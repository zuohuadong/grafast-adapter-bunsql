/**
 * EXPERIMENTAL: Polling-based PostgreSQL LISTEN/NOTIFY implementation
 * 
 * WARNING: This is an experimental feature that requires manual enablement.
 * Since Bun SQL doesn't support native LISTEN/NOTIFY events,
 * we use polling to implement similar functionality.
 * 
 * This approach has significant limitations:
 * - Has latency (depends on polling interval)
 * - Requires additional database table
 * - Consumes more resources
 * - Not as efficient as native LISTEN/NOTIFY
 * 
 * Only enable this feature if you understand these limitations and
 * have no alternative solution.
 * 
 * How it works:
 * 1. Create a notification table to store messages
 * 2. Use timer to poll for new messages
 * 3. Simulate LISTEN/NOTIFY behavior
 * 
 * Advantages:
 * - Works in Bun
 * - Message persistence (messages don't get lost)
 * - Can view historical messages
 * 
 * Disadvantages:
 * - Has latency (depends on polling interval)
 * - Requires additional database table
 * - Consumes more resources
 * - Not as efficient as native LISTEN/NOTIFY
 */

// Type definitions for Grafast - these would be available from grafast when installed
type GrafastSubscriber<TTopics extends { [key: string]: string }> = {
  subscribe<TTopic extends keyof TTopics>(topic: TTopic): AsyncIterableIterator<TTopics[TTopic]>;
  release(): void;
};

type Deferred<T> = {
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
  promise: Promise<T>;
};

// Type definitions for EventEmitter
interface EventEmitter {
  addListener(event: string, listener: (...args: any[]) => void): void;
  removeListener(event: string, listener: (...args: any[]) => void): void;
  emit(event: string, ...args: any[]): void;
}

// Type definitions for AsyncIterableIterator
interface AsyncIterableIterator<T> {
  next(): Promise<IteratorResult<T>>;
  return?(value?: any): Promise<IteratorResult<any>>;
  throw?(e?: any): Promise<IteratorResult<any>>;
  [Symbol.asyncIterator](): AsyncIterableIterator<T>;
}

interface IteratorResult<T> {
  done: boolean;
  value: T;
}

// Simple EventEmitter implementation
const createEventEmitter = (): EventEmitter => {
  const listeners: Record<string, ((...args: any[]) => void)[]> = {};
  
  return {
    addListener(event: string, listener: (...args: any[]) => void) {
      if (!listeners[event]) {
        listeners[event] = [];
      }
      listeners[event].push(listener);
    },
    removeListener(event: string, listener: (...args: any[]) => void) {
      if (listeners[event]) {
        const index = listeners[event].indexOf(listener);
        if (index > -1) {
          listeners[event].splice(index, 1);
        }
      }
    },
    emit(event: string, ...args: any[]) {
      if (listeners[event]) {
        listeners[event].forEach(listener => listener(...args));
      }
    }
  };
};

// Simple defer implementation
const createDeferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: any) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    resolve,
    reject,
    promise,
  };
};

interface NotificationRow {
  channel: string;
  payload: string;
  notified_at: Date;
}

// Type definition for Timer
type Timer = ReturnType<typeof setInterval>;

export class BunPgSubscriber<
  TTopics extends { [key: string]: string } = { [key: string]: string }
> implements GrafastSubscriber<TTopics> {
  private topics: { [topic in keyof TTopics]?: AsyncIterableIterator<any>[] } = {};
  private eventEmitter = createEventEmitter();
  private alive = true;
  private pollingInterval: Timer | null = null;
  private lastCheckTime: Date = new Date();
  private isPolling = false;

  constructor(
    private sql: Bun.SQLInterface,
    private options: {
      /**
       * Polling interval (milliseconds)
       * @default 1000
       */
      pollInterval?: number;
      /**
       * Notification table name
       * @default "pg_notify_queue"
       */
      tableName?: string;
      /**
       * Whether to auto-create table
       * @default true
       */
      autoCreateTable?: boolean;
      /**
       * Message retention time (seconds)
       * @default 3600 (1 hour)
       */
      messageRetention?: number;
    } = {}
  ) {
    console.warn(
      "WARNING: Using experimental polling-based LISTEN/NOTIFY implementation.\n" +
      "This approach has significant limitations:\n" +
      "- Has latency (depends on polling interval)\n" +
      "- Requires additional database table\n" +
      "- Consumes more resources\n" +
      "- Not as efficient as native LISTEN/NOTIFY\n\n" +
      "Only enable this feature if you understand these limitations and\n" +
      "have no alternative solution."
    );
    
    const {
      pollInterval = 1000,
      tableName = "pg_notify_queue",
      autoCreateTable = true,
      messageRetention = 3600,
    } = options;

    this.options = {
      pollInterval,
      tableName,
      autoCreateTable,
      messageRetention,
    };

    if (autoCreateTable) {
      this.setupTable().catch((e) => {
        console.error("Failed to setup notification table:", e);
      });
    }
  }

  /**
   * Create notification table
   */
  private async setupTable(): Promise<void> {
    const { tableName } = this.options;
    
    await this.sql.unsafe(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id SERIAL PRIMARY KEY,
        channel TEXT NOT NULL,
        payload TEXT,
        notified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed BOOLEAN DEFAULT FALSE,
        INDEX idx_channel_processed (channel, processed, notified_at)
      )
    `);

    // Create function to clean up old messages
    await this.sql.unsafe(`
      CREATE OR REPLACE FUNCTION cleanup_${tableName}()
      RETURNS void AS $$
      BEGIN
        DELETE FROM ${tableName}
        WHERE notified_at < NOW() - INTERVAL '${this.options.messageRetention} seconds';
      END;
      $$ LANGUAGE plpgsql;
    `);
  }

  /**
   * Send notification (alternative to NOTIFY)
   */
  async notify(channel: string, payload?: string): Promise<void> {
    const { tableName } = this.options;
    await this.sql.unsafe(
      `INSERT INTO ${tableName} (channel, payload) VALUES ($1, $2)`,
      [channel, payload || ""]
    );
  }

  /**
   * Poll for new messages
   */
  private async poll(): Promise<void> {
    if (this.isPolling || !this.alive) return;
    
    const { tableName } = this.options;
    const channels = Object.keys(this.topics);
    
    if (channels.length === 0) {
      return;
    }
    
    this.isPolling = true;
    try {
      // Query for new messages
      const notifications = await this.sql.unsafe<NotificationRow[]>(
        `
        UPDATE ${tableName}
        SET processed = TRUE
        WHERE id IN (
          SELECT id FROM ${tableName}
          WHERE channel = ANY($1)
            AND processed = FALSE
            AND notified_at > $2
          ORDER BY notified_at
          FOR UPDATE SKIP LOCKED
        )
        RETURNING channel, payload, notified_at
        `,
        [channels, this.lastCheckTime]
      );

      // Trigger events
      for (const notification of notifications) {
        this.eventEmitter.emit(notification.channel, notification.payload);
        if (notification.notified_at > this.lastCheckTime) {
          this.lastCheckTime = notification.notified_at;
        }
      }

      // Periodically clean up old messages
      if (Math.random() < 0.1) {
        await this.sql.unsafe(`SELECT cleanup_${tableName}()`);
      }
    } catch (e) {
      console.error("Error polling notifications:", e);
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Start polling
   */
  private startPolling(): void {
    if (this.pollingInterval) return;
    
    this.pollingInterval = setInterval(() => {
      this.poll();
    }, this.options.pollInterval);
  }

  /**
   * Stop polling
   */
  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  subscribe<TTopic extends keyof TTopics>(
    topic: TTopic
  ): AsyncIterableIterator<TTopics[TTopic]> {
    if (!this.alive) {
      throw new Error("This BunPgSubscriber has been released.");
    }

    const { eventEmitter, topics } = this;
    const stack: any[] = [];
    const queue: Deferred<any>[] = [];
    let finished: IteratorReturnResult<any> | false = false;

    function doFinally(value?: any) {
      if (!finished) {
        finished = { done: true, value };
        if (queue) {
          const promises = queue.splice(0, queue.length);
          promises.forEach((p) => {
            if (p.resolve) p.resolve(finished);
          });
        }
        eventEmitter.removeListener(topic as string, recv);
        
        const idx = topics[topic]?.indexOf(asyncIterableIterator);
        if (idx != null && idx >= 0) {
          topics[topic]!.splice(idx, 1);
          if (topics[topic]!.length === 0) {
            delete topics[topic];
            // If no more subscriptions, stop polling
            if (Object.keys(topics).length === 0) {
              that.stopPolling();
            }
          }
        }
      }
      return finished;
    }

    const that = this;
    const asyncIterableIterator: AsyncIterableIterator<any> = {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next() {
        if (stack.length > 0) {
          const value = await stack.shift();
          return { done: false, value };
        } else if (finished) {
          return finished;
        } else {
          const waiting = createDeferred<any>();
          queue.push(waiting);
          const result = await waiting.promise;
          // Check if this is a completion signal
          if (result && typeof result === 'object' && 'done' in result && result.done === true) {
            return result;
          }
          return { done: false, value: result };
        }
      },
      async return(value) {
        return doFinally(value);
      },
      async throw() {
        return doFinally();
      },
    };

    function recv(payload: any) {
      if (queue.length > 0) {
        const first = queue.shift();
        if (first) first.resolve(payload);
      } else {
        stack.push(payload);
      }
    }

    eventEmitter.addListener(topic as string, recv);

    if (!topics[topic]) {
      topics[topic] = [asyncIterableIterator];
      this.startPolling();
    } else {
      topics[topic]!.push(asyncIterableIterator);
    }

    return asyncIterableIterator;
  }

  async release(): Promise<void> {
    if (this.alive) {
      this.alive = false;
      this.stopPolling();
      
      for (const topic of Object.keys(this.topics)) {
        for (const asyncIterableIterator of this.topics[topic]!) {
          if (asyncIterableIterator.return) {
            await asyncIterableIterator.return();
          } else if (asyncIterableIterator.throw) {
            await asyncIterableIterator.throw(new Error("Subscriber released"));
          }
        }
      }
      
      this.topics = {} as any;
    }
  }
}

/**
 * EXPERIMENTAL: Native BunPgSubscriber (alias for compatibility)
 * 
 * WARNING: This is an experimental feature that requires manual enablement.
 * See BunPgSubscriber for more details about limitations.
 */
export const BunPgNativeSubscriber = BunPgSubscriber;
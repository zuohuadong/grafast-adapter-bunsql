/**
 * PostgreSQL LISTEN/NOTIFY support, built on Bun SQL's native `listen()` and `notify()`.
 */

// Type definitions for Grafast - these would be available from grafast when installed
type GrafastSubscriber<TTopics extends { [key: string]: string }> = {
  subscribe<TTopic extends keyof TTopics>(topic: TTopic): AsyncIterableIterator<TTopics[TTopic]>;
  release(): void;
};

type Waiter = {
  resolve: (result: IteratorResult<any>) => void;
  reject: (reason?: unknown) => void;
};

type Registration = {
  stop(): Promise<void>;
};

export class BunPgSubscriber<
  TTopics extends { [key: string]: string } = { [key: string]: string }
> implements GrafastSubscriber<TTopics> {
  private alive = true;
  private registrations = new Set<Registration>();

  constructor(private sql: Bun.SQL) {}

  /**
   * Send a NOTIFY on the given channel
   */
  async notify(channel: string, payload?: string): Promise<void> {
    await this.sql.notify(channel, payload);
  }

  subscribe<TTopic extends keyof TTopics>(
    topic: TTopic
  ): AsyncIterableIterator<TTopics[TTopic]> {
    if (!this.alive) {
      throw new Error("This BunPgSubscriber has been released.");
    }

    const buffer: any[] = [];
    const waiters: Waiter[] = [];
    let closed = false;

    const onnotify = (payload: string) => {
      if (closed) return;
      const waiter = waiters.shift();
      if (waiter) {
        waiter.resolve({ done: false, value: payload });
      } else {
        buffer.push(payload);
      }
    };

    const subscription = this.sql.listen(topic as string, onnotify);

    const stop = async () => {
      if (closed) return;
      closed = true;
      buffer.length = 0;
      for (const waiter of waiters.splice(0)) {
        waiter.resolve({ done: true, value: undefined });
      }
      this.registrations.delete(registration);
      await subscription.then((s) => s.unlisten()).catch(() => {});
    };

    // If LISTEN fails, end the iterator and surface the error to any pending `next()`
    subscription.catch((error) => {
      if (closed) return;
      closed = true;
      buffer.length = 0;
      this.registrations.delete(registration);
      for (const waiter of waiters.splice(0)) {
        waiter.reject(error);
      }
    });

    const registration: Registration = { stop };
    this.registrations.add(registration);

    const iterator: AsyncIterableIterator<any> = {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next() {
        if (buffer.length > 0) {
          return { done: false, value: buffer.shift() };
        }
        if (closed) {
          return { done: true, value: undefined };
        }
        return new Promise<IteratorResult<any>>((resolve, reject) => {
          waiters.push({ resolve, reject });
        });
      },
      async return(value?: any) {
        await stop();
        return { done: true, value };
      },
      async throw(error?: any) {
        await stop();
        throw error;
      },
    };

    return iterator;
  }

  async release(): Promise<void> {
    if (this.alive) {
      this.alive = false;
      await Promise.all([...this.registrations].map((r) => r.stop()));
      this.registrations.clear();
    }
  }
}

/**
 * Native BunPgSubscriber (alias for compatibility)
 */
export const BunPgNativeSubscriber = BunPgSubscriber;

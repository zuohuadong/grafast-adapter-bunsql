/**
 * Bun SQL adaptor for @dataplan/pg
 */

// Type placeholders - these would be available from @dataplan/pg and grafast when installed
import type {
  BunPgClient,
  BunPgAdaptorSettings,
  BunPgAdaptorMakePgServiceOptions,
} from "./types.js";
import { newBunPgClient } from "./client.js";
import { BunPgSubscriber } from "./subscriber.js";

// Additional type definitions
type WithPgClient<T> = any;

/**
 * Creates a withPgClient function for the given Bun SQL instance
 */
export function makeBunWithPgClient(
  sql: Bun.SQLInterface,
  release: () => void = () => {},
  options: {
    captureNotices?: boolean;
  } = {}
) {
  const withPgClient = async (
    pgSettings: any,
    callback: (client: BunPgClient) => Promise<any>,
  ) => {
    // Use reserve() to get an independent connection
    // This is similar to pg's pool.connect()
    const reserved = await sql.reserve();

    try {
      // Apply pgSettings
      if (pgSettings) {
        const entries = Object.entries(pgSettings).filter(
          ([_, v]) => v != null,
        );
        if (entries.length > 0) {
          // Use transaction to apply settings (set to local)
          return await reserved.begin(async (tx) => {
            for (const [key, value] of entries) {
              await tx.unsafe(`SELECT set_config($1, $2, true)`, [key, String(value)]);
            }

            // Execute callback within transaction
            const client = newBunPgClient(tx, 1, false, options);
            return await callback(client);
          });
        }
      }

      // No pgSettings, execute directly
      const client = newBunPgClient(reserved, 0, false, options);
      return await callback(client);
    } finally {
      // Release connection back to pool
      reserved.release();
    }
  };

  let released = false;
  const releaseOnce = () => {
    if (released) {
      throw new Error("Release called twice on the same withPgClient");
    } else {
      released = true;
      release();
    }
  };

  (withPgClient as any).release = releaseOnce;
  return withPgClient as any;
}

/**
 * Creates a withPgClient based on the provided settings
 */
export function createWithPgClient(
  options: BunPgAdaptorSettings = {},
  variant?: "SUPERUSER" | string | null,
  bunInstance: typeof Bun = Bun,
): WithPgClient<BunPgClient> {
  // If a ready-made SQL instance is provided, use it directly
  if (options.sql) {
    return makeBunWithPgClient(options.sql, undefined, {
      captureNotices: options.captureNotices,
    });
  }

  // Otherwise create new SQL instance
  const sqlOptions: Bun.SQLPostgresOrMySQLOptions = {
    adapter: "postgres",
    ...options.options,
  };

  if (options.connectionString) {
    sqlOptions.url = options.connectionString;
  }

  const sql = new bunInstance.SQL(sqlOptions as Bun.SQLPostgresOrMySQLOptions);
  const release = () => sql.end();
  
  return makeBunWithPgClient(sql, release, {
    captureNotices: options.captureNotices,
  });
}

/**
 * Creates a PgService configuration for Bun SQL
 */
export function makePgService(
  options: any,
  bunInstance: typeof Bun = Bun,
) {
  const {
    name = "main",
    sql: providedSql,
    connectionString,
    options: sqlOptions,
    superuserSql: providedSuperuserSql,
    superuserConnectionString,
    superuserOptions,
    schemas,
    withPgClientKey = name === "main" ? "withPgClient" : `${name}_withPgClient`,
    pgSettingsKey = name === "main" ? "pgSettings" : `${name}_pgSettings`,
    pgSubscriberKey = name === "main" ? "pgSubscriber" : `${name}_pgSubscriber`,
    pubsub = false,
    pgSettings,
    pgSettingsForIntrospection,
    captureNotices = false,
  } = options;

  const releasers: (() => void | Promise<void>)[] = [];

  // Create main SQL instance
  let sql: Bun.SQLInterface;
  if (providedSql) {
    sql = providedSql;
    releasers.push(() => sql.end());
  } else {
    const opts: Bun.SQLPostgresOrMySQLOptions = {
      adapter: "postgres",
      ...sqlOptions,
    };
    if (connectionString) {
      opts.url = connectionString;
    }
    sql = new bunInstance.SQL(opts);
    releasers.push(() => sql.end());
  }

  // Create superuser SQL instance (if needed)
  let superuserSql: Bun.SQLInterface | undefined;
  if (providedSuperuserSql) {
    superuserSql = providedSuperuserSql;
    releasers.push(() => superuserSql!.end());
  } else if (superuserConnectionString) {
    const opts: Bun.SQLPostgresOrMySQLOptions = {
      adapter: "postgres",
      ...superuserOptions,
      url: superuserConnectionString,
    };
    superuserSql = new bunInstance.SQL(opts);
    releasers.push(() => superuserSql!.end());
  }

  // Create subscriber (LISTEN/NOTIFY) when pubsub is enabled
  let pgSubscriber = options.pgSubscriber ?? null;
  if (!pgSubscriber && pubsub) {
    pgSubscriber = new BunPgSubscriber(sql as Bun.SQL);
    releasers.push(() => pgSubscriber!.release?.());
  }

  const service: any = {
    name,
    schemas: Array.isArray(schemas) ? schemas : [schemas ?? "public"],
    withPgClientKey: withPgClientKey as any,
    pgSettingsKey: pgSettingsKey as any,
    pgSubscriberKey: pgSubscriberKey as any,
    pgSettings,
    pgSettingsForIntrospection,
    pgSubscriber,
    adaptor: {
      createWithPgClient,
      makePgService,
    },
    adaptorSettings: {
      sql,
      connectionString,
      options: sqlOptions,
      superuserSql,
    },
    async release() {
      // Release resources in reverse order
      for (const releaser of [...releasers].reverse()) {
        try {
          await releaser();
        } catch (error) {
          // Log error but continue releasing other resources
          console.error("Error during resource release:", error);
        }
      }
    },
  };

  return service;
}

// Export adapter object to conform to interface
export const adaptor = {
  createWithPgClient,
  makePgService,
};
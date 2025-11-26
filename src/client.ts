/**
 * Bun SQL client implementation for @dataplan/pg
 */

// Type placeholders - these would be available from @dataplan/pg when installed
type PgClientQuery = {
  text: string;
  values?: any[];
  arrayMode?: boolean;
  name?: string;
};

type PgClientResult<T> = {
  rows: T[];
  rowCount: number;
  notices?: PgNotice[];
};

type PgNotice = {
  severity: string;
  message: string;
  code?: string;
  detail?: string;
  hint?: string;
  position?: number;
  internalPosition?: number;
  internalQuery?: string;
  where?: string;
  schema?: string;
  table?: string;
  column?: string;
  dataType?: string;
  constraint?: string;
  file?: string;
  line?: number;
  routine?: string;
};

// Type export for compatibility
export type { PgClientQuery, PgClientResult, PgNotice };

// Type definitions for Bun SQL - these would be available from Bun types
declare global {
  namespace Bun {
    interface SQLInterface {
      unsafe<T = any>(query: string, values?: any[]): Promise<T>;
      begin<T>(callback: (tx: TransactionSQL) => Promise<T>): Promise<T>;
      reserve(): Promise<ReservedSQL>;
      end(): Promise<void>;
    }

    interface TransactionSQL {
      unsafe<T = any>(query: string, values?: any[]): Promise<T>;
      savepoint<T>(callback: (tx: TransactionSQL) => Promise<T>): Promise<T>;
    }

    interface ReservedSQL {
      unsafe<T = any>(query: string, values?: any[]): Promise<T>;
      begin<T>(callback: (tx: TransactionSQL) => Promise<T>): Promise<T>;
      release(): void;
    }

    interface SQLConstructor {
      new(options: SQLPostgresOrMySQLOptions): SQLInterface;
      PostgresError: typeof SQLPostgresError;
    }

    const SQL: SQLConstructor;

    class SQLPostgresError extends Error {
      code?: string;
      detail?: string;
      hint?: string;
      position?: string;
      internalPosition?: string;
      internalQuery?: string;
      where?: string;
      schema?: string;
      table?: string;
      column?: string;
      dataType?: string;
      constraint?: string;
      file?: string;
      line?: string;
      routine?: string;
    }

    interface SQLPostgresOrMySQLOptions {
      adapter: string;
      url?: string;
      max?: number;
      idleTimeout?: number;
      connectionTimeout?: number;
      prepare?: boolean;
    }
  }
}

export type BunPgClient = {
  rawClient: any;
  withTransaction<T>(callback: (client: BunPgClient) => Promise<T>): Promise<T>;
  query<T>(opts: PgClientQuery): Promise<PgClientResult<T>>;
};

const EMPTY_ARRAY = Object.freeze([]) as never[];

/**
 * Attempt to extract NOTICE messages from errors
 * 
 * Note: Bun SQL currently doesn't directly expose NOTICE messages,
 * but we can try to extract them from certain error messages
 */
function extractNoticesFromError(error: any): PgNotice[] {
  const notices: PgNotice[] = [];
  
  // If it's a PostgresError, check for relevant information
  // Check for both actual Bun SQL PostgresError and our mock
  if (error instanceof Bun.SQLPostgresError ||
      (error.constructor && error.constructor.name === "PostgresError")) {
    // Some NOTICEs might appear as warnings in error details
    if (error.hint || error.detail) {
      notices.push({
        severity: "NOTICE",
        message: error.message,
        code: error.code,
        detail: error.detail,
        hint: error.hint,
        position: error.position ? parseInt(error.position, 10) : undefined,
        internalPosition: error.internalPosition ? parseInt(error.internalPosition, 10) : undefined,
        internalQuery: error.internalQuery,
        where: error.where,
        schema: error.schema,
        table: error.table,
        column: error.column,
        dataType: error.dataType,
        constraint: error.constraint,
        file: error.file,
        line: error.line ? parseInt(error.line, 10) : undefined,
        routine: error.routine,
      });
    }
  }
  
  return notices;
}

/**
 * Get session messages by querying pg_stat_activity (workaround)
 * 
 * This isn't real NOTICE, but can be used for debugging
 */
async function fetchSessionMessages(
  sql: Bun.SQLInterface | Bun.ReservedSQL | Bun.TransactionSQL
): Promise<PgNotice[]> {
  try {
    // Query recent warnings/messages from current session
    const result = await sql.unsafe<any[]>(`
      SELECT 
        'WARNING' as severity,
        message,
        '' as code
      FROM pg_stat_activity 
      WHERE pid = pg_backend_pid()
      AND state_change > NOW() - INTERVAL '1 second'
      LIMIT 5
    `);
    
    return result.map(row => ({
      severity: row.severity as any,
      message: row.message || "",
      code: row.code,
    }));
  } catch {
    return [];
  }
}

/**
 * Creates a new BunPgClient wrapper around a Bun SQL instance
 */
export function newBunPgClient(
  sql: Bun.SQLInterface | Bun.ReservedSQL | Bun.TransactionSQL,
  txLevel: number,
  alwaysQueue: boolean,
  options: {
    /**
     * Whether to attempt capturing NOTICE messages (experimental)
     * @default false
     */
    captureNotices?: boolean;
  } = {}
): BunPgClient {
  let queue: Promise<void> | null = null;

  const addToQueue = <T>(callback: () => Promise<T>): Promise<T> => {
    const result = queue ? queue.then(callback) : callback();
    const clearIfSame = () => {
      if (queue === newQueue) {
        queue = null;
      }
    };
    const newQueue = result.then(clearIfSame, clearIfSame);
    queue = newQueue;
    return result;
  };

  return {
    rawClient: sql,

    withTransaction(callback) {
      return addToQueue(async () => {
        // Bun SQL's begin() method automatically handles transactions
        // If already in a transaction, use savepoint
        if (txLevel > 0 && "savepoint" in sql) {
          return await (sql as Bun.TransactionSQL).savepoint(async (savepointSql) => {
            const newClient = newBunPgClient(savepointSql, txLevel + 1, alwaysQueue, options);
            return await callback(newClient);
          });
        } else {
          // Top-level transaction
          return await (sql as Bun.SQLInterface | Bun.ReservedSQL).begin(async (txSql: Bun.TransactionSQL) => {
            const newClient = newBunPgClient(txSql, txLevel + 1, alwaysQueue, options);
            return await callback(newClient);
          });
        }
      });
    },

    async query<TData>(opts: PgClientQuery): Promise<PgClientResult<TData>> {
      // Always use addToQueue to ensure proper queuing
      return addToQueue(() => doQuery());

      async function doQuery(): Promise<PgClientResult<TData>> {
        const { text, values = [], arrayMode, name } = opts;
        let notices: PgNotice[] = [];

        try {
          // Bun SQL uses unsafe method to execute queries with parameters
          // Note: Bun's prepared statements are automatically managed
          const result = await sql.unsafe<any[]>(text, values);

          // If NOTICE capture is enabled, try to get them
          if (options.captureNotices) {
            notices = await fetchSessionMessages(sql);
          }

          // Convert result format
          let rows: any[];
          if (arrayMode) {
            // Convert object array to value array
            rows = result.map((row) => Object.values(row));
          } else {
            rows = result;
          }

          return {
            rows: rows as TData[],
            rowCount: result.length,
            notices: notices.length > 0 ? notices : EMPTY_ARRAY,
          };
        } catch (error) {
          // Try to extract NOTICE from error
          if (options.captureNotices) {
            const errorNotices = extractNoticesFromError(error);
            if (errorNotices.length > 0) {
              notices = [...notices, ...errorNotices];
            }
          }

          // Convert Bun's error format
          // Check for both actual Bun SQL PostgresError and our mock
          if (error instanceof Bun.SQLPostgresError ||
              ((error as any)?.constructor && (error as any).constructor.name === "PostgresError")) {
            // Bun's error already contains all necessary information
            throw error;
          }
          throw error;
        }
      }
    },
  };
}
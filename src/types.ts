/**
 * Type definitions for Bun SQL adaptor
 */

// Type placeholders - these would be available from @dataplan/pg when installed
type PgClient = any;
type WithPgClient<T> = any;
type MakePgServiceOptions = any;
type PromiseOrDirect<T> = T | Promise<T>;
type PgAdaptor<T> = any;

declare global {
  namespace GraphileConfig {
    interface PgServiceConfiguration<T> {
      name: string;
      schemas: string[];
      withPgClientKey: any;
      pgSettingsKey: any;
      pgSubscriberKey: any;
      pgSettings?: any;
      pgSettingsForIntrospection?: any;
      pgSubscriber?: any;
      adaptor: PgAdaptor<T>;
      adaptorSettings: any;
      release(): Promise<void>;
    }
  }
}

export interface BunPgClient extends PgClient {
  rawClient: any; // Bun.SQL | Bun.ReservedSQL | Bun.TransactionSQL
  withTransaction<T>(callback: (client: BunPgClient) => Promise<T>): Promise<T>;
  query<T>(opts: any): Promise<any>;
}

export interface BunPgAdaptorSettings {
  /**
   * Bun SQL instance (if you want to provide your own)
   */
  sql?: Bun.SQLInterface;
  
  /**
   * Connection string
   */
  connectionString?: string;
  
  /**
   * Bun SQL options
   */
  options?: Bun.SQL.PostgresOrMySQLOptions;
  
  /**
   * Whether to attempt capturing NOTICE messages (experimental)
   * @default false
   */
  captureNotices?: boolean;
}

export interface BunPgAdaptorMakePgServiceOptions extends MakePgServiceOptions {
  /**
   * Bun SQL instance (if you want to provide your own)
   */
  sql?: Bun.SQLInterface;
  
  /**
   * Connection string
   */
  connectionString?: string;
  
  /**
   * Bun SQL options
   */
  options?: Bun.SQL.PostgresOrMySQLOptions;
  
  /**
   * Superuser SQL instance for installing watch fixtures
   */
  superuserSql?: Bun.SQLInterface;
  
  /**
   * Superuser connection string
   */
  superuserConnectionString?: string;
  
  /**
   * Superuser SQL options
   */
  superuserOptions?: Bun.SQL.PostgresOrMySQLOptions;
  
  /**
   * Whether to attempt capturing NOTICE messages (experimental)
   * @default false
   */
  captureNotices?: boolean;
  
  /**
   * Enable LISTEN/NOTIFY support (creates a BunPgSubscriber)
   * @default false
   */
  pubsub?: boolean;

  /**
   * Custom subscriber instance
   */
  pgSubscriber?: any;
}
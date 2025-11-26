/**
 * @dataplan/pg-bun - Bun SQL native adaptor for @dataplan/pg
 * 
 * This adaptor allows you to use Bun's native PostgreSQL driver with @dataplan/pg
 * instead of the node-postgres (pg) package.
 * 
 * @example
 * ```typescript
 * import { makePgService } from "@dataplan/pg-bun";
 * 
 * const pgService = makePgService({
 *   connectionString: process.env.DATABASE_URL,
 *   schemas: ["public"],
 *   options: {
 *     max: 20,
 *     idleTimeout: 30,
 *   },
 * });
 * 
 * // Use in your Grafast preset
 * const preset = {
 *   pgServices: [pgService],
 * };
 * ```
 */

export { createWithPgClient, makePgService, adaptor } from "./adaptor.js";
export { newBunPgClient } from "./client.js";
export { BunPgSubscriber, BunPgNativeSubscriber } from "./subscriber.js";
export type {
  BunPgClient,
  BunPgAdaptorSettings,
  BunPgAdaptorMakePgServiceOptions,
} from "./types.js";
export type { PgClientQuery, PgClientResult, PgNotice } from "./client.js";
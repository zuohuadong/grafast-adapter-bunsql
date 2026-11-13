import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { makePgService } from "../../src/adaptor.js";

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)("integration against PostgreSQL", () => {
  let service: any;
  let withPgClient: any;

  beforeAll(() => {
    service = makePgService({ connectionString: DATABASE_URL, pubsub: true });
    withPgClient = service.adaptor.createWithPgClient({ sql: service.adaptorSettings.sql });
  });

  afterAll(async () => {
    await service?.release();
  });

  test("runs a parameterised query and returns rows", async () => {
    const result = await withPgClient(null, (client: any) =>
      client.query({ text: "SELECT $1::int AS n, 'x'::text AS s", values: [7] }),
    );
    expect(result.rows).toEqual([{ n: 7, s: "x" }]);
    expect(result.rowCount).toBe(1);
  });

  test("arrayMode returns value arrays", async () => {
    const result = await withPgClient(null, (client: any) =>
      client.query({ text: "SELECT 1 AS a, 'b'::text AS b", arrayMode: true }),
    );
    expect(result.rows).toEqual([[1, "b"]]);
  });

  test("pgSettings are visible to queries inside the callback", async () => {
    const result = await withPgClient({ "app.user_id": "42" }, (client: any) =>
      client.query({ text: "SELECT current_setting('app.user_id') AS v" }),
    );
    expect(result.rows).toEqual([{ v: "42" }]);
  });

  test("transactions commit, and nested transactions use savepoints", async () => {
    const result = await withPgClient(null, (client: any) =>
      client.withTransaction(async (tx: any) => {
        await tx.withTransaction(async (inner: any) => inner.query({ text: "SELECT 1 AS n" }));
        return tx.query({ text: "SELECT 2 AS n" });
      }),
    );
    expect(result.rows).toEqual([{ n: 2 }]);
  });

  test("a failing transaction rethrows its error", async () => {
    await expect(
      withPgClient(null, (client: any) =>
        client.withTransaction(async () => {
          throw new Error("rollback me");
        }),
      ),
    ).rejects.toThrow("rollback me");
  });

  test("query errors from PostgreSQL propagate with their message", async () => {
    await expect(
      withPgClient(null, (client: any) =>
        client.query({ text: "SELECT * FROM definitely_missing_table_xyz" }),
      ),
    ).rejects.toThrow(/definitely_missing_table_xyz/);
  });

  test("captureNotices returns rows and a notices array", async () => {
    const capturing = service.adaptor.createWithPgClient({
      sql: service.adaptorSettings.sql,
      captureNotices: true,
    });
    const result = await capturing(null, (client: any) => client.query({ text: "SELECT 1 AS n" }));
    expect(result.rows).toEqual([{ n: 1 }]);
    expect(Array.isArray(result.notices)).toBe(true);
  });

  test("LISTEN receives a NOTIFY sent via the subscriber", async () => {
    const channel = `pgbun_itest_${Date.now()}`;
    const iterator = service.pgSubscriber.subscribe(channel);

    const pending = iterator.next();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await service.pgSubscriber.notify(channel, "hello-from-test");

    expect(await pending).toEqual({ done: false, value: "hello-from-test" });
    await iterator.return();
  });
});

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  adaptor,
  createWithPgClient,
  makeBunWithPgClient,
  makePgService,
} from "../../src/adaptor.js";
import * as index from "../../src/index.js";
import { BunPgSubscriber } from "../../src";
import { createFakeBun, createFakeReserved, createFakeSql, createFakeTx } from "./fake-sql.js";

describe("makeBunWithPgClient", () => {
  test("without pgSettings runs the callback on the reserved connection and releases it", async () => {
    const sql = createFakeSql();
    const reserved = createFakeReserved();
    sql.reserve.mockImplementationOnce(async () => reserved);
    const withPgClient = makeBunWithPgClient(sql);

    const result = await withPgClient(null, async (client: any) => {
      expect(client.rawClient).toBe(reserved);
      return "value";
    });

    expect(result).toBe("value");
    expect(reserved.begin).not.toHaveBeenCalled();
    expect(reserved.release).toHaveBeenCalledTimes(1);
  });

  test("releases the reserved connection when the callback throws", async () => {
    const sql = createFakeSql();
    const reserved = createFakeReserved();
    sql.reserve.mockImplementationOnce(async () => reserved);
    const withPgClient = makeBunWithPgClient(sql);

    await expect(
      withPgClient(null, async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");
    expect(reserved.release).toHaveBeenCalledTimes(1);
  });

  test("non-null pgSettings are applied with set_config inside a transaction", async () => {
    const sql = createFakeSql();
    const reserved = createFakeReserved();
    const tx = createFakeTx();
    sql.reserve.mockImplementationOnce(async () => reserved);
    reserved.begin.mockImplementationOnce(async (cb: any) => cb(tx));
    const withPgClient = makeBunWithPgClient(sql);

    const result = await withPgClient(
      { role: "app_user", empty: null, undef: undefined, count: 3 },
      async (client: any) => {
        expect(client.rawClient).toBe(tx);
        return "from-callback";
      },
    );

    expect(result).toBe("from-callback");
    expect(tx.unsafe.mock.calls).toEqual([
      ["SELECT set_config($1, $2, true)", ["role", "app_user"]],
      ["SELECT set_config($1, $2, true)", ["count", "3"]],
    ]);
    expect(reserved.release).toHaveBeenCalledTimes(1);
  });

  test("pgSettings with only null values skip the transaction", async () => {
    const sql = createFakeSql();
    const reserved = createFakeReserved();
    sql.reserve.mockImplementationOnce(async () => reserved);
    const withPgClient = makeBunWithPgClient(sql);

    await withPgClient({ a: null, b: undefined }, async () => 1);
    expect(reserved.begin).not.toHaveBeenCalled();
  });

  test("release is callable once; a second call throws", () => {
    const release = mock(() => {});
    const withPgClient = makeBunWithPgClient(createFakeSql(), release);
    withPgClient.release();
    expect(release).toHaveBeenCalledTimes(1);
    expect(() => withPgClient.release()).toThrow("Release called twice on the same withPgClient");
  });

  test("release defaults to a no-op when no releaser is given", () => {
    const withPgClient = makeBunWithPgClient(createFakeSql());
    expect(() => withPgClient.release()).not.toThrow();
  });
});

describe("createWithPgClient", () => {
  test("uses a provided SQL instance and does not construct one", async () => {
    const sql = createFakeSql();
    const { bun, constructed } = createFakeBun();
    const withPgClient = createWithPgClient({ sql }, null, bun);

    await withPgClient(null, async () => "ok");

    expect(constructed).toHaveLength(0);
    expect(sql.reserve).toHaveBeenCalledTimes(1);
  });

  test("creates a SQL instance from connectionString and options", () => {
    const { bun, constructed } = createFakeBun();
    const withPgClient = createWithPgClient(
      { connectionString: "postgres://u@h/db", options: { max: 4 } },
      null,
      bun,
    );

    expect(constructed).toEqual([{ adapter: "postgres", max: 4, url: "postgres://u@h/db" }]);
    expect(typeof withPgClient).toBe("function");
  });

  test("creates a SQL instance without a connection string", () => {
    const { bun, constructed } = createFakeBun();
    createWithPgClient({}, undefined, bun);
    expect(constructed).toEqual([{ adapter: "postgres" }]);
  });

  test("release of a constructed instance ends the SQL connection", () => {
    const { bun, sql } = createFakeBun();
    const withPgClient = createWithPgClient({ connectionString: "postgres://x" }, null, bun);
    withPgClient.release();
    expect(sql.end).toHaveBeenCalledTimes(1);
  });
});

describe("makePgService", () => {
  let errorSpy: ReturnType<typeof mock>;
  let originalError: typeof console.error;

  beforeEach(() => {
    originalError = console.error;
    errorSpy = mock(() => {});
    console.error = errorSpy as any;
  });

  afterEach(() => {
    console.error = originalError;
  });

  test("defaults for the main service", () => {
    const service = makePgService({ sql: createFakeSql() }, createFakeBun().bun);

    expect(service.name).toBe("main");
    expect(service.schemas).toEqual(["public"]);
    expect(service.withPgClientKey).toBe("withPgClient");
    expect(service.pgSettingsKey).toBe("pgSettings");
    expect(service.pgSubscriberKey).toBe("pgSubscriber");
    expect(service.pgSubscriber).toBeNull();
    expect(typeof service.adaptor.createWithPgClient).toBe("function");
    expect(typeof service.adaptor.makePgService).toBe("function");
  });

  test("non-main service prefixes its keys with the name", () => {
    const service = makePgService({ name: "other", sql: createFakeSql() }, createFakeBun().bun);
    expect(service.withPgClientKey).toBe("other_withPgClient");
    expect(service.pgSettingsKey).toBe("other_pgSettings");
    expect(service.pgSubscriberKey).toBe("other_pgSubscriber");
  });

  test("explicit keys take precedence over name-derived keys", () => {
    const service = makePgService(
      {
        name: "other",
        sql: createFakeSql(),
        withPgClientKey: "wpc",
        pgSettingsKey: "ps",
        pgSubscriberKey: "sub",
      },
      createFakeBun().bun,
    );
    expect(service.withPgClientKey).toBe("wpc");
    expect(service.pgSettingsKey).toBe("ps");
    expect(service.pgSubscriberKey).toBe("sub");
  });

  test("schemas are normalised to an array", () => {
    const single = makePgService({ sql: createFakeSql(), schemas: "app" }, createFakeBun().bun);
    const many = makePgService({ sql: createFakeSql(), schemas: ["a", "b"] }, createFakeBun().bun);
    expect(single.schemas).toEqual(["app"]);
    expect(many.schemas).toEqual(["a", "b"]);
  });

  test("pgSettings and pgSettingsForIntrospection are passed through", () => {
    const sql = createFakeSql();
    const service = makePgService(
      { sql, pgSettings: { role: "x" }, pgSettingsForIntrospection: { role: "y" } },
      createFakeBun().bun,
    );
    expect(service.pgSettings).toEqual({ role: "x" });
    expect(service.pgSettingsForIntrospection).toEqual({ role: "y" });
    expect(service.adaptorSettings.sql).toBe(sql);
  });

  test("creates a SQL instance from connectionString and options", () => {
    const { bun, constructed, sql } = createFakeBun();
    const service = makePgService({ connectionString: "postgres://c", options: { max: 2 } }, bun);
    expect(constructed).toEqual([{ adapter: "postgres", max: 2, url: "postgres://c" }]);
    expect(service.adaptorSettings.sql).toBe(sql);
    expect(service.adaptorSettings.connectionString).toBe("postgres://c");
  });

  test("creates a SQL instance without connectionString", () => {
    const { bun, constructed } = createFakeBun();
    makePgService({}, bun);
    expect(constructed).toEqual([{ adapter: "postgres" }]);
  });

  test("creates a superuser SQL instance from superuserConnectionString", () => {
    const { bun, constructed, sql } = createFakeBun();
    const service = makePgService(
      { sql: createFakeSql(), superuserConnectionString: "postgres://root", superuserOptions: { max: 1 } },
      bun,
    );
    expect(constructed).toEqual([{ adapter: "postgres", max: 1, url: "postgres://root" }]);
    expect(service.adaptorSettings.superuserSql).toBe(sql);
  });

  test("uses a provided superuserSql instance", () => {
    const superuserSql = createFakeSql();
    const { bun, constructed } = createFakeBun();
    const service = makePgService({ sql: createFakeSql(), superuserSql }, bun);
    expect(constructed).toHaveLength(0);
    expect(service.adaptorSettings.superuserSql).toBe(superuserSql);
  });

  test("release ends the provided SQL instance", async () => {
    const sql = createFakeSql();
    const service = makePgService({ sql }, createFakeBun().bun);
    await service.release();
    expect(sql.end).toHaveBeenCalledTimes(1);
  });

  test("release ends the provided superuser SQL instance too", async () => {
    const sql = createFakeSql();
    const superuserSql = createFakeSql();
    const service = makePgService({ sql, superuserSql }, createFakeBun().bun);
    await service.release();
    expect(sql.end).toHaveBeenCalledTimes(1);
    expect(superuserSql.end).toHaveBeenCalledTimes(1);
  });

  test("release ends a constructed main SQL instance", async () => {
    const { bun, sql } = createFakeBun();
    const service = makePgService({ connectionString: "postgres://c" }, bun);
    await service.release();
    expect(sql.end).toHaveBeenCalledTimes(1);
  });

  test("release ends a constructed superuser SQL instance", async () => {
    const { bun, sql } = createFakeBun();
    const service = makePgService({ sql: createFakeSql(), superuserConnectionString: "postgres://root" }, bun);
    await service.release();
    expect(sql.end).toHaveBeenCalledTimes(1);
  });

  test("pubsub: true creates a BunPgSubscriber and release stops it", async () => {
    const sql = createFakeSql();
    const service = makePgService({ sql, pubsub: true }, createFakeBun().bun);
    expect(service.pgSubscriber).toBeInstanceOf(BunPgSubscriber);

    const iterator = service.pgSubscriber.subscribe("topic");
    await service.release();

    expect(await iterator.next()).toEqual({ done: true, value: undefined });
    expect(sql.end).toHaveBeenCalledTimes(1);
  });

  test("pubsub: false does not create a subscriber", () => {
    const service = makePgService({ sql: createFakeSql() }, createFakeBun().bun);
    expect(service.pgSubscriber).toBeNull();
  });

  test("a provided pgSubscriber is exposed as-is and not released by the service", async () => {
    const pgSubscriber = { release: mock(() => {}) };
    const service = makePgService({ sql: createFakeSql(), pgSubscriber }, createFakeBun().bun);
    expect(service.pgSubscriber).toBe(pgSubscriber);
    await service.release();
    expect(pgSubscriber.release).not.toHaveBeenCalled();
  });

  test("a provided pgSubscriber takes precedence over pubsub", () => {
    const pgSubscriber = {};
    const service = makePgService({ sql: createFakeSql(), pubsub: true, pgSubscriber }, createFakeBun().bun);
    expect(service.pgSubscriber).toBe(pgSubscriber);
  });

  test("release continues after a failing releaser and logs the error", async () => {
    const failing = createFakeSql();
    failing.end.mockImplementationOnce(async () => {
      throw new Error("end failed");
    });
    const healthy = createFakeSql();
    const service = makePgService({ sql: failing, superuserSql: healthy }, createFakeBun().bun);

    await service.release();

    expect(healthy.end).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("Error during resource release:", expect.any(Error));
  });
});

describe("adaptor export", () => {
  test("exposes createWithPgClient and makePgService", () => {
    expect(adaptor.createWithPgClient).toBe(createWithPgClient);
    expect(adaptor.makePgService).toBe(makePgService);
  });

  test("package index re-exports the public API", () => {
    expect(index.createWithPgClient).toBe(createWithPgClient);
    expect(index.makePgService).toBe(makePgService);
    expect(index.adaptor).toBe(adaptor);
    expect(index.BunPgSubscriber).toBe(BunPgSubscriber);
    expect(index.BunPgNativeSubscriber).toBe(BunPgSubscriber);
    expect(typeof index.newBunPgClient).toBe("function");
  });
});

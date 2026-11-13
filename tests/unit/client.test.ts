import { describe, expect, mock, test } from "bun:test";
import { newBunPgClient } from "../../src";
import { createFakeSql, createFakeTx } from "./fake-sql.js";

class PostgresError extends Error {
  hint?: string;
  detail?: string;
  code?: string;
  constructor(message: string, props: Record<string, string | undefined> = {}) {
    super(message);
    Object.assign(this, props);
  }
}

describe("newBunPgClient query", () => {
  test("exposes the raw client", () => {
    const sql = createFakeSql();
    expect(newBunPgClient(sql, 0, false).rawClient).toBe(sql);
  });

  test("runs the query with values and returns rows", async () => {
    const sql = createFakeSql();
    sql.unsafe.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    const client = newBunPgClient(sql, 0, false);

    const result = await client.query({ text: "SELECT id FROM t WHERE x = $1", values: [5] });

    expect(sql.unsafe).toHaveBeenCalledWith("SELECT id FROM t WHERE x = $1", [5]);
    expect(result.rows).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.rowCount).toBe(2);
    expect(result.notices).toEqual([]);
  });

  test("defaults values to an empty array", async () => {
    const sql = createFakeSql();
    await newBunPgClient(sql, 0, false).query({ text: "SELECT 1" });
    expect(sql.unsafe).toHaveBeenCalledWith("SELECT 1", []);
  });

  test("arrayMode returns row values instead of objects", async () => {
    const sql = createFakeSql();
    sql.unsafe.mockResolvedValueOnce([{ a: 1, b: "x" }]);
    const result = await newBunPgClient(sql, 0, false).query({ text: "SELECT a, b", arrayMode: true });
    expect(result.rows).toEqual([[1, "x"]]);
    expect(result.rowCount).toBe(1);
  });

  test("serializes queries issued on the same client", async () => {
    const sql = createFakeSql();
    let resolveFirst!: (value: any[]) => void;
    sql.unsafe
      .mockImplementationOnce(() => new Promise<any[]>((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce([{ n: 2 }]);
    const client = newBunPgClient(sql, 0, false);

    const first = client.query({ text: "first" });
    const second = client.query({ text: "second" });
    await Promise.resolve();
    expect(sql.unsafe).toHaveBeenCalledTimes(1);

    resolveFirst([{ n: 1 }]);
    expect((await first).rows).toEqual([{ n: 1 }]);
    expect((await second).rows).toEqual([{ n: 2 }]);
    expect(sql.unsafe).toHaveBeenCalledTimes(2);
  });

  test("a failed query does not block the queue", async () => {
    const sql = createFakeSql();
    sql.unsafe.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce([{ ok: true }]);
    const client = newBunPgClient(sql, 0, false);

    const failing = client.query({ text: "bad" });
    const passing = client.query({ text: "good" });

    await expect(failing).rejects.toThrow("boom");
    expect((await passing).rows).toEqual([{ ok: true }]);
  });

  test("rethrows Postgres errors without notice capture", async () => {
    const sql = createFakeSql();
    const error = new PostgresError("syntax", { hint: "try x" });
    sql.unsafe.mockRejectedValueOnce(error);
    await expect(newBunPgClient(sql, 0, false).query({ text: "bad" })).rejects.toBe(error);
  });

  test("captureNotices returns session messages from pg_stat_activity", async () => {
    const sql = createFakeSql();
    sql.unsafe
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([{ severity: "WARNING", message: "careful", code: "" }]);
    const client = newBunPgClient(sql, 0, false, { captureNotices: true });

    const result = await client.query({ text: "SELECT id" });

    expect(result.rows).toEqual([{ id: 1 }]);
    expect(result.notices).toEqual([{ severity: "WARNING", message: "careful", code: "" }]);
    expect(sql.unsafe.mock.calls[1][0]).toContain("pg_stat_activity");
  });

  test("captureNotices maps a missing message to an empty string", async () => {
    const sql = createFakeSql();
    sql.unsafe
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ severity: "WARNING", message: null, code: undefined }]);
    const result = await newBunPgClient(sql, 0, false, { captureNotices: true }).query({ text: "x" });
    expect(result.notices).toEqual([{ severity: "WARNING", message: "", code: undefined }]);
  });

  test("captureNotices yields no notices when the session lookup fails", async () => {
    const sql = createFakeSql();
    sql.unsafe.mockResolvedValueOnce([{ id: 1 }]).mockRejectedValueOnce(new Error("no stat access"));
    const result = await newBunPgClient(sql, 0, false, { captureNotices: true }).query({ text: "x" });
    expect(result.rows).toEqual([{ id: 1 }]);
    expect(result.notices).toEqual([]);
  });

  test("captureNotices still rethrows a PostgresError that carries a hint", async () => {
    const sql = createFakeSql();
    const error = new PostgresError("relation missing", { hint: "create it", detail: "table x", code: "42P01" });
    sql.unsafe.mockRejectedValueOnce(error);
    const client = newBunPgClient(sql, 0, false, { captureNotices: true });
    await expect(client.query({ text: "SELECT * FROM x" })).rejects.toBe(error);
  });

  test("captureNotices ignores Postgres errors without hint or detail", async () => {
    const sql = createFakeSql();
    const error = new PostgresError("plain");
    sql.unsafe.mockRejectedValueOnce(error);
    await expect(newBunPgClient(sql, 0, false, { captureNotices: true }).query({ text: "x" })).rejects.toBe(error);
  });

  test("captureNotices ignores non-Postgres errors", async () => {
    const sql = createFakeSql();
    const error = new Error("network");
    sql.unsafe.mockRejectedValueOnce(error);
    await expect(newBunPgClient(sql, 0, false, { captureNotices: true }).query({ text: "x" })).rejects.toBe(error);
  });

  test("captureNotices recognises errors built from Bun's PostgresError class", async () => {
    const sql = createFakeSql();
    const error = Object.assign(Object.create(Bun.SQL.PostgresError.prototype), {
      message: "bad",
      hint: "h",
      position: "4",
    });
    sql.unsafe.mockRejectedValueOnce(error);
    await expect(newBunPgClient(sql, 0, false, { captureNotices: true }).query({ text: "x" })).rejects.toBe(error);
  });
});

describe("newBunPgClient withTransaction", () => {
  test("top-level transaction uses sql.begin and passes a nested client", async () => {
    const tx = createFakeTx();
    const sql = createFakeSql();
    sql.begin.mockImplementationOnce(async (cb: any) => cb(tx));
    const client = newBunPgClient(sql, 0, false);

    const result = await client.withTransaction(async (txClient) => {
      expect(txClient.rawClient).toBe(tx);
      return "done";
    });

    expect(result).toBe("done");
    expect(sql.begin).toHaveBeenCalledTimes(1);
    expect(tx.savepoint).not.toHaveBeenCalled();
  });

  test("nested transaction uses a savepoint on the transaction handle", async () => {
    const tx = createFakeTx();
    const sql = createFakeSql();
    sql.begin.mockImplementationOnce(async (cb: any) => cb(tx));
    const client = newBunPgClient(sql, 0, false);

    await client.withTransaction(async (txClient) => {
      await txClient.withTransaction(async () => 1);
    });

    expect(tx.savepoint).toHaveBeenCalledTimes(1);
  });

  test("nested level without savepoint support falls back to begin", async () => {
    const sql = createFakeSql();
    await newBunPgClient(sql, 1, false).withTransaction(async () => "ok");
    expect(sql.begin).toHaveBeenCalledTimes(1);
  });

  test("savepoint clients run the callback on the savepoint handle", async () => {
    const tx = createFakeTx();
    const sql = createFakeSql();
    tx.savepoint.mockImplementationOnce(async (cb: any) => cb(tx));
    const callback = mock(async (c: any) => c.rawClient);

    const result = await newBunPgClient(tx, 1, false).withTransaction(callback);

    expect(result).toBe(tx);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(sql.begin).not.toHaveBeenCalled();
  });

  test("errors inside a transaction propagate", async () => {
    const sql = createFakeSql();
    await expect(
      newBunPgClient(sql, 0, false).withTransaction(async () => {
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
  });
});

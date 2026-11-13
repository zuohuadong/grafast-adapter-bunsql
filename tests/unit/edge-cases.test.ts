import { describe, expect, test } from "bun:test";
import { makeBunWithPgClient } from "../../src/adaptor.js";
import { newBunPgClient } from "../../src/client.js";
import { BunPgSubscriber } from "../../src/subscriber.js";
import { createFakeReserved, createFakeSql, createFakeTx } from "./fake-sql.js";

function listenerOf(sql: any, index = 0): (payload: string) => void {
  return sql.listen.mock.calls[index][1];
}

describe("edge cases: client", () => {
  test("arrayMode on an empty result returns no rows", async () => {
    const sql = createFakeSql();
    const result = await newBunPgClient(sql, 0, false).query({ text: "q", arrayMode: true });
    expect(result).toEqual({ rows: [], rowCount: 0, notices: [] });
  });

  test("a query waits for an in-flight transaction on the same client", async () => {
    const sql = createFakeSql();
    let openGate!: () => void;
    sql.begin.mockImplementationOnce(async (cb: any) => {
      await new Promise<void>((resolve) => (openGate = resolve));
      return cb(createFakeTx());
    });
    const client = newBunPgClient(sql, 0, false);

    const transaction = client.withTransaction(async () => "done");
    const query = client.query({ text: "after" });
    await Promise.resolve();
    expect(sql.unsafe).not.toHaveBeenCalled();

    openGate();
    expect(await transaction).toBe("done");
    await query;
    expect(sql.unsafe).toHaveBeenCalledTimes(1);
  });
});

describe("edge cases: makeBunWithPgClient", () => {
  test("falsy but non-null pgSettings values are applied as strings", async () => {
    const sql = createFakeSql();
    const reserved = createFakeReserved();
    const tx = createFakeTx();
    sql.reserve.mockImplementationOnce(async () => reserved);
    reserved.begin.mockImplementationOnce(async (cb: any) => cb(tx));

    await makeBunWithPgClient(sql)({ a: 0, b: false, c: "", d: null }, async () => "ok");

    expect(tx.unsafe.mock.calls).toEqual([
      ["SELECT set_config($1, $2, true)", ["a", "0"]],
      ["SELECT set_config($1, $2, true)", ["b", "false"]],
      ["SELECT set_config($1, $2, true)", ["c", ""]],
    ]);
  });

  test("a callback error inside the pgSettings transaction still releases the connection", async () => {
    const sql = createFakeSql();
    const reserved = createFakeReserved();
    sql.reserve.mockImplementationOnce(async () => reserved);

    await expect(
      makeBunWithPgClient(sql)({ role: "x" }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(reserved.release).toHaveBeenCalledTimes(1);
  });

  test("a failed reserve() rejects without releasing anything", async () => {
    const sql = createFakeSql();
    sql.reserve.mockImplementationOnce(async () => {
      throw new Error("no connections");
    });
    const callback = async () => "never";

    await expect(makeBunWithPgClient(sql)(null, callback)).rejects.toThrow("no connections");
  });
});

describe("edge cases: subscriber", () => {
  test("two subscriptions to the same topic keep separate buffers", async () => {
    const sql = createFakeSql();
    const subscriber = new BunPgSubscriber(sql);
    const first = subscriber.subscribe("topic");
    const second = subscriber.subscribe("topic");
    expect(sql.listen).toHaveBeenCalledTimes(2);

    listenerOf(sql, 0)("only-first");
    expect(await first.next()).toEqual({ done: false, value: "only-first" });

    const pending = second.next();
    listenerOf(sql, 1)("for-second");
    expect(await pending).toEqual({ done: false, value: "for-second" });
  });

  test("multiple pending next() calls resolve in FIFO order", async () => {
    const sql = createFakeSql();
    const iterator = new BunPgSubscriber(sql).subscribe("topic");
    const firstPending = iterator.next();
    const secondPending = iterator.next();

    listenerOf(sql)("x");
    listenerOf(sql)("y");

    expect(await firstPending).toEqual({ done: false, value: "x" });
    expect(await secondPending).toEqual({ done: false, value: "y" });
  });

  test("an empty-string payload is delivered and sent as-is", async () => {
    const sql = createFakeSql();
    const subscriber = new BunPgSubscriber(sql);
    const iterator = subscriber.subscribe("topic");
    const pending = iterator.next();

    listenerOf(sql)("");
    expect(await pending).toEqual({ done: false, value: "" });

    await subscriber.notify("topic", "");
    expect(sql.notify).toHaveBeenCalledWith("topic", "");
  });
});

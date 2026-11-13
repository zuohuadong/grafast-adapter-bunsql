import { describe, expect, test } from "bun:test";
import { BunPgNativeSubscriber, BunPgSubscriber } from "../../src/subscriber.js";
import { createFakeSql } from "./fake-sql.js";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function listenerOf(sql: any, index = 0): (payload: string) => void {
  return sql.listen.mock.calls[index][1];
}

describe("BunPgSubscriber", () => {
  test("native alias points to the same class", () => {
    expect(BunPgNativeSubscriber).toBe(BunPgSubscriber);
  });

  test("notify delegates to sql.notify", async () => {
    const sql = createFakeSql();
    await new BunPgSubscriber(sql).notify("chan", "payload");
    expect(sql.notify).toHaveBeenCalledWith("chan", "payload");
  });

  test("notify without payload passes undefined through", async () => {
    const sql = createFakeSql();
    await new BunPgSubscriber(sql).notify("chan");
    expect(sql.notify).toHaveBeenCalledWith("chan", undefined);
  });

  test("subscribe registers a LISTEN on the topic", () => {
    const sql = createFakeSql();
    new BunPgSubscriber(sql).subscribe("topic-a");
    expect(sql.listen).toHaveBeenCalledWith("topic-a", expect.any(Function));
  });

  test("delivers a payload to a pending next()", async () => {
    const sql = createFakeSql();
    const it = new BunPgSubscriber(sql).subscribe("t");
    const pending = it.next();
    listenerOf(sql)("hello");
    expect(await pending).toEqual({ done: false, value: "hello" });
  });

  test("buffers payloads received before next() is called, in order", async () => {
    const sql = createFakeSql();
    const it = new BunPgSubscriber(sql).subscribe("t");
    listenerOf(sql)("one");
    listenerOf(sql)("two");
    expect(await it.next()).toEqual({ done: false, value: "one" });
    expect(await it.next()).toEqual({ done: false, value: "two" });
  });

  test("ignores payloads delivered after the iterator is closed", async () => {
    const sql = createFakeSql();
    const it = new BunPgSubscriber(sql).subscribe("t");
    const onnotify = listenerOf(sql);
    await it.return!();
    onnotify("late");
    expect(await it.next()).toEqual({ done: true, value: undefined });
  });

  test("return() unlistens and ends the iterator", async () => {
    const sql = createFakeSql();
    const it = new BunPgSubscriber(sql).subscribe("t");
    const subscription = await sql.listen.mock.results[0].value;

    expect(await it.return!("bye")).toEqual({ done: true, value: "bye" });
    expect(subscription.unlisten).toHaveBeenCalledTimes(1);
    expect(await it.next()).toEqual({ done: true, value: undefined });
  });

  test("return() resolves pending next() calls as done", async () => {
    const sql = createFakeSql();
    const it = new BunPgSubscriber(sql).subscribe("t");
    const pending = it.next();
    await it.return!();
    expect(await pending).toEqual({ done: true, value: undefined });
  });

  test("return() discards buffered payloads", async () => {
    const sql = createFakeSql();
    const it = new BunPgSubscriber(sql).subscribe("t");
    listenerOf(sql)("buffered");
    await it.return!();
    expect(await it.next()).toEqual({ done: true, value: undefined });
  });

  test("return() twice only unlistens once", async () => {
    const sql = createFakeSql();
    const it = new BunPgSubscriber(sql).subscribe("t");
    const subscription = await sql.listen.mock.results[0].value;
    await it.return!();
    await it.return!();
    expect(subscription.unlisten).toHaveBeenCalledTimes(1);
  });

  test("throw() unlistens and rethrows the error", async () => {
    const sql = createFakeSql();
    const it = new BunPgSubscriber(sql).subscribe("t");
    const subscription = await sql.listen.mock.results[0].value;
    const error = new Error("abort");
    await expect(it.throw!(error)).rejects.toBe(error);
    expect(subscription.unlisten).toHaveBeenCalledTimes(1);
  });

  test("errors from unlisten are swallowed", async () => {
    const sql = createFakeSql();
    sql.listen.mockImplementationOnce(async (channel: string) => ({
      channel,
      unlisten: async () => {
        throw new Error("connection gone");
      },
    }));
    const it = new BunPgSubscriber(sql).subscribe("t");
    await flush();
    expect(await it.return!()).toEqual({ done: true, value: undefined });
  });

  test("a failed LISTEN rejects pending next() calls", async () => {
    const sql = createFakeSql();
    const failure = new Error("could not listen");
    sql.listen.mockImplementationOnce(async () => {
      throw failure;
    });
    const it = new BunPgSubscriber(sql).subscribe("t");
    await expect(it.next()).rejects.toBe(failure);
    expect(await it.next()).toEqual({ done: true, value: undefined });
  });

  test("a failed LISTEN with no pending next() ends the iterator", async () => {
    const sql = createFakeSql();
    sql.listen.mockImplementationOnce(async () => {
      throw new Error("could not listen");
    });
    const it = new BunPgSubscriber(sql).subscribe("t");
    await flush();
    expect(await it.next()).toEqual({ done: true, value: undefined });
  });

  test("a failed LISTEN after return() is ignored", async () => {
    const sql = createFakeSql();
    let rejectListen!: (e: unknown) => void;
    sql.listen.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectListen = reject)),
    );
    const it = new BunPgSubscriber(sql).subscribe("t");
    const returning = it.return!();
    rejectListen(new Error("late failure"));
    await returning;
    expect(await it.next()).toEqual({ done: true, value: undefined });
  });

  test("subscribe is rejected after release()", async () => {
    const subscriber = new BunPgSubscriber(createFakeSql());
    await subscriber.release();
    expect(() => subscriber.subscribe("t")).toThrow("This BunPgSubscriber has been released.");
  });

  test("release() stops every open subscription exactly once", async () => {
    const sql = createFakeSql();
    const subscriber = new BunPgSubscriber(sql);
    const first = subscriber.subscribe("a");
    subscriber.subscribe("b");
    const subA = await sql.listen.mock.results[0].value;
    const subB = await sql.listen.mock.results[1].value;
    const pending = first.next();

    await subscriber.release();

    expect(subA.unlisten).toHaveBeenCalledTimes(1);
    expect(subB.unlisten).toHaveBeenCalledTimes(1);
    expect(await pending).toEqual({ done: true, value: undefined });

    await subscriber.release();
    expect(subA.unlisten).toHaveBeenCalledTimes(1);
  });

  test("release() does not unlisten subscriptions already returned", async () => {
    const sql = createFakeSql();
    const subscriber = new BunPgSubscriber(sql);
    const it = subscriber.subscribe("a");
    const subscription = await sql.listen.mock.results[0].value;
    await it.return!();
    await subscriber.release();
    expect(subscription.unlisten).toHaveBeenCalledTimes(1);
  });

  test("release() with no subscriptions is a no-op", async () => {
    const subscriber = new BunPgSubscriber(createFakeSql());
    await subscriber.release();
    await subscriber.release();
  });

  test("for-await consumes payloads until the subscriber is released", async () => {
    const sql = createFakeSql();
    const subscriber = new BunPgSubscriber(sql);
    const received: string[] = [];
    const loop = (async () => {
      for await (const payload of subscriber.subscribe("t") as AsyncIterable<string>) {
        received.push(payload);
      }
    })();

    listenerOf(sql)("x");
    listenerOf(sql)("y");
    await flush();
    await subscriber.release();
    await loop;

    expect(received).toEqual(["x", "y"]);
  });
});

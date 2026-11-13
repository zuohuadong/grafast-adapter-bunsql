import { mock } from "bun:test";

/**
 * Transaction-like handle: supports unsafe queries and savepoints
 */
export function createFakeTx(): any {
  return {
    unsafe: mock(async (_text: string, _values?: any[]) => []),
    savepoint: mock(async (cb: (tx: any) => Promise<any>) => cb(createFakeTx())),
  };
}

/**
 * Reserved connection handle (from sql.reserve())
 */
export function createFakeReserved(): any {
  return {
    unsafe: mock(async (_text: string, _values?: any[]) => []),
    begin: mock(async (cb: (tx: any) => Promise<any>) => cb(createFakeTx())),
    release: mock(() => {}),
  };
}

/**
 * Bun.SQL-like instance. `listen` records the onnotify callback per call and
 * resolves to a subscription with an `unlisten` mock.
 */
export function createFakeSql(): any {
  return {
    unsafe: mock(async (_text: string, _values?: any[]) => []),
    begin: mock(async (cb: (tx: any) => Promise<any>) => cb(createFakeTx())),
    reserve: mock(async () => createFakeReserved()),
    end: mock(async () => {}),
    notify: mock(async (_channel: string, _payload?: string) => {}),
    listen: mock(async (channel: string, _onnotify: (payload: string) => void) => ({
      channel,
      unlisten: mock(async () => {}),
    })),
  };
}

/**
 * Stand-in for the `Bun` global; `SQL` constructor returns the given instance
 */
export function createFakeBun(sql: any = createFakeSql()) {
  const constructed: any[] = [];
  class FakeSQL {
    constructor(options: any) {
      constructed.push(options);
      return sql;
    }
  }
  return {
    bun: { SQL: FakeSQL } as unknown as typeof Bun,
    constructed,
    sql,
  };
}

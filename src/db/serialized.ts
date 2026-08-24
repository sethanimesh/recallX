/** Drizzle's SQLite drivers have synchronous transactions. This facade serializes
 * complete operations and keeps async transaction callbacks inside BEGIN/COMMIT.
 * Builders are replayed after the lock is acquired so web tabs use fresh data. */
export function serializedDatabase<T extends object>(
  current: () => T,
  execute: (work: (database: T) => Promise<any>, write: boolean) => Promise<any>,
): T {
  const builder = (steps: Array<[PropertyKey, any[]]>, write: boolean): any => new Proxy({}, {
    get(_target, key) {
      const run = () => execute(async database => {
        let result: any = database;
        for (const [method, args] of steps) result = result[method](...args);
        return await result;
      }, write);
      if (key === 'then') return (resolve: any, reject: any) => run().then(resolve, reject);
      if (key === 'catch') return (reject: any) => run().catch(reject);
      if (['run', 'all', 'get', 'execute'].includes(String(key))) {
        return (...args: any[]) => execute(async database => {
          let result: any = database;
          for (const [method, params] of steps) result = result[method](...params);
          return await result[key](...args);
        }, write);
      }
      return (...args: any[]) => builder([...steps, [key, args]], write);
    },
  });
  return new Proxy({} as T, {
    get(_target, key) {
      if (key === 'transaction') return (callback: (database: T) => any) => execute(async database => callback(database), true);
      if (['select', 'selectDistinct', 'insert', 'update', 'delete'].includes(String(key))) {
        return (...args: any[]) => builder([[key, args]], !String(key).startsWith('select'));
      }
      return Reflect.get(current(), key);
    },
  });
}

export function serialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation, operation);
    tail = result.catch(() => {});
    return result;
  };
}

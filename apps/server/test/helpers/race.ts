// Starts every function at the same moment: all calls wait on one gate promise,
// then the gate opens and they run together. Used to force real concurrency on the DB.
export function raceAll<T>(fns: (() => Promise<T>)[]): Promise<PromiseSettledResult<T>[]> {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const runs = fns.map(async (fn) => {
    await gate;
    return fn();
  });
  open();
  return Promise.allSettled(runs);
}

// Settles a request within `ms`: a request that never answers (a dropped
// connection, a stalled cold start) rejects instead of leaving a page on
// "Loading…" forever.
export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`No response after ${ms} ms`);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

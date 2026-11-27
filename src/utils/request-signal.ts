import { AsyncLocalStorage } from 'node:async_hooks';

const current = new AsyncLocalStorage<AbortSignal>();

/**
 * Runs `work` so that every upstream call it makes (through `ApiClient`) is cancelled when `signal`
 * aborts: the MCP client cancelled the request or went away. Nested uses add up: the work stops when
 * any signal around it aborts. The tools stay unaware of it.
 */
export function withRequestSignal<T>(signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
  const outer = current.getStore();
  const combined = outer && signal ? AbortSignal.any([outer, signal]) : (signal ?? outer);
  return combined ? current.run(combined, work) : work();
}

/** The signal of the request being served, for the HTTP client to pass on. */
export function requestSignal(): AbortSignal | undefined {
  return current.getStore();
}

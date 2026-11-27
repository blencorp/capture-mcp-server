import { AsyncLocalStorage } from 'node:async_hooks';

const current = new AsyncLocalStorage<AbortSignal>();

/**
 * Runs `work` so that every upstream call it makes (through `ApiClient`) is cancelled when `signal`
 * aborts: the MCP client cancelled the request or went away. The tools stay unaware of it.
 */
export function withRequestSignal<T>(signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
  return signal ? current.run(signal, work) : work();
}

/** The signal of the request being served, for the HTTP client to pass on. */
export function requestSignal(): AbortSignal | undefined {
  return current.getStore();
}

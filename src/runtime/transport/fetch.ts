import { RequestTimeoutError } from "../errors.js";
import { newRequestId } from "../request-id.js";

export interface SendOptions {
  method: string;
  url: string;
  headers?: Headers;
  body?: BodyInit;
  /** Caller-owned cancellation (user aborted → raw AbortError propagates). */
  signal?: AbortSignal;
  /** Per-request timeout; omit or 0 disables. */
  timeoutMs?: number;
}

export interface HttpTransport {
  send(options: SendOptions): Promise<Response>;
}

/** Minimal fetch shape the runtime depends on (narrower than Bun's typeof fetch). */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: string }).name === "AbortError";
}

/**
 * Web-standard fetch transport. Uses only fetch / Headers / AbortSignal, so
 * the same code runs on Node 18+, Bun, browsers, Deno and Workers.
 */
export class FetchTransport implements HttpTransport {
  readonly #fetchFn: FetchLike;

  constructor(fetchFn: FetchLike = globalThis.fetch.bind(globalThis)) {
    this.#fetchFn = fetchFn;
  }

  async send(options: SendOptions): Promise<Response> {
    const requestId = newRequestId();
    const headers = new Headers(options.headers);
    headers.set("x-request-id", requestId);

    const timeoutSignal =
      options.timeoutMs !== undefined && options.timeoutMs > 0
        ? AbortSignal.timeout(options.timeoutMs)
        : undefined;
    const signal =
      timeoutSignal && options.signal
        ? AbortSignal.any([options.signal, timeoutSignal])
        : (timeoutSignal ?? options.signal);

    try {
      return await this.#fetchFn(options.url, {
        method: options.method,
        headers,
        body: options.body,
        signal,
      });
    } catch (error) {
      if (isAbortError(error) && !options.signal?.aborted) {
        // Timeout fired (the caller's signal is still live) — surface as a typed error.
        throw new RequestTimeoutError(`request timed out after ${options.timeoutMs}ms`, {
          requestId,
          cause: error,
        });
      }
      throw error;
    }
  }
}

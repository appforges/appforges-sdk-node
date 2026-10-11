import type { AuthProvider } from "./auth/provider.js";
import { BearerAuth } from "./auth/bearer.js";
import { errorFromResponse } from "./errors.js";
import { newIdempotencyKey } from "./idempotency.js";
import type { RuntimeLogger } from "./logger.js";
import { responseRequestId, responseTraceId } from "./request-id.js";
import { FetchTransport, type FetchLike, type HttpTransport, type SendOptions } from "./transport/fetch.js";
import { parseRetryAfterMs, requestWithRetry, type RetryOptions } from "./transport/retry.js";

export type QueryParamValue = string | number | boolean | undefined | null;

export interface RequestOptions {
  /** Serialized to the query string; null/undefined entries are skipped. */
  params?: Record<string, QueryParamValue>;
  headers?: Record<string, string> | Headers;
  /** JSON-serialized request body. */
  body?: unknown;
  /** Raw body passthrough (takes precedence over `body`). */
  rawBody?: BodyInit;
  signal?: AbortSignal;
  /** Manual idempotency key; wins over auto-injection. */
  idempotencyKey?: string;
  /**
   * Marks the operation idempotency-eligible (from the API contract). With
   * ClientOptions.autoIdempotency the client injects a key for write
   * operations that carry a body. Set by generated code, not logic.
   */
  idempotencyEligible?: boolean;
}

export interface ClientOptions {
  baseURL: string;
  auth?: AuthProvider;
  fetchFn?: FetchLike;
  transport?: HttpTransport;
  /** Per-request timeout in ms. Default 30_000. */
  timeoutMs?: number;
  retry?: RetryOptions;
  /** Auto-inject idempotency keys on eligible writes. Default false. */
  autoIdempotency?: boolean;
  /** Observability hooks; default silent. */
  logger?: RuntimeLogger;
}

function buildURL(base: string, path: string, params?: Record<string, QueryParamValue>): string {
  const baseClean = base.replace(/\/+$/, "");
  const pathClean = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${baseClean}${pathClean}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function toError(response: Response): Promise<never> {
  const raw = await response.text();
  let parsed: unknown;
  try {
    parsed = raw.length > 0 ? JSON.parse(raw) : undefined;
  } catch {
    parsed = undefined;
  }
  throw errorFromResponse(parsed, {
    httpStatus: response.status,
    requestId: responseRequestId(response),
    traceId: responseTraceId(response),
    retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
  });
}

/**
 * The runtime client every generated resource class builds on. Holds
 * configuration and the single request pipeline: build URL → auth → send
 * (with retry) → typed errors → parsed body. All logic lives here; generated
 * code only assembles arguments.
 */
export class BaseClient {
  readonly #options: ClientOptions;
  readonly #transport: HttpTransport;

  constructor(options: ClientOptions) {
    this.#options = options;
    this.#transport = options.transport ?? new FetchTransport(options.fetchFn);
  }

  /** Swap the auth provider (OAuth flows call this after token exchange). */
  useAuth(auth: AuthProvider | undefined): void {
    this.#options.auth = auth;
  }

  /** Convenience shorthand for useAuth(new BearerAuth(token)). */
  useBearer(token: string | (() => string | Promise<string>)): void {
    this.#options.auth = new BearerAuth(token);
  }

  protected async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.requestRaw(method, path, options);
    if (!response.ok) await toError(response);
    if (response.status === 204) return undefined as T;
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      return (await response.json()) as T;
    }
    return (await response.text()) as unknown as T;
  }

  /**
   * Full pipeline (URL → auth → retry-send → typed errors) returning the raw
   * Response — the SSE streaming path consumes this.
   */
  async requestRaw(method: string, path: string, options: RequestOptions = {}): Promise<Response> {
    const headers = options.headers instanceof Headers ? new Headers(options.headers) : new Headers(options.headers);
    let body: BodyInit | undefined;
    if (options.rawBody !== undefined) {
      body = options.rawBody;
    } else if (options.body !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(options.body);
    }
    const isWrite = method !== "GET" && method !== "HEAD" && method !== "DELETE";
    let idempotencyKey = options.idempotencyKey;
    if (
      idempotencyKey === undefined &&
      isWrite &&
      body !== undefined &&
      options.idempotencyEligible === true &&
      this.#options.autoIdempotency === true
    ) {
      idempotencyKey = newIdempotencyKey();
    }
    if (idempotencyKey !== undefined) {
      headers.set("x-idempotency-key", idempotencyKey);
    }
    await this.#options.auth?.apply(headers);

    const url = buildURL(this.#options.baseURL, path, options.params);
    const logger = this.#options.logger;
    let attempt = -1;
    let startedAt = 0;
    let currentRequestId = "";
    const send = (): Promise<Response> => {
      attempt += 1;
      startedAt = Date.now();
      const recorded = new Headers(headers);
      return this.#transport
        .send({
          method,
          url,
          headers: recorded,
          body,
          signal: options.signal,
          timeoutMs: this.#options.timeoutMs ?? 30_000,
        } satisfies SendOptions)
        .then((response) => {
          currentRequestId = responseRequestId(response) ?? currentRequestId;
          logger?.onResponse?.({
            method,
            url,
            requestId: currentRequestId,
            attempt,
            status: response.status,
            durationMs: Date.now() - startedAt,
          });
          return response;
        })
        .catch((error: unknown) => {
          logger?.onError?.({ method, url, requestId: currentRequestId || null, attempt, error });
          throw error;
        });
    };
    logger?.onRequest?.({ method, url, requestId: "", attempt: 0 });
    return requestWithRetry(send, this.#options.retry);
  }

  /**
   * Public verb helpers — the surface generated resource classes call.
   * Logic stays here in the runtime; generated code only assembles arguments.
   */
  get<T = void>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("GET", path, options);
  }

  post<T = void>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("POST", path, options);
  }

  put<T = void>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("PUT", path, options);
  }

  patch<T = void>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("PATCH", path, options);
  }

  delete<T = void>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("DELETE", path, options);
  }

  /** Raw-response GET for streaming endpoints (SSE). */
  getRaw(path: string, options?: RequestOptions): Promise<Response> {
    return this.requestRaw("GET", path, options);
  }
}

export { buildURL };

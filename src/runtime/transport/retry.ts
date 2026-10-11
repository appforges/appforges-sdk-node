/**
 * Retry policy for transient failures: HTTP 429 / 5xx and network errors.
 *
 * Backoff is exponential with full jitter; `Retry-After` (seconds or
 * HTTP-date, RFC 9110 §10.2.3) always wins when it asks for a longer wait.
 * Write-method retries rely on idempotency keys for safety — the generated
 * SDK injects them automatically (APP-2265 / B1).
 */

export interface RetryOptions {
  /** Cancellation applies to attempts and Retry-After waits. */
  signal?: AbortSignal;
  /** Additional attempts after the first one. Default 2 (three attempts total). */
  maxRetries?: number;
  /** Backoff base in ms. Default 200. */
  baseDelayMs?: number;
  /** Backoff ceiling in ms (exponential component only; Retry-After is honored in full). Default 30_000. */
  maxDelayMs?: number;
  /** Injectable sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Which statuses are retryable. Default: 429 and 5xx. */
  retryableStatus?: (status: number) => boolean;
}

export function parseRetryAfterMs(value: string | null, now = Date.now()): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return Math.round(parseFloat(trimmed) * 1000);
  }
  const asDate = Date.parse(trimmed);
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - now);
  return undefined;
}

function defaultRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function isNetworkError(error: unknown): boolean {
  // fetch() rejects with TypeError on network failure; AbortError is a
  // timeout / caller cancel and must not be retried here.
  return error instanceof TypeError;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "AbortError"
  );
}

export function computeDelayMs(
  attempt: number,
  retryAfterMs: number | undefined,
  options: RetryOptions,
): number {
  const base = options.baseDelayMs ?? 200;
  const max = options.maxDelayMs ?? 30_000;
  if (retryAfterMs !== undefined && retryAfterMs > 0) return retryAfterMs;
  const exponential = Math.min(max, base * 2 ** attempt);
  // Full jitter: uniform in [0, exponential].
  return Math.round(exponential * Math.random());
}

async function sleep(ms: number, options: RetryOptions): Promise<void> {
  options.signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: unknown) => {
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (error !== undefined) reject(error);
      else resolve();
    };
    const abort = () => finish(options.signal?.reason ?? new DOMException("Aborted", "AbortError"));
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) {
      abort();
      return;
    }
    if (options.sleep)
      options.sleep(ms).then(
        () => finish(),
        (error: unknown) => finish(error),
      );
    else timer = setTimeout(() => finish(), ms);
  });
}

/**
 * Send a request, retrying transient failures. `send` receives the
 * zero-based attempt number. Returns the final response (possibly non-2xx
 * once retries are exhausted); throws the original error if the transport
 * keeps failing with a network error, or immediately on aborts.
 */
export async function requestWithRetry(
  send: (attempt: number) => Promise<Response>,
  options: RetryOptions = {},
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 2;
  const retryableStatus = options.retryableStatus ?? defaultRetryableStatus;
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    options.signal?.throwIfAborted();
    try {
      const response = await send(attempt);
      if (!retryableStatus(response.status) || attempt >= maxRetries) return response;
      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      await response.body?.cancel();
      await sleep(computeDelayMs(attempt, retryAfterMs, options), options);
      attempt += 1;
    } catch (error) {
      if (isAbortError(error) || !isNetworkError(error) || attempt >= maxRetries) throw error;
      await sleep(computeDelayMs(attempt, undefined, options), options);
      attempt += 1;
    }
  }
}

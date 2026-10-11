/**
 * Typed error catalog for the AppForges runtime.
 *
 * The gateway (apigw) returns errors as `google.rpc.Status` JSON with an
 * `ErrorInfo` detail carrying `reason` / `domain` / `metadata`. Generated SDKs
 * register one subclass per reason (APP-2263); this module maps wire errors
 * onto those classes, falling back to {@link APIError} when the reason is
 * unknown or the body is malformed.
 */

export interface AppForgesErrorOptions {
  requestId?: string;
  httpStatus?: number;
  traceId?: string;
  /** Server-advised retry delay in milliseconds (from Retry-After). */
  retryAfterMs?: number;
  cause?: unknown;
}

/** Base class for every error thrown by the runtime and generated SDKs. */
export class AppForgesError extends Error {
  readonly requestId?: string;
  readonly httpStatus?: number;
  readonly traceId?: string;
  readonly retryAfterMs?: number;

  constructor(message: string, options: AppForgesErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.requestId = options.requestId;
    this.httpStatus = options.httpStatus;
    this.traceId = options.traceId;
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** Generic non-2xx response whose reason is not in the typed catalog. */
export class APIError extends AppForgesError {
  readonly reason?: string;
  readonly domain?: string;
  readonly metadata?: Record<string, unknown>;

  constructor(
    message: string,
    options: AppForgesErrorOptions & {
      reason?: string;
      domain?: string;
      metadata?: Record<string, unknown>;
    } = {},
  ) {
    super(message, options);
    this.reason = options.reason;
    this.domain = options.domain;
    this.metadata = options.metadata;
  }
}

/** Gateway quota exhaustion is available even when the OAS has no error catalog. */
export class RateLimitExceededError extends APIError {
  constructor(init: TypedErrorInit) {
    super(init.message ?? "rate limit exceeded", init);
  }
}

/** The request exceeded its configured timeout and was aborted. */
export class RequestTimeoutError extends AppForgesError {}

export interface TypedErrorInit {
  reason: string;
  domain?: string;
  message?: string;
  metadata?: Record<string, unknown>;
  requestId?: string;
  httpStatus?: number;
  traceId?: string;
  retryAfterMs?: number;
}

export type TypedErrorConstructor = new (init: TypedErrorInit) => AppForgesError;

const registry = new Map<string, TypedErrorConstructor>();

/** Register the class a generated SDK wants thrown for a given reason. */
export function registerErrorReason(reason: string, ctor: TypedErrorConstructor): void {
  registry.set(reason, ctor);
}

export function lookupErrorReason(reason: string): TypedErrorConstructor | undefined {
  return registry.get(reason);
}

/** Test-only: drop every registered reason. */
export function clearErrorReasonsForTest(): void {
  registry.clear();
}

/** `google.rpc.Status` wire shape (only fields we consume). */
export interface GoogleRpcStatus {
  code?: number;
  message?: string;
  status?: string;
  details?: Array<{
    "@type"?: string;
    reason?: string;
    domain?: string;
    metadata?: Record<string, unknown>;
  }>;
}

/** Best-effort parse of a `google.rpc.Status` payload; undefined when the body is not one. */
export function parseErrorStatus(body: unknown): GoogleRpcStatus | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const envelope = body as Record<string, unknown>;
  // apigw wraps google.rpc.Status in { error: ... }; direct Status is also
  // accepted for Connect-compatible callers and existing generated clients.
  const record =
    typeof envelope.error === "object" && envelope.error !== null
      ? (envelope.error as Record<string, unknown>)
      : envelope;
  if (typeof record.code !== "number" && typeof record.message !== "string") return undefined;
  const details = Array.isArray(record.details)
    ? record.details.filter(
        (d): d is NonNullable<GoogleRpcStatus["details"]>[number] =>
          typeof d === "object" && d !== null,
      )
    : undefined;
  return {
    code: typeof record.code === "number" ? record.code : undefined,
    message: typeof record.message === "string" ? record.message : undefined,
    status: typeof record.status === "string" ? record.status : undefined,
    details,
  };
}

export interface ErrorContext {
  httpStatus: number;
  requestId?: string;
  traceId?: string;
  retryAfterMs?: number;
}

/**
 * Turn a non-2xx response body into the most specific error available:
 * a registered reason class, else {@link APIError}.
 */
export function errorFromResponse(body: unknown, context: ErrorContext): AppForgesError {
  const status = parseErrorStatus(body);
  const info = status?.details?.find((d) => typeof d.reason === "string");
  const message = status?.message ?? `request failed with HTTP ${context.httpStatus}`;
  if (info?.reason) {
    const ctor =
      registry.get(info.reason) ??
      (info.reason === "RATE_LIMIT_EXCEEDED" ? RateLimitExceededError : undefined);
    const init: TypedErrorInit = {
      reason: info.reason,
      domain: info.domain,
      metadata: info.metadata,
      message,
      ...context,
    };
    if (ctor) return new ctor(init);
    return new APIError(message, {
      ...context,
      reason: info.reason,
      domain: info.domain,
      metadata: info.metadata,
    });
  }
  return new APIError(message, context);
}

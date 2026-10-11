/**
 * @appforges/runtime — the hand-written runtime embedded into the published
 * `@appforges/sdk` npm package.
 *
 * Curated entry surface (deep imports also available via subpath exports —
 * this is not a re-export-everything barrel, keeping bundles lean):
 * client, auth providers (incl. OAuth PKCE/device/refresh), typed error
 * catalog, transport primitives, cursor pagination and SSE streaming.
 * Zero runtime dependencies; Web-standard APIs only (fetch / Headers /
 * AbortSignal), so the same code runs on Node 18+, Bun, Deno, browsers and
 * edge workers.
 */
export { BaseClient, buildURL } from "./client.js";
export type { ClientOptions, QueryParamValue, RequestOptions } from "./client.js";
export { BearerAuth } from "./auth/bearer.js";
export { APIKeyAuth } from "./auth/apikey.js";
export type { AuthProvider } from "./auth/provider.js";
export { RefreshableBearer } from "./auth/oauth/refresh.js";
export { beginPKCE, exchangePKCECode } from "./auth/oauth/pkce.js";
export type { PKCESession } from "./auth/oauth/pkce.js";
export { startDeviceFlow, pollDeviceFlow } from "./auth/oauth/device.js";
export type { DevicePollResult } from "./auth/oauth/device.js";
export type { OAuthEndpoints, OAuthTokens } from "./auth/oauth/types.js";
export { FetchTransport } from "./transport/fetch.js";
export type { FetchLike, HttpTransport, SendOptions } from "./transport/fetch.js";
export { requestWithRetry, parseRetryAfterMs, computeDelayMs } from "./transport/retry.js";
export type { RetryOptions } from "./transport/retry.js";
export {
  APIError,
  AppForgesError,
  RequestTimeoutError,
  clearErrorReasonsForTest,
  errorFromResponse,
  lookupErrorReason,
  parseErrorStatus,
  registerErrorReason,
} from "./errors.js";
export type { AppForgesErrorOptions, ErrorContext, GoogleRpcStatus, TypedErrorConstructor, TypedErrorInit } from "./errors.js";
export { newRequestId, responseRequestId, responseTraceId } from "./request-id.js";
export { Paginator } from "./pagination.js";
export type { PageProjection, PaginatorOptions } from "./pagination.js";
export { connectSSE, parseSSEFrame } from "./streaming.js";
export type { SSEEvent, SSEStreamOptions } from "./streaming.js";
export { newIdempotencyKey } from "./idempotency.js";
export type { RuntimeLogger, RequestEvent, ResponseEvent, ErrorEvent } from "./logger.js";

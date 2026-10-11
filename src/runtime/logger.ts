/**
 * Injectable observability hooks. Default: silent. Implementations stay
 * allocation-free when no logger is configured.
 */

export interface RequestEvent {
  method: string;
  url: string;
  requestId: string;
  attempt: number;
}

export interface ResponseEvent {
  method: string;
  url: string;
  requestId: string;
  attempt: number;
  status: number;
  /** Wall-clock ms from request start to response headers. */
  durationMs: number;
}

export interface ErrorEvent {
  method: string;
  url: string;
  requestId: string | null;
  attempt: number;
  error: unknown;
}

export interface RuntimeLogger {
  onRequest?(event: RequestEvent): void;
  onResponse?(event: ResponseEvent): void;
  onError?(event: ErrorEvent): void;
}

export const silentLogger: RuntimeLogger = {};

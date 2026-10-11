/** Request-id helpers: generation, and extraction from gateway responses. */

export function newRequestId(): string {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === "function") {
    return cryptoRef.randomUUID();
  }
  // Fallback for exotic runtimes without WebCrypto — uniqueness is best-effort.
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function responseRequestId(response: Response): string | undefined {
  return response.headers.get("x-request-id") ?? undefined;
}

export function responseTraceId(response: Response): string | undefined {
  const direct = response.headers.get("x-trace-id");
  if (direct) return direct;
  const traceparent = response.headers.get("traceparent");
  const parsed = traceparent?.split("-")[1];
  return parsed && parsed.length > 0 ? parsed : undefined;
}

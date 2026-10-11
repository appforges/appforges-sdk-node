/**
 * Idempotency keys for safe write retries. Generated code marks
 * idempotency-eligible operations (IR `idempotent: true`); the client
 * auto-injects a key unless the caller supplies one.
 */

/** Random idempotency key (base64url of 16 random bytes). */
export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

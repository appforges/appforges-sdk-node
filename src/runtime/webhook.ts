/** Verify the existing IAM X-Webhook-Signature protocol over raw body bytes.
 * Provide original secrets returned by create/rotate, never stored hashes.
 * The current protocol does not authenticate event headers or prevent replay.
 */
export async function verifyWebhookSignature(
  body: Uint8Array,
  signature: string,
  secrets: readonly string[],
): Promise<boolean> {
  if (
    !(body instanceof Uint8Array) ||
    signature.length !== 64 ||
    !/^[0-9a-f]{64}$/.test(signature) ||
    secrets.length === 0
  )
    return false;
  const encoder = new TextEncoder();
  const bytes = Uint8Array.from(signature.match(/../g)!, (v) => parseInt(v, 16));
  let valid = false;
  for (const secret of secrets) {
    if (!secret) continue;
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(secret)));
    const derived = Array.from(digest, (v) => v.toString(16).padStart(2, "0")).join("");
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(derived),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    valid = (await crypto.subtle.verify("HMAC", key, bytes, new Uint8Array(body))) || valid;
  }
  return valid;
}

import type { DeviceAuthorization, DeviceStartOptions, OAuthEndpoints, OAuthTokens } from "./types.js";
import { parseTokenResponse } from "./pkce.js";
import type { FetchLike } from "../../transport/fetch.js";

/** RFC 8628 device authorization grant (no browser on the device). */

export async function startDeviceFlow(
  endpoints: OAuthEndpoints,
  options: DeviceStartOptions,
  fetchFn: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<DeviceAuthorization> {
  const body = new URLSearchParams({ client_id: options.clientId });
  if (options.scope !== undefined && options.scope !== "") {
    body.set("scope", options.scope);
  }
  const response = await fetchFn(`${endpoints.authorizeUrl.replace(/\/authorize$/, "/device_authorization")}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new Error(`device authorization failed with HTTP ${response.status}`);
  }
  const payload = (await response.json()) as Record<string, unknown>;
  const deviceCode = payload["device_code"];
  const userCode = payload["user_code"];
  const verificationUrl = payload["verification_uri"] ?? payload["verification_url"];
  if (typeof deviceCode !== "string" || typeof userCode !== "string" || typeof verificationUrl !== "string") {
    throw new Error("device authorization response missing device_code/user_code/verification_uri");
  }
  const authorization: DeviceAuthorization = {
    deviceCode,
    userCode,
    verificationUrl,
  };
  if (typeof payload["verification_uri_complete"] === "string") {
    authorization.verificationUrlComplete = payload["verification_uri_complete"];
  }
  if (typeof payload["interval"] === "number") {
    authorization.interval = payload["interval"];
  }
  const expiresIn = payload["expires_in"];
  if (typeof expiresIn === "number") {
    authorization.expiresAt = Date.now() + expiresIn * 1000;
  }
  return authorization;
}

export type DevicePollResult = OAuthTokens | "pending" | "slowDown" | "expired";

/** Poll the token endpoint once; callers space polls per `interval`. */
export async function pollDeviceFlow(
  endpoints: OAuthEndpoints,
  clientId: string,
  authorization: DeviceAuthorization,
  fetchFn: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<DevicePollResult> {
  const response = await fetchFn(endpoints.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: clientId,
      device_code: authorization.deviceCode,
    }),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (response.ok) {
    return parseTokenResponse(payload);
  }
  switch (payload["error"]) {
    case "authorization_pending":
      return "pending";
    case "slow_down":
      return "slowDown";
    case "expired_token":
      return "expired";
    default:
      throw new Error(`device flow polling failed: ${String(payload["error"])}`);
  }
}

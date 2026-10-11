import type { OAuthEndpoints, PKCEExchangeOptions, PKCEFlowOptions, OAuthTokens } from "./types.js";
import type { FetchLike } from "../../transport/fetch.js";

/** PKCE (RFC 7636) authorization-code flow with S256 challenge. */

const CHARACTER_SET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

function randomString(length: number): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) {
    out += CHARACTER_SET[byte % CHARACTER_SET.length];
  }
  return out;
}

async function sha256Base64Url(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  let binary = "";
  for (const byte of new Uint8Array(digest)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface PKCESession {
  /** Redirect the user agent here. */
  authorizationUrl: string;
  /** Opaque anti-CSRF state to compare on callback. */
  state: string;
  /** Pass to exchangeCode after the callback. */
  codeVerifier: string;
}

export async function beginPKCE(
  endpoints: OAuthEndpoints,
  options: PKCEFlowOptions,
): Promise<PKCESession> {
  const codeVerifier = randomString(64);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const state = randomString(24);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });
  if (options.scope !== undefined && options.scope !== "") {
    params.set("scope", options.scope);
  }
  for (const [key, value] of Object.entries(options.extraParams ?? {})) {
    params.set(key, value);
  }
  return {
    authorizationUrl: `${endpoints.authorizeUrl}?${params.toString()}`,
    state,
    codeVerifier,
  };
}

/** Exchange the authorization code for tokens (S256 verifier included). */
export async function exchangePKCECode(
  endpoints: OAuthEndpoints,
  options: PKCEExchangeOptions & { codeVerifier: string },
  fetchFn: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<OAuthTokens> {
  const response = await fetchFn(endpoints.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: options.code,
      client_id: options.clientId,
      redirect_uri: options.redirectUri,
      code_verifier: options.codeVerifier,
    }),
  });
  if (!response.ok) {
    throw new Error(`PKCE token exchange failed with HTTP ${response.status}`);
  }
  return parseTokenResponse(await response.json());
}

export function parseTokenResponse(body: Record<string, unknown>): OAuthTokens {
  const accessToken = body["access_token"];
  if (typeof accessToken !== "string" || accessToken === "") {
    throw new Error("token response missing access_token");
  }
  const tokens: OAuthTokens = { accessToken };
  if (typeof body["refresh_token"] === "string") {
    tokens.refreshToken = body["refresh_token"];
  }
  if (typeof body["scope"] === "string") {
    tokens.scope = body["scope"];
  }
  const expiresIn = body["expires_in"];
  if (typeof expiresIn === "number" || typeof expiresIn === "string") {
    const seconds = Number(expiresIn);
    if (Number.isFinite(seconds) && seconds > 0) {
      tokens.expiresAt = Date.now() + seconds * 1000;
    }
  }
  return tokens;
}

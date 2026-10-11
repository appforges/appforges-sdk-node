import type { AuthProvider } from "../provider.js";
import type { OAuthEndpoints, OAuthTokens, RefreshOptions } from "./types.js";
import { parseTokenResponse } from "./pkce.js";
import type { FetchLike } from "../../transport/fetch.js";

/**
 * RefreshableBearer — a Bearer auth provider that swaps in a new access
 * token via the refresh_token grant before expiry (with a safety window).
 */
export class RefreshableBearer implements AuthProvider {
  #tokens: OAuthTokens;
  readonly #endpoints: OAuthEndpoints;
  readonly #clientOptions: RefreshOptions;
  #refreshing: Promise<void> | null = null;

  constructor(
    tokens: OAuthTokens,
    endpoints: OAuthEndpoints,
    clientOptions: RefreshOptions,
    private readonly fetchFn: FetchLike = globalThis.fetch.bind(globalThis),
  ) {
    this.#tokens = tokens;
    this.#endpoints = endpoints;
    this.#clientOptions = clientOptions;
  }

  get tokens(): OAuthTokens {
    return this.#tokens;
  }

  async apply(headers: Headers): Promise<void> {
    // Refresh proactively when inside the 30s safety window.
    if (this.#tokens.expiresAt !== undefined && this.#tokens.expiresAt - Date.now() < 30_000) {
      await this.refresh();
    }
    headers.set("authorization", `Bearer ${this.#tokens.accessToken}`);
  }

  /** Refresh once; concurrent callers share a single grant request. */
  async refresh(): Promise<void> {
    this.#refreshing ??= (async () => {
      try {
        const body = new URLSearchParams({
          grant_type: "refresh_token",
          client_id: this.#clientOptions.clientId,
          refresh_token: this.#clientOptions.refreshToken,
        });
        const response = await this.fetchFn(this.#endpoints.tokenUrl, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
        });
        if (!response.ok) {
          throw new Error(`token refresh failed with HTTP ${response.status}`);
        }
        const refreshed = parseTokenResponse(await response.json());
        this.#tokens = {
          ...refreshed,
          // RFC 6749: servers MAY rotate refresh tokens; keep the old one
          // when the response omits it.
          refreshToken: refreshed.refreshToken ?? this.#clientOptions.refreshToken,
        };
        this.#clientOptions.refreshToken = this.#tokens.refreshToken ?? this.#clientOptions.refreshToken;
      } finally {
        this.#refreshing = null;
      }
    })();
    return this.#refreshing;
  }
}

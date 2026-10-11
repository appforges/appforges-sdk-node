/** Shared OAuth token shapes and endpoints. */

export interface OAuthTokens {
  accessToken: string;
  /** OAuth2 opaque refresh token, when issued. */
  refreshToken?: string;
  /** Epoch ms when accessToken expires; absent means unknown (treat as valid). */
  expiresAt?: number;
  /** Raw scope string granted. */
  scope?: string;
}

export interface OAuthEndpoints {
  /** Authorization endpoint for user-agent redirects. */
  authorizeUrl: string;
  /** Token endpoint for code exchange / refresh / device polling. */
  tokenUrl: string;
}

export interface PKCEFlowOptions {
  clientId: string;
  redirectUri: string;
  scope?: string;
  /** Extra authorization query parameters (state is auto-generated). */
  extraParams?: Record<string, string>;
}

export interface PKCEExchangeOptions {
  clientId: string;
  redirectUri: string;
  code: string;
}

export interface RefreshOptions {
  clientId: string;
  refreshToken: string;
}

export interface DeviceStartOptions {
  clientId: string;
  scope?: string;
}

export interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  verificationUrlComplete?: string;
  /** Recommended polling interval in seconds. */
  interval?: number;
  /** Epoch ms when the device code expires. */
  expiresAt?: number;
}

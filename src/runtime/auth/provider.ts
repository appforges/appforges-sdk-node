/**
 * Auth provider contract. Implementations inject credentials into request
 * headers; the optional {@link AuthProvider.refresh} hook is reserved for
 * OAuth token refresh (lands with APP-2265 / B1).
 */
export interface AuthProvider {
  apply(headers: Headers): Promise<void> | void;
  refresh?(): Promise<void>;
}

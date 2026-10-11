import type { AuthProvider } from "./provider.js";

type TokenSource = string | (() => string | Promise<string>);

/** Static or resolver-based Bearer token auth (`Authorization: Bearer <token>`). */
export class BearerAuth implements AuthProvider {
  readonly #token: TokenSource;

  constructor(token: TokenSource) {
    this.#token = token;
  }

  async apply(headers: Headers): Promise<void> {
    headers.set("authorization", `Bearer ${await this.resolve()}`);
  }

  async resolve(): Promise<string> {
    const token = typeof this.#token === "function" ? await this.#token() : this.#token;
    if (!token) throw new Error("BearerAuth: token source returned an empty token");
    return token;
  }
}

import type { AuthProvider } from "./provider.js";

type KeySource = string | (() => string | Promise<string>);

/** API-key auth into a configurable header (default `X-API-Key`). */
export class APIKeyAuth implements AuthProvider {
  readonly #header: string;
  readonly #key: KeySource;

  constructor(header: string | KeySource, key?: KeySource) {
    if (key === undefined) {
      // APIKeyAuth(token) — default header
      this.#header = "x-api-key";
      this.#key = header as KeySource;
    } else {
      this.#header = (header as string).toLowerCase();
      this.#key = key;
    }
  }

  async apply(headers: Headers): Promise<void> {
    headers.set(this.#header, await this.resolve());
  }

  async resolve(): Promise<string> {
    const key = typeof this.#key === "function" ? await this.#key() : this.#key;
    if (!key) throw new Error("APIKeyAuth: key source returned an empty key");
    return key;
  }
}

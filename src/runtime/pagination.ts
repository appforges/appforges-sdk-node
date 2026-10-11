/**
 * Cursor pagination as an async iterable. Generated list methods return a
 * Paginator; consume with `for await` or collect with `.all()`.
 *
 *   for await (const user of client.users.list()) { ... }
 *   const all = await client.users.list().all();
 */

export interface PageProjection<TItem, TPage> {
  /** Extract the item array from one page payload. */
  items(page: TPage): TItem[];
  /** Extract the next cursor from one page payload (null ends iteration). */
  token(page: TPage): string | null;
}

export interface PaginatorOptions {
  /** Applied to the first request only (Phase B: page_size passthrough). */
  initialPageSize?: number | undefined;
  /** Hard stop after N pages (guard against token loops). Default 10_000. */
  maxPages?: number;
}

export class Paginator<TItem, TPage> {
  readonly #fetchPage: (
    pageToken: string | undefined,
    pageSize: number | undefined,
  ) => Promise<TPage>;
  readonly #project: PageProjection<TItem, TPage>;
  readonly #options: PaginatorOptions;

  constructor(
    fetchPage: (pageToken: string | undefined, pageSize: number | undefined) => Promise<TPage>,
    project: PageProjection<TItem, TPage>,
    options: PaginatorOptions = {},
  ) {
    this.#fetchPage = fetchPage;
    this.#project = project;
    this.#options = options;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<TItem, void, unknown> {
    const maxPages = this.#options.maxPages ?? 10_000;
    let token: string | undefined;
    let pages = 0;
    const seen = new Set<string>();
    // Loop until the server says there is no next cursor.
    for (;;) {
      if (pages >= maxPages) {
        throw new Error(
          `paginator exceeded maxPages=${maxPages} (next_page_token did not terminate)`,
        );
      }
      const page = await this.#fetchPage(token, this.#options.initialPageSize);
      pages += 1;
      const items = this.#project.items(page);
      for (const item of items) {
        yield item;
      }
      const next = this.#project.token(page);
      if (next === null || next === undefined || next === "") {
        return;
      }
      if (seen.has(next))
        throw new Error("paginator repeated cursor (maxPages would not terminate)");
      seen.add(next);
      token = next;
    }
  }

  /** Collect every remaining item into one array. */
  async all(): Promise<TItem[]> {
    const collected: TItem[] = [];
    for await (const item of this) {
      collected.push(item);
    }
    return collected;
  }
}

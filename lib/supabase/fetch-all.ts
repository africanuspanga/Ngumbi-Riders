import 'server-only';

/*
 * Paginated fetch for queries that can exceed PostgREST's server-side row cap.
 *
 * Supabase hosted projects cap EVERY select at `db-max-rows` (1000 by default —
 * mirrored in supabase/config.toml) REGARDLESS of the client's `.limit()`: a
 * `.limit(10000)` silently returns 1000 rows with NO error. That silent
 * truncation is how the obligation-status job "succeeded" nightly while
 * transitioning nothing (see DECISIONS D-033). Every query whose result set can
 * grow with fleet × days MUST go through this helper (or aggregate in SQL).
 *
 * The caller supplies a page builder that applies a STABLE order (always add a
 * unique tiebreak column, e.g. .order('due_date').order('id')) and receives the
 * `.range(from, to)` bounds. Errors THROW — a failed page must never read as
 * "empty data" (that is exactly the bug class this repo shipped).
 */
type PageResult<T> = { data: T[] | null; error: { message: string } | null };

export const FETCH_PAGE_SIZE = 1000;

export async function fetchAllPages<T>(
  build: (from: number, to: number) => PromiseLike<PageResult<T>>,
  opts: { pageSize?: number; maxRows?: number; label?: string } = {},
): Promise<T[]> {
  const pageSize = opts.pageSize ?? FETCH_PAGE_SIZE;
  const maxRows = opts.maxRows ?? 200_000; // runaway backstop, far above fleet scale
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) {
      throw new Error(`${opts.label ?? 'fetchAllPages'} failed: ${error.message}`);
    }
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) return out;
    if (out.length >= maxRows) {
      throw new Error(`${opts.label ?? 'fetchAllPages'} exceeded ${maxRows} rows`);
    }
  }
}

/** Split ids into URL-safe chunks for PostgREST `.in()` filters. A ~1000-id
 * `.in()` builds a ~39 KB querystring that upstream proxies reject (the request
 * FAILS, it is not truncated) — keep chunks small enough to always fit. */
export function chunkIds<T>(ids: T[], size = 150): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

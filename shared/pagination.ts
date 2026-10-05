export interface PageCursor {
  mtime: number;
  id: string;
}

export interface PagedEnvelope<T> {
  rows: T[];
  nextCursor?: PageCursor;
}

interface RowLike {
  id: string;
  mtime?: number;
  deletedAt?: number;
}

export function parseCursor(value: unknown): PageCursor {
  if (typeof value !== "object" || value === null) throw new Error("Validation failed: cursor");
  const m = (value as { mtime?: unknown }).mtime;
  const cid = (value as { id?: unknown }).id;
  if (typeof m !== "number" || !Number.isFinite(m)) throw new Error("Validation failed: cursor");
  if (typeof cid !== "string" || !cid) throw new Error("Validation failed: cursor");
  return { mtime: Math.floor(m), id: cid };
}

/** Keyset slice for desc (mtime desc, id desc) order: rows strictly older than cursor. */
export function olderThanCursor<T extends RowLike>(rows: T[], cursor: PageCursor | undefined): T[] {
  if (!cursor) return rows;
  return rows.filter(
    (r) => (r.mtime ?? 0) < cursor.mtime || ((r.mtime ?? 0) === cursor.mtime && String(r.id) < cursor.id)
  );
}

/** Merge two desc windows (older-than + same-tick ties) into one desc order. */
export function mergeDesc<T extends RowLike>(older: T[], ties: T[]): T[] {
  return [...older, ...ties].sort((a, b) =>
    (b.mtime ?? 0) !== (a.mtime ?? 0) ? (b.mtime ?? 0) - (a.mtime ?? 0) : String(b.id).localeCompare(String(a.id))
  );
}

/** Drop tombstones, slice to limit, attach nextCursor when a further page exists. */
export function toEnvelope<T extends RowLike>(rows: T[], limit: number): PagedEnvelope<T> {
  const live = rows.filter((r) => !r.deletedAt);
  if (live.length <= limit) return { rows: live };
  const page = live.slice(0, limit);
  const last = page[page.length - 1];
  return { rows: page, nextCursor: { mtime: last.mtime ?? 0, id: last.id } };
}

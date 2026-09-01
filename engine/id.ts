/**
 * freshId — mint a stable synthetic id for a new schema object.
 *
 * The structured editor (WU-E) creates `addColumn` / `addIndex` / `createTable`
 * operations whose payloads must already carry ids (`engine/schema.ts`: identity
 * lives in the id, assigned at creation, preserved across rename and merge).
 * There is one generator, here, so the editor and any future server-side seeder
 * agree on the format. Pure and dependency-free like the rest of `engine/`.
 *
 * Format: `<prefix>_<context?>_<suffix>` —
 *   - prefix names the kind (`tbl` / `col` / `pk` / `fk` / `uq` / `idx`);
 *   - context is an optional lowercased hint (`users`, `users_email`) frozen at
 *     creation, allowed to go stale after a rename — a label, never identity;
 *   - suffix is 8 hex chars from a CSPRNG.
 *
 * The id never reaches SQL (schema objects live only inside `jsonb` documents —
 * `docs/backend-contract.md` §1); `validateOperation` re-checks any client id for
 * shape and freshness, so a collision here is a clean rejection, not corruption.
 */

export type IdKind = "tbl" | "col" | "pk" | "fk" | "uq" | "idx";

const SUFFIX_BYTES = 4; // → 8 hex chars

function randomSuffix(): string {
  const bytes = new Uint8Array(SUFFIX_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Lowercase, collapse anything outside `[a-z0-9_]` to `_`, trim repeats/edges. */
function slug(context: string): string {
  return context
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export function freshId(kind: IdKind, context?: string): string {
  const mid = context ? slug(context) : "";
  return [kind, mid, randomSuffix()].filter(Boolean).join("_");
}

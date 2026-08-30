# ADR 0008 — Robustness: validation, atomicity, quoting, destructive warnings

Status: accepted (design lock). No code ships here — this is the single owner for the
"real world, not happy path" concerns that ADRs 0001–0004 each left a seam pointing at.
`docs/robustness.md` is the companion: the per-operation validation rule table, the quoting
rules, the default allowlist, and the destructive-warning list with surfaces. `decisions.md`
carries the narrative.

Consolidates seams from ADR 0001 §3 (drops block on dependents; PK members are `NOT NULL`),
ADR 0002 (structural validity of a merged document deferred here), ADR 0003 §4–§5
(`checkReferences` is the seam; `quoteIdent` is a placeholder; `setDefault` renders a raw
literal and 0008 owns which are unsafe) and ADR 0004 §8 (`applyOperation`; batch atomicity).

## 1. One `validateOperation` in the engine, shared by server and editor

`engine/` gains a pure `validateOperation(doc: SchemaDocument, op: Operation): OpError[]` — no
framework imports, no I/O, returns a typed list (empty = valid). `applyOperation` (ADR 0004
§8) calls it and refuses the operation if it returns any `OpError`; the structured editor
(WU-E) imports it directly for inline feedback as the user types.

**Why.** ADR 0004 §8 already says `applyOperation` "is also the natural home for the
dependency check the structured editor needs, so the two share one implementation rather than
forking the rule". Extending that to the whole precondition set means the editor and the
server can never disagree about what is legal, and the rules stay in the dependency-free
engine where they can be table-tested in isolation.

**Considered and rejected.** A server-only validator with the client re-implementing a subset
for UX. Rejected: two rule sets drift, and the drift shows up as the editor accepting an edit
the API then rejects.

**Consequences.** `validateOperation` is pure over a `SchemaDocument` and one `Operation`; it
cannot see the operation log or the database, which is correct — every precondition in
`docs/robustness.md` is a property of the current document plus the proposed edit.
`OpError` and `OpWarning` are new public types in `engine/`, a discriminated union keyed on a
`reason` code (`docs/robustness.md` §1).

## 2. Three outcomes: block, warn, silent

Every precondition resolves to exactly one of:

- **Block** — `validateOperation` returns an `OpError`. Nothing is written; the editor shows
  an error, the API returns `422`. Used when the edit is *incoherent* — the resulting
  document would not be a valid Postgres schema, or the operation has no target to act on.
- **Warn** — the operation applies and a typed `OpWarning` is attached, surfaced on the
  structured editor, the branch Divergence sub-sheet, and the merge-review screen. Used when
  the edit is *legal but risky*.
- **Silent** — applies with nothing attached. The ordinary case.

**The block list** (full table in `docs/robustness.md` §2): target does not exist; new name
already taken in its namespace; type outside the nine `ColumnType` kinds or with invalid
parameters; identifier illegal (§3); a foreign key, index, unique, or primary-key member that
does not resolve; a second primary key on one table; **a nullable column placed in a primary
key** (the ADR 0001 invariant — also blocks `setNullable(true)` on a current PK member); a
drop with a live dependent (ADR 0001 §3, already locked); an unrenderable default (§4).

**The warn list**: `dropColumn` / `dropTable`; a narrowing or otherwise lossy `retypeColumn`;
`setNullable(false)` on a column with no default; (optional) a `changeForeignKey` that
loosens `onDelete` to `cascade`.

**Why `setNullable(false)` with no default warns rather than blocks.** Row data is out of
scope, so there is nothing for a `SET NOT NULL` to fail against — the resulting schema is
valid. Blocking it would stop a legitimate "this column is required from now on" edit; the
user may be relying on application-level enforcement, which is poor practice but is their
call, not ours to veto. A real Postgres would not block the DDL either (it fails only if
existing rows violate it). If the same batch also sets a default, no warning is emitted.

**Why a narrowing `retypeColumn` warns rather than blocks.** Deciding that `int → bigint` is
safe while `int → text` is not is exactly the widening / safety lattice `CONTEXT.md` puts out
of scope. Without it the engine cannot rank retypes, so it warns on every lossy-looking one
and blocks none. A real database does not block a narrowing `ALTER TYPE` either.

**Why `changePrimaryKey` dropping a column from the key is silent.** It is a deliberate
structural edit like any other; a warning there would be noise.

**Considered and rejected.** A fourth "confirm" tier (block until the user acknowledges).
Rejected: the merge and diff views already carry the warnings visibly, and a modal
confirmation is the interactive prompt ADR 0002 argues against for the merge — the same
argument applies to the editor.

**Consequences.** The warning catalogue is fixed here; adding a class is an ADR revision.
The `destructive: true` flag ADR 0003 §5 puts on the DDL IR is the data hook the diff and
merge views read to render these — the emitter sets it for `dropColumn`, `dropTable`,
`dropConstraint`, `dropIndex`, and a lossy `alterColumnType`; the warning *text* is composed
by `validateOperation` from the `OpWarning`, not regexed out of SQL.

## 3. Identifier quoting: always double-quote, and restrict new names at the source

Two rules, together:

1. **Generated DDL always double-quotes every identifier** — table, column, constraint,
   index, and the schema name. `quoteIdent` (ADR 0003 §5) becomes permanently
   `s => '"' + s.replace(/"/g, '""') + '"'`. There is no reserved-word list and no
   quote-only-when-needed path.
2. **New object names are restricted at edit time** to `^[a-z_][a-z0-9_]*$` and ≤ 63 bytes
   (Postgres's identifier length limit — a longer name is silently truncated by Postgres,
   which can collide two objects, so it blocks). Enforced by `validateOperation`
   (`reason: "invalid-identifier"`) for every op that introduces or changes a name.

**Why.** The ticket asks that "generated DDL always quotes identifiers" and that "reserved
words and mixed-case names round-trip correctly". Always-quoting satisfies the first
literally and the second for free: a column legitimately named `select` passes rule 2 (it
matches the charset) and round-trips because it is always emitted as `"select"`. ADR 0003 §5
anticipated a reserved-word list; it turns out to be unnecessary — always-quoting is already
correct for every identifier, reserved or not. Rule 2's charset restriction is not needed for
quoting correctness; it is there so the human-readable half of a stable id
(`col_users_email_9f31`) stays predictable and so the DDL is not littered with names that
*need* the quotes for anything but reserved words.

**Considered and rejected.** Quote-only-when-needed for more idiomatic output. It needs the
~100-entry Postgres reserved-word list kept current, plus a case check, to save quotes on an
artifact that is read and run once. Not worth the surface.

**Consequences.** Generated DDL is uniformly quoted — visually noisier than hand-written SQL,
but unambiguous and never wrong. The raw-SQL import path (stretch) will meet names that
break rule 2 (`"MyTable"`, Postgres-assigned constraint names); it needs a normalisation or
escape step at the single import chokepoint ADR 0003 §6 already reserves, not a relaxation of
rule 2 for editor-authored schemas.

## 4. Column defaults: an allowlist of renderable forms, rejected at edit time

`Column.default` stays a raw string or `null` (ADR 0001 — not re-opened). `validateOperation`
accepts a non-null default only if it matches one of:

- an integer or decimal literal — `0`, `-1`, `3.14`
- a boolean — `true`, `false`
- `null` (the keyword, distinct from no default)
- a single-quoted string literal with internal quotes doubled — `'pending'`, `'O''Brien'`
- a call to a function on a fixed allowlist — **V0: `now()`, `current_timestamp`,
  `gen_random_uuid()`**

Anything else — an unknown function, a bare word, an arithmetic expression, an unterminated
quote — returns `OpError { reason: "unsafe-default" }` with a message naming the allowed
forms. It is never silently dropped and never guessed at.

**Why.** The default is spliced verbatim into generated DDL (`... DEFAULT <string>`). A
small enumerated safe set is the same move as the closed `ColumnType` union and the
no-SQL-parser stance — it beats trying to sanitise open input, and it keeps the generated
migration trustworthy to run. The allowlist is one named constant; the V1 band widens it
(`current_date`, `current_time`, `clock_timestamp()`, `uuid_generate_v4()`), and
`nextval('...')` is deliberately left out because its string argument would need its own
parser to validate.

**Considered and rejected.** A denylist — pass everything through except strings containing
`;`, `--`, `/*`, or unbalanced quotes. Rejected: a blocklist is only as complete as the
bad-pattern list, and "render the rest as-is" means arbitrary user text flows into generated
SQL — the injection-shaped risk, even for an artifact a human runs by hand.

**Consequences.** `checkReferences`'s sibling check for an unrenderable default (ADR 0003 §4
seam) becomes redundant for editor-authored schemas — `validateOperation` has already
rejected it — but stays in `validateDocument` (§5) as the backstop for the import path.
`setDefault` and `addColumn` are the two ops that carry a default; both route through the
same allowlist function.

## 5. Structural validation of a whole document runs API-side, not in the engine

`engine/` gains a pure `validateDocument(doc: SchemaDocument): StructuralError[]` that
composes `checkReferences` (ADR 0003 §4 — names unique, every member/endpoint resolves) with
the checks 0008 adds: no nullable column in a primary key, no default outside the §4
allowlist, and any other whole-document invariant. It returns a typed list.

It runs in the **API layer**, not inside `threeWayMerge`:

- after `POST /branches/:name/operations` applies a batch, on the new branch head — a
  backstop; `validateOperation` should already have blocked any single-op route to an invalid
  state, so this is cheap insurance;
- after `threeWayMerge` returns `verdict: "clean"`, on the merged candidate — this is the
  case ADR 0002 explicitly deferred ("order-independent illegality is ticket 0008's"). Two
  individually-valid deltas can compose into an invalid document (a duplicate name, a
  dangling reference the merge left behind). On failure the merge endpoint responds `409`
  with the `StructuralError[]`, the same shape as the queue kick-back (ADR 0004 §4).

**Why API-side.** ADR 0002's `MergeOutcome` is a frozen shape (`merged` non-null iff verdict
is `clean`). Adding a structural-validity outcome there would change it. Running the check
one layer out — where ADR 0004 §8 already says "the server re-runs every operation and every
merge through the engine" — keeps the engine's merge contract intact and puts the check on
the code path that already owns "is this safe to persist".

**Considered and rejected.** A new `MergeVerdict` value (`"invalid"`) returned by
`threeWayMerge`. Cleaner call site, but it re-opens a frozen ADR and couples the pure merge
to a concern ADR 0002 deliberately handed off.

**Consequences.** `verifyPrefixes` (ADR 0003's migration replay) is unchanged — it keeps
running `checkReferences` alone after each statement, because a migration's *intermediate*
states only need reference resolution (a wrong statement order shows up as an object used
before it exists). The full `validateDocument` runs once, on the end-state document, not per
prefix.

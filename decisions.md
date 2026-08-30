# Decisions

A running log of the real calls made while building this. The brief at the top was written
before any code existed, as the problem statement asks. Everything under "Decisions" was
settled during planning or during the build, and the file gets appended to as things change.
Where I got something wrong and reversed it, the reversal stays in.

## Brief

### The problem

Version control for a Postgres schema: branch it, change it, see what diverged, merge it back.

The user I have in mind is a team of engineers sharing one database,
where more than one person changes the schema in the same time. That team already has version
control for their application code. For their schema they have migration files, which are a
change log rather than a schema, and reconciliation happens either as a Git text conflict on a
file nobody wants to hand-edit or in one person's head. This tool puts the schema itself under
version control and reconciles the schema, not the files that describe it.

Row data is kept out of scope.

### The hard part

Two problems, and the interesting thing is where they meet.

The first is rename. Given only two schema states, "column `email` became `email_address`" and
"column `email` was dropped and column `email_address` was added" look identical. This is not a
gap in anyone's implementation, it is genuinely undecidable from state alone, and the tools say
so. Atlas's docs state that it is impossible to disambiguate a rename from a drop and add
without asking. Skeema closed the feature request as not planned for the same reason. Prisma,
Alembic, and every non-interactive Atlas run produce a drop and an add, which destroys the
column and everything in it. The distinction is the difference between keeping a column and
deleting it, and it cannot be recovered after the fact.

The second is merging two schemas that diverged. A text merge over a schema dump gets this
wrong in both directions. It reports a conflict when two people added unrelated columns to the
same table, because the lines are adjacent. It merges cleanly when one person dropped a column
the other person indexed, because the lines are far apart. Almost every tool that advertises
"merge" is reconciling the migration file DAG instead, which is a different problem wearing the
same word. Django's `makemigrations --merge` writes a migration that depends on both branch
heads and reconciles nothing. Alembic's merge revision does the same. Neon has no merge at all
and tells you to handle it with whatever migration tool you already use.

Where the two problems meet is the case I care about. One branch renames `email` to
`email_address`. The other branch adds a unique index on `email`. Neither change is wrong.
Applied together in the obvious way, the index points at a column that no longer exists by that
name. The correct outcome is neither a conflict nor an error: it is an index on
`email_address`. I could not find a tool that does this. PlanetScale, which is the only real
prior art for semantic three-way schema merge, cannot do it, because `schemadiff` matches
objects by name and therefore cannot follow a column across a rename in the first place.

A simple approach fails at exactly this point. Diff two states and you lose the rename. Keep an
operation log and replay it and you have Django's problem, where the log tells you the order
things happened but not how to reconcile two orders. You need object identity that survives a
rename, and you need the merge to work on schema objects rather than text.

### The slice

One path, end to end, deployed:

Seed `main` with a small realistic schema. Cut a branch. Change it through a structured editor
that records what you did, including renames. Open a merge request. See a three-way diff against
the common ancestor with every conflict classified by type. Resolve the conflicts. Merge. Get
ordered, runnable Postgres DDL out the other side.

The edge case I own is rename-rebase: a dependent object, an index, a foreign key, or a NOT NULL
constraint, that was added on one branch against a column the other branch renamed. It gets
re-pointed at the new name instead of erroring or being silently dropped.

### Why this instead of a fixed prompt

A fixed prompt tells you whether I can build the thing described. This problem is mostly a
question about what to build, and it has a research answer that changes the design. I spent the
first block of time surveying ten tools, which is how I learned that rename is undecidable
rather than merely unimplemented, that PlanetScale is the only one doing real three-way schema
merge, and that its conflict vocabulary is worth borrowing. That survey moved the design. Object
identity became stable synthetic ids instead of name matching, and the whole rename-rebase case
opened up as a result. I do not think I would have got there by reasoning from first principles
in an afternoon, and a fixed prompt would not have given me anywhere to put the finding.

It also has a hard sub-problem with a real answer rather than a judgement call, which means I
can be wrong in a way that a test catches.

## Decisions

### The model is state-based, with no commit graph

A branch is its current schema document plus a snapshot of its parent taken when the branch was
cut. There are no commits and no history.

I considered building a real commit graph, since the product is called version control and Git
is the obvious mental model. I rejected it because the schema is small enough to store whole,
and because history buys nothing here. Nobody asks what the schema looked like six commits ago.
They ask what is different now and what happens if I merge. Three snapshots answer both, and
storing states instead of a chain of deltas means the merge never has to replay anything.

This follows PlanetScale, which treats a branch as a schema state and diffs states.

Cut: history, blame, revert, and any view of the schema at an arbitrary past point.

### Object identity is a stable synthetic id, not a name

Every table, column, constraint, and index carries an id assigned when it is created. The id
survives renames and survives merges. Foreign keys and indexes reference columns by id, and ids
resolve to names only when DDL is written out. A branch's base snapshot is an id-preserving copy.

The alternative is matching objects by name, which is what PlanetScale does and what every
state-based tool does. It works until someone renames something, at which point the diff reports
a drop and an add and the merge either destroys a column or produces a spurious conflict.

Two things fall out of ids that I did not expect when I chose them. Rename-rebase becomes almost
free: an index references its column by id, so when the other branch renames that column the
reference still resolves and the index follows automatically. And a family of ordering problems
disappears, because "rename column X" and "add index on X" commute when the reference is an id,
where they do not commute when it is a name.

The honest cost: ids exist because the editor mints them. Anything arriving from outside, a
pasted SQL file or an introspected database, has no ids, and for that input I am back where
everyone else is.

### Rename is captured when it happens, not inferred afterwards

The editor records a rename as a rename. There is no similarity matching and no prompt.

Every tool I surveyed resolves this one of three ways. It prompts a human, which Atlas notes
breaks the moment an agent or a CI job runs it non-interactively. It takes a directive the
author writes by hand, like Atlas's `renamed_from` or Liquibase's `renameColumn`. Or it gives up
and emits a destructive drop and add. The only automatic heuristic anyone trusts is exact
structural equality, and even Django only uses that to decide whether to ask.

Fuzzy name matching would be the tempting third option and I am not going to build it. A tool
that guesses `email` became `email_address` will eventually guess that `deleted_at` became
`updated_at`, and the cost of that guess is a dropped column.

### Input is a structured editor, so the engine diffs documents rather than parsing SQL

There is no SQL parser in this project. The editor produces a typed schema document and the
engine compares two of those.

This looks like a shortcut next to PlanetScale's `schemadiff`, which parses SQL into an AST. I
do not think it is one, and it is worth being precise about why. `schemadiff` parses and then
normalizes hard: it collapses `INT(12)` to `int`, makes implicit defaults explicit, lifts inline
primary keys out of column nodes into index structures, and inherits table collations down to
string columns. The output of that pipeline is a semantic model of the schema with every trace
of syntax removed. It is a schema document. A structured editor produces the same thing without
the parse step, so what I skipped is ingestion, not the diff.

"Semantic" here means the opposite of "textual", which is the distinction PlanetScale draws
against Neon's `pg_dump` comparison. The test is whether the diff knows that this is a column,
that it has a type, and that an index depends on it. Mine does. Whether that model arrived via a
parser is an implementation detail of how the schema got in.

What I lose is real: the engine cannot ingest arbitrary DDL. That is the gap, and it is the
first thing I would close given more time. See the console entry below.

Cut: SQL parsing, type normalization, and collation handling, all of which exist in
`schemadiff` because its input is arbitrary user SQL and its output has to match what MySQL
would do.

### Seven conflict classes, plus overlap

Conflicts are typed, not textual. The classes are divergent retype, add-vs-add, rename-vs-rename,
divergent index definition, drop-vs-modify, and dependency conflict. Overlap, where both branches
make the identical change, is not a conflict: it applies once and the merge proceeds.

The vocabulary comes from PlanetScale, which names clear conflicts, subtle conflicts, and
overlaps. Of those six, five are clear conflicts; dependency conflict is the subtle one. (A
seventh class arrived later while speccing the engine — see below — leaving six clear and one
subtle.)

The merge returns a typed report rather than an interactive prompt. Atlas's experience is the
argument: a prompt is a contract with a human, and it fails silently and destructively the
moment a CI job or an agent is on the other end.

A seventh class arrived while I was speccing the engine in ticket 0002: **divergent
definition**, a clear-severity catch-all for both sides changing the same object and aspect to
different values where none of the first six match — a divergent column default, or a divergent
primary key, unique, or foreign-key definition. These are real and were landing nowhere. I could
have let the commutativity check (below) absorb them, but that check reports "unclassified
divergence", which is the message reserved for *the enumeration has a hole* — using it for a
routine divergent-default edit would train people to ignore it. A named, queued class with a
branch picker is the honest treatment. That makes it six clear classes and one subtle.

The other correction from that spec pass: the classifier is two passes, not one. Pairing changes
by the object-and-aspect slot they touch finds five of the classes, but drop-vs-modify pairs a
deletion against an edit on *different* slots of the same object, and dependency conflict relates
an edit on one object to a deletion of *another*. Both need a second, cross-referencing pass.
A single-pass slot classifier would have silently missed two of the seven.

### Ordering conflicts: split in two, not dropped

This one I got wrong first and corrected.

PlanetScale names a "subtle conflict" for changes that are individually valid but produce
different results depending on application order, and their example is column order. My initial
plan dropped the class entirely on the grounds that Postgres schemas have no meaningful column
order. That reasoning was half right and I was about to lose something real.

PlanetScale's subtle conflict actually bundles three things. Positional order, meaning a
column's ordinal position in its table, genuinely does dissolve here. MySQL can express it with
`ADD COLUMN ... AFTER x`, so PlanetScale's canonical `CREATE TABLE` carries position and two
branches adding different columns compare as unequal. Postgres cannot express it at all, has no
way to reorder a table, and always appends. Two branches cannot hold competing intentions about
something neither can specify. PlanetScale makes the same call themselves for index ordering,
which they explicitly disregard.

Dependency order is a different thing and it is entirely real. One branch drops a column, the
other indexes it. One branch drops a table, the other adds a foreign key pointing at it. Both
sides are individually valid and the combination is broken. That survives as the dependency
conflict class.

Column order inside a composite index or primary key is a third thing again, and it matters
completely. An index on `(a, b)` is not an index on `(b, a)`. A divergence there is a divergent
index definition.

So the class did not disappear. It split, and I nearly deleted the useful third of it because
the name covered all three.

### The engine refuses to declare a merge it cannot prove

Before reporting a clean merge, the engine checks that applying each branch's delta to the
common ancestor in either order produces the same document, and that the document equals the
merge result. If that fails, the merge is blocked and reported as an unclassified divergence.

This is PlanetScale's commutativity test, `diff1(diff2(base)) == diff2(diff1(base))`. My first
plan kept it only as a unit test invariant. I moved it into the engine because the seven conflict
classes are rule-based, and a rule-based detector is only ever as complete as the list of rules
I thought of. The commutativity check does not depend on that list. It catches the case I failed
to enumerate, and it turns a silent wrong merge into a visible refusal.

It costs almost nothing, because the apply function and document equality both already exist for
other reasons. A merge tool that silently produces a wrong schema is worse than one that admits
it is stuck.

One limit I want recorded rather than glossed: this check proves *order-independence*, not
correctness. Two branches that each create a table called `audit` produce the same document in
either application order, so the check passes and the result is still invalid. Concurrent
duplicate names are caught up front by keying the classifier on `(namespace, name)` as well as
on id; everything else in that category — a duplicate name, a reference the merge left dangling —
is the job of a structural validation pass over the merged candidate, which is ticket 0008, not
this check.

### `main` is the trunk, and branches come only from `main`

Not "a branch like any other". Every branch is cut from `main` and merges back into `main`.

This is a deliberate constraint to keep the build tractable, and it removes branch-of-branch
merge semantics from scope. It also converges the model exactly on PlanetScale, where `main` is
the common ancestor by construction.

Cut: branching from a non-`main` branch.

### Staleness and races are one problem, solved with a merge queue

An open merge request goes stale the moment another branch merges into `main`. A separate but
related failure is the race: two authors open merge requests that are each individually clean,
both conflict with each other, and both click merge within seconds. The second one cannot
proceed, and the interesting question is what happens to them.

I chose PlanetScale's answer. Merging is serialized through a queue. A merge request is
re-validated against `main`'s head at the moment it reaches the front of the queue, not at the
moment it was opened. If `main` moved and the merge is still clean, it merges. If new conflicts
appeared, it goes back to the author with the new conflict list.

What sold me is that one mechanism covers both cases. The race and the stale merge request stop
being different situations and become the same code path, which is the second one to arrive
getting re-validated against a `main` that moved underneath it.

The alternative was GitHub's model: recompute the diff whenever the page is viewed, and refresh
live when the base moves. It is a better experience and it is more work, so it is on the stretch
list.

At this scale the queue does not need a job runner. A serialized merge inside one transaction
with a version check on `main`'s head has the same semantics for a fraction of the effort, and
I would rather spend the saved time on the merge engine.

One detail I want to get right rather than leave to the default: the author whose merge gets
kicked back did nothing wrong. The message needs to say what landed ahead of them and what now
conflicts, not that their state is invalid.

Cut: rebase as a user-facing operation. The queue's re-validation is an implicit rebase and that
is enough here.

### Foreign keys are in scope, which is where I part company with PlanetScale

PlanetScale bypasses native foreign keys entirely and pushes referential integrity into the
application or the proxy layer. Their reasons are good ones: enforcing referential integrity
across shards would need distributed two-phase locking, and their online migrations swap a ghost
table underneath the original, which breaks InnoDB's internal foreign key references.

Every one of those reasons is about the data plane, and this project does not have one. There is
no sharding, no ghost table, and no live traffic. So foreign keys stay, and they earn their
place: the most interesting case in DDL ordering is a foreign key that cannot be added until both
endpoint tables exist, and the most interesting dependency conflict is a foreign key pointing at
a table the other branch dropped.

I am flagging this because a reviewer who knows PlanetScale will read "foreign keys supported"
as either a misunderstanding or a deliberate divergence, and it is the second one.

### The generated migration is one transaction

Postgres has transactional DDL, so the whole migration is wrapped in a single transaction and
either fully applies or does nothing.

This is worth stating because it removes a problem the reference implementation has to work
around. A good part of `schemadiff`'s dependency machinery, the equivalence classes and the
topological sort within them, exists because MySQL cannot do multi-statement DDL atomically and
a failure halfway through leaves a half-migrated schema. On Postgres a bad ordering is a rolled
back transaction rather than a corrupted database.

I am still checking statement ordering and still verifying that every prefix of a migration
leaves the schema structurally valid, which is what `schemadiff` does with its step-by-step
in-memory replay. The transaction turns a bad ordering into "nothing happened". The intermediate
state check turns it into "caught before we generated it". Both are worth having.

### Merge requests are dry-run against a real Postgres before you merge

When a merge request is created, the generated migration runs against an ephemeral Neon branch
seeded with the target schema, and the result is read back and compared to what the engine said
the merge would produce. The verdict appears in the merge request.

This is PlanetScale's shadow branch, and I had it in the plan as a test-only harness before
realizing I was building the infrastructure and then throwing away the feature. Running the same
check on merge request creation costs very little from there, and it changes what the diff view
is claiming. Without it the tool says this migration should work. With it the tool says this
migration ran.

The round trip through Postgres is also most of a SQL importer, which is why the console entry
below is cheaper than it first looked.

Because it is on the request path it needs a real answer for when Neon is slow or unreachable.
The dry run is evidence, not a gate: the merge stays possible, and the UI says plainly that it
could not be verified.

*(Revised in ticket 0009. The dry run is now stretch-band, triggered by a manual "Validate"
button on a clean merge request rather than automatically on creation, and it only checks that
a real Postgres accepts the emitted DDL — no introspection, no compare-to-`merged`. See ADR
0009. The "evidence, not a gate" and graceful-degradation points still hold.)*

### Forward-only migrations

The generated DDL only goes forwards. Renames render as `ALTER ... RENAME` and never as a drop
and an add.

Down-migrations are a lot of work and, in my experience, close to useless: the down path is
rarely tested, and rolling a schema backwards usually loses data anyway. PlanetScale solves the
real version of this with reverse replication streams anchored to a GTID, which is a data plane
feature and out of scope by definition here.

Cut: down-migrations, rollback generation, and anything that executes the migration against a
real database on the user's behalf. The product ends at a migration you can read and run. This
is the largest single reduction against PlanetScale, whose entire value is that they apply it
for you, and it is the right cut for the time available.

*(Corrected below — see "The generated DDL is a rendering of the merge, not a deliverable".
The product does not "end at a migration you run": `main`'s schema document is the schema of
record and a merge updates it directly. There is no downstream database. The forward-only and
`ALTER … RENAME` facts above still hold for what `emit` renders.)*

### The generated DDL is a rendering of the merge, not a deliverable

Caught by grilling in ticket 0009. `main`'s schema document is the schema of record. A merge
updates that document directly — applying the merged delta and appending to the op log is the
entire act. Nothing executes the generated DDL and there is no downstream Postgres for it to
run against.

Earlier framing — "get ordered, runnable Postgres DDL out the other side", "the product ends
at a migration you can read and run" — imported the mental model of the migration-file tools
(Atlas, Prisma, Liquibase: you keep a schema, they hand you a file to apply) into a product
that is actually a control plane where the schema lives inside it. The docs even carried the
contradiction openly: state-based, migration files are not the input, yet a runnable migration
file was named as the output.

Nothing in code changes. `emit`'s `DdlStatement` IR, the phase ordering, `serialize`, and
`replay`'s intermediate-state check all stand, and the merge-review screen still shows the
SQL. What changes is language: the SQL is shown as what the merge amounts to, not as an
artifact anyone runs. The Neon-backed dry run (ticket 0009) drops to the stretch band with no
narrative attached — it just checks that a real Postgres accepts what `emit` produced; the
V0/V1 guarantee that `emit` is correct is a pure test (`applyDelta` / `replay` in memory).
ADR 0003's mechanism is untouched; its "a migration you deploy" framing is corrected here.

### Stack

React single page app, Hono API, both on Vercel, Neon Postgres, Drizzle.

The merge engine is plain TypeScript with no framework imports and no runtime dependencies. It
is the part that has to be right, so it is the part that is table-tested in isolation and could
be lifted into a CLI or a CI check without touching it.

The rest of the stack is a boring choice on purpose. I picked things I can move fast in, and
none of it is load-bearing for anything interesting in this problem. If the frontend starts
costing me time I will say so here rather than quietly absorbing it.

### Two id styles: prefixed strings inside the engine, UUIDs for users

Schema objects, meaning tables, columns, constraints and indexes, get an id like
`col_users_email_9f31`: a type prefix, the table and column name, and a short random suffix.
The engine works entirely on these ids, and a three-way merge is a dense mesh of id
references, so reading one in a diff without a lookup is worth the few extra characters. It
mirrors Postgres's own `users_email_fkey` convention. The human-readable part is frozen at
creation and goes stale after a rename. That staleness is useful, it tells you what the object
used to be called. The id string itself never changes.

Users and organisations get plain UUIDs instead. They are referenced in only a few places,
never in a graph you read by eye, and they land in a real database table where a uuid primary
key is the ordinary choice. Baking a username into a user's primary key would be a coupling
smell and would go stale the moment they rename themselves. Two styles in one codebase looks
inconsistent until you notice they live in different layers and never mix.

### Column types are a closed union, and defaults are opaque literals

A column's type is a discriminated union: `{ kind: "int" }`, `{ kind: "varchar"; n: number }`,
`{ kind: "numeric"; precision: number; scale: number }`, and so on across a fixed set of nine.
A bare string like `"varchar(255)"` cannot carry the parameters without a parser, and the
whole point of the structured editor is that there is no parser. Type equivalence is
structural equality on this object, parameters included, which is the exact-match rule from
`CONTEXT.md`.

A column default is stored as the raw SQL literal text the user entered, such as `"0"`,
`"false"` or `"now()"`, or `null` for no default. I am not parsing or normalising it. That
leaves a known ambiguity, `0` the integer versus `'0'` the string, which the DDL renderer
settles when it quotes literals. It does not need settling in the representation.

### The operation log is a UI feature, not the merge's source of truth

The engine's identity mechanism is the stable id in the snapshot, not the operation log. I
want this written down plainly because it came up again while charting ticket 0001 and it is
easy to get backwards. Surely the log is what tells you a column was renamed rather than
dropped and re-added? No. The editor writes the rename into the head snapshot by keeping the
column's id while changing its name, and the merge sees the same id with a new name when it
diffs snapshots by id. Delete every operation log and the merge is still correct. The log is
there for undo and for showing a branch's history. See ADR 0001 §2.

Two shapes I changed while writing the types. The `merge` marker on `main`'s log was going to
carry a `mergedById`. I dropped it once every `LogEntry` carried a required `authorId`, which
already records who ran the merge. And a log entry first embedded the whole `User` object as
its author. That bakes a stale copy of someone's name into every entry and drags the
organisation in behind it, so it is now an `authorId` string the app resolves for display.

### Drops are blocked when something depends on them

You cannot drop a column while an index, unique, primary key, or foreign key still references
it, and you cannot drop a table while another table's foreign key points at it. The editor
stops you and you remove the dependents first, each as its own operation. The alternative is
to cascade the drop and record what it swept away, which makes one logged operation stand for
several intents and multiplies what the merge engine has to reason about. See ADR 0001 §3.

### Users exist now, authentication still does not

The earlier cut list put "users" alongside "authentication and permissions". Users are back.
The product is for a team, and a merge request with no author makes the central demo
impossible to tell, the one where two people change the same schema and reconcile it. So there
is a `User` and an `Organization`, an `authorId` on every operation, a seeded organisation
with three people in it, and a landing page that takes a username. There is still no password,
no session, and no permission check, and impersonation is a non-goal rather than a bug. See
ADR 0001 §4.

### The migration generator takes two schema documents, not a delta

Ticket 0003. `emitMigration(source, target)` computes the delta itself with `diffSnapshots`,
the same way `threeWayMerge` is handed documents and derives its deltas rather than being
passed them. The ticket phrases the input as "a delta between two schema documents", which
reads like the signature, but the delta alone is not enough: resolving an object's id to its
current name needs the target document, and the foreign-key pass reads both. Passing a delta
as well would be a third input that can silently disagree with `diffSnapshots(source, target)`.
`source` is `theirs` for a merge and `base` for a branch head; `target` is the merged document
or the branch head. See ADR 0003 §1.

### DDL is generated as a typed statement list, then serialized

The generator builds a `DdlStatement[]` — a discriminated union that mirrors Postgres DDL and
carries resolved names, never ids — and only then renders it to SQL text. Two things need the
ordered statement list before it is a string: the intermediate-state check replays it against
an in-memory schema model, and the merge-review screen renders "what this migration will do"
without re-parsing SQL. It is the same move as the merge engine's derived delta: the artifact
that gets verified is the artifact that gets rendered, so they cannot drift. Emitting strings
directly would force the intermediate-state checker to parse SQL back into a model — the parser
this project has gone out of its way not to write. See ADR 0003 §2.

### Statement ordering reuses the merge engine's four fixed phases

The migration's dependency graph is the same shallow static graph `applyDelta` already reasons
about — table to column to {index, primary key, unique, foreign key}, cross-table only through
a foreign key, with views and the rest cut. A graph that shape has one topological order up to
sibling permutation, and it is known at compile time, so `emitMigration` sorts statements into
the same four phases the replay uses — creates and renames, intra-table alters, foreign keys,
then drops in reverse — instead of building and sorting a graph per migration. "Describe the
topological-sort rule" is answered by "the phases are the topological order". The foreign-key
knot — two new tables referencing each other — dissolves the way it does in `applyDelta`:
`CREATE TABLE` never carries its foreign keys, and a later pass adds every foreign key once all
tables and columns exist. A `change*` to an index or constraint emits an adjacent drop-then-add
pair inside one phase, not a drop deferred to the teardown phase, or the re-add would run
first. See ADR 0003 §3 and `docs/migration-generation.md` §3–4.

### A column retype is ordered before dependent adds, but nothing is dropped around it

Postgres `ALTER COLUMN ... TYPE` rebuilds every index, primary key, and unique that covers the
column on its own, so the generator never emits an explicit drop-and-recreate around a retype.
The only rule is a within-phase ordering: a retype of a column is serialized before any index
or constraint add in the same migration that lists that column, so we do not build an object
and immediately have Postgres rebuild it. Drops of dependents are already in the final phase,
so that direction needs nothing. See ADR 0003 §3 and `docs/migration-generation.md` §6.

### The intermediate-state check is a separate statement-by-statement replayer

`docs/merge-engine.md` has `applyDelta`, which replays id-referenced operations as one
four-phase batch. The migration check is a different thing: it replays the already-ordered,
name-resolved `DdlStatement[]` one statement at a time and asserts every reference still
resolves after each — every prefix of the migration, not just the end state. An unsound prefix
means the ordering is wrong, and this catches it at generation time, on top of the transaction
that would roll a bad ordering back at apply time. The reference-resolution predicate it runs
after each step is the seam to ticket 0008, which extends the same predicate with the
nullable-primary-key-member and unsafe-default checks. See ADR 0003 §4 and
`docs/migration-generation.md` §5.

### Quoting and destructive-change warnings are ticket 0008's, consumed through seams

Ticket 0003 leaves two hooks rather than deciding these. Every identifier in the serializer
goes through one `quoteIdent` function, a placeholder that always double-quotes until 0008
supplies the reserved-word and mixed-case rules. Every destructive statement in the IR carries
a `destructive: true` flag for 0008's warning pass to read, instead of that pass having to
regex generated SQL. Until 0008 lands, generated SQL over-quotes and carries no warnings, and
the spike is written not to depend on either. See ADR 0003 §5.

### Schema states are stored whole, as `jsonb`

Ticket 0004. A branch's `head`, its `base_snapshot`, and a merge request's frozen `base` /
`ours` / `theirs` are each one `jsonb` column holding a `SchemaDocument`. There is no table
for schema objects — tables, columns, indexes, and constraints live only inside those
documents.

This follows straight from the state-based model. The engine consumes whole documents and
clones them with `structuredClone`; it never queries inside one. Normalising into rows would
rebuild that tree on every read and create a second copy of the engine's types that can drift
from `engine/schema.ts`. The cost is that Postgres cannot enforce anything about schema
contents — id uniqueness, FK member resolution, every structural invariant is the engine's
job, which it already was. See ADR 0004 §1.

### The merge queue is a stored status, strict FIFO — and I walked this back once

Ticket 0004. My first cut of the queue was "no queue table": a line derived from `created_at`,
position shown for information only, merging serialised by a row lock and re-validated on the
merge click. The owner pushed back on two points and both were right. First, while merge
request 1 sits open with unresolved conflicts, merge request 2's three-way against current
`main` is misleading — its real base is whatever `main` becomes after MR1 lands, so inviting
its author to resolve conflicts then is inviting wasted work. Second, the "is this MR allowed
to act" gate has to hold at the API, not just the UI; deriving "is this the oldest open MR"
on every mutating call is recomputation for a fact that changes only on create, merge, and
abandon.

So `merge_requests.status` is `queued | open | held | merged`, and the invariant is that at
most one MR per target branch is `open` or `held` — the active one. Every mutating endpoint
checks that one column. The queue is strict single-file: the front MR merges or is abandoned,
then the oldest `queued` MR is promoted. A `held` MR (kicked back from a failed merge attempt)
keeps its place and blocks the line; "let a clean MR behind it jump ahead" was considered and
rejected because it reintroduces exactly the ordering questions the queue removes — if MR4 and
MR5 are both clean behind three held MRs, which merges first, and do they form their own
queue. The accepted cost is that an abandoned active MR freezes the line until someone deletes
it, which is how a real merge queue behaves. See ADR 0004 §3.

### The merge is one transaction with a row lock, not an optimistic version check

Ticket 0004. The ticket offers an optimistic check on `main`'s head as the cheap alternative
to a job runner. `SELECT … FOR UPDATE` on the target branch row is cheaper still and has the
same semantics — the database serialises the second merger behind the first, and there is no
compare-and-retry loop to write. `head_version` stays on the row, but only so a merge-request
`GET` can say "you previewed against `main@v3`, it is now at `v5`". The re-validation inside
the transaction runs `threeWayMerge` against the live `main.head`, never the frozen `theirs`.
See ADR 0004 §4.

### A merge request freezes only the three snapshots; everything else recomputes

Ticket 0004. The row stores `base` / `ours` / `theirs` and nothing derived — not the
`MergeReport`, not the generated migration, not the queue position. `GET /merge-requests/:id`
re-runs `threeWayMerge` and `emitMigration` every call. Same argument as the derived delta and
the DDL IR: a stored copy of engine output goes stale the moment the engine changes. The
engine is pure and works on kilobyte documents, so recomputing is free. When a `queued` MR is
promoted to `open`, its next `GET` rewrites the frozen `theirs` and `ours` to the live values
first — `base` never moves — so the active MR's resolution work is always against the real
current base. A merged MR is still fully reproducible, because its triple was refreshed to
what the merge actually used. See ADR 0004 §5.

### Resolutions are keyed by the engine's `conflictId`, with a stored snapshot to detect reshape

Ticket 0004. `engine/classify.ts` already builds `Conflict.id` as the class plus the sorted
object ids and nothing else, so the ticket's "key by object id plus conflict class" is just
"key by `conflictId`". Each stored resolution also carries a `conflict_snapshot` — the
conflict's `base` / `ours` / `theirs` at save time. On re-validation a resolution is
re-applied only if its `conflictId` is still a live conflict and the snapshot still matches;
if the id is gone the choice is dropped quietly, if the id is there but the shape changed it
is dropped with a visible notice. Rows are never auto-deleted — a stale one is harmless
because the engine ignores an unknown `conflictId` and the snapshot guard blocks a wrong
re-apply. See ADR 0004 §6.

### The API returns raw domain data; the client owns the view-model projection

Ticket 0004. I first proposed the opposite — the Hono layer assembling `MergeReview` (rows,
gate states, pre-rendered `"int → varchar(32)"` strings) and returning that, with the raw
`MergeReport` on a sibling `/report` route. The owner pushed back and was right. The two
candidate shapes are both JSON — this was never an SSR question — and the projection between
them has to run somewhere. The client is the right place here: it is not a thin consumer (WU-E
is a structured schema editor that already renders `SchemaDocument`s), `MergeReview` is defined
in `web/` and its fixture already builds that shape, and CI/agents want the raw typed report
rather than pre-rendered strings anyway. Server-side assembly would add an adapter layer and
couple the API to a frontend-shaped type for no present gain.

So `GET /merge-requests/:id` returns
`{ base, ours, theirs, report, migration, queue, stale, droppedResolutions }` — raw engine
output plus the queue framing the client cannot derive. No `/report` sibling; the primary
endpoint is already raw. `GET /overview` and `GET /branches/:name` likewise return domain data
(`Database`, `BranchSummary[]`, schema documents), not rendered aggregates. The
`MergeReview` transform grows in `web/src/merge-review/`, fed by the API instead of literals.
See ADR 0004 §7.

### The server re-runs every operation through the engine

Ticket 0004. `POST /branches/:name/operations` applies each op through a shared
`applyOperation(doc, op)` that enforces ADR 0001 §3's dependency block, returning `422` with
the blocking dependents and persisting nothing. The client enforces the same rule for
feedback, but the server is authoritative — an API that trusts the client can persist a
corrupt head. `applyOperation` is new engine surface (`apply.ts` exports only the batch
`applyDelta` today), framework-free, and it is also what the structured editor needs, so the
rule has one home. See ADR 0004 §8.

### The seed stays the blog schema, not a SaaS app

Ticket 0005. The ticket sketched a SaaS seed — `users`, `organizations`, `memberships`,
`projects`. I kept the provisional blog schema instead (`users`, `posts`, `comments`, `tags`,
`post_tags`). It is wired into the 0002 merge spike (~30 references), the 0003 emit spike, and
both worked branch examples, all green and reviewed; and it already does everything a seed
needs — every `ColumnType` once, single and composite primary keys, uniques, indexes, foreign
keys with `cascade` and `restrict`, nullable and not-null, literal and `now()` defaults —
small enough to read at a glance. The SaaS domain would make the versioned schema echo ryft's
own org/membership shape, which is a nice touch for a reviewer, but it is thematic polish and
it costs a rebuild of the two spikes and both examples. The versioned schema is a sample
customer database; it does not need to look like ryft's internals. If the theme is wanted
later, the demo organisation can be named for a SaaS company without touching the schema. See
ADR 0005 §1.

### The fresh instance is populated, not bare

Ticket 0005. `POST /workspace/reset` seeds `main` plus the `contact-fields` branch, its
operation log, and one open, clean merge request — so the branches list, the merge list, and
the three-way diff all have real content on the first screen. The ticket floated a pre-made
merge request as a nice-to-have; I made it the default. The merge-review screen is the built
surface and the one most worth showing working immediately, and a reviewer landing on three
empty lists learns less than one who can open a real branch and merge it. The seeded merge
request is clean, not conflicted — V0 ends in a successful merge, and the conflict beat is a
branch the demo script has the reviewer create, not a state a fresh instance sits in
uninvited. The empty-state copy is still fully specified and reachable by deleting the branch
(or a `?bare` reset mode for screenshots). See ADR 0005 §2.

### The first branch is created clean, with a suggestion rather than a pre-applied edit

Ticket 0005. "A first branch pre-loaded with a suggested change to try" reads two ways. A
branch that already contains an operation nobody made fights "one operation, one intent" — the
first log entry is a mystery to reverse-engineer and the first undo is ambiguous. So the
one-click path makes a branch equal to `main`, and the branch workspace shows a dismissible
copy suggestion ("Try a rename: `posts.body` → `content`") that is also step one of the demo
script. See ADR 0005 §3.

### The demo script is two tiers, not one

Ticket 0005. "Exercises every operation class exactly once" and "make someone smile" want
different documents. There is a five-minute golden path — land, merge the seeded request,
branch, make a few edits, merge — and a separate full-coverage appendix that threads all 21
operation classes through one `editor-tour` branch in the engine's own phase order, then walks
the V1 conflict beat. One script that did both would give a `renameTable` the same narrative
weight as the rename-rebase case and run long. See ADR 0005 §4 and `docs/first-run.md`.

### Validation is one pure function in the engine, and it blocks incoherence but only warns on risk

Ticket 0008. `validateOperation(doc, op)` lives in `engine/`, is pure, and returns typed
`OpError` / `OpWarning` lists. `applyOperation` calls it and refuses on any error; the
structured editor imports it for inline feedback, so the two can never disagree about what is
legal. Every precondition resolves to one of three outcomes: block (the resulting document
would not be a valid schema, or the edit has no target), warn (legal but risky — surfaced on
the editor, the divergence view, and the merge view), or silent.

The line between block and warn came down to one principle the owner set: if a real Postgres
would let the DDL through, we do not block it either. So `setNullable(false)` on a column with
no default warns rather than blocks — there is no row data in scope to violate it, and the
user may be relying on application-level enforcement, which is their call to make badly. A
narrowing `retypeColumn` also only warns: telling `int → bigint` from `int → text` is the
widening lattice `CONTEXT.md` puts out of scope, so the engine cannot rank retypes and warns
on all lossy-looking ones. Dropping a column from a primary key is silent — an ordinary
structural edit. What does block: a missing target, a name collision, a type outside the nine
kinds, an illegal identifier, an unresolved reference, a second primary key, a nullable column
in a primary key, a drop with live dependents, and an unrenderable default. See ADR 0008
§1–§2 and `docs/robustness.md` §2.

### Generated DDL always double-quotes every identifier, permanently

Ticket 0008. ADR 0003 left `quoteIdent` as a placeholder that always double-quotes, expecting
0008 to supply a reserved-word list and a quote-only-when-needed rule. 0008's answer is that
the list is unnecessary: always-quoting is already correct for every identifier, reserved or
not, and it makes the ticket's "reserved words and mixed-case names round-trip correctly"
fall out for free. A column legitimately named `select` is emitted as `"select"` and works.
The saving from quote-when-needed — fewer quotes on an artifact read and run once — is not
worth maintaining Postgres's ~100-word reserved list. Alongside this, new object names are
restricted at edit time to `^[a-z_][a-z0-9_]*$` and 63 bytes (Postgres's limit — a longer
name is silently truncated and can collide), which is a legibility choice, not a
quoting-correctness one. See ADR 0008 §3.

### Column defaults are an allowlist of renderable forms, rejected at edit time

Ticket 0008. The default literal is spliced verbatim into generated DDL, so `validateOperation`
accepts a non-null default only if it is an integer or decimal literal, a boolean, the `null`
keyword, a properly-quoted string literal, or a call to a function on a fixed allowlist —
`now()`, `current_timestamp`, `gen_random_uuid()` in V0, widened in V1. Anything else is a
blocking `unsafe-default` error naming the allowed forms; it is never silently dropped or
guessed at. This is the same move as the closed `ColumnType` union: a small enumerated safe
set beats sanitising open input, and it keeps the generated migration trustworthy to run. A
denylist (pass everything except strings with `;`, `--`, unbalanced quotes) was rejected —
a blocklist is only as good as its pattern list, and "render the rest as-is" puts arbitrary
user text into generated SQL. `Column.default` stays an opaque string in the representation
(ADR 0001 is not re-opened); 0008 only validates it. See ADR 0008 §4.

### Whole-document structural validation runs API-side, so the merge contract stays frozen

Ticket 0008. ADR 0002 deferred "order-independent illegality" in a merged document — a
duplicate name, a dangling reference two clean deltas leave behind — to this ticket.
`validateDocument(doc)` composes `checkReferences` (ADR 0003 §4) with the 0008 checks
(nullable primary-key member, unrenderable default) and runs in the API layer, not inside
`threeWayMerge`: after an operations batch on the new branch head as a backstop, and after
`threeWayMerge` returns `clean` on the merged candidate, where a `StructuralError` becomes a
`409`. Running it one layer out keeps ADR 0002's `MergeOutcome` shape (`merged` non-null iff
`clean`) frozen and puts the check on the code path that already owns "safe to persist" (ADR
0004 §8). A new `MergeVerdict` value was considered and rejected for re-opening a frozen ADR.
`verifyPrefixes` is unchanged — a migration's intermediate states only need reference
resolution. See ADR 0008 §5.

### The engine test catalogue is real tests, not a document to transcribe later

Ticket 0006. The ticket's literal deliverable was "the filled matrices and invariant list,
ready to transcribe into a test file". A markdown table is weak evidence for the "meaningful
tests" rubric line this ticket exists for, and the spike runners were already ~80% of the way,
so it ships as a real **vitest** suite: `engine/merge.test.ts` (38 scenarios), `emit.test.ts`
(10), `invariants.test.ts` (I1–I8 swept over both), and `web/src/merge-review/model.test.ts`
(the pure view-model selectors). `docs/engine-test-catalog.md` is the companion matrix.
Runner is one root `vitest.config.ts` covering `engine/`, `src/`, and the pure `web/` tests —
no separate `web/` runner, no `jsdom`.

Two engine behaviours the catalogue guessed wrong and were reconciled to reality (pin what
the engine does, not what I assumed): dropping a table emits a single `DROP TABLE` with no
explicit teardown of the table's own constraints (Postgres removes them with it), and the
drop half of a `changeIndex` redefinition carries `destructive: false` on purpose so 0008's
warning pass does not flag a mechanical redefinition as a destructive change.

One genuine gap surfaced and is pinned rather than hidden: `diffSnapshots` on a primary key
whose *id* changed — a wholesale `primaryKey` object swap instead of a `changePrimaryKey` —
emits `addPrimaryKey` without the matching `dropPrimaryKey`, so `emitMigration` fails its own
intermediate-state check. An `it.fails` test records it; it will flip to a real failure once
emit emits the drop or the fixture is reshaped. Fixing it is ADR 0003's call.

Frontend test posture: pure functions only (`web/src/merge-review/model.ts` selectors,
`format.ts` renderers). No DOM, component, or render tests — the surfaces are fixture-bound
and thin, and a render test pins layout without adding confidence.

## Deliberately cut

Beyond the cuts recorded above:

Views, enums and custom types, check constraints, triggers, functions, partitions, and
row-level security. This has a consequence I would rather name than hide: the dependency graph
is only tables to columns to indexes and foreign keys, which is shallower than `schemadiff`'s,
where the interesting case is a view depending on a table. I am not claiming parity with it.

Multiple schemas and namespaces. Authentication and permissions — users themselves are now in
scope (see "Users exist now, authentication still does not" above). More than one target branch
per merge request.

A widening or safety ordering over types. Two types are equal only if their normalized forms
match exactly, parameters included, so `varchar(255)` and `varchar(256)` differ. The engine does
not know that widening `int` to `bigint` is safer than retyping it to `text`. Ranking retypes by
risk is a stretch item.

A SQL console per branch, which is how PlanetScale actually works and was my original intent: a
SQL editor where you run `ALTER TABLE` and `DROP CONSTRAINT` and that becomes your schema
evolution. It is on the stretch list rather than cut, because it is the one feature that would
close the ingestion gap, and because a rename typed as `ALTER TABLE ... RENAME COLUMN` carries
its own intent, so the console keeps the identity signal that a raw state comparison loses.

*(An earlier version of this entry argued the console was "most of a SQL importer for free"
because the dry-run harness introspected Postgres back into a schema document. Ticket 0009
settled the harness as apply-only — it never introspects — so that argument no longer holds.
The console and raw-SQL import stay stretch, and would need their own introspection round-trip
if built.)*

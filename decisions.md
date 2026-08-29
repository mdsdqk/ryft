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

### Six conflict classes, plus overlap

Conflicts are typed, not textual. The classes are divergent retype, add-vs-add, rename-vs-rename,
divergent index definition, drop-vs-modify, and dependency conflict. Overlap, where both branches
make the identical change, is not a conflict: it applies once and the merge proceeds.

The vocabulary comes from PlanetScale, which names clear conflicts, subtle conflicts, and
overlaps. The first five of mine are clear conflicts. Dependency conflict is the subtle one.

The merge returns a typed report rather than an interactive prompt. Atlas's experience is the
argument: a prompt is a contract with a human, and it fails silently and destructively the
moment a CI job or an agent is on the other end.

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
plan kept it only as a unit test invariant. I moved it into the engine because the six conflict
classes are rule-based, and a rule-based detector is only ever as complete as the list of rules
I thought of. The commutativity check does not depend on that list. It catches the case I failed
to enumerate, and it turns a silent wrong merge into a visible refusal.

It costs almost nothing, because the apply function and document equality both already exist for
other reasons. A merge tool that silently produces a wrong schema is worse than one that admits
it is stuck.

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
close the ingestion gap, and because two things make it cheaper than it looks. It is the dry-run
harness run in reverse, executing statements against an ephemeral branch and introspecting the
result, so it needs no SQL parser. And a rename typed as `ALTER TABLE ... RENAME COLUMN` carries
its own intent, so the console keeps the identity signal that a raw state comparison loses.

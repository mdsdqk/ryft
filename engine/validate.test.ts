/**
 * validateOperation — the `docs/robustness.md` §2 rule table as cases.
 *
 * One `it` per (operation, outcome) the table names: every `OpError` reason is
 * provoked at least once, every `OpWarning` reason once, and the "allowed
 * silently" rows are checked to return `[]`. Runs against a clone of the seed
 * schema (`examples/seed.schema.ts`).
 */

import { describe, expect, it } from "vitest";
import { isOpError, validateOperation, type OpDiagnostic } from "./validate.js";
import { seedIds, seedSchema } from "../examples/seed.schema.js";
import type { SchemaDocument } from "./schema.js";
import type { Operation } from "./operations.js";

const doc = (): SchemaDocument => structuredClone(seedSchema);
const errors = (ds: OpDiagnostic[]) => ds.filter(isOpError).map((e) => e.reason);
const warnings = (ds: OpDiagnostic[]) => ds.filter((d) => !isOpError(d)).map((d) => d.reason);
const run = (op: Operation) => validateOperation(doc(), op);

const U = seedIds.users;
const P = seedIds.posts;
const C = seedIds.comments;
const T = seedIds.tags;

describe("tables", () => {
  it("createTable — clean add is silent", () => {
    expect(
      run({
        type: "createTable",
        table: {
          id: "tbl_new_0001",
          name: "attachments",
          columns: [{ id: "col_new_id_0001", name: "id", type: { kind: "uuid" }, nullable: false, default: null }],
          primaryKey: null,
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      }),
    ).toEqual([]);
  });

  it("createTable — name already taken blocks", () => {
    expect(
      errors(
        run({
          type: "createTable",
          table: { id: "tbl_x", name: "users", columns: [], primaryKey: null, foreignKeys: [], uniques: [], indexes: [] },
        }),
      ),
    ).toContain("name-taken");
  });

  it("createTable — bad identifier and bad type both block", () => {
    const ds = run({
      type: "createTable",
      table: {
        id: "tbl_x",
        name: "Bad Name",
        columns: [{ id: "c1", name: "ok", type: { kind: "varchar", n: 0 }, nullable: false, default: null }],
        primaryKey: null,
        foreignKeys: [],
        uniques: [],
        indexes: [],
      },
    });
    expect(errors(ds)).toEqual(expect.arrayContaining(["invalid-identifier", "invalid-type"]));
  });

  it("createTable — nullable primary-key member blocks", () => {
    expect(
      errors(
        run({
          type: "createTable",
          table: {
            id: "tbl_x",
            name: "x",
            columns: [{ id: "c1", name: "id", type: { kind: "uuid" }, nullable: true, default: null }],
            primaryKey: { id: "pk_x", name: "x_pkey", columnIds: ["c1"] },
            foreignKeys: [],
            uniques: [],
            indexes: [],
          },
        }),
      ),
    ).toContain("nullable-primary-key-member");
  });

  it("dropTable — referenced by a foreign key blocks with dependents, and warns", () => {
    const ds = run({ type: "dropTable", table: { ...doc().tables.find((t) => t.id === U.table)! } });
    const blocked = ds.find((d) => isOpError(d) && d.reason === "drop-blocked");
    expect(blocked).toBeDefined();
    expect((blocked as { dependents: unknown[] }).dependents.length).toBeGreaterThan(0);
    expect(warnings(ds)).toContain("drop-destructive");
  });

  it("dropTable — leaf table is allowed but still warns", () => {
    const ds = run({ type: "dropTable", table: { ...doc().tables.find((t) => t.id === seedIds.postTags.table)! } });
    expect(errors(ds)).toEqual([]);
    expect(warnings(ds)).toEqual(["drop-destructive"]);
  });

  it("renameTable — missing target blocks", () => {
    expect(errors(run({ type: "renameTable", tableId: "tbl_missing", from: "x", to: "y" }))).toEqual(["target-not-found"]);
  });

  it("renameTable — new name collides blocks", () => {
    expect(errors(run({ type: "renameTable", tableId: U.table, from: "users", to: "posts" }))).toContain("name-taken");
  });
});

describe("columns", () => {
  it("addColumn — NOT NULL with no default warns, does not block", () => {
    const ds = run({
      type: "addColumn",
      tableId: U.table,
      column: { id: "col_new", name: "nickname", type: { kind: "text" }, nullable: false, default: null },
    });
    expect(errors(ds)).toEqual([]);
    expect(warnings(ds)).toEqual(["not-null-no-default"]);
  });

  it("addColumn — unsafe default blocks", () => {
    expect(
      errors(
        run({
          type: "addColumn",
          tableId: U.table,
          column: { id: "col_new", name: "x", type: { kind: "text" }, nullable: true, default: "concat('a','b')" },
        }),
      ),
    ).toEqual(["unsafe-default"]);
  });

  it("addColumn — allowlisted forms are silent", () => {
    for (const d of ["0", "-1", "3.14", "true", "false", "null", "'pending'", "'O''Brien'", "now()", "gen_random_uuid()"]) {
      const ds = run({
        type: "addColumn",
        tableId: U.table,
        column: { id: "col_new", name: "x", type: { kind: "text" }, nullable: true, default: d },
      });
      expect(errors(ds), `default ${d}`).toEqual([]);
    }
  });

  it("dropColumn — plain column is allowed and warns", () => {
    const ds = run({
      type: "dropColumn",
      tableId: P.table,
      column: { ...doc().tables.find((t) => t.id === P.table)!.columns.find((c) => c.id === P.metadata)! },
    });
    expect(errors(ds)).toEqual([]);
    expect(warnings(ds)).toEqual(["drop-destructive"]);
  });

  it("dropColumn — column under a unique / index / FK blocks with dependents", () => {
    const ds = run({
      type: "dropColumn",
      tableId: U.table,
      column: { ...doc().tables.find((t) => t.id === U.table)!.columns.find((c) => c.id === U.email)! },
    });
    const blocked = ds.find((d) => isOpError(d) && d.reason === "drop-blocked") as { dependents: { kind: string }[] };
    expect(blocked).toBeDefined();
    expect(blocked.dependents.map((x) => x.kind)).toContain("unique");
  });

  it("renameColumn — collision on the table blocks", () => {
    expect(
      errors(run({ type: "renameColumn", tableId: U.table, columnId: U.email, from: "email", to: "display_name" })),
    ).toContain("name-taken");
  });

  it("retypeColumn — cross-kind and shrinking retypes warn", () => {
    expect(warnings(run({ type: "retypeColumn", tableId: C.table, columnId: C.flags, from: { kind: "int" }, to: { kind: "text" } }))).toEqual([
      "narrowing-retype",
    ]);
    expect(
      warnings(
        run({ type: "retypeColumn", tableId: T.table, columnId: T.name, from: { kind: "varchar", n: 50 }, to: { kind: "varchar", n: 20 } }),
      ),
    ).toEqual(["narrowing-retype"]);
  });

  it("retypeColumn — widening a parameter is silent", () => {
    expect(
      run({ type: "retypeColumn", tableId: T.table, columnId: T.name, from: { kind: "varchar", n: 50 }, to: { kind: "varchar", n: 200 } }),
    ).toEqual([]);
  });

  it("setNullable(true) on a primary-key member blocks", () => {
    expect(errors(run({ type: "setNullable", tableId: U.table, columnId: U.id, from: false, to: true }))).toEqual([
      "nullable-primary-key-member",
    ]);
  });

  it("setNullable(false) with no default warns", () => {
    expect(warnings(run({ type: "setNullable", tableId: P.table, columnId: P.body, from: true, to: false }))).toEqual([
      "not-null-no-default",
    ]);
  });
});

describe("primary keys / indexes / uniques", () => {
  it("addPrimaryKey on a table that already has one blocks", () => {
    expect(
      errors(run({ type: "addPrimaryKey", tableId: U.table, primaryKey: { id: "pk_x", name: "x_pkey", columnIds: [U.id] } })),
    ).toContain("primary-key-exists");
  });

  it("addIndex — unresolved member blocks", () => {
    expect(
      errors(
        run({ type: "addIndex", tableId: U.table, index: { id: "idx_x", name: "users_x_idx", columnIds: ["col_ghost"], unique: false } }),
      ),
    ).toEqual(["unresolved-reference"]);
  });

  it("addIndex — duplicate index name (schema-scoped) blocks", () => {
    expect(
      errors(
        run({
          type: "addIndex",
          tableId: U.table,
          index: { id: "idx_x", name: "posts_author_id_idx", columnIds: [U.email], unique: false },
        }),
      ),
    ).toContain("name-taken");
  });

  it("addIndex — clean is silent", () => {
    expect(
      run({ type: "addIndex", tableId: P.table, index: { id: "idx_x", name: "posts_published_idx", columnIds: [P.published], unique: false } }),
    ).toEqual([]);
  });

  it("dropIndex — missing target blocks", () => {
    expect(
      errors(run({ type: "dropIndex", tableId: P.table, index: { id: "idx_ghost", name: "g", columnIds: [], unique: false } })),
    ).toEqual(["target-not-found"]);
  });
});

describe("foreign keys", () => {
  it("addForeignKey — type mismatch on endpoints blocks with fk-shape", () => {
    expect(
      errors(
        run({
          type: "addForeignKey",
          tableId: C.table,
          fk: {
            id: "fk_x",
            name: "comments_body_fkey",
            columnIds: [C.body], // text
            refTableId: U.table,
            refColumnIds: [U.id], // uuid
            onDelete: "cascade",
          },
        }),
      ),
    ).toContain("fk-shape");
  });

  it("addForeignKey — referenced columns not a key blocks with fk-shape", () => {
    expect(
      errors(
        run({
          type: "addForeignKey",
          tableId: C.table,
          fk: {
            id: "fk_x",
            name: "comments_body2_fkey",
            columnIds: [C.body],
            refTableId: U.table,
            refColumnIds: [U.displayName], // not a PK/unique
            onDelete: "cascade",
          },
        }),
      ),
    ).toContain("fk-shape");
  });

  it("changeForeignKey — loosening ON DELETE toward cascade warns", () => {
    const fk = doc().tables.find((t) => t.id === C.table)!.foreignKeys.find((f) => f.id === C.authorFk)!;
    expect(
      warnings(
        run({
          type: "changeForeignKey",
          tableId: C.table,
          fkId: C.authorFk,
          from: { ...fk },
          to: { ...fk, onDelete: "cascade" },
        }),
      ),
    ).toEqual(["fk-action-loosened"]);
  });
});

describe("synthetic object ids (WU-E — client-minted ids on add/create)", () => {
  it("addColumn — a malformed id blocks with invalid-identifier", () => {
    expect(
      errors(
        run({
          type: "addColumn",
          tableId: U.table,
          column: { id: "not a valid id", name: "nickname", type: { kind: "text" }, nullable: true, default: null },
        }),
      ),
    ).toContain("invalid-identifier");
  });

  it("addColumn — reusing an existing object id blocks with name-taken", () => {
    expect(
      errors(
        run({
          type: "addColumn",
          tableId: U.table,
          column: { id: U.email, name: "nickname", type: { kind: "text" }, nullable: true, default: null },
        }),
      ),
    ).toContain("name-taken");
  });

  it("addIndex — reusing an existing object id blocks (previously unchecked)", () => {
    expect(
      errors(
        run({
          type: "addIndex",
          tableId: U.table,
          index: { id: U.pk, name: "users_extra_idx", columnIds: [U.email], unique: false },
        }),
      ),
    ).toContain("name-taken");
  });

  it("createTable — a malformed table id blocks", () => {
    expect(
      errors(
        run({
          type: "createTable",
          table: { id: "Bad_TableID", name: "attachments", columns: [], primaryKey: null, foreignKeys: [], uniques: [], indexes: [] },
        }),
      ),
    ).toContain("invalid-identifier");
  });

  it("addIndex — a well-formed fresh id is still silent", () => {
    expect(
      run({
        type: "addIndex",
        tableId: P.table,
        index: { id: "idx_posts_published_ab12cd34", name: "posts_published_idx", columnIds: [P.published], unique: false },
      }),
    ).toEqual([]);
  });
});

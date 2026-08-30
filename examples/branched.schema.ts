/**
 * Worked example 2 — branch `contact-fields`, cut from the seed.
 *
 * This is the seed with the three operations in `branched.log.ts` applied:
 *
 *   1. rename users.email  ->  email_address   (same column id)
 *   2. add   users.phone   varchar(30), nullable
 *   3. add   a unique index on users(email_address), holding the renamed
 *      column's ORIGINAL id
 *
 * Ticket 0002 loads this as `ours` in a rename-vs-dependent merge. The point it
 * demonstrates: the index added in step 3 holds `col_users_email_9f31`, the id
 * the column had before the rename and still has after it. Nothing needs
 * rebasing. The DDL renderer resolves that id to the current name
 * `email_address` when it emits `CREATE UNIQUE INDEX`.
 */

import type { SchemaDocument, Table } from "../engine/schema.js";
import { seedSchema, seedIds } from "./seed.schema.js";

/** New object ids introduced on this branch. Shared with `branched.log.ts`. */
export const branchIds = {
  phoneColumn: "col_users_phone_9f31",
  emailAddressUniqueIndex: "idx_users_email_address_9f31",
} as const;

function applyContactFields(usersTable: Table): Table {
  return {
    ...usersTable,
    columns: [
      // 1. renameColumn: email -> email_address. Id unchanged.
      ...usersTable.columns.map((column) =>
        column.id === seedIds.users.email
          ? { ...column, name: "email_address" }
          : column,
      ),
      // 2. addColumn: phone.
      {
        id: branchIds.phoneColumn,
        name: "phone",
        type: { kind: "varchar", n: 30 },
        nullable: true,
        default: null,
      },
    ],
    // 3. addIndex: unique on the renamed column, referenced by its original id.
    indexes: [
      ...usersTable.indexes,
      {
        id: branchIds.emailAddressUniqueIndex,
        name: "users_email_address_key",
        columnIds: [seedIds.users.email],
        unique: true,
      },
    ],
  };
}

export const branchedSchema: SchemaDocument = structuredClone({
  ...seedSchema,
  tables: seedSchema.tables.map((table) =>
    table.id === seedIds.users.table ? applyContactFields(table) : table,
  ),
});

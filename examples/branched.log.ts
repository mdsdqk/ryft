/**
 * Worked example operation log — branch `contact-fields`.
 *
 * The edits made on the branch, in order. Replaying these on the seed produces
 * `branched.schema.ts`. The merge engine never reads this log; it exists for
 * undo and for the "what changed on this branch" view. See ADR 0001 §2.
 */

import type { LogEntry } from "../src/domain/operations.js";
import { seedIds } from "./seed.schema.js";
import { branchIds } from "./branched.schema.js";

/**
 * Grace's seeded user id. Fixed UUID, shared with `examples/seed.workspace.ts`
 * (the first-run workspace, ticket 0005), which imports it as the `id` of the
 * seeded `grace` user so this log's `authorId` resolves to a real seeded person.
 */
export const GRACE = "3f2a9c14-0b7e-4d51-9a6c-8e2d1f4b7a90";

export const branchedLog: LogEntry[] = [
  {
    seq: 1,
    at: "2026-02-10T09:14:22.000Z",
    authorId: GRACE,
    op: {
      type: "renameColumn",
      tableId: seedIds.users.table,
      columnId: seedIds.users.email,
      from: "email",
      to: "email_address",
    },
  },
  {
    seq: 2,
    at: "2026-02-10T09:15:03.000Z",
    authorId: GRACE,
    op: {
      type: "addColumn",
      tableId: seedIds.users.table,
      column: {
        id: branchIds.phoneColumn,
        name: "phone",
        type: { kind: "varchar", n: 30 },
        nullable: true,
        default: null,
      },
    },
  },
  {
    seq: 3,
    at: "2026-02-10T09:16:41.000Z",
    authorId: GRACE,
    op: {
      type: "addIndex",
      tableId: seedIds.users.table,
      index: {
        id: branchIds.emailAddressUniqueIndex,
        name: "users_email_address_key",
        // The email column, referenced by the id it kept across the rename in
        // seq 1. Resolves to the name `email_address` at DDL-render time.
        columnIds: [seedIds.users.email],
        unique: true,
      },
    },
  },
];

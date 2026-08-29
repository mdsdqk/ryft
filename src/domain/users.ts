/**
 * Users and organisations.
 *
 * App-domain primitives, deliberately modelled even though V0/V1 is single-user
 * with no auth: the target customer is a team, branches and merge requests are
 * authored by different people, and retrofitting an author column later is a
 * migration. See ADR 0001 (§ username-only identity).
 *
 * Scope split:
 *  - These TYPES live here.
 *  - The `users` / `organizations` tables, the create-or-resume-by-username
 *    endpoint, and the "acting as" wiring are owned by ticket 0004.
 *  - Seeding one organisation and three users is owned by ticket 0005.
 *  - `engine/` never imports this module — it has no concept of a user.
 *
 * Identity model: the landing screen takes a username. Unknown username creates
 * a new user in the single organisation; known username resumes as that user.
 * No password, no claim, no lock — impersonation is a documented non-goal, not a
 * bug. `id` is an opaque UUID (`crypto.randomUUID()`), not the prefixed scheme
 * used for schema objects: users are referenced sparsely and land in a real
 * table where a uuid primary key is conventional.
 */

export type Organization = {
  /** Opaque UUID. */
  id: string;
  name: string;
  /** ISO 8601. */
  createdAt: string;
};

export type User = {
  /** Opaque UUID. This is what `LogEntry.authorId` and MR/branch author columns reference. */
  id: string;
  /** Referenced organisation by id. One organisation exists in V0/V1. */
  organizationId: string;
  /** Unique within the organisation. The login-screen entry. */
  username: string;
  /** Defaults to `username`; editable later. */
  displayName: string;
  /** ISO 8601. */
  createdAt: string;
};

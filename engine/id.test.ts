/**
 * freshId — format and uniqueness. Ticket 0008 / WU-E (id minting for the
 * structured editor).
 */

import { describe, expect, it } from "vitest";
import { freshId } from "./id.js";

describe("freshId", () => {
  it("prefixes with the kind and ends in an 8-hex suffix", () => {
    expect(freshId("col")).toMatch(/^col_[0-9a-f]{8}$/);
    expect(freshId("tbl")).toMatch(/^tbl_[0-9a-f]{8}$/);
  });

  it("folds a context hint into the middle segment", () => {
    expect(freshId("idx", "users_email_address")).toMatch(
      /^idx_users_email_address_[0-9a-f]{8}$/,
    );
  });

  it("sanitises a messy context to [a-z0-9_]", () => {
    expect(freshId("uq", "Users.Email Address!")).toMatch(
      /^uq_users_email_address_[0-9a-f]{8}$/,
    );
  });

  it("does not collide across a large batch", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(freshId("col", "users_email"));
    expect(seen.size).toBe(5000);
  });
});

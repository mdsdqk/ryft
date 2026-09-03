-- A merge now archives and drops its source branch (ADR 0013 §6), so a merged or
-- closed `merge_requests` row must be able to outlive the branch it names. Drop
-- the `source_branch` → `branches.name` foreign key; the column stays NOT NULL as
-- the historical record of where the request came from.
ALTER TABLE "merge_requests" DROP CONSTRAINT IF EXISTS "merge_requests_source_branch_branches_name_fk";

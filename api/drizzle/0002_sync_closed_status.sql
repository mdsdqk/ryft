-- Reconciliation migration. The `closed` enum value (ADR 0012 §3) and
-- `merge_requests.closed_at` were edited directly into `0000_warm_grandmaster.sql`
-- in commit 3b6953a instead of being generated as their own step. Any database
-- that applied `0000` before that edit — the deployed Neon instance — never got
-- them, and `drizzle-kit migrate` skips `0000` there because it is already
-- recorded as applied. This step carries those two changes, guarded so it is a
-- no-op on a database created from the post-edit `0000`.
ALTER TYPE "public"."merge_request_status" ADD VALUE IF NOT EXISTS 'closed';--> statement-breakpoint
ALTER TABLE "merge_requests" ADD COLUMN IF NOT EXISTS "closed_at" timestamp with time zone;

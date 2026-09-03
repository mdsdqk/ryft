-- The GitHub-style public identifier for a merge request (ADR 0004): a gapless
-- per-workspace counter that replaces the uuid in every route param and URL.
-- Added nullable, backfilled in `created_at` order (the same order the queue and
-- the revision history already use), then locked NOT NULL + unique. New rows get
-- their number from `MAX(number) + 1` in the create transaction.
ALTER TABLE "merge_requests" ADD COLUMN "number" integer;--> statement-breakpoint
WITH ordered AS (
  SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS n
  FROM "merge_requests"
)
UPDATE "merge_requests" m SET "number" = ordered.n
FROM ordered WHERE ordered."id" = m."id";--> statement-breakpoint
ALTER TABLE "merge_requests" ALTER COLUMN "number" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "merge_requests_number_uq" ON "merge_requests" USING btree ("number");

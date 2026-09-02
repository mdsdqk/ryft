CREATE TABLE "deleted_branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"head" jsonb NOT NULL,
	"base_snapshot" jsonb NOT NULL,
	"head_version" integer NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_by_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deleted_branches" ADD CONSTRAINT "deleted_branches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deleted_branches" ADD CONSTRAINT "deleted_branches_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deleted_branches" ADD CONSTRAINT "deleted_branches_deleted_by_id_users_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
CREATE TYPE "public"."merge_request_status" AS ENUM('queued', 'open', 'held', 'merged', 'closed');--> statement-breakpoint
CREATE TABLE "branches" (
	"name" text PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"head" jsonb NOT NULL,
	"base_snapshot" jsonb NOT NULL,
	"head_version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merge_request_resolutions" (
	"mr_id" uuid NOT NULL,
	"conflict_id" text NOT NULL,
	"choice" text NOT NULL,
	"payload" jsonb,
	"conflict_snapshot" jsonb NOT NULL,
	"saved_by" uuid NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merge_request_resolutions_mr_id_conflict_id_pk" PRIMARY KEY("mr_id","conflict_id")
);
--> statement-breakpoint
CREATE TABLE "merge_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_branch" text NOT NULL,
	"target_branch" text NOT NULL,
	"author_id" uuid NOT NULL,
	"status" "merge_request_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"merged_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"base" jsonb NOT NULL,
	"ours" jsonb NOT NULL,
	"theirs" jsonb NOT NULL,
	"previewed_main_version" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"branch_name" text NOT NULL,
	"seq" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"author_id" uuid NOT NULL,
	"op" jsonb NOT NULL,
	CONSTRAINT "operations_branch_name_seq_pk" PRIMARY KEY("branch_name","seq")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_request_resolutions" ADD CONSTRAINT "merge_request_resolutions_mr_id_merge_requests_id_fk" FOREIGN KEY ("mr_id") REFERENCES "public"."merge_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_request_resolutions" ADD CONSTRAINT "merge_request_resolutions_saved_by_users_id_fk" FOREIGN KEY ("saved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_requests" ADD CONSTRAINT "merge_requests_source_branch_branches_name_fk" FOREIGN KEY ("source_branch") REFERENCES "public"."branches"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_requests" ADD CONSTRAINT "merge_requests_target_branch_branches_name_fk" FOREIGN KEY ("target_branch") REFERENCES "public"."branches"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_requests" ADD CONSTRAINT "merge_requests_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_branch_name_branches_name_fk" FOREIGN KEY ("branch_name") REFERENCES "public"."branches"("name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_org_username_uq" ON "users" USING btree ("organization_id","username");
CREATE TABLE "directory_claims" (
	"user_id" text NOT NULL,
	"recruiter_id" uuid NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "directory_claims_user_id_recruiter_id_pk" PRIMARY KEY("user_id","recruiter_id")
);
--> statement-breakpoint
CREATE TABLE "directory_recruiters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"company" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"field" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"batch" text NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"taken_count" integer DEFAULT 0 NOT NULL,
	"suppressed" boolean DEFAULT false NOT NULL,
	"suppressed_reason" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "directory_recruiters_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "directory_claims" ADD CONSTRAINT "directory_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_claims" ADD CONSTRAINT "directory_claims_recruiter_id_directory_recruiters_id_fk" FOREIGN KEY ("recruiter_id") REFERENCES "public"."directory_recruiters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "directory_claims_user_id_taken_at_idx" ON "directory_claims" USING btree ("user_id","taken_at");--> statement-breakpoint
CREATE INDEX "directory_recruiters_batch_idx" ON "directory_recruiters" USING btree ("batch");--> statement-breakpoint
CREATE INDEX "directory_recruiters_open_idx" ON "directory_recruiters" USING btree ("suppressed","taken_count");
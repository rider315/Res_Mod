CREATE TABLE "captured_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'other' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"company" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'saved' NOT NULL,
	"score" integer,
	"tailoring_id" uuid,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extension_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"label" text DEFAULT 'Browser extension' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "extension_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "captured_jobs" ADD CONSTRAINT "captured_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captured_jobs" ADD CONSTRAINT "captured_jobs_tailoring_id_tailorings_id_fk" FOREIGN KEY ("tailoring_id") REFERENCES "public"."tailorings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extension_tokens" ADD CONSTRAINT "extension_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "captured_jobs_user_idx" ON "captured_jobs" USING btree ("user_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "captured_jobs_user_url_idx" ON "captured_jobs" USING btree ("user_id","url");--> statement-breakpoint
CREATE INDEX "extension_tokens_user_idx" ON "extension_tokens" USING btree ("user_id");
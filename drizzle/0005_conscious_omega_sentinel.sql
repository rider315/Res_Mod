CREATE TABLE "mail_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"address" text NOT NULL,
	"password" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"recruiter_id" uuid NOT NULL,
	"thread_id" uuid,
	"resume_id" uuid,
	"tailoring_id" uuid,
	"job_title" text DEFAULT '' NOT NULL,
	"job_description" text DEFAULT '' NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"attach_resume" boolean DEFAULT true NOT NULL,
	"tracking_token" text,
	"open_count" integer DEFAULT 0 NOT NULL,
	"message_id" text,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outreach_emails_tracking_token_unique" UNIQUE("tracking_token")
);
--> statement-breakpoint
CREATE TABLE "outreach_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"sender_name" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"availability" text DEFAULT '' NOT NULL,
	"highlights" text DEFAULT '' NOT NULL,
	"track_opens" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"email_id" uuid NOT NULL,
	"body" text NOT NULL,
	"intent" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"suggested_reply" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recruiters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"company" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_accounts" ADD CONSTRAINT "mail_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_emails" ADD CONSTRAINT "outreach_emails_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_emails" ADD CONSTRAINT "outreach_emails_recruiter_id_recruiters_id_fk" FOREIGN KEY ("recruiter_id") REFERENCES "public"."recruiters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_emails" ADD CONSTRAINT "outreach_emails_thread_id_outreach_emails_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."outreach_emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_emails" ADD CONSTRAINT "outreach_emails_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_emails" ADD CONSTRAINT "outreach_emails_tailoring_id_tailorings_id_fk" FOREIGN KEY ("tailoring_id") REFERENCES "public"."tailorings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_profiles" ADD CONSTRAINT "outreach_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_replies" ADD CONSTRAINT "outreach_replies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_replies" ADD CONSTRAINT "outreach_replies_email_id_outreach_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."outreach_emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruiters" ADD CONSTRAINT "recruiters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outreach_emails_user_id_updated_at_idx" ON "outreach_emails" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "outreach_emails_recruiter_id_idx" ON "outreach_emails" USING btree ("recruiter_id");--> statement-breakpoint
CREATE INDEX "outreach_emails_thread_id_idx" ON "outreach_emails" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "outreach_emails_tailoring_id_idx" ON "outreach_emails" USING btree ("tailoring_id");--> statement-breakpoint
CREATE INDEX "outreach_replies_email_id_idx" ON "outreach_replies" USING btree ("email_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recruiters_user_id_email_key" ON "recruiters" USING btree ("user_id","email");
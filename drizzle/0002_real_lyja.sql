CREATE TABLE "tailorings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"resume_id" uuid,
	"resume_title" text NOT NULL,
	"job_title" text DEFAULT '' NOT NULL,
	"company" text DEFAULT '' NOT NULL,
	"level" text NOT NULL,
	"job_description" text DEFAULT '' NOT NULL,
	"changes" jsonb NOT NULL,
	"applied_count" integer NOT NULL,
	"coverage" jsonb,
	"latex" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tailorings" ADD CONSTRAINT "tailorings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tailorings" ADD CONSTRAINT "tailorings_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tailorings_user_id_created_at_idx" ON "tailorings" USING btree ("user_id","created_at");
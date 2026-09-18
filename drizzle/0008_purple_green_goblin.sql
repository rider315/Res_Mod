ALTER TABLE "outreach_emails" ADD COLUMN "cover_letter" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_emails" ADD COLUMN "attach_cover_letter" boolean DEFAULT false NOT NULL;
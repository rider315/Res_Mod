CREATE TABLE "company_research" (
	"domain" text PRIMARY KEY NOT NULL,
	"site" text NOT NULL,
	"company" text DEFAULT '' NOT NULL,
	"facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL
);

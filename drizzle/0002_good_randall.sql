CREATE TABLE "app_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "foods" ADD COLUMN "name_en" text;--> statement-breakpoint
ALTER TABLE "foods" ADD COLUMN "search_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "foods_search_trgm_idx" ON "foods" USING gin ("search_text" gin_trgm_ops);
ALTER TYPE "public"."strategy_type" ADD VALUE 'kronos_rotation';--> statement-breakpoint
CREATE TABLE "kronos_forecasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"ticker" text NOT NULL,
	"predicted_return_pct" numeric(8, 4) NOT NULL,
	"forecast_date" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "kronos_forecasts_pipeline_ticker_date_uniq" UNIQUE("pipeline_id","ticker","forecast_date")
);
--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD COLUMN "input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD COLUMN "output_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD COLUMN "cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "pipelines" ADD COLUMN "kronos_ticker_universe" json DEFAULT '[]'::json;--> statement-breakpoint
ALTER TABLE "pipelines" ADD COLUMN "kronos_rebalance_pct" numeric(5, 2) DEFAULT '50.00';--> statement-breakpoint
ALTER TABLE "pipelines" ADD COLUMN "kronos_min_signal_pct" numeric(5, 2) DEFAULT '1.00';--> statement-breakpoint
ALTER TABLE "strategy_templates" ADD COLUMN "kronos_ticker_universe" json DEFAULT '[]'::json;--> statement-breakpoint
ALTER TABLE "strategy_templates" ADD COLUMN "kronos_rebalance_pct" numeric(5, 2) DEFAULT '50.00';--> statement-breakpoint
ALTER TABLE "strategy_templates" ADD COLUMN "kronos_min_signal_pct" numeric(5, 2) DEFAULT '1.00';--> statement-breakpoint
ALTER TABLE "kronos_forecasts" ADD CONSTRAINT "kronos_forecasts_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kronos_forecasts_pipeline_date_idx" ON "kronos_forecasts" USING btree ("pipeline_id","forecast_date");
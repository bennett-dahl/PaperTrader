ALTER TABLE "pipeline_runs" ADD COLUMN "forecasts_loaded_at" timestamp;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD COLUMN "forecast_to_run_gap_ms" integer;

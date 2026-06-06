ALTER TABLE "pipeline_runs"
  ADD COLUMN "input_tokens" integer NOT NULL DEFAULT 0,
  ADD COLUMN "output_tokens" integer NOT NULL DEFAULT 0,
  ADD COLUMN "cost_usd" numeric(10, 6) NOT NULL DEFAULT 0;

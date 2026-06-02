CREATE TYPE "public"."decision_action" AS ENUM('BUY', 'SELL', 'HOLD', 'SKIP');--> statement-breakpoint
CREATE TYPE "public"."pipeline_status" AS ENUM('active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('pending', 'running', 'completed', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."strategy_type" AS ENUM('thesis_driven', 'signal_driven');--> statement-breakpoint
CREATE TABLE "decision_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"portfolio_id" uuid,
	"ticker" text NOT NULL,
	"action" "decision_action" NOT NULL,
	"confidence" numeric(4, 2),
	"shares" numeric(15, 6),
	"price_at_decision" numeric(15, 4),
	"reasoning" text NOT NULL,
	"signal_summary" text,
	"executed" boolean DEFAULT false NOT NULL,
	"execution_error" text,
	"decided_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "earnings_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" text NOT NULL,
	"report_date" text NOT NULL,
	"report_time" text,
	"eps_actual" numeric(10, 4),
	"eps_estimate" numeric(10, 4),
	"eps_beat" boolean,
	"eps_surprise_pct" numeric(8, 4),
	"analyst_revision_direction" text,
	"revenue_actual" numeric(20, 2),
	"revenue_estimate" numeric(20, 2),
	"revenue_beat" boolean,
	"raw_data" text,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "earnings_signals_ticker_report_date_unique" UNIQUE("ticker","report_date")
);
--> statement-breakpoint
CREATE TABLE "pipeline_portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"allocation_pct" numeric(5, 2) DEFAULT '100.00' NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_portfolios_pipeline_id_portfolio_id_unique" UNIQUE("pipeline_id","portfolio_id")
);
--> statement-breakpoint
CREATE TABLE "pipeline_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"status" "run_status" DEFAULT 'pending' NOT NULL,
	"triggered_by" text DEFAULT 'cron' NOT NULL,
	"tickers_evaluated" integer DEFAULT 0 NOT NULL,
	"trades_executed" integer DEFAULT 0 NOT NULL,
	"trades_skipped" integer DEFAULT 0 NOT NULL,
	"trades_failed" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"template_id" uuid,
	"name" text NOT NULL,
	"status" "pipeline_status" DEFAULT 'active' NOT NULL,
	"thesis" text NOT NULL,
	"strategy_type" "strategy_type" DEFAULT 'thesis_driven' NOT NULL,
	"ticker_universe" text[] DEFAULT '{}' NOT NULL,
	"max_positions" integer DEFAULT 10 NOT NULL,
	"max_position_pct" numeric(5, 2) DEFAULT '10.00' NOT NULL,
	"min_cash_reserve_pct" numeric(5, 2) DEFAULT '5.00' NOT NULL,
	"earnings_lookback_days" integer DEFAULT 3 NOT NULL,
	"earnings_forward_days" integer DEFAULT 7 NOT NULL,
	"min_confidence_threshold" numeric(4, 2) DEFAULT '0.65' NOT NULL,
	"autonomous" boolean DEFAULT true NOT NULL,
	"allow_short_sell" boolean DEFAULT false NOT NULL,
	"rebalance_on_run" boolean DEFAULT false NOT NULL,
	"hypothesis_config" text,
	"config_overrides" text[] DEFAULT '{}' NOT NULL,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategy_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"strategy_type" "strategy_type" DEFAULT 'thesis_driven' NOT NULL,
	"thesis" text NOT NULL,
	"ticker_universe" text[] DEFAULT '{}' NOT NULL,
	"max_positions" integer DEFAULT 10 NOT NULL,
	"max_position_pct" numeric(5, 2) DEFAULT '10.00' NOT NULL,
	"min_cash_reserve_pct" numeric(5, 2) DEFAULT '5.00' NOT NULL,
	"earnings_lookback_days" integer DEFAULT 3 NOT NULL,
	"earnings_forward_days" integer DEFAULT 7 NOT NULL,
	"min_confidence_threshold" numeric(4, 2) DEFAULT '0.65' NOT NULL,
	"autonomous" boolean DEFAULT true NOT NULL,
	"allow_short_sell" boolean DEFAULT false NOT NULL,
	"rebalance_on_run" boolean DEFAULT false NOT NULL,
	"hypothesis_config" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "decision_log" ADD CONSTRAINT "decision_log_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_log" ADD CONSTRAINT "decision_log_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_log" ADD CONSTRAINT "decision_log_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_portfolios" ADD CONSTRAINT "pipeline_portfolios_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_portfolios" ADD CONSTRAINT "pipeline_portfolios_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_template_id_strategy_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."strategy_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_templates" ADD CONSTRAINT "strategy_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
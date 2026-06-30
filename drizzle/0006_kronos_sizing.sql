ALTER TABLE "pipelines" DROP COLUMN IF EXISTS "kronos_rebalance_pct";--> statement-breakpoint
ALTER TABLE "strategy_templates" DROP COLUMN IF EXISTS "kronos_rebalance_pct";--> statement-breakpoint
ALTER TABLE "pipelines" ADD COLUMN "kronos_min_trade_pct" numeric(5, 2) NOT NULL DEFAULT '20.00';--> statement-breakpoint
ALTER TABLE "pipelines" ADD COLUMN "kronos_max_trade_pct" numeric(5, 2) NOT NULL DEFAULT '80.00';--> statement-breakpoint
ALTER TABLE "pipelines" ADD COLUMN "kronos_saturation_pct" numeric(5, 2) NOT NULL DEFAULT '5.00';--> statement-breakpoint
ALTER TABLE "pipelines" ADD COLUMN "kronos_sizing_curve" text NOT NULL DEFAULT 'linear';--> statement-breakpoint
ALTER TABLE "strategy_templates" ADD COLUMN "kronos_min_trade_pct" numeric(5, 2) NOT NULL DEFAULT '20.00';--> statement-breakpoint
ALTER TABLE "strategy_templates" ADD COLUMN "kronos_max_trade_pct" numeric(5, 2) NOT NULL DEFAULT '80.00';--> statement-breakpoint
ALTER TABLE "strategy_templates" ADD COLUMN "kronos_saturation_pct" numeric(5, 2) NOT NULL DEFAULT '5.00';--> statement-breakpoint
ALTER TABLE "strategy_templates" ADD COLUMN "kronos_sizing_curve" text NOT NULL DEFAULT 'linear';

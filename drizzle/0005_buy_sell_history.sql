ALTER TABLE "transactions" ADD COLUMN "pipeline_id" uuid REFERENCES "pipelines"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "cost_basis_at_sale" numeric(15, 4);

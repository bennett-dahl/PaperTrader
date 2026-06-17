export interface TransactionRow {
  id: string;
  ticker: string;
  type: "BUY" | "SELL";
  shares: string;
  pricePerShare: string;
  totalAmount: string;
  costBasisAtSale: string | null;
  executedAt: Date;
  pipelineId: string | null;
  pipelineName: string | null;
}

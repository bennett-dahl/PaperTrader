export type { TransactionRow } from "./transactions";

export interface HoldingWithPrice {
  ticker: string;
  name: string;
  shares: number;
  avgCostBasis: number;
  currentPrice?: number;
  change?: number;
  changePercent?: number;
}

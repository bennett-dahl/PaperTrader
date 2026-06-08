export const DEFAULT_PIPELINE_CONFIG = {
  strategyType: "thesis_driven" as const,
  tickerUniverse: [] as string[],
  maxPositions: 10,
  maxPositionPct: "10.00",
  minCashReservePct: "5.00",
  earningsLookbackDays: 3,
  earningsForwardDays: 7,
  minConfidenceThreshold: "0.65",
  autonomous: true,
  allowShortSell: false,
  rebalanceOnRun: false,
  hypothesisConfig: null as string | null,
  kronosTickerUniverse: [] as string[],
  kronosRebalancePct: "50.00",
  kronosMinSignalPct: "1.00",
};

export const INHERITABLE_FIELDS = [
  "thesis", "strategyType", "tickerUniverse",
  "maxPositions", "maxPositionPct", "minCashReservePct",
  "earningsLookbackDays", "earningsForwardDays",
  "minConfidenceThreshold", "autonomous", "allowShortSell",
  "rebalanceOnRun", "hypothesisConfig",
  "kronosTickerUniverse", "kronosRebalancePct", "kronosMinSignalPct",
] as const;

export type InheritableField = typeof INHERITABLE_FIELDS[number];

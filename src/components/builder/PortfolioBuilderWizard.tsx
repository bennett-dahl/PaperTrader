"use client";

import { useState, useCallback } from "react";
import { useActivePortfolio } from "@/contexts/ActivePortfolioContext";
import Step1Config from "./Step1Config";
import Step2Suggestions from "./Step2Suggestions";
import Step3Confirm from "./Step3Confirm";

export interface SuggestionItem {
  ticker: string;
  name: string;
  sector: string;
  category: string;
  riskLevel: string;
  marketCap: string;
  description: string | null;
  price: number;
  shares: number;
  allocatedAmount: number;
}

export interface BuildConfig {
  portfolioId: string;
  amount: number;
  riskLevel: "low" | "medium" | "high";
  categories: string[];
  stockCount: number;
}

interface PortfolioBuilderWizardProps {
  portfolios: {
    id: string;
    name: string;
    cashBalance: number;
    isDefault: boolean;
  }[];
}

export default function PortfolioBuilderWizard({ portfolios }: PortfolioBuilderWizardProps) {
  const { activePortfolioId, setActivePortfolioId } = useActivePortfolio();

  // Determine default portfolio
  const defaultPortfolio =
    portfolios.find((p) => p.id === activePortfolioId) ??
    portfolios.find((p) => p.isDefault) ??
    portfolios[0];

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [config, setConfig] = useState<BuildConfig>({
    portfolioId: defaultPortfolio?.id ?? "",
    amount: Math.min(1000, defaultPortfolio?.cashBalance ?? 1000),
    riskLevel: "medium",
    categories: [],
    stockCount: 5,
  });
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [executeResults, setExecuteResults] = useState<{
    results: Array<{ ticker: string; success: boolean; error?: string; totalAmount?: number }>;
    successCount: number;
    failCount: number;
  } | null>(null);

  const handleStep1Submit = useCallback(
    async (cfg: BuildConfig) => {
      setConfig(cfg);
      if (cfg.portfolioId !== activePortfolioId) {
        setActivePortfolioId(cfg.portfolioId);
      }
      setStep(2);
    },
    [activePortfolioId, setActivePortfolioId]
  );

  const handleStep2Confirm = useCallback((items: SuggestionItem[]) => {
    setSuggestions(items);
    setStep(3);
  }, []);

  const handleExecuteComplete = useCallback(
    (results: { results: Array<{ ticker: string; success: boolean; error?: string; totalAmount?: number }>; successCount: number; failCount: number }) => {
      setExecuteResults(results);
    },
    []
  );

  const handleReset = useCallback(() => {
    setStep(1);
    setSuggestions([]);
    setExecuteResults(null);
  }, []);

  return (
    <div>
      {step === 1 && (
        <Step1Config
          portfolios={portfolios}
          initialConfig={config}
          onSubmit={handleStep1Submit}
        />
      )}
      {step === 2 && (
        <Step2Suggestions
          config={config}
          onBack={() => setStep(1)}
          onConfirm={handleStep2Confirm}
        />
      )}
      {step === 3 && (
        <Step3Confirm
          config={config}
          suggestions={suggestions}
          executeResults={executeResults}
          onBack={() => setStep(2)}
          onExecute={handleExecuteComplete}
          onReset={handleReset}
        />
      )}
    </div>
  );
}

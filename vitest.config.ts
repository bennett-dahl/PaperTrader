import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],  // console output only
      include: [
        "src/lib/**/*.ts",
        "src/app/api/**/*.ts",
        "src/hooks/**/*.ts",
        "src/components/**/*.tsx",
      ],
      exclude: [
        "src/components/ui/**",            // shadcn primitives, not our logic
        "src/db/**",
        "src/app/layout.tsx",
        "src/app/page.tsx",
        "src/middleware.ts",
        // Complex UI components tested as black boxes only
        "src/components/stock-detail/**",  // StockDetailSheet is deeply stateful
        "src/components/PriceChart.tsx",   // recharts wrapper, no logic
        "src/components/BottomNav.tsx",    // pure nav, no logic
        "src/components/Sidebar.tsx",      // pure nav, no logic
        "src/components/OnboardingFlow.tsx", // complex onboarding flow
        "src/components/SessionProvider.tsx",   // auth provider wrapper
        "src/components/StockSearch.tsx",       // search UI, covered via API tests
        "src/components/CreatePortfolioButton.tsx",
        "src/components/builder/PortfolioBuilderWizard.tsx", // coordinator, tested via step tests
        "src/components/TradeSheet.tsx",   // thin wrapper over TradePanel (tested)
        "src/components/PortfolioCard.tsx", // pure display component
      ],
      thresholds: {
        lines: 60,
        functions: 55,
        branches: 50,
      },
    },
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

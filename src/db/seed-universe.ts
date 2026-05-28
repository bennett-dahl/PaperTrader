import { db } from "./index";
import { stockUniverse } from "./schema";

const stocks = [
  // ─── LOW RISK / Conservative ───────────────────────────────────────────────
  // ETFs / Broad Market
  { ticker: "SPY",  name: "SPDR S&P 500 ETF Trust",           sector: "ETF",         category: "etf",            riskLevel: "low" as const, marketCap: "large", description: "Tracks the S&P 500 index" },
  { ticker: "VTI",  name: "Vanguard Total Stock Market ETF",   sector: "ETF",         category: "etf",            riskLevel: "low" as const, marketCap: "large", description: "Broad US stock market exposure" },
  { ticker: "QQQ",  name: "Invesco QQQ Trust",                 sector: "ETF",         category: "etf",            riskLevel: "low" as const, marketCap: "large", description: "Tracks the Nasdaq-100" },
  { ticker: "IWM",  name: "iShares Russell 2000 ETF",          sector: "ETF",         category: "etf",            riskLevel: "medium" as const, marketCap: "large", description: "US small-cap exposure" },
  { ticker: "DIA",  name: "SPDR Dow Jones Industrial Average", sector: "ETF",         category: "etf",            riskLevel: "low" as const, marketCap: "large", description: "Tracks the Dow Jones 30" },
  { ticker: "AGG",  name: "iShares Core US Aggregate Bond ETF",sector: "Bond",        category: "bond",           riskLevel: "low" as const, marketCap: "large", description: "US investment-grade bonds" },
  { ticker: "BND",  name: "Vanguard Total Bond Market ETF",    sector: "Bond",        category: "bond",           riskLevel: "low" as const, marketCap: "large", description: "Broad US bond market" },
  { ticker: "TLT",  name: "iShares 20+ Year Treasury Bond ETF",sector: "Bond",       category: "bond",           riskLevel: "low" as const, marketCap: "large", description: "Long-term US Treasury bonds" },
  { ticker: "GLD",  name: "SPDR Gold Shares",                  sector: "Commodity",   category: "commodity",      riskLevel: "low" as const, marketCap: "large", description: "Physical gold exposure" },
  { ticker: "VIG",  name: "Vanguard Dividend Appreciation ETF",sector: "ETF",         category: "dividend",       riskLevel: "low" as const, marketCap: "large", description: "Dividend growth stocks" },
  // Large-cap Defensive
  { ticker: "JNJ",  name: "Johnson & Johnson",                 sector: "Healthcare",  category: "healthcare",     riskLevel: "low" as const, marketCap: "large", description: "Diversified healthcare giant" },
  { ticker: "PG",   name: "Procter & Gamble Co.",              sector: "Consumer",    category: "consumer",       riskLevel: "low" as const, marketCap: "large", description: "Consumer staples leader" },
  { ticker: "KO",   name: "Coca-Cola Co.",                     sector: "Consumer",    category: "consumer",       riskLevel: "low" as const, marketCap: "large", description: "Global beverage giant" },
  { ticker: "WMT",  name: "Walmart Inc.",                      sector: "Consumer",    category: "consumer",       riskLevel: "low" as const, marketCap: "large", description: "World's largest retailer" },
  { ticker: "VZ",   name: "Verizon Communications Inc.",       sector: "Telecom",     category: "telecom",        riskLevel: "low" as const, marketCap: "large", description: "Major US telecom carrier" },
  { ticker: "T",    name: "AT&T Inc.",                         sector: "Telecom",     category: "telecom",        riskLevel: "low" as const, marketCap: "large", description: "Large-cap US telecom" },
  { ticker: "NEE",  name: "NextEra Energy Inc.",               sector: "Utilities",   category: "utilities",      riskLevel: "low" as const, marketCap: "large", description: "Largest US utility company" },
  { ticker: "DUK",  name: "Duke Energy Corp.",                 sector: "Utilities",   category: "utilities",      riskLevel: "low" as const, marketCap: "large", description: "Regulated electric utility" },

  // ─── MEDIUM RISK / Balanced ─────────────────────────────────────────────────
  // Tech – established
  { ticker: "AAPL", name: "Apple Inc.",                        sector: "Technology",  category: "tech",           riskLevel: "medium" as const, marketCap: "large", description: "Consumer electronics & software" },
  { ticker: "MSFT", name: "Microsoft Corp.",                   sector: "Technology",  category: "tech",           riskLevel: "medium" as const, marketCap: "large", description: "Cloud & enterprise software leader" },
  { ticker: "GOOGL",name: "Alphabet Inc.",                     sector: "Technology",  category: "tech",           riskLevel: "medium" as const, marketCap: "large", description: "Search, cloud, and digital ads" },
  { ticker: "META", name: "Meta Platforms Inc.",               sector: "Technology",  category: "tech",           riskLevel: "medium" as const, marketCap: "large", description: "Social media and virtual reality" },
  { ticker: "AMZN", name: "Amazon.com Inc.",                   sector: "Technology",  category: "tech",           riskLevel: "medium" as const, marketCap: "large", description: "E-commerce and cloud computing" },
  // Finance
  { ticker: "JPM",  name: "JPMorgan Chase & Co.",              sector: "Finance",     category: "finance",        riskLevel: "medium" as const, marketCap: "large", description: "Largest US bank by assets" },
  { ticker: "BAC",  name: "Bank of America Corp.",             sector: "Finance",     category: "finance",        riskLevel: "medium" as const, marketCap: "large", description: "Major US commercial bank" },
  { ticker: "V",    name: "Visa Inc.",                         sector: "Finance",     category: "finance",        riskLevel: "medium" as const, marketCap: "large", description: "Global payments network" },
  { ticker: "MA",   name: "Mastercard Inc.",                   sector: "Finance",     category: "finance",        riskLevel: "medium" as const, marketCap: "large", description: "Global payments technology" },
  { ticker: "GS",   name: "Goldman Sachs Group Inc.",          sector: "Finance",     category: "finance",        riskLevel: "medium" as const, marketCap: "large", description: "Leading investment bank" },
  // Healthcare
  { ticker: "UNH",  name: "UnitedHealth Group Inc.",           sector: "Healthcare",  category: "healthcare",     riskLevel: "medium" as const, marketCap: "large", description: "Largest US health insurer" },
  { ticker: "ABBV", name: "AbbVie Inc.",                       sector: "Healthcare",  category: "healthcare",     riskLevel: "medium" as const, marketCap: "large", description: "Biopharmaceutical company" },
  { ticker: "LLY",  name: "Eli Lilly and Co.",                 sector: "Healthcare",  category: "healthcare",     riskLevel: "medium" as const, marketCap: "large", description: "Pharmaceutical innovation leader" },
  { ticker: "TMO",  name: "Thermo Fisher Scientific Inc.",     sector: "Healthcare",  category: "healthcare",     riskLevel: "medium" as const, marketCap: "large", description: "Life sciences equipment" },
  // Energy
  { ticker: "XOM",  name: "Exxon Mobil Corp.",                 sector: "Energy",      category: "energy",         riskLevel: "medium" as const, marketCap: "large", description: "Largest US oil company" },
  { ticker: "CVX",  name: "Chevron Corp.",                     sector: "Energy",      category: "energy",         riskLevel: "medium" as const, marketCap: "large", description: "Integrated energy company" },
  { ticker: "COP",  name: "ConocoPhillips",                    sector: "Energy",      category: "energy",         riskLevel: "medium" as const, marketCap: "large", description: "Large US E&P company" },
  // International ETFs
  { ticker: "EFA",  name: "iShares MSCI EAFE ETF",             sector: "ETF",         category: "international",  riskLevel: "medium" as const, marketCap: "large", description: "Developed market ex-US stocks" },
  { ticker: "VWO",  name: "Vanguard FTSE Emerging Markets ETF",sector: "ETF",         category: "international",  riskLevel: "medium" as const, marketCap: "large", description: "Emerging market equities" },
  // Real Estate
  { ticker: "VNQ",  name: "Vanguard Real Estate ETF",          sector: "Real Estate", category: "realestate",     riskLevel: "medium" as const, marketCap: "large", description: "US REITs exposure" },
  { ticker: "AMT",  name: "American Tower Corp.",               sector: "Real Estate", category: "realestate",     riskLevel: "medium" as const, marketCap: "large", description: "Global cell tower REIT" },

  // ─── HIGH RISK / Aggressive ──────────────────────────────────────────────────
  // High-growth tech
  { ticker: "NVDA", name: "NVIDIA Corp.",                       sector: "Technology",  category: "tech",           riskLevel: "high" as const, marketCap: "large", description: "AI chips and GPU leader" },
  { ticker: "TSLA", name: "Tesla Inc.",                         sector: "Technology",  category: "tech",           riskLevel: "high" as const, marketCap: "large", description: "Electric vehicles and energy" },
  { ticker: "CRWD", name: "CrowdStrike Holdings Inc.",          sector: "Technology",  category: "tech",           riskLevel: "high" as const, marketCap: "large", description: "Cloud-native cybersecurity" },
  { ticker: "SNOW", name: "Snowflake Inc.",                     sector: "Technology",  category: "tech",           riskLevel: "high" as const, marketCap: "large", description: "Cloud data platform" },
  { ticker: "NET",  name: "Cloudflare Inc.",                    sector: "Technology",  category: "tech",           riskLevel: "high" as const, marketCap: "mid",   description: "Network security & CDN" },
  { ticker: "DDOG", name: "Datadog Inc.",                       sector: "Technology",  category: "tech",           riskLevel: "high" as const, marketCap: "mid",   description: "Cloud monitoring platform" },
  { ticker: "PLTR", name: "Palantir Technologies Inc.",         sector: "Technology",  category: "tech",           riskLevel: "high" as const, marketCap: "large", description: "Data analytics and AI software" },
  { ticker: "RBLX", name: "Roblox Corp.",                       sector: "Technology",  category: "tech",           riskLevel: "high" as const, marketCap: "mid",   description: "Online gaming platform" },
  { ticker: "COIN", name: "Coinbase Global Inc.",               sector: "Finance",     category: "crypto",         riskLevel: "high" as const, marketCap: "mid",   description: "Cryptocurrency exchange" },
  { ticker: "MSTR", name: "MicroStrategy Inc.",                 sector: "Technology",  category: "crypto",         riskLevel: "high" as const, marketCap: "mid",   description: "Business intelligence & Bitcoin" },
  // Biotech
  { ticker: "MRNA", name: "Moderna Inc.",                       sector: "Healthcare",  category: "biotech",        riskLevel: "high" as const, marketCap: "mid",   description: "mRNA therapeutics" },
  { ticker: "BNTX", name: "BioNTech SE",                        sector: "Healthcare",  category: "biotech",        riskLevel: "high" as const, marketCap: "mid",   description: "mRNA cancer & vaccine biotech" },
  { ticker: "CELH", name: "Celsius Holdings Inc.",              sector: "Consumer",    category: "consumer",       riskLevel: "high" as const, marketCap: "mid",   description: "Energy drink growth brand" },
  // Speculative / Small-cap
  { ticker: "SMCI", name: "Super Micro Computer Inc.",          sector: "Technology",  category: "tech",           riskLevel: "high" as const, marketCap: "mid",   description: "AI server infrastructure" },
  { ticker: "ARM",  name: "Arm Holdings plc",                   sector: "Technology",  category: "tech",           riskLevel: "high" as const, marketCap: "large", description: "Chip architecture licensor" },
  { ticker: "SHOP", name: "Shopify Inc.",                       sector: "Technology",  category: "tech",           riskLevel: "high" as const, marketCap: "large", description: "E-commerce platform" },
  { ticker: "SQ",   name: "Block Inc.",                         sector: "Finance",     category: "fintech",        riskLevel: "high" as const, marketCap: "mid",   description: "Payments & crypto ecosystem" },
  { ticker: "UBER", name: "Uber Technologies Inc.",             sector: "Technology",  category: "tech",           riskLevel: "high" as const, marketCap: "large", description: "Ride-sharing and delivery" },
  { ticker: "LYFT", name: "Lyft Inc.",                          sector: "Technology",  category: "tech",           riskLevel: "high" as const, marketCap: "mid",   description: "US ride-sharing platform" },
  { ticker: "RIVN", name: "Rivian Automotive Inc.",             sector: "Automotive",  category: "ev",             riskLevel: "high" as const, marketCap: "mid",   description: "Electric truck manufacturer" },
  { ticker: "LCID", name: "Lucid Group Inc.",                   sector: "Automotive",  category: "ev",             riskLevel: "high" as const, marketCap: "small", description: "Luxury EV maker" },
  { ticker: "ARKK", name: "ARK Innovation ETF",                 sector: "ETF",         category: "etf",            riskLevel: "high" as const, marketCap: "large", description: "Disruptive innovation ETF" },
];

async function seed() {
  console.log("Seeding stock universe...");

  // Upsert all stocks
  for (const stock of stocks) {
    await db
      .insert(stockUniverse)
      .values(stock)
      .onConflictDoUpdate({
        target: stockUniverse.ticker,
        set: {
          name: stock.name,
          sector: stock.sector,
          category: stock.category,
          riskLevel: stock.riskLevel,
          marketCap: stock.marketCap,
          description: stock.description ?? null,
        },
      });
  }

  console.log(`✓ Seeded ${stocks.length} stocks`);
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});

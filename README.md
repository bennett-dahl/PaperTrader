# PaperTrader

> Practice investing with $5,000 in virtual cash and real market data. No real money, all the learning.

PaperTrader is a mobile-first web app that lets you simulate stock trading using real market prices from Finnhub. Build your strategy, test your instincts, and track your portfolio — all without risking a cent.

---

## Features

- **$5,000 starting balance** per portfolio
- **Real stock prices** via Finnhub API (refreshed every 5 minutes)
- **Buy & sell any stock** with paper money
- **Portfolio performance tracking** with charts
- **Watchlist** to monitor stocks you're considering
- **Transaction history** for every trade
- **Multiple portfolios** to test different strategies
- **Google Sign-In** — no password to manage
- **Mobile-first design** with bottom nav on mobile, sidebar on desktop

---

## Tech Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 14 (App Router) |
| Database | Vercel Postgres (Neon) via Drizzle ORM |
| Auth | Auth.js v5 with Google provider |
| Styling | Tailwind CSS + shadcn/ui |
| Market Data | Finnhub API |
| Cron Jobs | Vercel Cron (via vercel.json) |
| Charts | Recharts |

---

## Getting Started

### 1. Clone & install

```bash
git clone <your-repo>
cd PaperTrader
npm install
```

### 2. Set up environment variables

```bash
cp .env.local.example .env.local
```

Fill in `.env.local`:

| Variable | Where to get it |
|---|---|
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `AUTH_GOOGLE_ID` | [Google Cloud Console](https://console.cloud.google.com) → OAuth 2.0 |
| `AUTH_GOOGLE_SECRET` | Same as above |
| `POSTGRES_URL` | [Vercel Dashboard](https://vercel.com) → Storage → Postgres |
| `FINNHUB_API_KEY` | [finnhub.io](https://finnhub.io) — free tier is enough |
| `CRON_SECRET` | `openssl rand -hex 32` |

### 3. Set up the database

```bash
npx drizzle-kit push
```

This creates all tables in your Postgres database.

### 4. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Deploying to Vercel

1. Push to GitHub
2. Import the repo in [Vercel](https://vercel.com)
3. Add all environment variables in Vercel project settings
4. Deploy — Vercel will automatically pick up the cron jobs from `vercel.json`

> **Note:** Cron jobs require a Vercel Pro plan or the Hobby plan (1 cron per project). The quote refresh cron runs every 5 minutes and the snapshot cron every 15 minutes.

---

## Wiring Up Real Market Data

The Finnhub API calls are stubbed with `// TODO:` comments in:

- `src/app/api/quotes/route.ts` — quote cache refresh
- `src/app/api/cron/refresh-quotes/route.ts` — cron-driven batch refresh
- `src/components/StockSearch.tsx` — symbol search autocomplete

Set `FINNHUB_API_KEY` in your `.env.local` and uncomment the Finnhub code blocks to go live.

---

## Project Structure

```
src/
  app/
    (auth)/onboarding/     — New user onboarding flow
    (dashboard)/           — Protected dashboard shell
      dashboard/           — Portfolio overview
      trade/               — Stock search + buy/sell
      watchlist/           — Price tracking
      history/             — Transaction log
      portfolios/          — Manage multiple portfolios
    api/
      quotes/              — Quote fetching + cache
      trade/               — Execute paper trades
      portfolio/           — Portfolio CRUD
      watchlist/           — Watchlist management
      cron/                — Scheduled jobs
  components/
    BottomNav.tsx          — Mobile nav
    Sidebar.tsx            — Desktop nav
    PortfolioCard.tsx      — Portfolio summary card
    HoldingRow.tsx         — Individual holding display
    TradeSheet.tsx         — Buy/sell bottom drawer
    StockSearch.tsx        — Debounced stock search
    PriceChart.tsx         — Recharts portfolio chart
    OnboardingFlow.tsx     — Step-by-step onboarding
  db/
    schema.ts              — Drizzle ORM table definitions
    index.ts               — Database connection
```

---

## Not Financial Advice

PaperTrader is a learning tool. All trades use fake money. Past simulated performance does not predict real market results. Please don't use this to make actual investment decisions.

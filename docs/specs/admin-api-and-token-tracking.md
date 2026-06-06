# Spec: Admin API + Token Tracking

**Date:** 2026-06-06  
**Status:** Reviewed — ready to build  
**Scope:** Two tightly coupled features — an admin pipeline API callable by the AI assistant, and per-run token/cost tracking so Bennett can see spend across experiments.

---

## Motivation

Bennett wants the AI assistant (Claw) to be able to:
1. Research a trading strategy idea
2. Present options
3. Directly create a pipeline experiment in PaperTrader without manual UI steps

Additionally, since every pipeline run calls Claude (claude-3-5-haiku), he needs visibility into cumulative AI spend per experiment.

---

## Feature 1: Admin API

### Overview

A new route group `/api/admin/pipelines` authenticated via bearer token (`PIPELINE_SECRET`), enabling the AI assistant to create, list, and manage pipelines without a user session cookie. All operations are scoped to the owner user identified by a new `ADMIN_USER_EMAIL` env var.

### Auth Pattern

```
Authorization: Bearer <PIPELINE_SECRET>
```

Same pattern as `/api/cron/pipeline-orchestrator` with `CRON_SECRET`. Reuse `PIPELINE_SECRET` (already in Vercel). Add `ADMIN_USER_EMAIL` env var pointing to Bennett's Google account email for user scoping.

### New Env Vars

| Var | Description |
|-----|-------------|
| `ADMIN_USER_EMAIL` | Bennett's Google email — scopes all admin operations |

`PIPELINE_SECRET` already exists in Vercel.

### Endpoints

#### `GET /api/admin/pipelines`

List all pipelines for the admin user with token spend aggregates.

**Implementation note:** Use Drizzle `count` + `sum` for aggregates inside the enrichment loop. `sum()` returns `string | null` — handle null (no runs yet) as 0.

```ts
import { count, sum } from "drizzle-orm";

const [agg] = await db
  .select({
    totalRuns: count(pipelineRuns.id),
    totalInputTokens: sum(pipelineRuns.inputTokens),
    totalOutputTokens: sum(pipelineRuns.outputTokens),
    totalCostUsd: sum(pipelineRuns.costUsd),
  })
  .from(pipelineRuns)
  .where(eq(pipelineRuns.pipelineId, p.id));
```

**Response:**
```json
{
  "pipelines": [
    {
      "id": "uuid",
      "name": "Earnings Momentum",
      "status": "active",
      "strategyType": "thesis_driven",
      "thesis": "...",
      "createdAt": "ISO8601",
      "portfolioCount": 1,
      "lastRunStatus": "completed",
      "lastRunAt": "ISO8601",
      "totalRuns": 12,
      "totalInputTokens": 45000,
      "totalOutputTokens": 8200,
      "totalCostUsd": "0.0428"
    }
  ]
}
```

#### `POST /api/admin/pipelines`

Create a new pipeline. Same field contract and `resolveConfig` call as existing `/api/pipelines` POST. Use the admin user (from `ADMIN_USER_EMAIL`) as `userId` throughout — not a session user.

**Request body:**
```json
{
  "name": "string (required)",
  "thesis": "string (required)",
  "strategyType": "thesis_driven | signal_driven",
  "tickerUniverse": ["AAPL", "MSFT"],
  "maxPositions": 10,
  "maxPositionPct": 10,
  "minCashReservePct": 5,
  "earningsLookbackDays": 3,
  "earningsForwardDays": 7,
  "minConfidenceThreshold": 0.65,
  "autonomous": true,
  "allowShortSell": false,
  "rebalanceOnRun": false,
  "templateId": "uuid (optional)",
  "portfolioAssignments": [
    { "portfolioId": "uuid", "allocationPct": 100 }
  ]
}
```

**Response:** `201` with `{ pipeline }`.

#### `PATCH /api/admin/pipelines/[id]`

Update a small set of safe mutable fields only. **Do NOT call `resolveConfig`** — this is a direct update, unlike the existing session-authed PATCH which recomputes overrides. Always set `updatedAt: new Date()`.

**Allowed fields:**
```json
{
  "status": "active | paused | archived",
  "name": "string",
  "autonomous": false
}
```

**Validation:** Explicitly validate `status` against the allowed enum values (`["active", "paused", "archived"]`) before hitting the DB — don't let Postgres throw on a bad string.

**Response:** `200` with updated `{ pipeline }`.

#### `GET /api/admin/pipelines/[id]/stats`

Detailed run history + token spend for a single pipeline.

**Response:**
```json
{
  "pipeline": { "id": "...", "name": "..." },
  "summary": {
    "totalRuns": 12,
    "completedRuns": 10,
    "failedRuns": 2,
    "totalTradesExecuted": 34,
    "totalInputTokens": 45000,
    "totalOutputTokens": 8200,
    "totalCostUsd": "0.0428"
  },
  "recentRuns": [
    {
      "id": "uuid",
      "status": "completed",
      "startedAt": "ISO8601",
      "durationMs": 4200,
      "tradesExecuted": 3,
      "inputTokens": 3800,
      "outputTokens": 650,
      "costUsd": "0.0036"
    }
  ]
}
```

### File Structure

```
src/app/api/admin/
  pipelines/
    route.ts               ← GET (list) + POST (create)
    [id]/
      route.ts             ← PATCH (update)
      stats/
        route.ts           ← GET (run history + spend)
  _auth.ts                 ← shared bearer token check + user resolution
```

### Auth Helper (`_auth.ts`)

```ts
export async function requireAdminUser(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.PIPELINE_SECRET}`) return null;
  const email = process.env.ADMIN_USER_EMAIL;
  if (!email) return null;
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0] ?? null;
}
```

---

## Feature 2: Token Tracking

### Overview

Capture token usage from every `generateObject` call in `/api/pipeline/run`, persist it to `pipeline_runs`, and surface spend in the UI.

### DB Migration

Next migration number: check `drizzle/` directory for current highest — use the next sequential number.

Add columns to `pipeline_runs`:

```sql
ALTER TABLE pipeline_runs
  ADD COLUMN input_tokens  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN cost_usd      DECIMAL(10, 6) NOT NULL DEFAULT 0;
```

Drizzle schema additions:
```ts
inputTokens: integer("input_tokens").notNull().default(0),
outputTokens: integer("output_tokens").notNull().default(0),
costUsd: decimal("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
```

### Token Capture (`pipeline/run/route.ts`)

**AI SDK field names** (ai ^6.x): `usage.promptTokens` (input) and `usage.completionTokens` (output).

The run loops over `pipeline.portfolioLinks` and calls `generateObject` **once per portfolio**. Accumulate across all iterations:

```ts
// Before portfolio loop:
let totalInputTokens = 0;
let totalOutputTokens = 0;

// After each generateObject call:
const { object, usage } = await generateObject({ ... });
totalInputTokens += usage.promptTokens;
totalOutputTokens += usage.completionTokens;

// At finalize (db.update pipelineRuns):
const COST_PER_INPUT_TOKEN  = 0.80 / 1_000_000;
const COST_PER_OUTPUT_TOKEN = 4.00 / 1_000_000;
const costUsd = (totalInputTokens * COST_PER_INPUT_TOKEN) + (totalOutputTokens * COST_PER_OUTPUT_TOKEN);

await db.update(pipelineRuns).set({
  status: "completed",
  inputTokens: totalInputTokens,
  outputTokens: totalOutputTokens,
  costUsd: String(costUsd),
  // ...existing fields
}).where(eq(pipelineRuns.id, run.id));
```

### Regular GET `/api/pipelines` — also needs token enrichment

The UI pipeline list fetches from `/api/pipelines` (session-authed), not the admin endpoint. The existing enrichment loop must also add token aggregates so the cost badge has data. Add the same `count`/`sum` query described in admin GET, and extend the `PipelineListItem` type to include:

```ts
totalInputTokens: number;
totalOutputTokens: number;
totalCostUsd: string;
totalRuns: number;
```

**Import note:** Add `count, sum` to drizzle-orm imports in `pipelines/route.ts`.

### UI Changes

> **⚠️ Important:** The `/advisor` route is the portfolio builder wizard — no pipeline UI lives there. All pipeline UI changes target `/pipelines` (list) and `/pipelines/[id]` (detail).

#### `/pipelines` page — Pipeline Card

Add a subtle cost line per pipeline card. Data comes from `totalCostUsd` and `lastRunAt` in the regular GET response:

```
[Pipeline Name]          ● active
Last run: 2h ago · 3 trades · $0.004 this run
Cumulative spend: $0.043
```

Add a **Usage Summary Card** at the top of the page (above the pipeline list) showing all-time aggregated spend. Aggregate on page load from the enriched pipeline list:

```
AI Pipeline Spend — all time
$0.28  |  48 runs  |  avg $0.006 / run
```

#### `/pipelines/[id]` page — Runs Tab

The runs tab already renders `recentRuns` from the pipeline detail fetch. After migration, new fields are available. Add two columns to the runs table:

- `Tokens` — `(inputTokens + outputTokens)` formatted (e.g. `4.5k`)
- `Cost` — `$0.0036`

Add a summary row below the table: **Total spend: $X.XXXX**

---

## OpenClaw Skill

Once the admin API is deployed, create:

```
~/.openclaw/plugin-skills/papertrader/SKILL.md
```

Documents:
- Base URL: `https://papertrader-henna.vercel.app`
- Auth: `Authorization: Bearer $PIPELINE_SECRET`
- How to list, create, update, and inspect pipeline stats
- Research workflow: web_search strategy → present 2-3 options to Bennett → on approval → POST to create

---

## Tests Required

All in same commit, 100% coverage target. Follow existing Vitest + `next-test-api-route-handler` patterns.

### Admin API tests

- `_auth.ts` — valid token, invalid token, missing env var, user not found
- `GET /api/admin/pipelines` — enriched list with spend totals, null aggregates (no runs), bad auth
- `POST /api/admin/pipelines` — happy path, missing thesis, bad auth, template not found, portfolio assignment validation
- `PATCH /api/admin/pipelines/[id]` — status update, invalid status string, 404, bad auth, `updatedAt` set
- `GET /api/admin/pipelines/[id]/stats` — correct aggregation, null-safe sums, 404, bad auth

### Token tracking tests

- `pipeline/run` route — **requires QStash mock** (no existing test file for this route):
  ```ts
  vi.mock("@upstash/qstash/nextjs", () => ({
    verifySignatureAppRouter: (handler: unknown) => handler,
  }));
  vi.mock("ai", () => ({ generateObject: vi.fn() }));
  ```
  Verify: `generateObject` usage is destructured, `totalInputTokens`/`totalOutputTokens` accumulate across multiple portfolio links, `costUsd` is computed correctly and written to `pipeline_runs` on finalize.

### Regular GET `/api/pipelines` tests

- Updated enrichment returns token aggregate fields
- Null-safe handling when pipeline has no runs

### UI component tests

- Pipeline card renders cost badge with `totalCostUsd`
- Usage summary card computes correct totals from pipeline list
- Runs table renders `Tokens` and `Cost` columns, summary row shows correct total

---

## Migration Steps (for build agent)

1. Determine next migration number from `drizzle/` directory
2. Write Drizzle migration: add `input_tokens`, `output_tokens`, `cost_usd` to `pipeline_runs`; update schema.ts types
3. Apply migration to Neon via **direct (non-pooler) endpoint** (see: Neon migration lesson in MEMORY)
4. Update `pipeline/run/route.ts`: destructure `usage` from `generateObject`, accumulate per-portfolio, write to run on finalize
5. Update `GET /api/pipelines` enrichment: add token aggregate fields; extend `PipelineListItem` type; add `count`/`sum` imports
6. Build `src/app/api/admin/` routes + `_auth.ts`
7. Update `/pipelines` page: cost badge on pipeline cards, usage summary card at top
8. Update `/pipelines/[id]` page: add Tokens + Cost columns to runs table, summary row
9. Create OpenClaw skill file at `~/.openclaw/plugin-skills/papertrader/SKILL.md`
10. Write and pass all tests
11. Push to main → Vercel auto-deploys
12. Bennett adds `ADMIN_USER_EMAIL` to Vercel env vars ← **manual step**

---

## Open Questions

**Q: Usage Summary Card placement** — Spec puts it at top of `/pipelines` page. If the pipeline list is empty (no pipelines yet), the card would show all-zeros. Should it only render when there's at least one pipeline with runs? → Always show the card, even when spend is zero. Keep it simple.

All other questions resolved by code review. Build when ready.

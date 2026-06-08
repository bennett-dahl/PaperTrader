# Admin Portfolios API — Developer Spec

## Overview

Add four admin-only endpoints under `/api/admin/portfolios` for managing portfolios on behalf of the admin user. The auth pattern is identical to `/api/admin/pipelines` — Bearer token checked against `PIPELINE_SECRET`, user resolved via `ADMIN_USER_EMAIL`.

---

## Auth

Use the existing helper verbatim:

```ts
import { requireAdminUser } from "../_auth";
// OR (from [id] route):
import { requireAdminUser } from "../../_auth";
```

**`_auth.ts` behavior (do not modify):**

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

Return `401` when `requireAdminUser` returns `null`.

---

## Schema reference (from `src/db/schema.ts`)

### `portfolios` table

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK, auto-generated |
| `userId` | `uuid` | FK → users.id (cascade) |
| `name` | `text` | required |
| `startingBalance` | `decimal(15,2)` | default `"5000.00"` |
| `cashBalance` | `decimal(15,2)` | default `"5000.00"` |
| `createdAt` | `timestamp` | defaultNow |
| `isDefault` | `boolean` | default `false` |

### `pipelinePortfolios` table (junction)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `pipelineId` | `uuid` | FK → pipelines.id (cascade) |
| `portfolioId` | `uuid` | FK → portfolios.id (cascade) |
| `allocationPct` | `decimal(5,2)` | default `"100.00"` |
| `assignedAt` | `timestamp` | defaultNow |

---

## Files to Create

```
src/app/api/admin/portfolios/route.ts           ← GET + POST
src/app/api/admin/portfolios/[id]/route.ts      ← PATCH + DELETE
tests/api/admin-portfolios.test.ts              ← tests for GET + POST
tests/api/admin-portfolios-id.test.ts           ← tests for PATCH + DELETE
```

> **Note on test file location:** All existing tests live in `tests/api/` (e.g., `tests/api/admin-pipelines.test.ts`). Follow this convention — do **not** place test files inside `src/app/api/...`.

---

## Endpoint: GET /api/admin/portfolios

**File:** `src/app/api/admin/portfolios/route.ts`

**What it does:**
- Authenticate via `requireAdminUser`; return 401 if null
- Query all portfolios where `userId = user.id`, ordered by `createdAt DESC`
- For each portfolio, query `pipelinePortfolios` to count how many pipeline links exist (`portfolioId = portfolio.id`)
- Return `200` with `{ portfolios: [...] }`

**Response shape per portfolio item:**

```ts
{
  id: string,
  userId: string,
  name: string,
  startingBalance: string,    // decimal string, e.g. "5000.00"
  cashBalance: string,        // decimal string
  isDefault: boolean,
  createdAt: string,          // ISO 8601: portfolio.createdAt.toISOString()
  pipelineCount: number,      // count of rows in pipelinePortfolios for this portfolio
}
```

**Implementation notes:**
- Spread the raw portfolio row into the response and add `pipelineCount`
- Convert `createdAt` to ISO string
- `pipelineCount` is the length of the array returned by the `pipelinePortfolios` query (or the count column)

**Query pattern (mirroring pipelines GET):**

```ts
const allPortfolios = await db
  .select()
  .from(portfolios)
  .where(eq(portfolios.userId, user.id))
  .orderBy(desc(portfolios.createdAt));

const enriched = await Promise.all(allPortfolios.map(async (p) => {
  const links = await db
    .select({ portfolioId: pipelinePortfolios.portfolioId })
    .from(pipelinePortfolios)
    .where(eq(pipelinePortfolios.portfolioId, p.id));

  return {
    ...p,
    createdAt: p.createdAt.toISOString(),
    pipelineCount: links.length,
  };
}));

return NextResponse.json({ portfolios: enriched });
```

---

## Endpoint: POST /api/admin/portfolios

**File:** `src/app/api/admin/portfolios/route.ts` (same file as GET, export both)

**Request body:**

```ts
{
  name: string;           // required
  startingBalance?: string; // optional, default "5000.00"
}
```

**Validation (in order):**

1. `name` is missing or empty after `.trim()` → `400 { error: "name is required" }`
2. `startingBalance` is provided AND (`isNaN(parseFloat(startingBalance))` OR `parseFloat(startingBalance) <= 0`) → `400 { error: "startingBalance must be a valid positive decimal" }`

**Create logic:**

```ts
const trimmedName = body.name.trim();
const balance = body.startingBalance ?? "5000.00";

const [portfolio] = await db
  .insert(portfolios)
  .values({
    userId: user.id,
    name: trimmedName,
    startingBalance: balance,
    cashBalance: balance,   // cashBalance initialized to startingBalance
    isDefault: false,
  })
  .returning();
```

**Response:** `201` with `{ portfolio }` — raw row from `.returning()`

---

## Endpoint: PATCH /api/admin/portfolios/:id

**File:** `src/app/api/admin/portfolios/[id]/route.ts`

**Request body:**

```ts
{
  name?: string;
  cashBalance?: string;
  // startingBalance MUST NOT be accepted — reject if present
}
```

**Validation (in order):**

1. `body.startingBalance !== undefined` → `400 { error: "startingBalance is immutable and cannot be updated" }`
2. `name` provided but `.trim()` is empty → `400 { error: "name cannot be empty" }`
3. `cashBalance` provided AND (`isNaN(parseFloat(cashBalance))` OR `parseFloat(cashBalance) <= 0`) → `400 { error: "cashBalance must be a valid positive decimal" }`

**Ownership check:**

```ts
const existing = await db
  .select()
  .from(portfolios)
  .where(and(eq(portfolios.id, id), eq(portfolios.userId, user.id)))
  .limit(1);

if (!existing[0]) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
```

**Update logic:**

Only include fields that were provided in the request body:

```ts
const updateFields: Record<string, unknown> = {};
if (body.name !== undefined) updateFields.name = body.name.trim();
if (body.cashBalance !== undefined) updateFields.cashBalance = body.cashBalance;

const [updated] = await db
  .update(portfolios)
  .set(updateFields)
  .where(and(eq(portfolios.id, id), eq(portfolios.userId, user.id)))
  .returning();
```

**Response:** `200` with `{ portfolio: updated }`

---

## Endpoint: DELETE /api/admin/portfolios/:id

**File:** `src/app/api/admin/portfolios/[id]/route.ts`

**Steps (in order):**

### 1. Authenticate
Return `401` if no admin user.

### 2. Resolve params
```ts
const { id } = await params;
```

### 3. Ownership check
```ts
const existing = await db
  .select()
  .from(portfolios)
  .where(and(eq(portfolios.id, id), eq(portfolios.userId, user.id)))
  .limit(1);

if (!existing[0]) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
```

### 4. Pipeline link check (409 guard)
```ts
const links = await db
  .select()
  .from(pipelinePortfolios)
  .where(eq(pipelinePortfolios.portfolioId, id));

if (links.length > 0) {
  return NextResponse.json(
    { error: "Portfolio is linked to one or more pipelines and cannot be deleted" },
    { status: 409 }
  );
}
```

### 5. Default portfolio promotion (conditional)

If `existing[0].isDefault === true`, after deletion we must promote the next oldest portfolio:

```ts
if (existing[0].isDefault) {
  // Find next oldest sibling BEFORE deleting (order by createdAt ASC, exclude current)
  const siblings = await db
    .select()
    .from(portfolios)
    .where(and(eq(portfolios.userId, user.id), ne(portfolios.id, id)))
    .orderBy(asc(portfolios.createdAt))
    .limit(1);

  // Delete the portfolio
  await db.delete(portfolios).where(eq(portfolios.id, id));

  // Promote sibling if one exists
  if (siblings[0]) {
    await db
      .update(portfolios)
      .set({ isDefault: true })
      .where(eq(portfolios.id, siblings[0].id));
  }
  // If no siblings, just deleted — no default portfolio remains, which is fine
} else {
  // Non-default: simple delete
  await db.delete(portfolios).where(eq(portfolios.id, id));
}
```

**Import `ne` and `asc` from `drizzle-orm`:**
```ts
import { eq, and, ne, asc } from "drizzle-orm";
```

### 6. Response
`204` with no body:
```ts
return new NextResponse(null, { status: 204 });
```

---

## Complete route.ts structure

### `src/app/api/admin/portfolios/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { portfolios, pipelinePortfolios } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireAdminUser } from "../_auth";

export async function GET(req: NextRequest) { ... }
export async function POST(req: NextRequest) { ... }
```

### `src/app/api/admin/portfolios/[id]/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { portfolios, pipelinePortfolios } from "@/db/schema";
import { eq, and, ne, asc } from "drizzle-orm";
import { requireAdminUser } from "../../_auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) { ... }

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) { ... }
```

---

## Tests

### File: `tests/api/admin-portfolios.test.ts`

Tests for GET and POST `/api/admin/portfolios`.

**Imports and setup:**

```ts
import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/db";
import { mockUser, mockPortfolio } from "../fixtures/factories";

const VALID_SECRET = "test-pipeline-secret";
const VALID_EMAIL = "admin@example.com";

function setupAdminEnv() {
  process.env.PIPELINE_SECRET = VALID_SECRET;
  process.env.ADMIN_USER_EMAIL = VALID_EMAIL;
}

function authHeader() {
  return { Authorization: `Bearer ${VALID_SECRET}` };
}
```

**Mock portfolio for admin tests (define at top of file):**

```ts
const mockAdminPortfolio = {
  ...mockPortfolio,
  id: "portfolio-admin-1",
  userId: mockUser.id,
  name: "Admin Portfolio",
  startingBalance: "5000.00",
  cashBalance: "5000.00",
  isDefault: false,
  createdAt: new Date("2025-01-01"),
};
```

---

#### `describe("GET /api/admin/portfolios")`

Each `it` block calls `setupAdminEnv()` and `vi.resetModules()` in `beforeEach`.

Import via dynamic import after `resetModules`:
```ts
const handler = await import("@/app/api/admin/portfolios/route");
```

**Test cases:**

1. **`returns 401 with invalid token`**
   - Mock `db.select` to return `[mockUser]` on limit
   - Send `GET` with `Authorization: Bearer wrong`
   - Expect `status === 401`

2. **`returns 401 with no auth header`**
   - No `db.select` mock needed (auth fails before DB)
   - Send `GET` with no Authorization header
   - Expect `status === 401`

3. **`returns empty portfolios array when user has none`**
   - First `db.select` call (user lookup) returns `[mockUser]`; subsequent calls return `[]`
   - Send `GET` with valid auth
   - Expect `status === 200`, `data.portfolios` is `[]`

4. **`returns portfolio list with pipelineCount`**
   - First `db.select` call returns `[mockUser]`
   - Second call (portfolio list) returns `[mockAdminPortfolio]`
   - Third call (pipelinePortfolios count for each portfolio) returns `[]` (0 links)
   - Send `GET` with valid auth
   - Expect `status === 200`
   - Expect `data.portfolios[0].pipelineCount === 0`
   - Expect `data.portfolios[0].name === "Admin Portfolio"`

   > **DB mock tip:** Use a `callCount` counter on `vi.mocked(db.select)` to return different results per call, the same way `admin-pipelines.test.ts` does it.

---

#### `describe("POST /api/admin/portfolios")`

Each `it` block calls `setupAdminEnv()` and `vi.resetModules()` in `beforeEach`.

**Test cases:**

1. **`returns 401 with bad auth`**
   - Send `POST` with no auth header and `{ name: "Test" }` body
   - Expect `status === 401`

2. **`returns 400 when name is missing`**
   - Mock `db.select` → returns `[mockUser]`
   - Send `POST` with valid auth and `{}` body (no name)
   - Expect `status === 400`, `data.error` matches `/name/i`

3. **`returns 400 when name is empty string after trim`**
   - Mock `db.select` → returns `[mockUser]`
   - Send `POST` with valid auth and `{ name: "   " }` body
   - Expect `status === 400`, `data.error` matches `/name/i`

4. **`returns 400 when startingBalance is non-numeric`**
   - Mock `db.select` → returns `[mockUser]`
   - Send `POST` with `{ name: "My Portfolio", startingBalance: "not-a-number" }`
   - Expect `status === 400`, `data.error` matches `/startingBalance/i`

5. **`returns 400 when startingBalance is zero or negative`**
   - Mock `db.select` → returns `[mockUser]`
   - Send `POST` with `{ name: "My Portfolio", startingBalance: "0" }`
   - Expect `status === 400`
   - Also test with `"-100.00"` (negative)

6. **`happy path — creates portfolio with default balance and returns 201`**
   - Mock `db.select` → returns `[mockUser]`
   - Mock `db.insert` → `values().returning()` resolves to `[mockAdminPortfolio]`
   - Send `POST` with `{ name: "My Portfolio" }`
   - Expect `status === 201`
   - Expect `data.portfolio` is defined
   - Expect `data.portfolio.name === "My Portfolio"` (or whatever the mock returns)

7. **`happy path — creates portfolio with custom startingBalance and returns 201`**
   - Same as above but body is `{ name: "My Portfolio", startingBalance: "10000.00" }`
   - Expect `status === 201`

---

### File: `tests/api/admin-portfolios-id.test.ts`

Tests for PATCH and DELETE `/api/admin/portfolios/[id]`.

**Setup** — same `VALID_SECRET`, `setupAdminEnv()`, `authHeader()` helpers as above.

**Mock data** for this file:

```ts
const mockAdminPortfolio = {
  ...mockPortfolio,
  id: "portfolio-1",
  userId: mockUser.id,
  name: "Test Portfolio",
  startingBalance: "5000.00",
  cashBalance: "3000.00",
  isDefault: false,
  createdAt: new Date("2025-01-01"),
};

const mockDefaultPortfolio = {
  ...mockAdminPortfolio,
  id: "portfolio-default",
  isDefault: true,
  createdAt: new Date("2024-12-01"),
};

const mockSiblingPortfolio = {
  ...mockAdminPortfolio,
  id: "portfolio-sibling",
  name: "Sibling Portfolio",
  isDefault: false,
  createdAt: new Date("2025-02-01"),
};
```

---

#### `describe("PATCH /api/admin/portfolios/[id]")`

Import: `const handler = await import("@/app/api/admin/portfolios/[id]/route");`
Pass `params: { id: "portfolio-1" }` in `testApiHandler`.

**Test cases:**

1. **`returns 401 with bad auth`**
   - Send `PATCH` with no auth and `{ name: "New Name" }`
   - Expect `status === 401`

2. **`returns 400 when startingBalance is included in body`**
   - Mock `db.select` call 1 → `[mockUser]`
   - Send `PATCH` with `{ startingBalance: "9999.00" }`
   - Expect `status === 400`, `data.error` matches `/startingBalance/i`

3. **`returns 400 when name is empty after trim`**
   - Mock `db.select` call 1 → `[mockUser]`
   - Send `PATCH` with `{ name: "   " }`
   - Expect `status === 400`, `data.error` matches `/name/i`

4. **`returns 400 when cashBalance is non-numeric`**
   - Mock `db.select` call 1 → `[mockUser]`
   - Send `PATCH` with `{ cashBalance: "abc" }`
   - Expect `status === 400`, `data.error` matches `/cashBalance/i`

5. **`returns 400 when cashBalance is zero or negative`**
   - Mock `db.select` call 1 → `[mockUser]`
   - Send `PATCH` with `{ cashBalance: "-50.00" }`
   - Expect `status === 400`

6. **`returns 404 when portfolio not found or not owned`**
   - Call 1 → `[mockUser]`, call 2 → `[]` (portfolio not found)
   - Send `PATCH` with `{ name: "New Name" }`, `params: { id: "nonexistent" }`
   - Expect `status === 404`

7. **`happy path — updates name and returns 200`**
   - Call 1 → `[mockUser]`, call 2 → `[mockAdminPortfolio]`
   - Mock `db.update` → `set().where().returning()` resolves to `[{ ...mockAdminPortfolio, name: "Updated Name" }]`
   - Send `PATCH` with `{ name: "Updated Name" }`
   - Expect `status === 200`, `data.portfolio` defined

8. **`happy path — updates cashBalance and returns 200`**
   - Call 1 → `[mockUser]`, call 2 → `[mockAdminPortfolio]`
   - Mock `db.update` → returns `[{ ...mockAdminPortfolio, cashBalance: "2500.00" }]`
   - Send `PATCH` with `{ cashBalance: "2500.00" }`
   - Expect `status === 200`, `data.portfolio.cashBalance === "2500.00"`

---

#### `describe("DELETE /api/admin/portfolios/[id]")`

Import: `const handler = await import("@/app/api/admin/portfolios/[id]/route");`

**Test cases:**

1. **`returns 401 with bad auth`**
   - Send `DELETE` with no auth
   - Expect `status === 401`

2. **`returns 404 when portfolio not found`**
   - Call 1 → `[mockUser]`, call 2 → `[]`
   - Send `DELETE`, `params: { id: "nonexistent" }`
   - Expect `status === 404`

3. **`returns 409 when portfolio has active pipeline links`**
   - Call 1 → `[mockUser]`
   - Call 2 (ownership check) → `[mockAdminPortfolio]`
   - Call 3 (pipelinePortfolios check) → `[{ id: "link-1", pipelineId: "pipe-1", portfolioId: "portfolio-1" }]`
   - Send `DELETE`, `params: { id: "portfolio-1" }`
   - Expect `status === 409`, `data.error` matches `/pipeline/i`

4. **`happy path — deletes non-default portfolio and returns 204`**
   - Call 1 → `[mockUser]`
   - Call 2 (ownership) → `[mockAdminPortfolio]` (`isDefault: false`)
   - Call 3 (pipeline links) → `[]` (no links)
   - Mock `db.delete` so it resolves without error
   - Send `DELETE`, `params: { id: "portfolio-1" }`
   - Expect `status === 204`

5. **`deletes default portfolio and promotes oldest sibling`**
   - Call 1 → `[mockUser]`
   - Call 2 (ownership) → `[mockDefaultPortfolio]` (`isDefault: true`)
   - Call 3 (pipeline links) → `[]`
   - Call 4 (siblings query) → `[mockSiblingPortfolio]`
   - Mock `db.delete` → resolves
   - Mock `db.update` → `set().where().returning()` resolves to `[{ ...mockSiblingPortfolio, isDefault: true }]`
   - Send `DELETE`, `params: { id: "portfolio-default" }`
   - Expect `status === 204`
   - Verify `db.update` was called (the sibling was promoted)

6. **`deletes default portfolio with no siblings — no promotion, returns 204`**
   - Call 1 → `[mockUser]`
   - Call 2 (ownership) → `[mockDefaultPortfolio]` (`isDefault: true`)
   - Call 3 (pipeline links) → `[]`
   - Call 4 (siblings query) → `[]` (no siblings)
   - Mock `db.delete` → resolves
   - Send `DELETE`, `params: { id: "portfolio-default" }`
   - Expect `status === 204`
   - Verify `db.update` was **NOT** called

---

## DB mock patterns

All DB mocking uses `vi.mocked(db.select|insert|update|delete)` with `as any` cast. Follow the exact patterns from `tests/api/admin-pipelines.test.ts`:

**Single-call select mock:**
```ts
vi.mocked(db.select).mockReturnValue({
  from: vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue([mockUser]),
    }),
  }),
} as any);
```

**Multi-call select mock (callCount counter):**
```ts
let callCount = 0;
vi.mocked(db.select).mockImplementation(() => {
  callCount++;
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(callCount === 1 ? [mockUser] : []),
        orderBy: vi.fn().mockResolvedValue(callCount === 2 ? [mockAdminPortfolio] : []),
      }),
      orderBy: vi.fn().mockResolvedValue(callCount === 2 ? [mockAdminPortfolio] : []),
    }),
  } as any;
});
```

**Insert mock:**
```ts
vi.mocked(db.insert).mockReturnValue({
  values: vi.fn().mockReturnValue({
    returning: vi.fn().mockResolvedValue([mockAdminPortfolio]),
  }),
} as any);
```

**Update mock:**
```ts
vi.mocked(db.update).mockReturnValue({
  set: vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([updatedPortfolio]),
    }),
  }),
} as any);
```

**Delete mock:**
```ts
vi.mocked(db.delete).mockReturnValue({
  where: vi.fn().mockResolvedValue([]),
} as any);
```

---

## DELETE with default-promotion: mock sequencing detail

The DELETE on a default portfolio with siblings involves **4 DB calls**:
1. `db.select` — user lookup (auth)
2. `db.select` — ownership check (returns `[mockDefaultPortfolio]`)
3. `db.select` — pipeline links check (returns `[]`)
4. `db.select` — siblings query (returns `[mockSiblingPortfolio]`)
5. `db.delete` — delete the portfolio
6. `db.update` — promote sibling to isDefault

The `vi.mocked(db.select).mockImplementation` counter must handle 4 distinct calls. Example:

```ts
let selectCount = 0;
vi.mocked(db.select).mockImplementation(() => {
  selectCount++;
  if (selectCount === 1) {
    // user lookup
    return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([mockUser]) }) }) } as any;
  } else if (selectCount === 2) {
    // ownership check
    return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([mockDefaultPortfolio]) }) }) } as any;
  } else if (selectCount === 3) {
    // pipeline links check
    return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) } as any;
  } else {
    // siblings query
    return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([mockSiblingPortfolio]) }) }) }) } as any;
  }
});
```

---

## Validation helper (optional, DRY)

You may optionally extract a shared validator into the route files:

```ts
function isValidPositiveDecimal(val: string): boolean {
  const n = parseFloat(val);
  return !isNaN(n) && n > 0;
}
```

---

## Summary of status codes

| Scenario | Status |
|---|---|
| Bad/missing auth | 401 |
| Missing required field / invalid value | 400 |
| `startingBalance` in PATCH body | 400 |
| Portfolio not found / not owned | 404 |
| DELETE portfolio with pipeline links | 409 |
| GET success | 200 |
| POST success | 201 |
| PATCH success | 200 |
| DELETE success | 204 (no body) |

---

## Checklist for implementer

- [ ] `src/app/api/admin/portfolios/route.ts` — exports `GET` and `POST`
- [ ] `src/app/api/admin/portfolios/[id]/route.ts` — exports `PATCH` and `DELETE`
- [ ] `tests/api/admin-portfolios.test.ts` — all GET + POST test cases pass
- [ ] `tests/api/admin-portfolios-id.test.ts` — all PATCH + DELETE test cases pass
- [ ] `ne` and `asc` imported from `drizzle-orm` in the `[id]` route
- [ ] DELETE default portfolio with sibling: sibling promoted to `isDefault = true`
- [ ] DELETE default portfolio with no sibling: no update call, no error, 204
- [ ] `startingBalance` in PATCH body → 400, not 200
- [ ] All tests use `vi.resetModules()` in `beforeEach`
- [ ] Run `pnpm test` (or `npx vitest`) to confirm green

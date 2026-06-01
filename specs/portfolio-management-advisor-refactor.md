# Portfolio Management & Advisor Refactor — Developer Spec

**Status:** Ready for implementation  
**Created:** 2026-06-01  
**Scope:** Route rename `/build` → `/advisor`, `/portfolios` page management actions, mobile nav replacement, PortfolioSwitcher CTA updates

---

## 1. Summary of Changes

| # | Change | Impact |
|---|--------|--------|
| 1 | Rename `/build` route to `/advisor` | Route + nav labels + all href references |
| 2 | `/portfolios` page: add Rename, Delete, Adjust Cash actions per portfolio | New dialogs, 2 new API endpoints |
| 3 | `PortfolioSwitcher` "New Portfolio" CTA → `/portfolios` (all 3 states) | 3 href replacements |
| 4 | Mobile nav: remove `BottomNav`, add hamburger → Sheet drawer | Layout update, new `MobileNav` component |
| 5 | Delete isDefault portfolio → auto-promote another | API logic |

---

## 2. File-by-File Breakdown

### 2.1 Files to CREATE

#### `src/app/(dashboard)/advisor/page.tsx`
- Copy of `src/app/(dashboard)/build/page.tsx` (identical content)
- No functional changes — just a new path

#### `src/app/api/portfolio/[id]/route.ts`
- New file (the `[id]` dynamic segment under `api/portfolio/`)
- Implements `PATCH` and `DELETE` handlers (see Section 4)

#### `src/components/MobileNav.tsx`
- New component replacing `BottomNav`
- Hamburger button + shadcn `Sheet` drawer
- Contains all nav links (see Section 5)

---

### 2.2 Files to MODIFY

#### `src/app/(dashboard)/layout.tsx`
**Current:** Renders `<BottomNav />` and a minimal mobile header  
**Changes:**
1. Remove `import BottomNav from "@/components/BottomNav"`
2. Add `import MobileNav from "@/components/MobileNav"`
3. In the mobile header `<header>` block: add a hamburger button on the right side that triggers the `MobileNav` sheet
4. Remove `<BottomNav />` at bottom of layout
5. Remove `pb-20` from the main content wrapper (was padding for bottom nav); replace with `pb-4`

**New mobile header structure:**
```tsx
<header className="flex items-center justify-between px-4 py-3 border-b border-slate-800 sm:hidden sticky top-0 bg-slate-950/95 backdrop-blur z-10">
  <div className="flex items-center gap-2">
    <TrendingUp className="h-5 w-5 text-emerald-400" />
    <span className="font-bold text-lg">PaperTrader</span>
  </div>
  <div className="flex items-center gap-3">
    {session.user.image && (
      <img src={session.user.image} alt={session.user.name ?? "User"} className="h-8 w-8 rounded-full" />
    )}
    <MobileNav user={session.user} />
  </div>
</header>
```

**Main content wrapper change:**
```tsx
// Before:
<main className="flex-1 pb-20 sm:pb-0 sm:pl-64 min-h-screen">
// After:
<main className="flex-1 pb-4 sm:pb-0 sm:pl-64 min-h-screen">
```

---

#### `src/components/Sidebar.tsx`
**Changes:**
1. Change nav item: `{ href: "/build", label: "Build Portfolio", icon: Wand2 }` → `{ href: "/advisor", label: "Advisor", icon: Wand2 }`
   - Keep `Wand2` icon (still appropriate for an AI advisor)

---

#### `src/components/PortfolioSwitcher.tsx`
**Changes:** Replace all 3 `/build` href references with `/portfolios`

1. **Zero portfolios state:**
   ```tsx
   // Before:
   <Link href="/build" ...>Create your first portfolio →</Link>
   // After:
   <Link href="/portfolios" ...>Create your first portfolio →</Link>
   ```

2. **One portfolio state:**
   ```tsx
   // Before:
   <Link href="/build" ...>＋ New Portfolio</Link>
   // After:
   <Link href="/portfolios" ...>＋ New Portfolio</Link>
   ```

3. **Two+ portfolios state — `__new__` value handler:**
   ```tsx
   // Before:
   if (value === "__new__") { router.push("/build"); }
   // After:
   if (value === "__new__") { router.push("/portfolios"); }
   ```

---

#### `src/app/(dashboard)/trade/page.tsx`
**Changes:** Update the Portfolio Builder CTA card

```tsx
// Before:
<Link href="/build" ...>
  <p className="font-semibold text-sm text-emerald-300">Build a Portfolio</p>
  <p className="text-slate-400 text-xs">Let us pick a diversified mix of stocks...</p>
// After:
<Link href="/advisor" ...>
  <p className="font-semibold text-sm text-emerald-300">Stock Advisor</p>
  <p className="text-slate-400 text-xs">Get personalized stock picks for your portfolio in 3 easy steps</p>
```

---

#### `src/app/(dashboard)/portfolios/page.tsx`
**Changes:** Add per-portfolio action UI (Rename, Delete, Adjust Cash)

This is a Server Component that fetches data. Action dialogs must be client components. Keep the server component for data fetching; add a new `PortfolioActions` client component per card.

**Add import:**
```tsx
import PortfolioActions from "@/components/PortfolioActions";
```

**In the card map, add actions row below the existing stats row:**
```tsx
<div className="bg-slate-900 border border-slate-800 rounded-2xl px-5 py-4 space-y-3">
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-2">
      <p className="font-semibold">{p.name}</p>
      {p.isDefault && <Badge ...>Active</Badge>}
    </div>
    <p className="font-bold text-lg">${p.totalValue.toFixed(2)}</p>
  </div>
  <div className="flex justify-between text-sm text-slate-400">
    <span>{p.holdingsCount} holdings</span>
    <span className={...}>{p.pct.toFixed(2)}% all time</span>
  </div>
  {/* NEW */}
  <PortfolioActions
    portfolioId={p.id}
    portfolioName={p.name}
    cashBalance={parseFloat(p.cashBalance)}
    holdingsCount={p.holdingsCount}
    isDefault={p.isDefault}
  />
</div>
```

---

### 2.3 Files to CREATE (Components)

#### `src/components/PortfolioActions.tsx`
Client component with 3 action buttons (Rename, Adjust Cash, Delete) per portfolio card.

**Props interface:**
```ts
interface PortfolioActionsProps {
  portfolioId: string;
  portfolioName: string;
  cashBalance: number;
  holdingsCount: number;
  isDefault: boolean;
}
```

**State:**
```ts
const [renameOpen, setRenameOpen] = useState(false);
const [cashOpen, setCashOpen] = useState(false);
const [deleteOpen, setDeleteOpen] = useState(false);
const [loading, setLoading] = useState(false);
const [newName, setNewName] = useState(portfolioName);
const [newCash, setNewCash] = useState(String(cashBalance));
const router = useRouter();
```

**Action handlers:**
```ts
const handleRename = async () => {
  if (!newName.trim() || newName.trim() === portfolioName) return;
  setLoading(true);
  try {
    const res = await fetch(`/api/portfolio/${portfolioId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    if (!res.ok) { toast.error("Failed to rename portfolio"); return; }
    toast.success("Portfolio renamed");
    setRenameOpen(false);
    router.refresh();
  } catch { toast.error("Something went wrong"); }
  finally { setLoading(false); }
};

const handleAdjustCash = async () => {
  const amount = parseFloat(newCash);
  if (isNaN(amount) || amount < 0) return;
  setLoading(true);
  try {
    const res = await fetch(`/api/portfolio/${portfolioId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cashBalance: amount }),
    });
    if (!res.ok) { toast.error("Failed to update cash balance"); return; }
    toast.success("Cash balance updated");
    setCashOpen(false);
    router.refresh();
  } catch { toast.error("Something went wrong"); }
  finally { setLoading(false); }
};

const handleDelete = async () => {
  setLoading(true);
  try {
    const res = await fetch(`/api/portfolio/${portfolioId}`, { method: "DELETE" });
    if (!res.ok) { toast.error("Failed to delete portfolio"); return; }
    toast.success("Portfolio deleted");
    setDeleteOpen(false);
    router.refresh();
  } catch { toast.error("Something went wrong"); }
  finally { setLoading(false); }
};
```

**Button row layout:**
```tsx
<div className="flex items-center gap-2 pt-1 border-t border-slate-800">
  <Button variant="ghost" size="sm" onClick={() => { setNewName(portfolioName); setRenameOpen(true); }}
    className="text-slate-400 hover:text-white text-xs gap-1.5 h-8 px-3">
    <Pencil className="h-3.5 w-3.5" /> Rename
  </Button>
  <Button variant="ghost" size="sm" onClick={() => { setNewCash(String(cashBalance)); setCashOpen(true); }}
    className="text-slate-400 hover:text-white text-xs gap-1.5 h-8 px-3">
    <DollarSign className="h-3.5 w-3.5" /> Add Cash
  </Button>
  <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(true)}
    className="ml-auto text-slate-600 hover:text-red-400 text-xs gap-1.5 h-8 px-3">
    <Trash2 className="h-3.5 w-3.5" /> Delete
  </Button>
</div>
```

**Icons:** `Pencil`, `DollarSign`, `Trash2` from `lucide-react`

**Rename Dialog:**
```tsx
<Dialog open={renameOpen} onOpenChange={setRenameOpen}>
  <DialogContent className="bg-slate-900 border-slate-700 text-white">
    <DialogHeader><DialogTitle>Rename Portfolio</DialogTitle></DialogHeader>
    <div className="space-y-4 mt-2">
      <Input
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleRename()}
        placeholder="Portfolio name"
        className="bg-slate-800 border-slate-700 text-white"
      />
      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => setRenameOpen(false)} className="flex-1">Cancel</Button>
        <Button
          onClick={handleRename}
          disabled={loading || !newName.trim() || newName.trim() === portfolioName}
          className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold"
        >
          {loading ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  </DialogContent>
</Dialog>
```

**Adjust Cash Dialog:**
```tsx
<Dialog open={cashOpen} onOpenChange={setCashOpen}>
  <DialogContent className="bg-slate-900 border-slate-700 text-white">
    <DialogHeader><DialogTitle>Adjust Cash Balance</DialogTitle></DialogHeader>
    <div className="space-y-4 mt-2">
      <p className="text-slate-400 text-sm">
        This updates your available cash. Your starting balance is used for ROI calculations and won't change.
      </p>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
        <Input
          type="number"
          min={0}
          step={100}
          value={newCash}
          onChange={(e) => setNewCash(e.target.value)}
          className="bg-slate-800 border-slate-700 text-white pl-7"
        />
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => setCashOpen(false)} className="flex-1">Cancel</Button>
        <Button
          onClick={handleAdjustCash}
          disabled={loading || newCash === "" || parseFloat(newCash) < 0}
          className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold"
        >
          {loading ? "Saving…" : "Update Cash"}
        </Button>
      </div>
    </div>
  </DialogContent>
</Dialog>
```

**Delete Dialog:**
```tsx
<Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
  <DialogContent className="bg-slate-900 border-slate-700 text-white">
    <DialogHeader><DialogTitle>Delete Portfolio</DialogTitle></DialogHeader>
    <div className="space-y-4 mt-2">
      {holdingsCount > 0 ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3">
          <p className="text-red-400 text-sm font-medium mb-1">⚠️ Portfolio has holdings</p>
          <p className="text-slate-300 text-sm">
            This portfolio has {holdingsCount} holding{holdingsCount !== 1 ? "s" : ""}.
            Deleting it will permanently remove all data including trade history. This cannot be undone.
          </p>
        </div>
      ) : (
        <p className="text-slate-400 text-sm">
          Are you sure you want to delete "{portfolioName}"? This cannot be undone.
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => setDeleteOpen(false)} className="flex-1">Cancel</Button>
        <Button
          onClick={handleDelete}
          disabled={loading}
          className="flex-1 bg-red-500 hover:bg-red-400 text-white font-bold"
        >
          {loading ? "Deleting…" : "Delete Portfolio"}
        </Button>
      </div>
    </div>
  </DialogContent>
</Dialog>
```

---

#### `src/components/MobileNav.tsx`
Client component. Hamburger button that opens a shadcn Sheet from the left.

**Props:**
```ts
interface MobileNavProps {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
}
```

**Nav items** (same as Sidebar but includes Portfolios, uses /advisor):
```ts
const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/trade", label: "Trade", icon: TrendingUp },
  { href: "/advisor", label: "Advisor", icon: Wand2 },
  { href: "/watchlist", label: "Watchlist", icon: Eye },
  { href: "/history", label: "History", icon: Clock },
  { href: "/portfolios", label: "Portfolios", icon: Briefcase },
];
```

**Full component:**
```tsx
export default function MobileNav({ user }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon"
          className="text-slate-400 hover:text-white min-h-[44px] min-w-[44px]">
          <Menu className="h-5 w-5" />
          <span className="sr-only">Open menu</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[280px] bg-slate-900 border-slate-800 p-0 flex flex-col">
        {/* Logo */}
        <div className="flex items-center gap-2 px-6 py-5 border-b border-slate-800">
          <TrendingUp className="h-6 w-6 text-emerald-400" />
          <span className="text-xl font-bold text-white">PaperTrader</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors min-h-[44px] ${
                  active
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "text-slate-400 hover:text-white hover:bg-slate-800"
                }`}
              >
                <Icon className="h-5 w-5 flex-shrink-0" />
                <span className="font-medium">{label}</span>
              </Link>
            );
          })}
        </nav>

        {/* User section */}
        <div className="border-t border-slate-800 p-4">
          <div className="flex items-center gap-3 mb-3">
            <Avatar className="h-8 w-8">
              <AvatarImage src={user.image ?? undefined} />
              <AvatarFallback>{user.name?.charAt(0).toUpperCase() ?? "?"}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user.name}</p>
              <p className="text-xs text-slate-500 truncate">{user.email}</p>
            </div>
          </div>
          <button
            onClick={() => { setOpen(false); signOut({ callbackUrl: "/" }); }}
            className="flex items-center gap-2 text-slate-500 hover:text-white text-sm transition-colors w-full px-2 py-1.5 rounded-lg hover:bg-slate-800 min-h-[44px]"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

**Note:** The shadcn Sheet includes a default close button (X). Keep it. Nav link `onClick={() => setOpen(false)}` closes the drawer on navigation.

---

### 2.4 Files to DELETE

#### `src/components/BottomNav.tsx`
Delete after removing all imports from `layout.tsx`.

---

## 3. Route Changes Summary

| Old Route | New Route |
|-----------|-----------|
| `/build` | `/advisor` |

**All `/build` references to update:**
- `src/app/(dashboard)/build/page.tsx` → move/copy to `src/app/(dashboard)/advisor/page.tsx`
- `src/components/Sidebar.tsx` → nav item href + label
- `src/components/PortfolioSwitcher.tsx` → 3 occurrences
- `src/app/(dashboard)/trade/page.tsx` → CTA href + copy

**Optional redirect** (for bookmarked users), add to `next.config.js`:
```js
async redirects() {
  return [{ source: '/build', destination: '/advisor', permanent: true }];
}
```

---

## 4. API Endpoint Specs

### 4.1 `PATCH /api/portfolio/[id]`

**File:** `src/app/api/portfolio/[id]/route.ts`

**Request body:**
```ts
// Rename only
{ "name": "New Name" }

// Adjust cash only  
{ "cashBalance": 7500.00 }

// Both fields
{ "name": "New Name", "cashBalance": 7500.00 }
```

**Validation:**
- At least one of `name` or `cashBalance` must be present
- `name` (if present): non-empty string after `.trim()`
- `cashBalance` (if present): valid number >= 0
- `startingBalance` and `isDefault` are NOT updatable via this endpoint

**Auth flow:**
1. `auth()` — if no session, return 401
2. Look up `dbUser` by email
3. Fetch portfolio by `params.id`
4. Verify `portfolio.userId === dbUser.id` — if not, return 403

**Response 200:**
```json
{ "portfolio": { ...updatedPortfolioRow } }
```

**Error responses:**
| Status | Condition |
|--------|-----------|
| 400 | No fields provided, empty name, negative cashBalance |
| 401 | Not authenticated |
| 403 | Portfolio belongs to different user |
| 404 | Portfolio or user not found |

**Implementation:**
```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { portfolios, users } from "@/db/schema";
import { eq, and, ne, desc } from "drizzle-orm";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, cashBalance } = body as { name?: string; cashBalance?: number };

  if (name === undefined && cashBalance === undefined)
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });

  if (name !== undefined && !name.trim())
    return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });

  if (cashBalance !== undefined && (typeof cashBalance !== "number" || cashBalance < 0))
    return NextResponse.json({ error: "Cash balance must be a non-negative number" }, { status: 400 });

  const dbUser = await db.select().from(users).where(eq(users.email, session.user.email)).limit(1);
  if (!dbUser[0]) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const portfolio = await db.select().from(portfolios).where(eq(portfolios.id, params.id)).limit(1);
  if (!portfolio[0]) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
  if (portfolio[0].userId !== dbUser[0].id)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const updates: Partial<{ name: string; cashBalance: string }> = {};
  if (name !== undefined) updates.name = name.trim();
  if (cashBalance !== undefined) updates.cashBalance = cashBalance.toFixed(2);

  const updated = await db
    .update(portfolios)
    .set(updates)
    .where(eq(portfolios.id, params.id))
    .returning();

  return NextResponse.json({ portfolio: updated[0] });
}
```

---

### 4.2 `DELETE /api/portfolio/[id]`

**Same file:** `src/app/api/portfolio/[id]/route.ts`

**Request:** No body.

**Auth flow:** Same as PATCH (session → dbUser → fetch portfolio → verify ownership).

**Business logic:**
1. If `portfolio.isDefault === true` AND other portfolios exist for this user:
   - Find most recently created other portfolio (`ORDER BY createdAt DESC LIMIT 1`)
   - Set `isDefault = true` on that portfolio
2. Delete the portfolio (FK cascades: holdings, transactions, snapshots, watchlist all deleted)

**Response 200:**
```json
{ "success": true }
```

**Error responses:** Same 401/403/404 as PATCH.

**Implementation:**
```ts
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dbUser = await db.select().from(users).where(eq(users.email, session.user.email)).limit(1);
  if (!dbUser[0]) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const portfolio = await db.select().from(portfolios).where(eq(portfolios.id, params.id)).limit(1);
  if (!portfolio[0]) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
  if (portfolio[0].userId !== dbUser[0].id)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Auto-promote another portfolio to isDefault if needed
  if (portfolio[0].isDefault) {
    const others = await db
      .select()
      .from(portfolios)
      .where(and(eq(portfolios.userId, dbUser[0].id), ne(portfolios.id, params.id)))
      .orderBy(desc(portfolios.createdAt))
      .limit(1);

    if (others[0]) {
      await db.update(portfolios).set({ isDefault: true }).where(eq(portfolios.id, others[0].id));
    }
  }

  await db.delete(portfolios).where(eq(portfolios.id, params.id));

  return NextResponse.json({ success: true });
}
```

---

## 5. Edge Cases & Validation

### 5.1 Delete Default Portfolio (with other portfolios remaining)
- API auto-promotes the most recently created other portfolio to `isDefault = true`
- Frontend sees updated state after `router.refresh()`

### 5.2 Delete Last Portfolio
- No promotion needed (no other portfolios)
- After `router.refresh()`, the dashboard layout detects 0 portfolios and redirects to `/onboarding`
- No special frontend handling needed

### 5.3 Adjust Cash Below $0
- Frontend: disable submit when `parseFloat(newCash) < 0` or empty string
- Backend: return 400 if `cashBalance < 0`

### 5.4 Rename to Empty String
- Frontend: disable submit when `newName.trim() === ""`
- Backend: return 400

### 5.5 Rename to Same Name
- Frontend: disable submit when `newName.trim() === portfolioName` (no-op UX)
- Backend: accepts it (valid no-harm update)

### 5.6 Rapid Double-Submit
- `loading` state prevents duplicate API calls while request is in flight

### 5.7 Cash Adjust With Fractional Values
- Frontend: `type="number"` with `step={100}` is a hint only; any value accepted
- Backend: stored as `toFixed(2)` string (consistent with schema)

### 5.8 `startingBalance` Immutability
- Not exposed in any UI; not accepted in PATCH handler; stays as ROI baseline forever

### 5.9 Mobile Sheet With Many Nav Items
- `overflow-y-auto` on nav section prevents overflow

### 5.10 PortfolioSwitcher After Last Portfolio Deleted
- `router.refresh()` triggers layout redirect to `/onboarding` — correct existing behavior

---

## 6. Migration Considerations

**No database migrations required.** All changes are frontend routing/UI + new API endpoints using existing schema. No schema alterations.

**No environment variable changes required.**

**Deploy order:** Standard — build + deploy. `/build` will 404 after directory rename. Since it's not an SEO/public route, this is acceptable. Optional redirect in `next.config.js` if needed.

---

## 7. Implementer Checklist

- [ ] Create `src/app/(dashboard)/advisor/page.tsx` (copy of build/page.tsx)
- [ ] Delete `src/app/(dashboard)/build/` directory
- [ ] Update `src/components/Sidebar.tsx` — href `/advisor`, label "Advisor"
- [ ] Update `src/components/PortfolioSwitcher.tsx` — 3x `/build` → `/portfolios`
- [ ] Update `src/app/(dashboard)/trade/page.tsx` — CTA href + copy
- [ ] Create `src/app/api/portfolio/[id]/route.ts` (PATCH + DELETE)
- [ ] Create `src/components/PortfolioActions.tsx`
- [ ] Update `src/app/(dashboard)/portfolios/page.tsx` — add `<PortfolioActions>` per card
- [ ] Create `src/components/MobileNav.tsx`
- [ ] Update `src/app/(dashboard)/layout.tsx` — remove BottomNav, add MobileNav to header, fix pb-20
- [ ] Delete `src/components/BottomNav.tsx`
- [ ] (Optional) Add `/build` → `/advisor` redirect in `next.config.js`
- [ ] Smoke test: mobile hamburger opens/closes sheet, all links work, active state correct
- [ ] Smoke test: rename portfolio — success, error states
- [ ] Smoke test: adjust cash — success, negative rejected
- [ ] Smoke test: delete with holdings (warning shown), without holdings, last portfolio
- [ ] Smoke test: `/advisor` route renders correctly
- [ ] Smoke test: sidebar shows "Advisor" link, active on `/advisor`
- [ ] Smoke test: PortfolioSwitcher "New Portfolio" → `/portfolios`

# Spec: Global Portfolio Picker in Nav Bar

## Goal
Move the portfolio picker from the dashboard page into the global mobile header so it's accessible from anywhere in the app. The active portfolio should feel like a global workspace context, not a page-level control.

## Current State
- `PortfolioSwitcher` is a `<Select>` only on the dashboard page, driven by `?portfolio=` URL param
- `ActivePortfolioContext` exists in the layout (localStorage-based) but is not connected to the switcher
- Mobile header: `[PaperTrader logo + text] → [user avatar] [hamburger]`

## Design

### Mobile Header — Three Zones
```
[PT icon only]   [Portfolio Name ▾]   [👤 ☰]
```
- Logo shrinks to icon-only on mobile (keep the `TrendingUp` icon + emerald bg, drop "PaperTrader" text — it's visible enough in the pill area)
- Center: `PortfolioPill` — tappable pill showing active portfolio name + ChevronDown icon
- Right: user avatar + MobileNav hamburger (unchanged)

### PortfolioPill Interaction
- **Single portfolio**: show name as static pill (no chevron). Tap → navigate to `/portfolios` to create another
- **Multiple portfolios**: show active name + ChevronDown. Tap → bottom sheet with portfolio list
- Bottom sheet uses shadcn `<Sheet side="bottom">` (already in the stack)
- Sheet contents: radio-style list of portfolios, active one checked/highlighted, "＋ New Portfolio" item at bottom that navigates to `/portfolios`
- Selecting a portfolio: closes sheet, updates context, updates URL if on dashboard

### State Management — Hybrid Approach
The dashboard page is a server component reading `searchParams.portfolio`, so pure client-side context isn't enough. Use a **cookie + context** approach:

1. **Cookie** (`active_portfolio_id`): written by `PortfolioPill` on selection, readable server-side
2. **URL param** (`?portfolio=`): `PortfolioPill` navigates with `router.push(?portfolio=id)` when currently on `/dashboard`; other pages don't need it
3. **`ActivePortfolioContext`**: client-side state driven by cookie/localStorage — use cookie as source of truth over localStorage

#### Priority order for resolving active portfolio (dashboard server component):
1. `searchParams.portfolio` (explicit URL param)
2. Cookie `active_portfolio_id`
3. `isDefault` portfolio
4. First portfolio

#### `ActivePortfolioContext` changes:
- On hydration: read from cookie first (via `document.cookie`), fall back to localStorage
- On `setActivePortfolioId`: write to both cookie and localStorage

## File Changes

### `src/components/PortfolioPill.tsx` (NEW)
```
"use client"

Props:
  portfolios: { id: string; name: string }[]

Behavior:
- useActivePortfolio() for current selection
- usePathname() to detect if on /dashboard
- useRouter() for navigation
- Single portfolio: pill button → router.push('/portfolios')
- Multiple portfolios: pill button → open bottom Sheet
- Sheet: list of portfolios with checkmark on active, + New Portfolio at bottom
- On select: setActivePortfolioId(id), set cookie, if on /dashboard → router.push(`?portfolio=${id}`)
```

Styling: pill shape, `bg-white/5 border border-glass-border rounded-full px-3 py-1 text-sm text-slate-200 flex items-center gap-1.5`, ChevronDown icon h-3 w-3

### `src/app/(dashboard)/layout.tsx` (MODIFY)
- Add `PortfolioPill` import
- Mobile header: replace current `<Link href="/dashboard">` logo block with icon-only version, insert `<PortfolioPill portfolios={userPortfolios.map(p => ({ id: p.id, name: p.name }))} />` in center
- `userPortfolios` is already fetched in the layout — pass it to PortfolioPill

### `src/contexts/ActivePortfolioContext.tsx` (MODIFY)
- On hydration (`useEffect`): check `document.cookie` for `active_portfolio_id` first, then localStorage
- In `setActivePortfolioId`: also write `document.cookie = \`active_portfolio_id=${id}; path=/; max-age=31536000\``

### `src/app/(dashboard)/dashboard/page.tsx` (MODIFY)
- Add cookie reading: `import { cookies } from 'next/headers'`
- Portfolio resolution: check searchParams first, then cookie, then isDefault, then first
- Remove `<PortfolioSwitcher>` import and usage (the header pill replaces it)
- Keep the page-level portfolio name display (the `<p>` showing portfolio.name) — just remove the switcher beneath it

### `src/components/PortfolioSwitcher.tsx` (KEEP for now)
- Keep the file — it may be used in the desktop Sidebar. Check `Sidebar.tsx` and only delete if unused.

## Desktop (Sidebar)
- The desktop layout uses `<Sidebar>` — check if `PortfolioSwitcher` is used there
- If not, add portfolio picker to the Sidebar as well (same context-driven approach, can use a `<Select>` since there's more space)
- If it is, just ensure it reads from `ActivePortfolioContext` instead of URL param

## Tests
- `__tests__/components/PortfolioPill.test.tsx`: render with 0/1/multiple portfolios, test sheet open/close, test selection calls setActivePortfolioId + router.push
- Update `ActivePortfolioContext` tests to cover cookie read/write
- Update dashboard page tests to cover cookie-based portfolio resolution

## Definition of Done
- [ ] PortfolioPill renders in mobile header on all dashboard routes
- [ ] Single portfolio shows name only (no chevron), tapping goes to /portfolios
- [ ] Multiple portfolios show name + chevron, tapping opens bottom sheet
- [ ] Selecting in sheet updates active portfolio globally (context + cookie)
- [ ] Navigating to /dashboard after switching shows correct portfolio (SSR via cookie)
- [ ] Desktop Sidebar still works
- [ ] Dashboard page no longer shows standalone PortfolioSwitcher
- [ ] All tests pass

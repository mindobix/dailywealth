# CLAUDE.md — DailyWealth

Project context and working rules for Claude Code sessions.

## What this project is

DailyWealth is a **local-first, single-page portfolio tracker** built with vanilla HTML/CSS/JS and IndexedDB. No build step, no server, no frameworks. Open `index.html` directly in a browser.

## How to run

```bash
npx serve .
# or
python3 -m http.server 8080
```

## Commit / push rules

- **Never commit or push automatically.** Only commit when the user explicitly asks.
- When committing, always add `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` to the commit message.

## Code style

- Vanilla JS only — no TypeScript, no frameworks, no npm packages.
- No comments unless the WHY is genuinely non-obvious (a hidden constraint, a workaround, a subtle invariant).
- No docstrings or multi-line comment blocks.
- No extra error handling for scenarios that can't happen — trust internal guarantees.
- Don't introduce abstractions beyond what the task requires.

## Architecture rules

- **All data in IndexedDB** via `db.js` primitives (`dbGet`, `dbGetAll`, `dbPut`, `dbDelete`, `dbPutBatch`).
- **`storage.js`** wraps `db.js` with named per-store functions — use these, not raw `dbGet`/`dbPut` calls where a named wrapper exists.
- **Multi-client** — every store record has a `clientId` field. Always filter by `getActiveClientId()` when reading data for display.
- **`importTypes` are global** — CSV column schemas are shared across clients; per-client visibility is enforced at render time via the `accounts` store.

## IndexedDB stores (version 9)

| Store | Key shape | Notes |
|---|---|---|
| `investments` | `inv_<date>` or `inv_<date>_<clientId>` | Also used by Kids tab |
| `plans529` | `529_<date>` or `529_<date>_<clientId>` | Multi-client clash uses `_<clientId>` suffix |
| `kids` | uid | Kids portfolio snapshots |
| `importHistory` | uid | One record per import run |
| `clients` | uid | Client profiles |
| `importTypes` | uid | Global CSV column schemas |
| `accounts` | uid | Per-client account metadata |
| `computedFields` | uid | Per-client computed column defs |
| `csvImportTypes` | uid | CSV import type configs |
| `csvRecords` | uid | Raw imported CSV rows |
| `accountingEntries` | uid | Deposits, RMDs, withdrawals, cash, borrowed, repayment — all in one store, split by `type` field |
| `riskAssets` | uid | Stock/option trades with embedded `legs[]` array |

**All 12 stores are included in backup/restore** (`app.js → backupData / restoreData`).

## Key modules

### `grid.js` — shared inline editing
- `startCellEdit(td)` — activates an inline editor on a grid cell
- `_saveCellChange(storeName, recId, field, newVal, type)` — persists the change
- Date edits rename the record ID (`inv_<date>` / `529_<date>`). Clash detection is **client-scoped** — a clash against a different client's record is allowed and resolved by appending `_<clientId>` to the new ID.
- Shared by Investments, 529 Plans, and Kids grids.

### `risk-assets.js` — risk asset trade journal
- `_raCalc(t)` — computes all P&L fields from a trade record: `openQty`, `avgCost`, `avgSell`, `openCostBasis`, `realizedPnl`, `currentValue` (requires `t.lastPrice`), `unrealizedPnl`, `totalGainLoss`
- Options multiplier: `mult = t.type === 'option' ? 100 : 1`
- `_RA_COLS = 11` — master table colspan constant
- `_acktgAccountOptions(selectedId)` — generates `<option>` HTML with optional pre-selection; used for account dropdowns in both accounting entries and risk asset trade forms

### `dashboard.js` — dashboard rendering
- `_buildRiskAssetsWidget()` — self-contained Risk Asset Book widget; uses `_dashRaCalc()` (mirrors `_raCalc`) so it doesn't depend on `risk-assets.js` state
- Dashboard layout order: hero+stats row → risk asset book → portfolio chart → allocation/yearly → breakdown/monthly
- Stat cards and Profit Matrix are co-located in `.dash-top-right` (flex column, right side of hero row)
- `_dashBorrowedByAccount` — net per-account borrowed adjustment; processes both `_dashBorrowedEntries` and `_dashRepaymentEntries` with identical sign logic (fromAccount += amt, toAccount -= amt). Repayments reverse the direction of the original borrow, so the net naturally cancels when fully repaid
- Borrowed stat card pills show **net outstanding** per lender account and are hidden when net ≤ 0

### `accounting.js`
- `_acktgAccountOptions(selectedId)` — accepts optional `selectedId` to pre-select the account dropdown when editing an existing entry
- All accounting types (`deposit`, `rmd`, `withdrawal`, `cash`, `borrowed`, `repayment`) share the `accountingEntries` store
- Borrowed section renders two sub-tables: borrowed entries (red amounts) and repayment entries (green amounts), with a net Outstanding footer row
- `_dashBorrowedByAccount` in `dashboard.js` processes repayment entries with the same sign logic as borrowed entries, so all dashboard widgets automatically reflect net outstanding without extra code

### `app.js` — backup / restore
- `backupData()` — reads all 12 stores, downloads JSON
- `restoreData()` — merges backup JSON; store list must be kept in sync with `db.js` whenever a new store is added

## CSS design tokens (defined in `base.css`)

| Token | Usage |
|---|---|
| `var(--canvas)` | Page background |
| `var(--canvas-raised)` | White card background |
| `var(--canvas-sunk)` | Slightly grey inset surfaces |
| `var(--rule)` | Light border color |
| `var(--rule-strong)` | Stronger border |
| `var(--ink)` | Primary text |
| `var(--ink-soft)` | Secondary text |
| `var(--ink-muted)` | Tertiary text |
| `var(--ink-faint)` | Placeholder / disabled |
| `var(--ok)` | Green (positive values) |
| `var(--bad)` | Red (negative values) |
| `var(--accent)` | Brand blue |
| `var(--font-sans)` | UI font |
| `var(--font-serif)` | Display / hero numbers |
| `var(--font-mono)` | Financial figures |
| `var(--shadow-card)` | Standard card box shadow |
| `var(--shadow-float)` | Elevated shadow (tooltips) |

## Dashboard layout CSS

- `.dash-top-row` — `grid: 300px 1fr`, `align-items: start`
- `.dash-top-right` — `flex-direction: column`, `gap: 16px` — wraps stat cards + profit matrix
- `.dash-stat-cards` — white card container (`var(--canvas-raised)`, border, shadow, padding 20px 24px), inner grid `repeat(auto-fill, minmax(160px, 1fr))`
- `.dash-stat-card` — inner tile, `var(--canvas)` background, 8px radius, no shadow
- `.dash-ra-*` — Risk Asset Book widget classes in `dashboard.css`

## Things to watch out for

- When adding a new IndexedDB store: update `db.js` (store list + version bump), `app.js` (backup + restore arrays), and `README.md`.
- `_RA_COLS` in `risk-assets.js` must match the actual number of `<th>` columns in the master table; tfoot colspans must also sum to `_RA_COLS`.
- `kids` records live in the `investments` store filtered by kids account — do not confuse with the `kids` store (which is a separate snapshot store).
- The `accounts` store has a `prepopulation` localStorage flag per client (`dw-accts-prepop-<clientId>`). If clearing or restoring accounts data, also clear these flags (see `app.js → restoreData`).

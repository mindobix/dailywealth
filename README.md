# DailyWealth

A local-first personal portfolio tracker that runs entirely in the browser. No server, no accounts, no data leaves your device. All data is stored in IndexedDB.

## Running the App

Open `index.html` directly in a browser, or serve the folder with any static file server:

```bash
npx serve .
# or
python3 -m http.server 8080
```

## Architecture

- **Vanilla HTML/CSS/JS** — no build step, no frameworks, no dependencies
- **IndexedDB** — all data stored locally via `db.js` (version 9)
- **Multi-client** — full data isolation per client/portfolio

## File Structure

```
index.html          — App shell, nav, all view containers, modals
js/
  db.js             — IndexedDB open/read/write/delete primitives
  storage.js        — Named wrappers around db.js for each store
  app.js            — Init, view routing, backup/restore
  clients.js        — Client management, active client state
  accounts.js       — Account & computed field management, column ordering
  investments.js    — Investments grid, True P&L column
  529plans.js       — 529 Plans grid
  accounting.js     — Accounting entries (deposits, RMDs, withdrawals, cash, borrowed)
  risk-assets.js    — Risk asset trades (stocks & options) with P&L calculations
  dashboard.js      — Dashboard: charts, widgets, profit matrix, risk asset book
  computed.js       — Computed column definitions
  grid.js           — Shared grid rendering, inline editing, date-clash detection
  importcsv.js      — CSV import flow
  kids.js           — Kids accounts view
css/
  base.css          — Design tokens (colors, fonts, spacing)
  styles.css        — Global layout
  header.css        — Nav bar, client selector
  dashboard.css     — Dashboard widgets
  accounts.css      — Accounts & computed tab
  accounting.css    — Accounting tab (including Risk Assets master table)
  clients.css       — Clients view
  grid.css          — Shared grid styles
  computed.css      — Computed fields modal
  importcsv.css     — CSV import view
```

## IndexedDB Stores

| Store | Purpose |
|---|---|
| `investments` | Weekly/daily portfolio snapshots per client (also used by Kids tab) |
| `plans529` | 529 plan snapshots per client |
| `kids` | Kids portfolio snapshots per client |
| `importHistory` | Record of each CSV import run |
| `clients` | Client profiles (name, color) |
| `importTypes` | CSV column definitions per format |
| `accounts` | Account metadata per client (name, field key, order, visibility) |
| `computedFields` | Computed column definitions per client |
| `csvImportTypes` | CSV import type configurations |
| `csvRecords` | Raw imported CSV records |
| `accountingEntries` | Deposits, RMDs, withdrawals, cash, and borrowed entries per client |
| `riskAssets` | Risk asset trades (stocks & options) with embedded legs per client |

All stores are included in backup and restore.

## Views

### Dashboard

Layout (top to bottom):
1. **Hero card** (left) + **right column** (stat cards + Profit Matrix stacked)
2. **Risk Asset Book widget** — full-width
3. **Portfolio chart**
4. **Asset Allocation | Yearly Gain/Loss** (side by side)
5. **Account Breakdown | Monthly Performance** (side by side)

**Hero card** — latest total portfolio value, week-over-week delta, sub-totals breakdown (investments, 529, kids, grand total).

**Stat cards** — Weekly G/L, YTD G/L, 1-Year Return, True Return (when accounting data exists) — grouped inside a shared white card container matching the hero card style.

**Profit Matrix** — 4-period P&L cards (Last 2 Months, 1 Month, 2 Weeks, 1 Week) — sits directly below the stat cards in the right column.

**Risk Asset Book widget** — full-width panel:
- KPI strip (6 tiles): Open Positions, Capital Deployed, Current Value, Unrealized G/L, Realized P&L, Total G/L
- Positions table (up to 10 rows): Position, Type, Account, Open Qty, Last Price, Current Value, Unrealized G/L, Realized P&L, Total G/L, Status
- Total G/L by Symbol bar chart panel (right side)

**Portfolio chart** — line chart with range selector (1M / 3M / YTD / 1Y / 3Y / ALL) and hover tooltip.

**Asset Allocation** — Total Inv. Value → Risk Assets / Cash split with per-account cash breakdown.

**Yearly Gain / Loss** — P&L summed by year with Grand Total.

**Account Breakdown** — horizontal bar chart per account by latest value.

**Monthly Performance** — bar chart of gain/loss per month (last 12 months).

### Investments
- Sortable, paginated grid of all investment records for the active client
- Per-client column isolation
- **True P&L column** — cumulative gain/loss adjusted for deposits, RMDs, and withdrawals up to each row's date

### 529 Plans
- Sortable, paginated grid of 529 plan snapshots per client
- Inline cell editing with per-client date clash detection

### Kids
- Filtered view of investment records tagged to kids accounts

### Accounting

- **Deposits / RMDs / Withdrawals / Borrowed** — 2-column grid per section, inline add/edit/delete
- **Cash** — per-account cash balances with auto-timestamped "Last Updated"; supports negative amounts
- **Net Summary** — totals for Deposits, RMDs, Withdrawals, Borrowed, and Total Cash
- **Risk Assets** — Fidelity-style master table for stock and options trades (see below)

### Risk Assets (Accounting tab)

Full trade journal for risk assets — stocks and options — per client.

**Trade record fields:** Symbol, Type (stock / option), Account, Option details (Call/Put, strike, expiry), Last Price, Notes.

**Trade legs:** each trade has one or more buy/sell legs (date, action, qty, price, commission, fees).

**Computed per trade** (`_raCalc`):

| Field | Formula |
|---|---|
| Open Qty | buyQty − sellQty |
| Avg Cost | buyValue / buyQty |
| Avg Sell | sellValue / sellQty |
| Open Cost Basis | avgCost × openQty × mult |
| Realized P&L | (avgSell − avgCost) × sellQty × mult − commissions/fees |
| Current Value | lastPrice × openQty × mult |
| Unrealized G/L | currentValue − openCostBasis |
| Total G/L | realizedP&L + unrealizedG/L |

`mult = 100` for options, `1` for stocks.

**Master table:** 11 columns — Symbol, Type, Account, Last Price, Open Qty, Avg Cost, Current Value, Unrealized G/L, Realized P&L, Total G/L, Actions. Totals footer sums all money columns.

Each row expands to a legs detail table and summary strip. Account dropdown pre-selects the saved account when editing.

### Accounts
- Account and computed field management per client
- Drag-to-reorder (controls column order in investment/529 grids)
- Show/hide individual accounts
- Adding a new account auto-generates a camelCase field key and injects the column into matching CSV import formats

### Import CSV
- Upload CSV files mapped to investment or 529 format definitions
- Supports multiple import types per client

### Clients
- Create and manage multiple portfolios
- Switching clients re-scopes all views to that client

## Backup & Restore

Use the **Data** menu in the nav bar to:
- **Backup** — downloads a JSON file containing all 12 IndexedDB stores
- **Restore** — merges a backup JSON into the current database (backup entries win on conflicts), then reloads

Stores covered: `investments`, `plans529`, `kids`, `importHistory`, `clients`, `importTypes`, `accounts`, `computedFields`, `csvImportTypes`, `csvRecords`, `accountingEntries`, `riskAssets`

## Key Design Decisions

- **importTypes are global** — CSV column schemas are shared across clients. Per-client visibility is enforced at render time via the `accounts` store.
- **True P&L is cumulative** — each investment row's True P&L sums only the accounting entries dated on or before that row's date.
- **Cash entries are standalone** — cash balances in the Accounting tab are independent records (not derived from investment data). They feed the Asset Allocation dashboard widget.
- **No spinners on currency inputs** — amount fields use `type="text"` with `inputmode="decimal"` to avoid browser spin buttons.
- **Risk asset multiplier** — all dollar calculations for options use `qty × 100 × price` to reflect the standard 100-share-per-contract convention.
- **Last Price is manual** — no live data feed; the user enters the current market price per trade to enable unrealized P&L calculations.
- **Dashboard Risk Asset Book is self-contained** — `_dashRaCalc()` in `dashboard.js` mirrors `_raCalc()` from `risk-assets.js` so the dashboard does not depend on the accounting module's internal state.
- **Multi-client date clash detection** — when a date cell is edited in the investments or 529 grids, `grid.js` checks for an ID clash scoped to the same client only. A clash against a different client's record is allowed and resolved by appending the clientId to the new record's ID.
- **Accounting entry types** — all accounting entries (deposits, RMDs, withdrawals, cash, borrowed) live in the single `accountingEntries` store, distinguished by a `type` field.

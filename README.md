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
- **IndexedDB** — all data stored locally via `db.js`
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
  accounting.js     — Accounting entries (deposits, RMDs, withdrawals, cash)
  risk-assets.js    — Risk asset trades (stocks & options) with P&L calculations
  dashboard.js      — Dashboard: charts, widgets, profit matrix, risk asset book
  computed.js       — Computed column definitions
  grid.js           — Shared grid rendering utilities
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
| `investments` | Weekly/daily portfolio snapshots per client |
| `plans529` | 529 plan snapshots per client |
| `importHistory` | Record of each CSV import run |
| `clients` | Client profiles (name, color) |
| `importTypes` | CSV column definitions per format |
| `accounts` | Account metadata per client (name, field key, order, visibility) |
| `computedFields` | Computed column definitions per client |
| `csvImportTypes` | CSV import type configurations |
| `csvRecords` | Raw imported CSV records |
| `accountingEntries` | Deposits, RMDs, withdrawals, and cash entries per client |
| `riskAssets` | Risk asset trades (stocks & options) with embedded legs per client |

## Views

### Dashboard
- **Hero card** — latest total portfolio value with week-over-week delta
- **Stat cards** — Weekly G/L, YTD G/L, 1-Year Return, True Return (when accounting data exists), 529 Total — grouped inside a shared white card container
- **Risk Asset Book widget** — full-width panel between stat cards and portfolio chart:
  - KPI strip (6 tiles): Open Positions, Capital Deployed, Current Value, Unrealized G/L, Realized P&L, Total G/L
  - Positions table (up to 10 rows): Position, Type, Account, Open Qty, Last Price, Current Value, Unrealized G/L, Realized P&L, Total G/L, Status
  - Total G/L by Symbol bar chart panel
- **Portfolio chart** — line chart with range selector (1M / 3M / YTD / 1Y / 3Y / ALL) and hover tooltip
- **Asset Allocation** — Total Inv. Value → Risk Assets / Cash split with per-account cash breakdown
- **Yearly Gain / Loss** — P&L summed by year with Grand Total
- **Account Breakdown** — horizontal bar chart per account by latest value
- **Monthly Performance** — bar chart of gain/loss per month (last 12 months)
- **Profit Matrix** — 4-period P&L cards: Last 2 Months, 1 Month, 2 Weeks, 1 Week

### Investments
- Sortable grid of all investment records for the active client
- Per-client column isolation
- **True P&L column** — cumulative gain/loss adjusted for deposits, RMDs, and withdrawals up to each row's date

### 529 Plans
- Sortable grid of 529 plan records

### Accounting
- **Deposits / RMDs / Withdrawals** — 2-column grid, each section with inline add/edit/delete
- **Cash** — per-account cash balances with auto-timestamped "Last Updated"; supports negative amounts
- **Net Summary** — Totals for Deposits, RMDs, Withdrawals, and Total Cash
- **Risk Assets** — Fidelity-style master table for stock and options trades (see below)

### Risk Assets (Accounting tab)

Full trade journal for risk assets — stocks and options — per client.

**Trade record fields:**
- Symbol, Type (stock / option), Account
- Option details: contract type (Call/Put), strike, expiry
- **Last Price** — manually entered current market price; drives Current Value and Unrealized G/L
- Notes

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

`mult = 100` for options (per-contract), `1` for stocks.

**Master table columns:** Symbol, Type, Account, Last Price, Open Qty, Avg Cost, Current Value, Unrealized G/L, Realized P&L, Total G/L, Actions

**Totals footer** sums Current Value, Unrealized G/L, Realized P&L, and Total G/L across all trades.

Each row expands to show the legs detail table and a summary strip. Inline form supports add/edit/delete for both trades and individual legs. Account dropdown pre-selects the previously saved account when editing.

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
- **Backup** — downloads a JSON file containing all IndexedDB stores
- **Restore** — merges a backup JSON into the current database (backup entries win on conflicts), then reloads

All stores are included in backup/restore:
`investments`, `plans529`, `importHistory`, `clients`, `importTypes`, `accounts`, `computedFields`, `csvImportTypes`, `csvRecords`, `accountingEntries`, `riskAssets`

## Key Design Decisions

- **importTypes are global** — CSV column schemas are shared across clients. Per-client visibility is enforced at render time via the `accounts` store.
- **True P&L is cumulative** — each investment row's True P&L sums only the accounting entries dated on or before that row's date.
- **Cash entries are standalone** — cash balances in the Accounting tab are independent records (not derived from investment data). They feed the Asset Allocation dashboard widget.
- **No spinners on currency inputs** — amount fields use `type="text"` with `inputmode="decimal"` to avoid browser spin buttons.
- **Risk asset multiplier** — all dollar calculations for options use `qty × 100 × price` to reflect the standard 100-share-per-contract convention.
- **Last Price is manual** — no live data feed; the user enters the current market price per trade to enable unrealized P&L calculations.
- **Dashboard Risk Asset Book is self-contained** — `_dashRaCalc()` in `dashboard.js` mirrors `_raCalc()` from `risk-assets.js` so the dashboard does not depend on the accounting module's internal state.

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
- **IndexedDB** — all data stored locally via `db.js` (version 7)
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
  dashboard.js      — Dashboard: charts, widgets, profit matrix
  computed.js       — Computed column definitions
  grid.js           — Shared grid rendering utilities
  importcsv.js      — CSV import flow
css/
  base.css          — Design tokens (colors, fonts, spacing)
  styles.css        — Global layout
  header.css        — Nav bar, client selector
  dashboard.css     — Dashboard widgets
  accounts.css      — Accounts & computed tab
  accounting.css    — Accounting tab
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

## Views

### Dashboard
- **Hero card** — latest total portfolio value with week-over-week delta
- **Stat cards** — Weekly G/L, YTD G/L, 1-Year Return, True Return (when accounting data exists), 529 Total
- **Portfolio chart** — line chart with range selector (1M / 3M / YTD / 1Y / 3Y / ALL) and hover tooltip
- **Asset Allocation** — Total Inv. Value → Risk Assets / Cash split with per-account cash breakdown (whole-dollar amounts, 2-decimal percentages)
- **Yearly Gain / Loss** — P&L summed by year with Grand Total
- **Account Breakdown** — horizontal bar chart per account by latest value
- **Monthly Performance** — bar chart of gain/loss per month (last 12 months)
- **Profit Matrix** — 4-period P&L cards: Last 2 Months, 1 Month, 2 Weeks, 1 Week

### Investments
- Sortable grid of all investment records for the active client
- Per-client column isolation — accounts added for one client don't appear in another's grid
- **True P&L column** — cumulative gain/loss adjusted for deposits, RMDs, and withdrawals up to each row's date (shown only when accounting entries exist)

### 529 Plans
- Sortable grid of 529 plan records

### Accounting
- **Deposits / RMDs / Withdrawals** — 2-column grid, each section with inline add/edit/delete
- **Cash** — per-account cash balances with auto-timestamped "Last Updated"; supports negative amounts
- **Net Summary** — Totals for Deposits, RMDs, Withdrawals, and Total Cash

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
- Switching clients re-scopes all views (investments, accounting, accounts, dashboard) to that client

## Backup & Restore

Use the **Data** menu in the nav bar to:
- **Backup** — downloads a JSON file containing all 10 IndexedDB stores
- **Restore** — merges a backup JSON into the current database (backup entries win on conflicts), then reloads

All stores are included in backup/restore:
`investments`, `plans529`, `importHistory`, `clients`, `importTypes`, `accounts`, `computedFields`, `csvImportTypes`, `csvRecords`, `accountingEntries`

## Key Design Decisions

- **importTypes are global** — CSV column schemas are shared across clients. Per-client visibility is enforced at render time via the `accounts` store (only columns with a matching account for the active client are shown).
- **True P&L is cumulative** — each investment row's True P&L sums only the accounting entries dated on or before that row's date, not all-time totals.
- **Cash entries are standalone** — cash balances in the Accounting tab are independent records (not derived from investment data). They feed the Asset Allocation dashboard widget.
- **No spinners on currency inputs** — amount fields use `type="text"` with `inputmode="decimal"` to avoid browser spin buttons.

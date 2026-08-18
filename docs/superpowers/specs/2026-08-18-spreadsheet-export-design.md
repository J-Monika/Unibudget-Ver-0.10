# Spreadsheet Export (CSV) Design Spec

## 1. Overview & Goals
UniBudget users need an effortless way to export their financial data from the app into spreadsheets (Microsoft Excel, Google Sheets, Apple Numbers, LibreOffice Calc) for budgeting, monthly analysis, expense reporting, and long-term record-keeping.

This feature adds a context-aware **Spreadsheet Export (CSV)** engine to UniBudget with seamless triggers in both the **Recent Transactions card header** and the **User Avatar Menu**.

---

## 2. Core Decisions & Requirements

1. **File Format**:
   - RFC 4180-compliant **CSV (`.csv`)** with **UTF-8 Byte Order Mark (`\uFEFF`)** prefix.
   - The UTF-8 BOM ensures that Microsoft Excel on Windows and macOS automatically detects UTF-8 encoding without mangling currency symbols (e.g. `₱`), accents, or notes.

2. **Data Scope & Columns**:
   - Tabular transaction history with 12 structured columns:
     1. `Date` (`YYYY-MM-DD`)
     2. `Time` (`HH:mm:ss`)
     3. `Description`
     4. `Type` (`Expense`, `Income`, `Transfer`, `Adjustment`)
     5. `Category` (e.g. `Food & Dining`, `Rent & Utilities`, etc.)
     6. `Account / Wallet` (Human-readable name, e.g. `GCash`, `Cash`, `GoTyme`, `Maya`)
     7. `To Account` (Destination wallet name for transfers, or empty)
     8. `Amount` (Signed numerical value: negative `-` for expenses, positive `+` for income, making `=SUM()` calculations effortless in spreadsheets)
     9. `Currency` (e.g. `PHP`, `USD`)
     10. `Fee` (Transfer fee amount if applicable)
     11. `Source / Notes` (e.g. `gcash-auto`, transfer note, or manual entry)
     12. `Transaction ID` (Unique ID for reconciliation or deduplication)

3. **Context-Aware Filtering**:
   - If UI filters are active (e.g. filtered by Wallet carousel, Date chip, Search query, or Transaction type), only the matching visible transactions are exported.
   - If no filters are active, all transactions are exported.
   - Filenames adapt intelligently:
     - All transactions: `unibudget-transactions-YYYY-MM-DD.csv`
     - Wallet filtered: `unibudget-gcash-YYYY-MM-DD.csv`
     - Custom filtered: `unibudget-filtered-YYYY-MM-DD.csv`

4. **UI Triggers**:
   - **Recent Transactions Section Header**: An `📥 Export` action placed beside `🔄 Sync` and `Clear All` for fast access right above the transaction list and filters.
   - **User Menu (Avatar Dropdown)**: An `📥 Export to Spreadsheet (CSV)` item in `#menuPop`.

5. **Download & Mobile Sharing Flow**:
   - Direct client-side `Blob` download trigger (`<a download="...">`) supported in modern browsers and Android WebViews.
   - Fallback / support for Web Share API (`navigator.share` with file) on compatible mobile devices.
   - Visual feedback via UniBudget toast: `"📥 Exported X transactions to <filename>"`. If no transactions match, toasts `"No transactions to export"`.

---

## 3. Architecture & Components

```
+-------------------------------------------------------------+
|                     User Interaction                        |
|  - Transactions Header: [📥 Export]                         |
|  - User Menu Popover:   [📥 Export to Spreadsheet (CSV)]    |
+------------------------------+------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|                   Export Orchestration                      |
|  - Gets active filtered txns (or all txns from state)       |
|  - Determines smart filename                                |
|  - Resolves walletId -> Wallet Names                        |
+------------------------------+------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|               Export Engine (`export-engine.js`)            |
|  - `formatCsvValue(val)` (RFC 4180 quote escaping)          |
|  - `generateTransactionsCsv(txns, wallets, currency)`       |
|  - `generateExportFilename(filterInfo)`                     |
|  - `triggerCsvDownload(csvString, filename)`                |
+------------------------------+------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|            File Delivery & User Notification                |
|  - Blob download / Web Share API                            |
|  - Toast confirmation: "Exported 24 transactions"           |
+-------------------------------------------------------------+
```

### 3.1 Modular File Structure
* **`www/export-engine.js`**:
  Pure functional module exposing `ExportEngine` (works in browser window and Node.js `module.exports` for tests):
  - `escapeCsvField(field)`: Handles quotes, commas, newlines.
  - `formatDate(timestamp)` / `formatTime(timestamp)`: Local time ISO string helpers.
  - `generateTransactionsCsv(txns, wallets, defaultCurrency)`: Generates BOM + Header + CSV rows.
  - `generateExportFilename(options)`: Computes appropriate file name with timestamp and filter context.
  - `downloadCsv(csvContent, filename)`: Browser Blob download and Web Share execution.
* **`www/index.html`**:
  - Adds `<script src="export-engine.js"></script>`
  - Adds `📥 Export` link in `.txns-card .sec-head`
  - Adds `📥 Export to Spreadsheet (CSV)` in `.menu-pop`
  - Wires event listeners and toast feedback.
* **`tests/export-engine.test.js`**:
  - Comprehensive unit test suite covering escaping, signed amounts, missing wallet fallbacks, UTF-8 BOM, empty datasets, and date formatting.

---

## 4. CSV Schema Specification

### Headers:
```csv
Date,Time,Description,Type,Category,Account,To Account,Amount,Currency,Fee,Source / Notes,Transaction ID
```

### Sample Row Output:
```csv
2026-08-18,10:15:00,Jollibee Food,Expense,Food & Dining,GCash,, -547.00,PHP,0.00,gcash-auto,m-abc123
2026-08-18,09:00:00,Monthly Allowance,Income,Allowance & Aid,GoTyme,,3200.00,PHP,0.00,manual,m-def456
2026-08-18,08:30:00,Cash-in from GoTyme,Transfer,Transfer,GoTyme,GCash,-500.00,PHP,15.00,Allowance cash-in,m-ghi789
```

---

## 5. Verification Plan

### 5.1 Automated Unit Tests
Run via `npm test` (`node --test tests/*.test.js`):
- `tests/export-engine.test.js`:
  - Verify UTF-8 BOM is prepended.
  - Verify header columns match specification.
  - Verify special characters (commas, quotes, newlines) are properly escaped.
  - Verify signed amount logic (Expense is negative, Income is positive, Fee is recorded).
  - Verify wallet ID is converted to wallet display name (e.g. `w-gcash` -> `GCash`).
  - Verify filename generation based on filter context and date.

### 5.2 Integration & Existing Tests
- Run all existing test suites (`tests/wallet-engine.test.js`, `tests/wallet-full-integration.test.js`, `tests/transaction-filter.test.js`) to ensure zero regressions.

### 5.3 Manual Verification
- Open `www/index.html` in browser.
- Seed/add multiple transactions across different wallets (GCash, Cash, Maya, GoTyme).
- Click `📥 Export` in Recent Transactions header -> verify `.csv` downloads, open in Excel/Google Sheets, verify formatting and currency characters.
- Filter by "GCash" and "This Month", click `📥 Export` -> verify only matching GCash transactions are exported with filtered filename.
- Click `📥 Export to Spreadsheet (CSV)` in User Avatar popover menu -> verify download works seamlessly.

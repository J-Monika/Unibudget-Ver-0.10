# Spreadsheet Export (CSV) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a context-aware Spreadsheet Export (CSV) feature to UniBudget allowing users to export transaction data into Excel/Google Sheets from the Recent Transactions card and Avatar Menu.

**Architecture:** Pure modular `ExportEngine` in `www/export-engine.js` (with UMD pattern for browser and Node.js testing) that handles RFC 4180 CSV generation with UTF-8 BOM, context-aware filtering, wallet name mapping, and signed amount formatting. Integrated into `www/index.html` with fast UI triggers and toast feedback.

**Tech Stack:** Vanilla JavaScript (ES5/ES6 compatible), Capacitor/Web Share API, Node.js Test Runner (`node:test`, `node:assert/strict`).

**Spec:** [`docs/superpowers/specs/2026-08-18-spreadsheet-export-design.md`](file:///c:/Users/MRMD/git-beginners/Unibudget-Ver-0.10/docs/superpowers/specs/2026-08-18-spreadsheet-export-design.md)

## Global Constraints
- RFC 4180-compliant CSV with UTF-8 BOM (`\uFEFF`) prefix.
- 12 structured columns: `Date`, `Time`, `Description`, `Type`, `Category`, `Account`, `To Account`, `Amount`, `Currency`, `Fee`, `Source / Notes`, `Transaction ID`.
- Signed amounts: negative for expenses (`-500.00`), positive for income (`+1000.00`), transfer amount for transfers.
- Context-aware export: exports currently filtered transactions if filters (search, date, wallet, type) are active, or all transactions if no filters are active.
- Works in browser and Capacitor Android WebView with zero external heavy libraries.

---

### Task 1: Core CSV Export Engine (`www/export-engine.js` & `tests/export-engine.test.js`)

**Files:**
- Create: `www/export-engine.js`
- Test: `tests/export-engine.test.js`

**Interfaces:**
- Produces:
  - `ExportEngine.escapeCsvField(value: string | number | null): string`
  - `ExportEngine.formatDate(timestamp: number): string`
  - `ExportEngine.formatTime(timestamp: number): string`
  - `ExportEngine.getWalletName(walletId: string, wallets: Array<Wallet>): string`
  - `ExportEngine.generateTransactionsCsv(txns: Array<Transaction>, wallets: Array<Wallet>, defaultCurrency?: string): string`
  - `ExportEngine.generateExportFilename(options: { filterType?: string, walletName?: string, dateStr?: string }): string`
  - `ExportEngine.triggerCsvDownload(csvContent: string, filename: string): Promise<{ success: boolean, method: 'share' | 'download' }>`

- [ ] **Step 1: Write the unit test suite for ExportEngine**

Create `tests/export-engine.test.js` covering field escaping, date/time formatting, wallet name mapping, UTF-8 BOM presence, header columns, signed amounts, transfer handling, and filename generation.

```javascript
// tests/export-engine.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const ExportEngine = require('../www/export-engine.js');

const sampleWallets = [
  { id: 'w-cash', name: 'Cash', icon: '💵' },
  { id: 'w-gcash', name: 'GCash', icon: '💙' },
  { id: 'w-gotyme', name: 'GoTyme', icon: '🟣' }
];

const fixedTs = new Date('2026-08-18T14:30:45').getTime();

const sampleTxns = [
  {
    id: 'tx-1',
    desc: 'Jollibee "Special" Meal',
    amount: 250.5,
    type: 'expense',
    cat: 'Food & Dining',
    walletId: 'w-gcash',
    source: 'gcash-auto',
    ts: fixedTs,
    deleted: false
  },
  {
    id: 'tx-2',
    desc: 'Monthly Allowance',
    amount: 5000,
    type: 'income',
    cat: 'Allowance & Aid',
    walletId: 'w-gotyme',
    ts: fixedTs,
    deleted: false
  },
  {
    id: 'tx-3',
    desc: 'Cash-in to GCash, with note',
    amount: 1000,
    type: 'transfer',
    cat: 'Transfer',
    walletId: 'w-gotyme',
    toWalletId: 'w-gcash',
    fee: 15,
    sub: 'Allowance transfer',
    ts: fixedTs,
    deleted: false
  },
  {
    id: 'tx-4',
    desc: 'Deleted record',
    amount: 100,
    type: 'expense',
    cat: 'Other',
    walletId: 'w-cash',
    ts: fixedTs,
    deleted: true
  }
];

test('escapeCsvField escapes strings with quotes, commas, and newlines', () => {
  assert.equal(ExportEngine.escapeCsvField('Simple text'), 'Simple text');
  assert.equal(ExportEngine.escapeCsvField('Text with, comma'), '"Text with, comma"');
  assert.equal(ExportEngine.escapeCsvField('Text with "quotes"'), '"Text with ""quotes"""');
  assert.equal(ExportEngine.escapeCsvField('Line 1\nLine 2'), '"Line 1\nLine 2"');
  assert.equal(ExportEngine.escapeCsvField(null), '');
  assert.equal(ExportEngine.escapeCsvField(undefined), '');
  assert.equal(ExportEngine.escapeCsvField(123.45), '123.45');
});

test('getWalletName resolves wallet ID to display name with fallback', () => {
  assert.equal(ExportEngine.getWalletName('w-gcash', sampleWallets), 'GCash');
  assert.equal(ExportEngine.getWalletName('w-cash', sampleWallets), 'Cash');
  assert.equal(ExportEngine.getWalletName('w-unknown', sampleWallets), 'w-unknown');
  assert.equal(ExportEngine.getWalletName('', sampleWallets), '');
});

test('generateTransactionsCsv produces UTF-8 BOM, standard headers, and correctly formatted rows', () => {
  const csv = ExportEngine.generateTransactionsCsv(sampleTxns, sampleWallets, 'PHP');
  
  // Must start with UTF-8 BOM
  assert.equal(csv.startsWith('\uFEFF'), true);

  const lines = csv.slice(1).trim().split('\n');
  assert.equal(lines.length, 4); // Header + 3 active txns (tx-4 is deleted)

  // Header verification
  assert.equal(lines[0], 'Date,Time,Description,Type,Category,Account,To Account,Amount,Currency,Fee,Source / Notes,Transaction ID');

  // Row 1: Expense (negative amount, escaped description)
  assert.ok(lines[1].includes('"Jollibee ""Special"" Meal"'));
  assert.ok(lines[1].includes('Expense'));
  assert.ok(lines[1].includes('Food & Dining'));
  assert.ok(lines[1].includes('GCash'));
  assert.ok(lines[1].includes('-250.50'));
  assert.ok(lines[1].includes('PHP'));
  assert.ok(lines[1].includes('gcash-auto'));
  assert.ok(lines[1].includes('tx-1'));

  // Row 2: Income (positive amount)
  assert.ok(lines[2].includes('Monthly Allowance'));
  assert.ok(lines[2].includes('Income'));
  assert.ok(lines[2].includes('5000.00'));
  assert.ok(lines[2].includes('GoTyme'));

  // Row 3: Transfer (source & destination wallets, fee)
  assert.ok(lines[3].includes('"Cash-in to GCash, with note"'));
  assert.ok(lines[3].includes('Transfer'));
  assert.ok(lines[3].includes('GoTyme'));
  assert.ok(lines[3].includes('GCash'));
  assert.ok(lines[3].includes('-1000.00'));
  assert.ok(lines[3].includes('15.00'));
  assert.ok(lines[3].includes('Allowance transfer'));
});

test('generateExportFilename generates context-aware filenames', () => {
  const baseName = ExportEngine.generateExportFilename({ dateStr: '2026-08-18' });
  assert.equal(baseName, 'unibudget-transactions-2026-08-18.csv');

  const walletName = ExportEngine.generateExportFilename({ walletName: 'GCash', dateStr: '2026-08-18' });
  assert.equal(walletName, 'unibudget-gcash-2026-08-18.csv');

  const filteredName = ExportEngine.generateExportFilename({ isFiltered: true, dateStr: '2026-08-18' });
  assert.equal(filteredName, 'unibudget-filtered-2026-08-18.csv');
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/export-engine.test.js`
Expected: FAIL with "Cannot find module '../www/export-engine.js'"

- [ ] **Step 3: Implement `www/export-engine.js`**

```javascript
// www/export-engine.js
(function (root, factory) {
  var exp = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = exp;
  }
  if (root) {
    root.ExportEngine = exp;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function () {
  "use strict";

  var UTF8_BOM = "\uFEFF";
  var CSV_HEADERS = [
    "Date",
    "Time",
    "Description",
    "Type",
    "Category",
    "Account",
    "To Account",
    "Amount",
    "Currency",
    "Fee",
    "Source / Notes",
    "Transaction ID"
  ];

  function padZero(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function formatDate(timestamp) {
    if (!timestamp) return "";
    var d = new Date(timestamp);
    if (isNaN(d.getTime())) return "";
    return d.getFullYear() + "-" + padZero(d.getMonth() + 1) + "-" + padZero(d.getDate());
  }

  function formatTime(timestamp) {
    if (!timestamp) return "";
    var d = new Date(timestamp);
    if (isNaN(d.getTime())) return "";
    return padZero(d.getHours()) + ":" + padZero(d.getMinutes()) + ":" + padZero(d.getSeconds());
  }

  function escapeCsvField(val) {
    if (val === null || val === undefined) return "";
    var str = String(val);
    if (str.indexOf('"') !== -1 || str.indexOf(',') !== -1 || str.indexOf('\n') !== -1 || str.indexOf('\r') !== -1) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function getWalletName(walletId, wallets) {
    if (!walletId) return "";
    if (Array.isArray(wallets)) {
      for (var i = 0; i < wallets.length; i++) {
        if (wallets[i] && wallets[i].id === walletId) {
          return wallets[i].name || walletId;
        }
      }
    }
    return walletId;
  }

  function formatSignedAmount(txn) {
    var amt = Number(txn.amount) || 0;
    if (txn.type === "expense") {
      return "-" + amt.toFixed(2);
    } else if (txn.type === "income") {
      return amt.toFixed(2);
    } else if (txn.type === "transfer") {
      return "-" + amt.toFixed(2);
    } else if (txn.type === "adjustment") {
      return amt.toFixed(2);
    }
    return amt.toFixed(2);
  }

  function generateTransactionsCsv(txns, wallets, defaultCurrency) {
    var currency = defaultCurrency || "PHP";
    var rows = [CSV_HEADERS.join(",")];
    var activeList = Array.isArray(txns) ? txns.filter(function (t) { return t && !t.deleted; }) : [];

    activeList.forEach(function (t) {
      var dateStr = formatDate(t.ts);
      var timeStr = formatTime(t.ts);
      var descStr = escapeCsvField(t.desc || "");
      var typeStr = escapeCsvField(t.type ? (t.type.charAt(0).toUpperCase() + t.type.slice(1)) : "Expense");
      var catStr = escapeCsvField(t.cat || (t.type === "transfer" ? "Transfer" : "Other"));
      var fromWalletStr = escapeCsvField(getWalletName(t.walletId, wallets));
      var toWalletStr = escapeCsvField(t.type === "transfer" ? getWalletName(t.toWalletId, wallets) : "");
      var amtStr = formatSignedAmount(t);
      var feeStr = (t.fee && t.fee > 0) ? Number(t.fee).toFixed(2) : "0.00";
      var noteStr = escapeCsvField(t.sub || t.source || "");
      var idStr = escapeCsvField(t.id || "");

      var row = [
        dateStr,
        timeStr,
        descStr,
        typeStr,
        catStr,
        fromWalletStr,
        toWalletStr,
        amtStr,
        currency,
        feeStr,
        noteStr,
        idStr
      ].join(",");

      rows.push(row);
    });

    return UTF8_BOM + rows.join("\n");
  }

  function generateExportFilename(options) {
    var opts = options || {};
    var d = opts.dateStr || formatDate(Date.now());
    if (opts.walletName) {
      var cleanWallet = String(opts.walletName).toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-");
      return "unibudget-" + cleanWallet + "-" + d + ".csv";
    }
    if (opts.isFiltered) {
      return "unibudget-filtered-" + d + ".csv";
    }
    return "unibudget-transactions-" + d + ".csv";
  }

  function triggerCsvDownload(csvContent, filename) {
    return new Promise(function (resolve) {
      try {
        var blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        
        // Check if Web Share API with files is available and supported
        if (typeof navigator !== "undefined" && navigator.canShare && typeof File !== "undefined") {
          var file = new File([blob], filename, { type: "text/csv" });
          if (navigator.canShare({ files: [file] })) {
            navigator.share({
              files: [file],
              title: "UniBudget Export",
              text: "UniBudget Transactions Export"
            }).then(function () {
              resolve({ success: true, method: "share" });
            }).catch(function () {
              // User cancelled share or failed, fallback to direct download
              directDownload(blob, filename);
              resolve({ success: true, method: "download" });
            });
            return;
          }
        }

        // Direct standard blob download
        directDownload(blob, filename);
        resolve({ success: true, method: "download" });
      } catch (err) {
        resolve({ success: false, error: err });
      }
    });
  }

  function directDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);
  }

  return {
    UTF8_BOM: UTF8_BOM,
    CSV_HEADERS: CSV_HEADERS,
    formatDate: formatDate,
    formatTime: formatTime,
    escapeCsvField: escapeCsvField,
    getWalletName: getWalletName,
    generateTransactionsCsv: generateTransactionsCsv,
    generateExportFilename: generateExportFilename,
    triggerCsvDownload: triggerCsvDownload
  };
});
```

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `node --test tests/export-engine.test.js`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit changes**

```bash
git add www/export-engine.js tests/export-engine.test.js
git commit -m "feat: implement core CSV export engine with unit tests"
```

---

### Task 2: UI Integration & Event Handlers (`www/index.html`)

**Files:**
- Modify: `www/index.html`

**Interfaces:**
- Consumes: `ExportEngine` (loaded via `<script src="export-engine.js">`)
- Modifies:
  - `.txns-card .sec-head .side`: adds `<span class="link" id="exportTxns">📥 Export</span> &nbsp;`
  - `.menu-pop`: adds `<button class="menu-item" id="menuExport">📥 Export to Spreadsheet (CSV)</button>`
  - JS: adds `exportCurrentTransactions()` helper and event listeners for `#exportTxns` and `#menuExport`.

- [ ] **Step 1: Update HTML markup in `www/index.html`**

1. In `#menuPop` (around line 874), add:
```html
<button class="menu-item" id="menuExport">📥 Export to Spreadsheet (CSV)</button>
```
2. In `.txns-card .sec-head .side` (around line 932), add `📥 Export`:
```html
<span class="side"><span class="link" id="exportTxns" title="Export transactions to CSV">📥 Export</span> &nbsp; <span class="link" id="syncNow">🔄 Sync</span> &nbsp; <span class="link" id="clearAll" style="color:var(--spent)">Clear All</span></span>
```
3. In script imports (around line 1363), add:
```html
<script src="export-engine.js"></script>
```

- [ ] **Step 2: Add export action orchestration in `www/index.html`**

Add `exportCurrentTransactions()` function inside the main app script:
```javascript
  function exportCurrentTransactions(){
    if (!state || !window.ExportEngine) {
      toast("Export engine not ready");
      return;
    }
    var list = filteredTxns();
    if (!list || !list.length) {
      toast("No transactions to export");
      return;
    }

    var isFiltered = !!(currentSearchQuery || currentDateFilter !== "all" || currentTypeFilter !== "all" || selectedWalletFilter);
    var activeWalletObj = selectedWalletFilter ? getWalletById(selectedWalletFilter) : null;
    var filename = ExportEngine.generateExportFilename({
      isFiltered: isFiltered,
      walletName: activeWalletObj ? activeWalletObj.name : null
    });

    var csvContent = ExportEngine.generateTransactionsCsv(list, state.wallets, state.currency);
    ExportEngine.triggerCsvDownload(csvContent, filename).then(function(res){
      if (res && res.success) {
        toast("📥 Exported " + list.length + " record" + (list.length === 1 ? "" : "s") + " to " + filename);
      } else {
        toast("Export failed. Please try again.");
      }
    });
  }
```

- [ ] **Step 3: Wire up event listeners in `www/index.html`**

1. Wire `#exportTxns` in Recent Transactions card header:
```javascript
  var expBtn = el("#exportTxns");
  if (expBtn) expBtn.addEventListener("click", exportCurrentTransactions);
```
2. Wire `#menuExport` in avatar dropdown:
```javascript
  var menuExpBtn = el("#menuExport");
  if (menuExpBtn) menuExpBtn.addEventListener("click", function(){
    el("#menuPop").classList.remove("show");
    exportCurrentTransactions();
  });
```

- [ ] **Step 4: Commit changes**

```bash
git add www/index.html
git commit -m "feat: add export triggers to transactions header and user menu"
```

---

### Task 3: Full Integration Testing & Regression Validation

**Files:**
- Create: `tests/export-integration.test.js`

- [ ] **Step 1: Write `tests/export-integration.test.js`**

Simulate end-to-end user workflows:
1. Complete state with multiple wallets, various transaction types (expense, income, transfer with fee, adjustment).
2. Filter transactions by wallet ID -> verify exported CSV has correct subset and smart filename.
3. Filter by search query -> verify exported CSV contains only matching items.
4. Verify empty state gracefully returns empty payload indication.

```javascript
// tests/export-integration.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const WalletEngine = require('../www/wallet-engine.js');
const ExportEngine = require('../www/export-engine.js');

test('Integration: full export lifecycle with filters and wallet calculations', () => {
  const wallets = WalletEngine.normalizeWallets([
    { id: 'w-cash', name: 'Cash', icon: '💵', initialBalance: 1000 },
    { id: 'w-gcash', name: 'GCash', icon: '💙', initialBalance: 2500 },
    { id: 'w-gotyme', name: 'GoTyme', icon: '🟣', initialBalance: 10000 }
  ]);

  const now = Date.now();
  const txns = [
    {
      id: 'tx-101',
      desc: 'National Bookstore',
      amount: 450,
      type: 'expense',
      cat: 'Books & Supplies',
      walletId: 'w-cash',
      ts: now,
      deleted: false
    },
    {
      id: 'tx-102',
      desc: 'GCash Starbucks',
      amount: 195,
      type: 'expense',
      cat: 'Food & Dining',
      walletId: 'w-gcash',
      ts: now,
      deleted: false
    },
    {
      id: 'tx-103',
      desc: 'Transfer from GoTyme to GCash',
      amount: 2000,
      type: 'transfer',
      cat: 'Transfer',
      walletId: 'w-gotyme',
      toWalletId: 'w-gcash',
      fee: 15,
      sub: 'Top-up GCash',
      ts: now,
      deleted: false
    }
  ];

  // 1. Export All Transactions
  const allCsv = ExportEngine.generateTransactionsCsv(txns, wallets, 'PHP');
  assert.ok(allCsv.startsWith('\uFEFF'));
  const allLines = allCsv.slice(1).trim().split('\n');
  assert.equal(allLines.length, 4); // 1 header + 3 rows

  // 2. Filter by GCash Wallet
  const gcashFiltered = WalletEngine.filterTransactions(txns, { walletId: 'w-gcash' }, wallets);
  // Matches tx-102 (source) and tx-103 (destination)
  assert.equal(gcashFiltered.length, 2);

  const gcashFilename = ExportEngine.generateExportFilename({ walletName: 'GCash', dateStr: '2026-08-18' });
  assert.equal(gcashFilename, 'unibudget-gcash-2026-08-18.csv');

  const gcashCsv = ExportEngine.generateTransactionsCsv(gcashFiltered, wallets, 'PHP');
  const gcashLines = gcashCsv.slice(1).trim().split('\n');
  assert.equal(gcashLines.length, 3); // 1 header + 2 rows
  assert.ok(gcashLines[1].includes('GCash Starbucks'));
  assert.ok(gcashLines[2].includes('Transfer from GoTyme to GCash'));

  // 3. Search query filter
  const searchFiltered = WalletEngine.filterTransactions(txns, { query: 'National Bookstore' }, wallets);
  assert.equal(searchFiltered.length, 1);
  const searchCsv = ExportEngine.generateTransactionsCsv(searchFiltered, wallets, 'PHP');
  assert.ok(searchCsv.includes('National Bookstore'));
  assert.ok(!searchCsv.includes('Starbucks'));
});
```

- [ ] **Step 2: Run all test suites**

Run: `node --test tests/*.test.js`
Expected: All test suites PASS (all 20+ tests pass with zero regressions).

- [ ] **Step 3: Commit integration test**

```bash
git add tests/export-integration.test.js
git commit -m "test: add full integration tests for spreadsheet export lifecycle"
```

---

### Task 4: Final Verification & Manual Checks

- [ ] **Step 1: Run full automated test suite**
Run `node --test tests/*.test.js` to ensure complete green status across all test suites.

- [ ] **Step 2: Inspect git status and diff**
Run `git status` and `git diff HEAD~3` to verify cleanliness of code changes.

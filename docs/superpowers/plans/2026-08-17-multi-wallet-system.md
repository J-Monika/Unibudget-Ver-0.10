# Multi-Wallet & Multi-Account System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a full Multi-Wallet & Multi-Account subsystem in UniBudget supporting Cash, GCash, Maya, GoTyme, and custom wallets with interactive carousel filtering, inter-wallet transfers, balance reconciliation, and auto-capture routing.

**Architecture:** Extend UniBudget's state management to maintain an array of wallets (`state.wallets`), update transaction records with `walletId` / `toWalletId` / `fee`, render an interactive horizontal carousel below the Total Balance card that supports dynamic filtering and quick actions (Transfer, Reconcile, Add Wallet), and integrate automatic routing for native GCash and Maya notifications.

**Tech Stack:** Vanilla JavaScript (ES6+), HTML5, CSS3 with responsive design tokens, Capacitor Native Bridge, Supabase Cloud Sync (PostgreSQL JSONB/RLS), Node.js `node:test` for unit testing.

**Spec:** `docs/superpowers/specs/2026-08-17-multi-wallet-design.md`

## Global Constraints
- Default Wallets: Cash (💵, `#10b981`), GCash (💙, `#007dfe`), Maya (💚, `#05a85c`), GoTyme (🟣, `#7c3aed`).
- All financial balances and calculations must remain exact to 2 decimal places (`Math.round(val * 100) / 100`).
- Transfers between wallets must adjust individual wallet balances without counting towards monthly expense or income totals.
- Backward compatibility: any legacy transaction without a `walletId` must seamlessly migrate to `w-gcash` (if `source === "gcash-auto"` or desc contains GCash), `w-maya` (if Maya), or `w-cash` (default).
- Must work 100% offline in Device mode (LocalStorage) and synchronize via Supabase when configured.

---

### Task 1: Wallet Data Structure, Balance Engine & Migration Logic

**Files:**
- Create: `tests/wallet-engine.test.js`
- Create: `www/wallet-engine.js`
- Modify: `www/index.html`

**Interfaces:**
- Produces:
  - `DEFAULT_WALLETS`: Array of default wallet objects (`Cash`, `GCash`, `Maya`, `GoTyme`).
  - `normalizeWallets(wallets)`: Array of valid wallet objects with IDs, names, icons, colors, initial balances.
  - `computeWalletBalances(wallets, txns)`: Object mapping `walletId -> { balance, income, expense, transfersIn, transfersOut, fees }`.
  - `computeTotalNetWorth(wallets, txns)`: Number representing total balance across all active wallets.
  - `migrateTransactions(txns)`: Array of transactions with guaranteed `walletId`.

- [ ] **Step 1: Write the failing unit tests for the wallet engine**

```javascript
// tests/wallet-engine.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_WALLETS,
  normalizeWallets,
  computeWalletBalances,
  computeTotalNetWorth,
  migrateTransactions
} from '../www/wallet-engine.js';

test('DEFAULT_WALLETS contains Cash, GCash, Maya, GoTyme', () => {
  assert.equal(DEFAULT_WALLETS.length, 4);
  const ids = DEFAULT_WALLETS.map(w => w.id);
  assert.deepEqual(ids, ['w-cash', 'w-gcash', 'w-maya', 'w-gotyme']);
});

test('computeWalletBalances correctly computes starting balance, income, expense, and transfers', () => {
  const wallets = [
    { id: 'w-cash', name: 'Cash', initialBalance: 500 },
    { id: 'w-gcash', name: 'GCash', initialBalance: 1000 }
  ];
  const txns = [
    { id: 't1', type: 'income', amount: 200, walletId: 'w-cash', deleted: false },
    { id: 't2', type: 'expense', amount: 150, walletId: 'w-cash', deleted: false },
    { id: 't3', type: 'transfer', amount: 300, walletId: 'w-gcash', toWalletId: 'w-cash', fee: 15, deleted: false },
    { id: 't4', type: 'expense', amount: 50, walletId: 'w-gcash', deleted: true } // deleted should be ignored
  ];

  const balances = computeWalletBalances(wallets, txns);
  // Cash: 500 (init) + 200 (in) - 150 (out) + 300 (transfer in) = 850
  assert.equal(balances['w-cash'].balance, 850);
  // GCash: 1000 (init) - 300 (transfer out) - 15 (fee) = 685
  assert.equal(balances['w-gcash'].balance, 685);

  const total = computeTotalNetWorth(wallets, txns);
  // Total: 850 + 685 = 1535
  assert.equal(total, 1535);
});

test('migrateTransactions backfills missing walletId appropriately', () => {
  const legacyTxns = [
    { id: 't1', desc: 'Jollibee', amount: 100 },
    { id: 't2', desc: 'GCash Cash In', amount: 500, source: 'gcash-auto' },
    { id: 't3', desc: 'Maya Food purchase', amount: 200 }
  ];
  const migrated = migrateTransactions(legacyTxns);
  assert.equal(migrated[0].walletId, 'w-cash');
  assert.equal(migrated[1].walletId, 'w-gcash');
  assert.equal(migrated[2].walletId, 'w-maya');
});
```

- [ ] **Step 2: Run unit tests to verify failure**

Run: `node --test tests/wallet-engine.test.js`
Expected: FAIL (Cannot find module `../www/wallet-engine.js`)

- [ ] **Step 3: Implement `www/wallet-engine.js`**

```javascript
// www/wallet-engine.js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.WalletEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  "use strict";

  var DEFAULT_WALLETS = [
    { id: "w-cash", name: "Cash", icon: "💵", color: "#10b981", type: "cash", initialBalance: 0, isDefault: true },
    { id: "w-gcash", name: "GCash", icon: "💙", color: "#007dfe", type: "ewallet", initialBalance: 0, isDefault: true },
    { id: "w-maya", name: "Maya", icon: "💚", color: "#05a85c", type: "ewallet", initialBalance: 0, isDefault: true },
    { id: "w-gotyme", name: "GoTyme", icon: "🟣", color: "#7c3aed", type: "bank", initialBalance: 0, isDefault: true }
  ];

  function normalizeWallets(wallets) {
    if (!Array.isArray(wallets) || !wallets.length) {
      return DEFAULT_WALLETS.map(function(w){ return Object.assign({}, w); });
    }
    var existingIds = {};
    var list = wallets.filter(function(w){
      if (!w || !w.id) return false;
      existingIds[w.id] = true;
      return !w.deleted;
    }).map(function(w){
      return {
        id: String(w.id),
        name: String(w.name || "Wallet"),
        icon: String(w.icon || "💳"),
        color: String(w.color || "#6366f1"),
        type: String(w.type || "other"),
        initialBalance: Math.round((Number(w.initialBalance) || 0) * 100) / 100,
        isDefault: !!w.isDefault
      };
    });
    // Ensure core default wallets exist if not deleted
    DEFAULT_WALLETS.forEach(function(dw){
      if (!existingIds[dw.id]) {
        list.push(Object.assign({}, dw));
      }
    });
    return list;
  }

  function migrateTransactions(txns) {
    if (!Array.isArray(txns)) return [];
    return txns.map(function(t){
      if (!t) return t;
      var copy = Object.assign({}, t);
      if (!copy.walletId) {
        var lowDesc = (copy.desc || "").toLowerCase();
        if (copy.source === "gcash-auto" || lowDesc.indexOf("gcash") !== -1) {
          copy.walletId = "w-gcash";
        } else if (lowDesc.indexOf("maya") !== -1 || lowDesc.indexOf("paymaya") !== -1) {
          copy.walletId = "w-maya";
        } else if (lowDesc.indexOf("gotyme") !== -1) {
          copy.walletId = "w-gotyme";
        } else {
          copy.walletId = "w-cash";
        }
      }
      return copy;
    });
  }

  function computeWalletBalances(wallets, txns) {
    var validWallets = normalizeWallets(wallets);
    var balances = {};
    validWallets.forEach(function(w){
      balances[w.id] = {
        wallet: w,
        initialBalance: w.initialBalance || 0,
        income: 0,
        expense: 0,
        transfersIn: 0,
        transfersOut: 0,
        fees: 0,
        balance: w.initialBalance || 0
      };
    });

    var activeTxns = (txns || []).filter(function(t){ return t && !t.deleted; });

    activeTxns.forEach(function(t){
      var amt = Number(t.amount) || 0;
      var fee = Number(t.fee) || 0;

      if (t.type === "income") {
        if (balances[t.walletId]) {
          balances[t.walletId].income += amt;
          balances[t.walletId].balance += amt;
        }
      } else if (t.type === "expense") {
        if (balances[t.walletId]) {
          balances[t.walletId].expense += amt;
          balances[t.walletId].balance -= amt;
        }
      } else if (t.type === "transfer") {
        if (balances[t.walletId]) {
          balances[t.walletId].transfersOut += amt;
          balances[t.walletId].balance -= amt;
          if (fee > 0) {
            balances[t.walletId].fees += fee;
            balances[t.walletId].balance -= fee;
          }
        }
        if (balances[t.toWalletId]) {
          balances[t.toWalletId].transfersIn += amt;
          balances[t.toWalletId].balance += amt;
        }
      }
    });

    // Round all final balances
    Object.keys(balances).forEach(function(k){
      balances[k].balance = Math.round(balances[k].balance * 100) / 100;
      balances[k].income = Math.round(balances[k].income * 100) / 100;
      balances[k].expense = Math.round(balances[k].expense * 100) / 100;
      balances[k].transfersIn = Math.round(balances[k].transfersIn * 100) / 100;
      balances[k].transfersOut = Math.round(balances[k].transfersOut * 100) / 100;
      balances[k].fees = Math.round(balances[k].fees * 100) / 100;
    });

    return balances;
  }

  function computeTotalNetWorth(wallets, txns) {
    var b = computeWalletBalances(wallets, txns);
    var sum = 0;
    Object.keys(b).forEach(function(k){ sum += b[k].balance; });
    return Math.round(sum * 100) / 100;
  }

  return {
    DEFAULT_WALLETS: DEFAULT_WALLETS,
    normalizeWallets: normalizeWallets,
    migrateTransactions: migrateTransactions,
    computeWalletBalances: computeWalletBalances,
    computeTotalNetWorth: computeTotalNetWorth
  };
});
```

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `node --test tests/wallet-engine.test.js`
Expected: All tests pass (3/3 pass).

- [ ] **Step 5: Integrate `wallet-engine.js` script tag in `www/index.html` and update `normalizeState()`**

- Add `<script src="wallet-engine.js"></script>` before main application script.
- In `normalizeState(s)`:
  - `s.wallets = WalletEngine.normalizeWallets(s.wallets);`
  - `s.txns = WalletEngine.migrateTransactions(s.txns);`

- [ ] **Step 6: Commit Task 1 changes**

```bash
git add tests/wallet-engine.test.js www/wallet-engine.js www/index.html
git commit -m "feat: add multi-wallet state engine, calculation logic and migration"
```

---

### Task 2: Interactive Wallet Carousel Component & UI Styles

**Files:**
- Modify: `www/index.html` (CSS styles + HTML structure + JS render functions)

**Interfaces:**
- Consumes: `WalletEngine.computeWalletBalances(state.wallets, state.txns)`, `state.selectedWalletFilter`
- Produces:
  - `#walletCarousel` DOM element rendering horizontal card deck.
  - Interactive selection: `selectWalletFilter(walletId)` filtering transactions & charts.
  - Quick action buttons under carousel: Transfer (`#btnQuickTransfer`), Reconcile (`#btnQuickReconcile`), Add Wallet (`#btnAddWalletCard`).

- [ ] **Step 1: Add Carousel CSS styles to `www/index.html`**

```css
/* ---------- Multi-Wallet Carousel & Cards ---------- */
.wallets-section { width: 100%; margin-top: 4px; }
.wallets-carousel {
  display: flex; gap: 10px; overflow-x: auto; padding: 4px 2px 10px;
  scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch;
}
.wallets-carousel::-webkit-scrollbar { display: none; }
.wallets-carousel { -ms-overflow-style: none; scrollbar-width: none; }

.wallet-card {
  flex: 0 0 138px; scroll-snap-align: start;
  background: var(--card); border: 1.5px solid var(--line); border-radius: 16px;
  padding: 12px 14px; cursor: pointer; transition: all .18s ease;
  display: flex; flex-direction: column; justify-content: space-between; min-height: 82px;
  position: relative; user-select: none;
}
.wallet-card:hover { transform: translateY(-2px); border-color: var(--muted); }
.wallet-card.active {
  border-color: var(--w-accent, var(--accent));
  background: linear-gradient(180deg, var(--w-soft, var(--accent-soft)), var(--card));
  box-shadow: 0 4px 16px var(--w-glow, rgba(99,102,241,.25));
}
.wallet-card-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.wallet-card-brand { display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 13px; color: var(--ink); }
.wallet-card-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--w-accent, var(--accent)); }
.wallet-card-bal { font-size: 15px; font-weight: 800; color: #fff; margin-top: 8px; white-space: nowrap; }
.wallet-card-all { flex: 0 0 110px; text-align: center; justify-content: center; }
.wallet-card-add {
  flex: 0 0 100px; border: 1.5px dashed var(--line); background: transparent;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  color: var(--muted); font-size: 12px; font-weight: 700; gap: 4px;
}
.wallet-card-add:hover { border-color: var(--accent); color: var(--accent); }

.wallet-quick-actions {
  display: flex; gap: 8px; margin-top: 4px; justify-content: flex-end;
}
.w-action-btn {
  border: 1px solid var(--line); background: var(--card); color: var(--ink-soft);
  font-size: 12.5px; font-weight: 700; padding: 6px 12px; border-radius: 10px;
  cursor: pointer; display: inline-flex; align-items: center; gap: 5px;
}
.w-action-btn:hover { background: var(--card-elevated); color: #fff; }
.active-wallet-pill {
  font-size: 11.5px; font-weight: 700; color: var(--accent);
  background: var(--accent-soft); padding: 2px 8px; border-radius: 999px;
}
```

- [ ] **Step 2: Add Carousel HTML markup below the Total Balance card in `www/index.html`**

```html
<!-- Multi-Wallet Carousel -->
<section class="wallets-section" id="walletsSection">
  <div class="wallets-carousel" id="walletCarousel"></div>
  <div class="wallet-quick-actions">
    <button type="button" class="w-action-btn" id="btnQuickTransfer"><span>🔄</span> Transfer</button>
    <button type="button" class="w-action-btn" id="btnQuickReconcile"><span>⚖️</span> Reconcile</button>
  </div>
</section>
```

- [ ] **Step 3: Implement `renderWalletCarousel()` in `www/index.html`**

- Calculate all balances using `WalletEngine.computeWalletBalances(state.wallets, state.txns)`.
- Render "All Wallets" card showing global net worth.
- Render each wallet card with its respective color, icon, name, and live balance.
- Render "+ Add" card at the end.
- Tapping a wallet updates `selectedWalletFilter = walletId` (or `null` for All), and calls `render()`.
- Filter `activeTxns()` when `selectedWalletFilter` is not null.

- [ ] **Step 4: Test in browser/webview**

Open `www/index.html` in browser and verify horizontal scrolling, tapping wallet cards, active glowing border, and transaction filtering.

- [ ] **Step 5: Commit Task 2 changes**

```bash
git add www/index.html
git commit -m "feat: add interactive multi-wallet carousel and filtering UI"
```

---

### Task 3: Add Transaction Modal Wallet Selector & Transaction Badges

**Files:**
- Modify: `www/index.html`

**Interfaces:**
- Consumes: `state.wallets`, `selectedWalletFilter`
- Produces:
  - Form field `<select id="txnWallet">` in `#addTxnScrim`.
  - Transaction row wallet badges in Recent Transactions feed.

- [ ] **Step 1: Add Wallet Selector field to `#addTxnScrim` form in `www/index.html`**

```html
<div class="field">
  <label for="txnWallet">Account / Wallet</label>
  <select id="txnWallet" class="f"></select>
</div>
```

- [ ] **Step 2: Update `fillWalletsDropdown()` and modal opening logic**

- Populate `#txnWallet` with active wallets (icon + name + current balance).
- When opening `#addTxnScrim`, default to `selectedWalletFilter` if set, otherwise `"w-cash"`.
- In `addTxn(e)`: Save `walletId: el("#txnWallet").value`.

- [ ] **Step 3: Render Wallet Badges on Recent Transactions List**

- Display a subtle chip with the wallet's icon & color next to each transaction's category/date.

- [ ] **Step 4: Verify adding income and expenses to specific wallets updates that wallet's balance**

- [ ] **Step 5: Commit Task 3 changes**

```bash
git add www/index.html
git commit -m "feat: integrate wallet selector into transaction creation and list badges"
```

---

### Task 4: Wallet-to-Wallet Transfer Flow & Fee Handling

**Files:**
- Create: `tests/wallet-transfer.test.js`
- Modify: `www/index.html`

**Interfaces:**
- Consumes: `state.wallets`, `WalletEngine.computeWalletBalances`
- Produces:
  - `#transferScrim` modal HTML (From Wallet, To Wallet, Amount, Transfer Fee, Note).
  - `saveTransfer()` handler logging a `type: "transfer"` transaction + optional fee.

- [ ] **Step 1: Write unit test for transfer creation & fee logic**

```javascript
// tests/wallet-transfer.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeWalletBalances } from '../www/wallet-engine.js';

test('Transfer correctly shifts funds between wallets with optional fee', () => {
  const wallets = [
    { id: 'w-gotyme', name: 'GoTyme', initialBalance: 5000 },
    { id: 'w-gcash', name: 'GCash', initialBalance: 200 }
  ];
  const transferTxn = {
    id: 't-transfer-1',
    desc: 'Transfer: GoTyme → GCash',
    amount: 1000,
    type: 'transfer',
    cat: 'Transfer',
    walletId: 'w-gotyme',
    toWalletId: 'w-gcash',
    fee: 15,
    ts: Date.now(),
    deleted: false
  };

  const balances = computeWalletBalances(wallets, [transferTxn]);
  // GoTyme: 5000 - 1000 - 15 = 3985
  assert.equal(balances['w-gotyme'].balance, 3985);
  // GCash: 200 + 1000 = 1200
  assert.equal(balances['w-gcash'].balance, 1200);
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `node --test tests/wallet-transfer.test.js`
Expected: PASS

- [ ] **Step 3: Add `#transferScrim` Modal markup and CSS in `www/index.html`**

```html
<!-- ============ WALLET TRANSFER MODAL ============ -->
<div class="scrim" id="transferScrim">
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="transferTitle">
    <div class="modal-head">
      <div>
        <h3 id="transferTitle">🔄 Transfer Money</h3>
        <p>Move funds between your accounts.</p>
      </div>
      <button class="x" id="closeTransfer" aria-label="Close">✕</button>
    </div>
    <form id="transferForm" autocomplete="off">
      <div class="field">
        <label for="trFrom">From Account</label>
        <select id="trFrom" class="f"></select>
      </div>
      <div class="field">
        <label for="trTo">To Account</label>
        <select id="trTo" class="f"></select>
      </div>
      <div class="field">
        <label for="trAmount">Transfer Amount</label>
        <div class="amt-wrap">
          <span class="sym" id="trSym">₱</span>
          <input id="trAmount" class="num" type="number" min="0.01" step="0.01" placeholder="0.00" />
        </div>
      </div>
      <div class="field">
        <label for="trFee">Transfer Fee (InstaPay / Cash-In) <span style="font-weight:500;color:var(--muted)">(optional)</span></label>
        <div class="amt-wrap">
          <span class="sym">₱</span>
          <input id="trFee" class="num" type="number" min="0" step="1" placeholder="0.00" />
        </div>
      </div>
      <div class="field">
        <label for="trNote">Note / Reference <span style="font-weight:500;color:var(--muted)">(optional)</span></label>
        <input id="trNote" type="text" placeholder="e.g. Allowance cash-in, ATM cash-out" />
      </div>
      <button type="submit" class="submit">Execute Transfer</button>
    </form>
  </div>
</div>
```

- [ ] **Step 4: Wire up Transfer events and validation**

- Validate `fromWallet !== toWallet`.
- Validate `amount > 0` and sufficient funds warning if applicable.
- Save transfer transaction with `walletId` (source), `toWalletId` (dest), and `fee`.
- Trigger celebrate/toast on completion.

- [ ] **Step 5: Commit Task 4 changes**

```bash
git add tests/wallet-transfer.test.js www/index.html
git commit -m "feat: add wallet-to-wallet transfer modal with optional fee logging"
```

---

### Task 5: Balance Reconciliation & Custom Wallet Management

**Files:**
- Modify: `www/index.html`

**Interfaces:**
- Consumes: `state.wallets`, `computeWalletBalances`
- Produces:
  - `#reconcileScrim` (Adjust balance modal).
  - `#walletModalScrim` (Add/Edit wallet modal).

- [ ] **Step 1: Add `#reconcileScrim` and `#walletModalScrim` HTML & CSS in `www/index.html`**

- Form for Reconcile: Target wallet dropdown, current calculated balance, actual balance input, computed delta indicator.
- Form for Custom Wallet: Name input, Type selector (Cash, E-Wallet, Bank, Other), Color picker palette, Emoji icon picker, Starting balance.

- [ ] **Step 2: Implement Reconciliation Logic**

```javascript
function saveReconciliation(e) {
  e.preventDefault();
  var walletId = el("#recWallet").value;
  var actualBal = parseFloat(el("#recActual").value);
  var calcBal = currentBalances[walletId].balance;
  var diff = Math.round((actualBal - calcBal) * 100) / 100;
  if (diff === 0) { toast("Balance already matches!"); closeReconcile(); return; }

  var isGain = diff > 0;
  state.txns.push({
    id: id(),
    desc: "Balance Adjustment (" + getWalletById(walletId).name + ")",
    amount: Math.abs(diff),
    type: isGain ? "income" : "expense",
    cat: "Other",
    walletId: walletId,
    ts: now(),
    updated_at: now(),
    deleted: false
  });
  save(); render(); closeReconcile();
  toast("Balance adjusted by " + (isGain ? "+" : "−") + fmt(Math.abs(diff)));
}
```

- [ ] **Step 3: Implement Add/Edit/Delete Custom Wallet Logic**

- Allow adding new custom wallets (e.g. SeaBank, BPI, ShopeePay).
- Update `state.wallets` and persist.

- [ ] **Step 4: Commit Task 5 changes**

```bash
git add www/index.html
git commit -m "feat: add balance reconciliation and custom wallet management modals"
```

---

### Task 6: Native GCash/Maya Capture Routing & Cloud Sync Verification

**Files:**
- Modify: `www/index.html`
- Modify: `www/cloud.js`
- Modify: `supabase-schema.sql`

**Interfaces:**
- Consumes: `GcashWatcherPlugin`, `parseGcash()`, Supabase Auth & DB
- Produces:
  - Smart routing of auto-ingested alerts to `w-gcash`, `w-maya`, etc.
  - Multi-wallet state sync across devices via Supabase.

- [ ] **Step 1: Update `parseGcash()` and `ingestGcash()` in `www/index.html`**

```javascript
function parseGcash(text) {
  // ... existing parsing logic ...
  var walletId = "w-gcash";
  if (wallet === "Maya") walletId = "w-maya";
  else if (wallet === "ShopeePay" && state.wallets.some(function(w){ return w.id === "w-shopee" || w.name === "ShopeePay"; })) {
    walletId = "w-shopee";
  }
  return {
    desc: desc,
    amount: Math.round(amount*100)/100,
    type: type,
    cat: cat,
    ref: ref,
    walletId: walletId
  };
}
```

- [ ] **Step 2: Ensure Supabase schema and `cloud.js` seamlessly sync `wallets` and `walletId`**

- Verify `budgets.data` JSONB stores `wallets` array.
- Verify `transactions` table inserts and pulls retain `walletId`, `toWalletId`, and `fee`.

- [ ] **Step 3: Run comprehensive verification**

- Run all node test suites: `node --test tests/*.test.js`.
- Sideload / browser test: Verify all 4 default wallets, transfers, reconcile, filter, and auto-capture simulation.

- [ ] **Step 4: Commit Task 6 changes**

```bash
git add www/index.html www/cloud.js supabase-schema.sql
git commit -m "feat: route native wallet alerts and sync multi-wallet state with Supabase"
```

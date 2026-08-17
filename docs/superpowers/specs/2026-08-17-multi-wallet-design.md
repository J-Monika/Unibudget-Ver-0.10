# Multi-Wallet & Multi-Account System Design

## 1. Overview & Problem Statement
In the Philippines, students and young adults manage their money across multiple distinct repositories: physical cash for daily jeepney/canteen purchases, e-wallets (**GCash** and **Maya**) for online transactions and P2P transfers, and high-yield digital or traditional banks (**GoTyme**, **SeaBank**, **Landbank**, **BPI**) for savings and scholarship stipends.

Currently, **UniBudget** maintains a single aggregated balance without distinguishing where funds are physically located. This design introduces a comprehensive **Multi-Wallet Subsystem** that provides real-time per-wallet balance tracking, inter-wallet transfers with fee logging, quick reconciliation, custom wallet creation, and automatic routing for GCash/Maya notifications.

---

## 2. Core Architecture & Data Models

### 2.1 Wallet Model (`state.wallets`)
Each wallet is defined by:
```typescript
interface Wallet {
  id: string;               // e.g. "w-cash", "w-gcash", "w-maya", "w-gotyme", or "w-custom-<id>"
  name: string;             // Display name (e.g. "GCash", "GoTyme", "Cash")
  type: "cash" | "ewallet" | "bank" | "other";
  color: string;            // Hex color code (e.g. "#007dfe", "#05a85c", "#7c3aed")
  icon: string;             // Emoji icon (e.g. "💵", "💙", "💚", "🟣", "🏦")
  initialBalance: number;   // Baseline starting balance
  isDefault: boolean;       // Built-in vs user-created
  deleted?: boolean;        // Soft delete tombstone
}
```

### 2.2 Default Pre-Configured Wallets
Upon user creation or migration, every account is initialized with:
1. **Cash** (`id: "w-cash"`, `name: "Cash"`, `icon: "💵"`, `color: "#10b981"`, `type: "cash"`)
2. **GCash** (`id: "w-gcash"`, `name: "GCash"`, `icon: "💙"`, `color: "#007dfe"`, `type: "ewallet"`)
3. **Maya** (`id: "w-maya"`, `name: "Maya"`, `icon: "💚"`, `color: "#05a85c"`, `type: "ewallet"`)
4. **GoTyme** (`id: "w-gotyme"`, `name: "GoTyme"`, `icon: "🟣"`, `color: "#7c3aed"`, `type: "bank"`)

Users may create additional custom wallets (e.g. SeaBank, BPI, BDO, ShopeePay, Tonik, Landbank) with custom icons, colors, and initial balances.

### 2.3 Transaction Model Updates
Existing and new transactions extend with wallet links:
```typescript
interface Transaction {
  id: string;
  desc: string;
  amount: number;
  type: "expense" | "income" | "transfer";
  cat: string;              // Expense/Income category
  walletId: string;         // Source wallet ID (or single wallet for income/expense)
  toWalletId?: string;      // Destination wallet ID (for transfers)
  fee?: number;             // Optional transfer fee
  source?: string;          // e.g. "gcash-auto", "manual"
  sub?: string;
  ts: number;
  updated_at: number;
  deleted: boolean;
}
```

### 2.4 Live Balance Computation (Hybrid Model)
* **Individual Wallet Balance**:
  $$\text{Balance}(W) = \text{initialBalance}(W) + \sum \text{Income}(W) - \sum \text{Expense}(W) + \sum \text{TransferIn}(W) - \sum \text{TransferOut}(W) - \sum \text{TransferFee}(W)$$
* **Total Balance (Net Worth)**:
  $$\text{Total Balance} = \sum_{W \in \text{Wallets}} \text{Balance}(W)$$
* **Transfer Impact on Budget**: Transfers between wallets adjust respective wallet balances without modifying the global monthly spending or income statistics. If a transfer fee is specified (e.g. ₱15 InstaPay fee), a dedicated expense transaction is automatically generated under `"Other"` or `"Fees"`.

### 2.5 Migration & Backward Compatibility
For existing transactions without a `walletId`:
* If `source === "gcash-auto"` $\rightarrow$ assigned to `"w-gcash"`.
* If `desc` contains `"Maya"` or `"PayMaya"` $\rightarrow$ assigned to `"w-maya"`.
* Otherwise $\rightarrow$ default assigned to `"w-cash"`.
* If `state.wallets` is absent in `localStorage` or Supabase, it is automatically initialized with the default 4 wallets.

---

## 3. UI Components & User Experience

### 3.1 Horizontal Wallet Carousel (Home Screen)
* Located directly below the Total Balance card and above the Donut Chart.
* Displays swipeable cards for:
  * **All Wallets Pill**: Shows total net worth.
  * **Cash Card**: Live cash on hand.
  * **GCash Card**: Live GCash balance.
  * **Maya Card**: Live Maya balance.
  * **GoTyme Card**: Live GoTyme balance.
  * **Custom Wallet Cards**: Any added e-wallets or banks.
  * **＋ Add Wallet Card**: Quick launcher for creating custom wallets.
* **Interactive Filtering**: Tapping a wallet card filters the **Recent Transactions** feed and the **Donut Chart** to only display transactions for that specific wallet, with an active glowing highlight.
* **Quick Action Controls**:
  * 🔄 **Transfer**: Move funds between wallets.
  * ⚖️ **Reconcile**: Adjust balance to match real-life balances.

### 3.2 Modal Interfaces

#### A. Add / Edit Transaction Modal
* Adds a segmented/dropdown **Wallet Selector** (`"Paid from"` or `"Deposited to"`).
* Defaults to the currently selected filter wallet or `"w-cash"`.

#### B. Wallet Transfer Modal
* **Source Wallet** (`From:`) dropdown.
* **Destination Wallet** (`To:`) dropdown (validates source $\neq$ destination).
* **Transfer Amount** input with currency formatting.
* **Transfer Fee** (optional input with quick presets: ₱0, ₱10, ₱15, ₱25).
* **Notes** (e.g. "Allowance cash-in", "ATM cash-out").

#### C. Balance Reconcile / Adjustment Modal
* Selects target wallet.
* Displays current **System Calculated Balance**.
* Input for **Actual Real Balance**.
* Shows live difference ($\pm \Delta$).
* When saved, logs an adjustment transaction (`"Balance Adjustment"`) to sync the books.

#### D. Add / Manage Wallet Modal
* Name input (e.g. "SeaBank", "BPI Debit").
* Type selector (`E-Wallet`, `Bank`, `Cash`, `Other`).
* Color palette presets (GCash Blue, Maya Green, GoTyme Violet, SeaBank Orange, BPI Red, BDO Blue, Landbank Green).
* Emoji icon picker.
* Starting Balance input.
* Delete / archive button for custom wallets (safely preventing deletion if active transactions exist).

---

## 4. Integration & Ingestion

### 4.1 Native GCash & Maya Auto-Routing
* When `GcashNotificationListener` or `GcashSmsReceiver` intercepts an alert:
  * `parseGcash()` inspects the message context.
  * GCash alerts $\rightarrow$ automatically tagged with `walletId: "w-gcash"`.
  * Maya alerts $\rightarrow$ automatically tagged with `walletId: "w-maya"`.
  * ShopeePay / GrabPay / Bank SMS $\rightarrow$ dynamically matched to existing custom wallets or defaulted cleanly.

### 4.2 Cloud Sync & Supabase
* `state.wallets` synchronizes within the user's `budgets` record (`data` JSONB).
* Transactions with `walletId` and `toWalletId` synchronize via `cloud.js` and `supabase-schema.sql` with Last-Write-Wins (LWW) conflict resolution.
* Offline device mode retains full capability with zero network dependencies.

---

## 5. Verification & Testing Strategy
1. **Unit & Calculation Testing**:
   - Verify starting balance + income/expense calculates accurately.
   - Verify wallet transfers correctly debit source and credit destination without altering total net worth.
   - Verify transfer fees log as expense and debit source wallet.
   - Verify balance reconciliation computes correct positive/negative delta.
2. **UI & State Filter Testing**:
   - Verify tapping a wallet card filters transaction list and donut chart.
   - Verify "All Wallets" restores global aggregated metrics.
   - Verify adding/editing custom wallets updates carousel immediately.
3. **Auto-Capture Testing**:
   - Test GCash SMS/notification mock strings assign `w-gcash`.
   - Test Maya SMS/notification mock strings assign `w-maya`.
4. **Offline & Cloud Sync Testing**:
   - Test local storage persistence after reload.
   - Test Supabase push/pull serialization without data loss.

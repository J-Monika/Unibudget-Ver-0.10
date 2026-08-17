# UniBudget — Android App & Student Finance Tracker

UniBudget is a student budget tracker with **multi-wallet and multi-account management**, **login/signup (Supabase cloud sync)**, and **automatic notification/SMS transaction capture** (GCash, Maya, GoTyme, etc.). When your e-wallet notifies you of money received or spent, the app automatically parses it, maps it to the right wallet, logs the transaction, updates your budget, and alerts you — even when the app is closed.

A ready-to-install debug build is available: **`UniBudget-debug.apk`**.

---

## 🌟 What's New: Multi-Wallet & Multi-Account Balance System

UniBudget now features a comprehensive **Multi-Wallet Subsystem** tailored for Philippine personal finance workflows:

### 1. Default Philippine E-Wallets & Accounts
- **💵 Cash** (Emerald `#10b981`) — Physical cash on hand with quick balance reconciliation.
- **💙 GCash** (Electric Blue `#007dfe`) — Direct sync with GCash notification & SMS auto-capture.
- **💚 Maya** (Maya Green `#05a85c`) — Automatic capture and separate balance tracking.
- **🟣 GoTyme** (Digital Purple `#7c3aed`) — Dedicated GoTyme bank account tracking.

### 2. Interactive Wallet Carousel
- Located directly below the **Total Net Worth** card.
- Displays an **🌐 All Wallets** overview card, individual account balance cards, and a **➕ New Account** button.
- **Filter-on-Tap**: Tapping any wallet card dynamically isolates and filters your entire dashboard (Total Balance, Donut Chart, Category Breakdown, and Recent Transactions) to display figures for that specific account. Includes a one-tap `✕ Filtered` dismissal pill.

### 3. Account-to-Account Transfers (`🔄 Transfer`)
- Easily move funds between accounts (e.g. *GoTyme → GCash* or *Bank → Cash*).
- Transfers update respective wallet balances without skewing your monthly expense/income budget limits.
- Supports optional **InstaPay / Cash-In fees** (e.g., ₱15 or ₱25) recorded as a tracked expense under "Other".

### 4. Hybrid Balance Reconciliation (`⚖️ Reconcile`)
- Live balance equation:
  $$\text{Balance}(W) = \text{initialBalance}(W) + \text{Income}(W) - \text{Expense}(W) + \text{TransfersIn}(W) - \text{TransfersOut}(W) - \text{TransferFees}(W)$$
- If your physical cash or real wallet balance differs from the app due to untracked expenses, enter your actual balance into the Reconcile modal. UniBudget computes the exact difference and logs a balance adjustment transaction.

### 5. Custom E-Wallets & Banks (`➕ New Account`)
- Create unlimited custom accounts (e.g., **SeaBank**, **BDO**, **BPI**, **ShopeePay**, **GrabPay**).
- Customize with a 10-color gradient palette picker, custom emoji icons, account types (*e-wallet*, *bank*, *cash*, *other*), and starting balances.

### 6. Automated Wallet Routing
- Native notification & SMS listener automatically attributes transactions to the appropriate wallet (`w-gcash`, `w-maya`, `w-gotyme`, or matching custom account name).

---

## 📂 Project Architecture

```
UniBudget/
├── UniBudget-debug.apk                  ← Installable Android build (sideload to phone)
├── www/                                 ← Web application (HTML/CSS/JS)
│   ├── index.html                       ← UI, Carousel, Modals, & Application Controller
│   ├── wallet-engine.js                 ← Multi-wallet computation engine & migrations
│   ├── cloud.js                         ← Supabase authentication & offline sync adapter
│   ├── gcash-bridge.js                  ← Native Capacitor bridge for auto-capture
│   ├── app-config.js                    ← ⚙️ Supabase URL & public anon key
│   └── vendor/
│       └── supabase.js                  ← Bundled Supabase client
├── tests/                               ← Automated unit & integration test suite
│   ├── wallet-engine.test.js            ← Balance math, defaults, & migration tests
│   ├── wallet-transfer.test.js          ← Transfer debit/credit & fee tests
│   └── wallet-full-integration.test.js  ← Full lifecycle (income, expense, transfer, reconcile)
├── android/                             ← Native Android Capacitor project
│   └── app/src/main/java/com/unibudget/app/
│       ├── GcashNotificationListener.java ← Reads GCash/Maya notifications
│       ├── GcashSmsReceiver.java          ← Reads SMS payment alerts
│       ├── GcashCaptureStore.java         ← Queue + system notifications
│       ├── GcashWatcherPlugin.java        ← Native ↔ JS Capacitor plugin
│       └── MainActivity.java
├── docs/superpowers/                    ← Specifications and implementation plans
│   ├── specs/2026-08-17-multi-wallet-design.md
│   └── plans/2026-08-17-multi-wallet-system.md
├── supabase-schema.sql                  ← Database schema (run once in Supabase)
├── package.json
└── capacitor.config.json
```

---

## 🧪 Testing

UniBudget includes an automated Node.js test suite for wallet engine computations and data migration:

```bash
# Run all automated tests
node --test tests/*.test.js
```

**Test Coverage:**
- `DEFAULT_WALLETS contains Cash, GCash, Maya, GoTyme`
- `computeWalletBalances correctly computes starting balance, income, expense, and transfers`
- `migrateTransactions backfills missing walletId appropriately`
- `Full workflow: starting balance + income + expense + transfer + reconcile`
- `Transfer correctly shifts funds between wallets with optional fee`

---

## ⚙️ 1. Set Up Supabase (Cloud Sync)

1. Create a free project at **[supabase.com](https://supabase.com)**.
2. Go to **SQL Editor** → **New query** → paste all of **`supabase-schema.sql`** → **Run**.
3. **Authentication → Sign In / Providers → Email**: turn **"Confirm email" OFF** (for instant student login without email confirmation).
4. **Project Settings → API**, copy:
   - **Project URL**
   - **anon public** key
5. Open **`www/app-config.js`** and paste them in:
   ```javascript
   window.UNIBUDGET_CONFIG = {
     SUPABASE_URL: "https://xxxxxxxx.supabase.co",
     SUPABASE_ANON_KEY: "eyJhbGciOi....(anon key)...."
   };
   ```
6. Re-sync with `npx cap sync android`. Once keys are present, the app shows **"☁ Cloud sync"** and syncs accounts, wallets, and transactions across devices.

> **Note:** Without Supabase keys, UniBudget runs seamlessly in offline **Device Mode** using localStorage.

---

## 🛠️ 2. Build the Android APK

1. **Sync web assets to Android:**
   ```bash
   npx cap sync android
   ```

2. **Build Debug APK:**
   - **Via Android Studio (GUI):**
     ```bash
     npx cap open android
     ```
     Wait for Gradle to finish, then go to **Build → Build Bundle(s)/APK(s) → Build APK(s)**.
   - **Via Command Line:**
     ```bash
     cd android
     ./gradlew assembleDebug      # Windows: .\gradlew.bat assembleDebug
     ```
   Output APK: `android/app/build/outputs/apk/debug/app-debug.apk` (or root `UniBudget-debug.apk`).

---

## 📱 3. Installation & Auto-Capture Setup

1. Copy `UniBudget-debug.apk` to your Android phone and install it (**Allow from this source** if prompted).
2. Open **UniBudget** and log in or sign up.
3. Tap **Avatar menu (top-right) → 🔗 Connect GCash**, and grant permissions:
   - **Notification Access**: Enables reading payment alerts from GCash, Maya, and bank apps.
   - **SMS Access**: Backup detection for SMS confirmation alerts.
   - **Show Notifications**: Displays in-app confirmation chips when a transaction is auto-captured.

---

## 📝 Changelog Summary

### v1.0.0 (Multi-Wallet Release)
- ✨ **Multi-Wallet Engine**: Added default wallets (Cash, GCash, Maya, GoTyme) + custom wallet support.
- 🎨 **Horizontal Wallet Carousel**: Added carousel layout with active glowing borders, real-time balance previews, and tap-to-filter.
- 🔄 **Account Transfers**: Introduced inter-wallet transfers with optional fee deduction.
- ⚖️ **Balance Reconciliation**: Introduced reconciliation modal to adjust discrepancies between real-world cash/e-wallets and tracked balances.
- 🏷️ **Transaction Account Routing & Badges**: Added wallet badges to transaction records and wallet selector to Add Transaction form.
- ☁️ **Cloud Synchronization**: Extended Supabase sync schema to persist and merge multi-wallet configurations across devices.
- 🧪 **Automated Test Suite**: Added 5 comprehensive unit and integration tests under `tests/`.

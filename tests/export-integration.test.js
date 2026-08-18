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

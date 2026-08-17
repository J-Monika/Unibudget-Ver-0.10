// tests/wallet-full-integration.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const WalletEngine = require('../www/wallet-engine.js');

const {
  DEFAULT_WALLETS,
  normalizeWallets,
  computeWalletBalances,
  computeTotalNetWorth,
  migrateTransactions
} = WalletEngine;

test('Full workflow: starting balance + income + expense + transfer + reconcile', () => {
  // 1. Initialize wallets with GoTyme starting with 5000, Cash 500, GCash 1000, Maya 200
  let wallets = normalizeWallets([
    { id: 'w-cash', name: 'Cash', icon: '💵', color: '#10b981', initialBalance: 500 },
    { id: 'w-gcash', name: 'GCash', icon: '💙', color: '#007dfe', initialBalance: 1000 },
    { id: 'w-maya', name: 'Maya', icon: '💚', color: '#05a85c', initialBalance: 200 },
    { id: 'w-gotyme', name: 'GoTyme', icon: '🟣', color: '#7c3aed', initialBalance: 5000 }
  ]);

  let txns = [];

  // Initial net worth: 500 + 1000 + 200 + 5000 = 6700
  assert.equal(computeTotalNetWorth(wallets, txns), 6700);

  // 2. Add income to GoTyme (Scholarship allowance +10,000)
  txns.push({
    id: 't-inc-1',
    desc: 'DOST Stipend',
    amount: 10000,
    type: 'income',
    cat: 'Allowance & Aid',
    walletId: 'w-gotyme',
    deleted: false
  });

  // 3. Add expense from GCash (Jollibee -250)
  txns.push({
    id: 't-exp-1',
    desc: 'Jollibee Food',
    amount: 250,
    type: 'expense',
    cat: 'Food & Dining',
    walletId: 'w-gcash',
    deleted: false
  });

  // 4. Transfer from GoTyme to GCash (2000 with 15 fee)
  txns.push({
    id: 't-trf-1',
    desc: 'Cash in to GCash',
    amount: 2000,
    type: 'transfer',
    cat: 'Transfer',
    walletId: 'w-gotyme',
    toWalletId: 'w-gcash',
    fee: 15,
    deleted: false
  });

  let balances = computeWalletBalances(wallets, txns);
  // GoTyme: 5000 + 10000 - 2000 - 15 = 12985
  assert.equal(balances['w-gotyme'].balance, 12985);
  // GCash: 1000 - 250 + 2000 = 2750
  assert.equal(balances['w-gcash'].balance, 2750);
  // Cash: 500
  assert.equal(balances['w-cash'].balance, 500);
  // Maya: 200
  assert.equal(balances['w-maya'].balance, 200);

  // Total net worth: 12985 + 2750 + 500 + 200 = 16435
  assert.equal(computeTotalNetWorth(wallets, txns), 16435);

  // 5. Add custom SeaBank wallet
  wallets.push({
    id: 'w-seabank',
    name: 'SeaBank',
    icon: '🏦',
    color: '#f97316',
    type: 'bank',
    initialBalance: 3000,
    isDefault: false
  });

  // 6. Reconcile Cash: user discovers they actually have 450 in pocket (50 diff)
  txns.push({
    id: 't-rec-1',
    desc: 'Balance Adjustment (Cash)',
    amount: 50,
    type: 'adjustment',
    direction: 'decrease',
    cat: 'Adjustment',
    walletId: 'w-cash',
    deleted: false
  });

  balances = computeWalletBalances(wallets, txns);
  assert.equal(balances['w-cash'].balance, 450);
  assert.equal(balances['w-cash'].expense, 0); // Must NOT be counted as expense
  assert.equal(balances['w-cash'].income, 0);
  assert.equal(balances['w-seabank'].balance, 3000);
  // Total net worth: 16435 + 3000 - 50 = 19385
  assert.equal(computeTotalNetWorth(wallets, txns), 19385);
});

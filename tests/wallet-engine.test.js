// tests/wallet-engine.test.js
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

test('computeWalletBalances correctly handles non-budget adjustment without altering income/expense', () => {
  const wallets = [
    { id: 'w-cash', name: 'Cash', initialBalance: 1000 },
    { id: 'w-gcash', name: 'GCash', initialBalance: 2000 }
  ];
  const txns = [
    { id: 't-adj-down', type: 'adjustment', direction: 'decrease', amount: 200, walletId: 'w-cash', deleted: false },
    { id: 't-adj-up', type: 'adjustment', direction: 'increase', amount: 150, walletId: 'w-gcash', deleted: false }
  ];

  const balances = computeWalletBalances(wallets, txns);
  // Cash: 1000 - 200 = 800
  assert.equal(balances['w-cash'].balance, 800);
  assert.equal(balances['w-cash'].expense, 0); // MUST NOT count as expense
  assert.equal(balances['w-cash'].income, 0);

  // GCash: 2000 + 150 = 2150
  assert.equal(balances['w-gcash'].balance, 2150);
  assert.equal(balances['w-gcash'].income, 0); // MUST NOT count as income
  assert.equal(balances['w-gcash'].expense, 0);

  // Total net worth: 800 + 2150 = 2950
  const total = computeTotalNetWorth(wallets, txns);
  assert.equal(total, 2950);
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

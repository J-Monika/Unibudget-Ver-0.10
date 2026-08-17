// tests/wallet-transfer.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const WalletEngine = require('../www/wallet-engine.js');

const { computeWalletBalances, computeTotalNetWorth } = WalletEngine;

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

  // Total net worth: 5000 + 200 - 15 (fee) = 5185
  const total = computeTotalNetWorth(wallets, [transferTxn]);
  assert.equal(total, 5185);
});

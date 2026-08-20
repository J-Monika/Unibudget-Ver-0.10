// tests/transaction-filter.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const WalletEngine = require('../www/wallet-engine.js');

const { filterTransactions, getStartOfWeek, getStartOfMonth } = WalletEngine;

const sampleWallets = [
  { id: 'w-cash', name: 'Cash', icon: '💵', color: '#10b981' },
  { id: 'w-gcash', name: 'GCash', icon: '💙', color: '#007dfe' },
  { id: 'w-gotyme', name: 'GoTyme', icon: '🟣', color: '#7c3aed' }
];

const now = Date.now();
const oneDay = 24 * 60 * 60 * 1000;
const twoWeeksAgo = now - 14 * oneDay;
const threeDaysAgo = now - 3 * oneDay;

const sampleTxns = [
  {
    id: 't1',
    desc: 'Jollibee Chickenjoy',
    amount: 150,
    type: 'expense',
    cat: 'Food & Dining',
    walletId: 'w-gcash',
    ts: now,
    deleted: false
  },
  {
    id: 't2',
    desc: 'Jeepney Fare',
    amount: 15,
    type: 'expense',
    cat: 'Transportation',
    walletId: 'w-cash',
    ts: threeDaysAgo,
    deleted: false
  },
  {
    id: 't3',
    desc: 'DOST Stipend',
    amount: 8000,
    type: 'income',
    cat: 'Allowance & Aid',
    walletId: 'w-gotyme',
    ts: twoWeeksAgo,
    deleted: false
  },
  {
    id: 't4',
    desc: 'Transfer: GoTyme → GCash',
    amount: 2000,
    type: 'transfer',
    cat: 'Transfer',
    walletId: 'w-gotyme',
    toWalletId: 'w-gcash',
    fee: 15,
    ts: threeDaysAgo,
    deleted: false
  },
  {
    id: 't5',
    desc: 'Shopee Desk Lamp',
    amount: 350,
    type: 'expense',
    cat: 'School & Supplies',
    walletId: 'w-gcash',
    ts: now - 40 * oneDay, // Last month
    deleted: false
  },
  {
    id: 't6',
    desc: 'Old Deleted Item',
    amount: 500,
    type: 'expense',
    cat: 'Food & Dining',
    walletId: 'w-cash',
    ts: now,
    deleted: true
  }
];

test('filterTransactions returns active items when filters are default/all', () => {
  const res = filterTransactions(sampleTxns, { query: '', dateRange: 'all', type: 'all' }, sampleWallets);
  assert.equal(res.length, 5); // Excludes deleted item
});

test('filterTransactions filters by text query across counterparty, category, wallet name and amount', () => {
  // Query "jollibee"
  let res = filterTransactions(sampleTxns, { query: 'jollibee' }, sampleWallets);
  assert.equal(res.length, 1);
  assert.equal(res[0].id, 't1');

  // Query category "Transportation"
  res = filterTransactions(sampleTxns, { query: 'transportation' }, sampleWallets);
  assert.equal(res.length, 1);
  assert.equal(res[0].id, 't2');

  // Query wallet name "GoTyme" (matches stipend and transfer)
  res = filterTransactions(sampleTxns, { query: 'gotyme' }, sampleWallets);
  assert.equal(res.length, 2);

  // Query amount "8000"
  res = filterTransactions(sampleTxns, { query: '8000' }, sampleWallets);
  assert.equal(res.length, 1);
  assert.equal(res[0].id, 't3');
});

test('filterTransactions filters by transaction type', () => {
  const expenses = filterTransactions(sampleTxns, { type: 'expense' }, sampleWallets);
  assert.equal(expenses.length, 3);

  const incomes = filterTransactions(sampleTxns, { type: 'income' }, sampleWallets);
  assert.equal(incomes.length, 1);
  assert.equal(incomes[0].id, 't3');

  const transfers = filterTransactions(sampleTxns, { type: 'transfer' }, sampleWallets);
  assert.equal(transfers.length, 1);
  assert.equal(transfers[0].id, 't4');
});

test('filterTransactions filters by custom date range', () => {
  const toLocalYMD = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const from = toLocalYMD(now - 5 * oneDay);
  const to = toLocalYMD(now);

  const res = filterTransactions(sampleTxns, {
    dateRange: 'custom',
    customFrom: from,
    customTo: to
  }, sampleWallets);

  // Should include t1 (now), t2 (3 days ago), t4 (3 days ago)
  const ids = res.map(t => t.id).sort();
  assert.deepEqual(ids, ['t1', 't2', 't4']);
});

test('filterTransactions excludes balance adjustments by default, includes when explicitly requested', () => {
  const txnsWithAdj = [
    ...sampleTxns,
    { id: 't-adj', type: 'adjustment', direction: 'increase', amount: 500, walletId: 'w-cash', ts: now, deleted: false }
  ];

  // Default 'all' type: excludes adjustment
  const resDefault = filterTransactions(txnsWithAdj, { type: 'all' }, sampleWallets);
  assert.equal(resDefault.some(t => t.id === 't-adj'), false);
  assert.equal(resDefault.length, 5);

  // Explicit 'adjustment' type: includes adjustment
  const resAdjOnly = filterTransactions(txnsWithAdj, { type: 'adjustment' }, sampleWallets);
  assert.equal(resAdjOnly.length, 1);
  assert.equal(resAdjOnly[0].id, 't-adj');

  // Explicit includeAdjustments flag: includes adjustment
  const resInclude = filterTransactions(txnsWithAdj, { type: 'all', includeAdjustments: true }, sampleWallets);
  assert.equal(resInclude.length, 6);
  assert.equal(resInclude.some(t => t.id === 't-adj'), true);
});


// tests/cloud-sync.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const CloudEngine = require('../www/cloud.js');

test('CloudEngine exports core sync and LWW conflict resolution functions', () => {
  assert.equal(typeof CloudEngine.mergeTransactions, 'function');
  assert.equal(typeof CloudEngine.mergeUtangs, 'function');
  assert.equal(typeof CloudEngine.mergeWallets, 'function');
  assert.equal(typeof CloudEngine.mergeSettings, 'function');
  assert.equal(typeof CloudEngine.getPendingOutbox, 'function');
  assert.equal(typeof CloudEngine.rowFromTxn, 'function');
  assert.equal(typeof CloudEngine.txnFromRow, 'function');
});

test('Last-Write-Wins: Remote transaction with newer updated_at overwrites local', () => {
  const localTxns = [
    { id: 'tx-1', desc: 'Lunch at Cafeteria', amount: 80, cat: 'Food & Dining', ts: 1000, updated_at: 1000, deleted: false }
  ];
  const remoteRows = [
    {
      id: 'tx-1',
      description: 'Lunch at Cafeteria (Updated on Phone)',
      amount: 95,
      category: 'Food & Dining',
      occurred_at: new Date(1000).toISOString(),
      updated_at: new Date(2000).toISOString(),
      deleted: false
    }
  ];

  const res = CloudEngine.mergeTransactions(localTxns, remoteRows);
  assert.equal(res.changedLocal, true, 'Local state should update');
  assert.equal(res.merged.length, 1);
  assert.equal(res.merged[0].amount, 95);
  assert.equal(res.merged[0].desc, 'Lunch at Cafeteria (Updated on Phone)');
  assert.equal(res.merged[0].updated_at, 2000);
});

test('Last-Write-Wins: Local transaction with newer updated_at is kept and marked unpushed', () => {
  const localTxns = [
    { id: 'tx-1', desc: 'Dinner (Edited Offline)', amount: 150, cat: 'Food & Dining', ts: 1000, updated_at: 3000, deleted: false }
  ];
  const remoteRows = [
    {
      id: 'tx-1',
      description: 'Dinner (Old Cloud Version)',
      amount: 120,
      category: 'Food & Dining',
      occurred_at: new Date(1000).toISOString(),
      updated_at: new Date(2000).toISOString(),
      deleted: false
    }
  ];

  const res = CloudEngine.mergeTransactions(localTxns, remoteRows);
  assert.equal(res.merged.length, 1);
  assert.equal(res.merged[0].amount, 150, 'Local newer amount must win');
  assert.equal(res.merged[0].desc, 'Dinner (Edited Offline)');
  assert.equal(res.unpushed.length, 1, 'Local newer item must be queued for push');
  assert.equal(res.unpushed[0].id, 'tx-1');
});

test('Multi-Device Concurrency: Transactions created on separate devices merge without data loss', () => {
  const deviceA_Txns = [
    { id: 'tx-device-a', desc: 'Jeepney Fare', amount: 15, cat: 'Transportation', ts: 5000, updated_at: 5000, deleted: false }
  ];
  const deviceB_RemoteRows = [
    {
      id: 'tx-device-b',
      description: 'Photocopying Notes',
      amount: 25,
      category: 'Books & Supplies',
      occurred_at: new Date(5100).toISOString(),
      updated_at: new Date(5100).toISOString(),
      deleted: false
    }
  ];

  const res = CloudEngine.mergeTransactions(deviceA_Txns, deviceB_RemoteRows);
  assert.equal(res.merged.length, 2, 'Both transactions from Device A and Device B must exist');
  const ids = res.merged.map(t => t.id).sort();
  assert.deepEqual(ids, ['tx-device-a', 'tx-device-b']);
});

test('Tombstone Deletion: Deleted item on one device propagates to other devices', () => {
  const localTxns = [
    { id: 'tx-to-delete', desc: 'Accidental Entry', amount: 500, ts: 1000, updated_at: 1000, deleted: false }
  ];
  const remoteRows = [
    {
      id: 'tx-to-delete',
      description: 'Accidental Entry',
      amount: 500,
      occurred_at: new Date(1000).toISOString(),
      updated_at: new Date(4000).toISOString(),
      deleted: true
    }
  ];

  const res = CloudEngine.mergeTransactions(localTxns, remoteRows);
  assert.equal(res.merged.length, 1);
  assert.equal(res.merged[0].deleted, true, 'Deleted tombstone must be set to true');
  assert.equal(res.merged[0].updated_at, 4000);
});

test('LWW Utangs Merge: Merges loan updates and disjoint repayment payments', () => {
  const localUtangs = [
    {
      id: 'u-1',
      who: 'Mark',
      amount: 500,
      dir: 'lent',
      settled: false,
      updated_at: 1000,
      payments: [
        { id: 'pay-1', amount: 200, ts: 1000 }
      ]
    }
  ];
  const remoteUtangs = [
    {
      id: 'u-1',
      who: 'Mark',
      amount: 500,
      dir: 'lent',
      settled: false,
      updated_at: 2000,
      payments: [
        { id: 'pay-2', amount: 300, ts: 2000 }
      ]
    }
  ];

  const res = CloudEngine.mergeUtangs(localUtangs, remoteUtangs);
  assert.equal(res.merged.length, 1);
  const u = res.merged[0];
  assert.equal(u.payments.length, 2, 'Both pay-1 and pay-2 must be merged');
  assert.equal(u.settled, true, '500 total paid against 500 debt marks settled');
});

test('LWW Wallets Merge: Adds remote custom wallet and resolves conflicting edits', () => {
  const localWallets = [
    { id: 'w-cash', name: 'Cash', updated_at: 1000 },
    { id: 'w-custom-1', name: 'Alumni Card', color: '#007dfe', updated_at: 1000 }
  ];
  const remoteWallets = [
    { id: 'w-custom-1', name: 'Alumni Card (Gold)', color: '#eab308', updated_at: 2500 },
    { id: 'w-custom-2', name: 'Seabank', color: '#05a85c', updated_at: 2000 }
  ];

  const res = CloudEngine.mergeWallets(localWallets, remoteWallets);
  assert.equal(res.merged.length, 3);
  const w1 = res.merged.find(w => w.id === 'w-custom-1');
  assert.equal(w1.name, 'Alumni Card (Gold)');
  assert.equal(w1.color, '#eab308');
  assert.ok(res.merged.some(w => w.id === 'w-custom-2'));
});

test('LWW Settings Merge: Merges currency, limits, and allowance settings', () => {
  const localState = {
    currency: 'PHP',
    limits: { 'Food & Dining': 3000 },
    allowance: { amount: 1500, period: 'weekly' },
    settingsUpdated: 1000
  };
  const remoteBudgetData = {
    currency: 'USD',
    limits: { 'Food & Dining': 4000, 'Fun & Social': 1000 },
    allowance: { amount: 2000, period: 'monthly' },
    updated_at: 2000
  };

  const res = CloudEngine.mergeSettings(localState, remoteBudgetData);
  assert.equal(res.changedLocal, true);
  assert.equal(res.state.currency, 'USD');
  assert.equal(res.state.limits['Food & Dining'], 4000);
  assert.equal(res.state.limits['Fun & Social'], 1000);
  assert.equal(res.state.allowance.amount, 2000);
});

test('Outbox Watermark: Extracts only items modified after lastPush timestamp', () => {
  const txns = [
    { id: 't-1', updated_at: 1000 },
    { id: 't-2', updated_at: 2000 },
    { id: 't-3', updated_at: 3000 }
  ];

  const outbox = CloudEngine.getPendingOutbox(txns, 1500);
  assert.equal(outbox.length, 2);
  assert.deepEqual(outbox.map(t => t.id), ['t-2', 't-3']);
});

test('Row Serialization: rowFromTxn and txnFromRow roundtrip preserves rich metadata', () => {
  const uid = 'user-uuid-123';
  const originalTxn = {
    id: 'tx-transfer-1',
    desc: 'Transfer: Cash to GCash',
    amount: 500,
    type: 'expense',
    cat: 'Transfer',
    walletId: 'w-cash',
    toWalletId: 'w-gcash',
    fee: 15,
    ts: 1700000000000,
    updated_at: 1700000005000,
    deleted: false
  };

  const row = CloudEngine.rowFromTxn(uid, originalTxn);
  assert.equal(row.user_id, uid);
  assert.equal(row.id, 'tx-transfer-1');
  assert.equal(row.amount, 500);
  assert.equal(row.type, 'expense');

  const extraMeta = {
    'tx-transfer-1': {
      walletId: 'w-cash',
      toWalletId: 'w-gcash',
      fee: 15
    }
  };

  const restored = CloudEngine.txnFromRow(row, extraMeta);
  assert.equal(restored.id, originalTxn.id);
  assert.equal(restored.amount, originalTxn.amount);
  assert.equal(restored.walletId, 'w-cash');
  assert.equal(restored.toWalletId, 'w-gcash');
  assert.equal(restored.fee, 15);
  assert.equal(restored.updated_at, originalTxn.updated_at);
});

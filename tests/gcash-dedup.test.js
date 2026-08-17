// tests/gcash-dedup.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const WalletEngine = require('../www/wallet-engine.js');

const { generateGcashTxnId, strHash } = WalletEngine;

test('generateGcashTxnId generates deterministic ID when Ref No is present', () => {
  const parsed1 = { walletId: 'w-gcash', type: 'income', amount: 55, who: 'S** JA****', ref: '900123456789' };
  const id1 = generateGcashTxnId(parsed1, { ref: '900123456789' });

  const parsed2 = { walletId: 'w-gcash', type: 'income', amount: 55, who: 'S** JA****', ref: '900123456789' };
  const id2 = generateGcashTxnId(parsed2, { ref: '900123456789' });

  assert.equal(id1, 'gcash-ref-900123456789');
  assert.equal(id1, id2);
});

test('generateGcashTxnId generates deterministic ID for push notifications lacking Ref No', () => {
  const parsed = { walletId: 'w-gcash', type: 'income', amount: 55, who: 'S** JA****', desc: 'GCash · S** JA****' };
  const metaNotification = {
    key: '0|com.globe.gcash.android|4200|null|10250',
    postTime: 1723875600000,
    text: 'You have received PHP 55.00 of GCash from S** JA****.'
  };

  // Immediate ingestion
  const idInitial = generateGcashTxnId(parsed, metaNotification);

  // Re-scan 4 hours later (exact same Android notification in shade)
  const idRescan = generateGcashTxnId(parsed, metaNotification);

  assert.ok(idInitial.startsWith('gcash-key-'));
  assert.equal(idInitial, idRescan, 'Re-scanned notification must produce identical ID');
});

test('generateGcashTxnId differentiates distinct payments of the same amount with different post times', () => {
  const parsed = { walletId: 'w-gcash', type: 'income', amount: 55, who: 'S** JA****', desc: 'GCash · S** JA****' };
  
  // Payment 1 (10:00 AM)
  const id1 = generateGcashTxnId(parsed, {
    key: '0|com.globe.gcash.android|4201|null|10250',
    postTime: 1723880000000
  });

  // Payment 2 (2:30 PM - separate payment from same person for same amount)
  const id2 = generateGcashTxnId(parsed, {
    key: '0|com.globe.gcash.android|4202|null|10250',
    postTime: 1723896200000
  });

  assert.notEqual(id1, id2, 'Two separate payments must produce different IDs');
});

test('generateGcashTxnId fallback content fingerprint is stable', () => {
  const parsed = { walletId: 'w-gcash', type: 'income', amount: 55, who: 'S** JA****', desc: 'GCash · S** JA****' };
  const text = 'You have received PHP 55.00 of GCash from S** JA****.';
  
  const id1 = generateGcashTxnId(parsed, { text });
  const id2 = generateGcashTxnId(parsed, { text });

  assert.ok(id1.startsWith('gcash-fp-'));
  assert.equal(id1, id2);
});

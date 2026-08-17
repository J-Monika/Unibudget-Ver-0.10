// tests/allowance.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const WalletEngine = require('../www/wallet-engine.js');

const { computeAllowanceWindow, computeAllowanceBudget } = WalletEngine;

test('computeAllowanceWindow returns 1-day window for daily period', () => {
  const fakeNow = new Date('2026-08-17T14:30:00.000Z').getTime();
  const startOfDay = new Date('2026-08-17T00:00:00.000Z').setHours(0, 0, 0, 0);
  const endOfDay = startOfDay + 24 * 60 * 60 * 1000;

  const w = computeAllowanceWindow({ amount: 200, period: 'daily' }, fakeNow);
  assert.ok(w);
  assert.equal(w.len, 1);
  assert.equal(w.start, startOfDay);
  assert.equal(w.end, endOfDay);
});

test('computeAllowanceWindow returns 7-day window for weekly period', () => {
  const fakeAnchor = new Date('2026-08-10T00:00:00.000Z').getTime();
  const fakeNow = new Date('2026-08-12T10:00:00.000Z').getTime();

  const w = computeAllowanceWindow({ amount: 1500, period: 'weekly', anchor: fakeAnchor }, fakeNow);
  assert.ok(w);
  assert.equal(w.len, 7);
  assert.equal(w.start, fakeAnchor);
  assert.equal(w.end, fakeAnchor + 7 * 24 * 60 * 60 * 1000);
});

test('computeAllowanceBudget accurately scales daily, weekly, and monthly allowances', () => {
  // Daily allowance of 200/day
  const daily = { amount: 200, period: 'daily' };
  assert.equal(computeAllowanceBudget(daily, 'this-month'), 6000); // 200 * 30
  assert.equal(computeAllowanceBudget(daily, 'this-week'), 1400);  // 200 * 7

  // Weekly allowance of 1000/week
  const weekly = { amount: 1000, period: 'weekly' };
  assert.equal(computeAllowanceBudget(weekly, 'this-week'), 1000);
  assert.equal(computeAllowanceBudget(weekly, 'this-month'), 4330); // 1000 * 4.33

  // Monthly allowance of 8000/month
  const monthly = { amount: 8000, period: 'monthly' };
  assert.equal(computeAllowanceBudget(monthly, 'this-month'), 8000);
});

// tests/ipon-goals.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function computeIponRequirements(goals, nowMs = Date.now()) {
  const dayMs = 86400000;
  const activeGoals = (goals || []).filter(g => !g.deleted && !g.completed);
  let totalDailyIpon = 0;
  let totalRemaining = 0;
  let totalSaved = 0;
  const breakdown = [];

  activeGoals.forEach(g => {
    const saved = g.savedAmount || 0;
    totalSaved += saved;
    const remaining = Math.max(0, (g.targetAmount || 0) - saved);
    totalRemaining += remaining;

    if (remaining > 0) {
      const targetMs = g.targetDate ? new Date(g.targetDate + "T23:59:59").getTime() : (nowMs + 30 * dayMs);
      const daysLeft = Math.max(1, Math.ceil((targetMs - nowMs) / dayMs));
      const dailyRate = remaining / daysLeft;
      totalDailyIpon += dailyRate;
      breakdown.push({ id: g.id, name: g.name, daysLeft, dailyRate, remaining });
    }
  });

  return {
    activeCount: activeGoals.length,
    totalSaved,
    totalRemaining,
    totalDailyIpon,
    breakdown
  };
}

function computeDualSegmentSafeToSpend(allowanceAmount, availableBaon, daysLeft, totalDailyIpon) {
  const periodIponNeeded = totalDailyIpon * daysLeft;
  const disposableAvailable = Math.max(0, availableBaon - periodIponNeeded);
  const disposableSafePerDay = disposableAvailable / daysLeft;

  const isEatingIntoIpon = totalDailyIpon > 0 && availableBaon > 0 && availableBaon < periodIponNeeded;
  const isTotallyBroke = availableBaon <= 0;

  // Percentage splits (Green disposable first from left, Blue Ipon buffer second)
  const pctDisposable = allowanceAmount > 0 ? Math.max(0, Math.min(100, (disposableAvailable / allowanceAmount) * 100)) : 0;
  const iponPortion = totalDailyIpon > 0 ? Math.min(periodIponNeeded, availableBaon) : 0;
  const pctIpon = allowanceAmount > 0 ? Math.max(0, Math.min(100 - pctDisposable, (iponPortion / allowanceAmount) * 100)) : 0;

  return {
    disposableAvailable,
    disposableSafePerDay,
    periodIponNeeded,
    iponPortion,
    pctDisposable,
    pctIpon,
    isEatingIntoIpon,
    isTotallyBroke
  };
}

test('computeIponRequirements accurately computes daily rates and remaining balances', () => {
  const nowMs = new Date('2026-08-21T00:00:00Z').getTime();
  const goals = [
    {
      id: 'g-laptop',
      name: 'Laptop for Thesis',
      targetAmount: 15000,
      savedAmount: 3000,
      targetDate: '2026-11-19', // ~91 days away
      completed: false,
      deleted: false
    },
    {
      id: 'g-concert',
      name: 'Concert Ticket',
      targetAmount: 4500,
      savedAmount: 0,
      targetDate: '2026-10-05', // ~46 days away
      completed: false,
      deleted: false
    },
    {
      id: 'g-done',
      name: 'Old Trip',
      targetAmount: 2000,
      savedAmount: 2000,
      completed: true,
      deleted: false
    }
  ];

  const req = computeIponRequirements(goals, nowMs);
  assert.equal(req.activeCount, 2, 'Should only count 2 uncompleted goals');
  assert.equal(req.totalSaved, 3000, 'Saved total for active goals is 3000');
  assert.equal(req.totalRemaining, 12000 + 4500, 'Remaining total is 16500');

  // Laptop: 12,000 / 91 days = ~131.87/day
  // Concert: 4,500 / 46 days = ~97.83/day
  // Total: ~229.70/day
  assert.ok(req.totalDailyIpon > 225 && req.totalDailyIpon < 235, 'Daily rate sum is accurately calculated');
});

test('Dual-segment Safe to Spend allocates Green disposable FIRST before Blue Ipon', () => {
  const allowanceAmount = 1000;
  const daysLeft = 5;
  const totalDailyIpon = 50; // Needs 250 for period (50 * 5)

  // 1. Fresh state: 1000 available
  const fresh = computeDualSegmentSafeToSpend(allowanceAmount, 1000, daysLeft, totalDailyIpon);
  assert.equal(fresh.disposableAvailable, 750, 'Disposable available is 750 (1000 - 250)');
  assert.equal(fresh.disposableSafePerDay, 150, 'Disposable rate is 150/day (750 / 5)');
  assert.equal(fresh.pctDisposable, 75, 'Green bar is 75%');
  assert.equal(fresh.pctIpon, 25, 'Blue bar is 25%');
  assert.equal(fresh.isEatingIntoIpon, false);

  // 2. Mid spending: Spent 300 -> 700 available
  const mid = computeDualSegmentSafeToSpend(allowanceAmount, 700, 4, totalDailyIpon);
  // Period ipon needed = 50 * 4 = 200
  assert.equal(mid.disposableAvailable, 500, 'Disposable is 500 (700 - 200)');
  assert.equal(mid.disposableSafePerDay, 125, 'Disposable rate is 125/day (500 / 4)');
  assert.equal(mid.pctDisposable, 50, 'Green bar is 50%');
  assert.equal(mid.pctIpon, 20, 'Blue bar is 20%');

  // 3. Low disposable cash: Only 300 available, 2 days left (100 ipon needed)
  const low = computeDualSegmentSafeToSpend(allowanceAmount, 300, 2, totalDailyIpon);
  assert.equal(low.disposableAvailable, 200);
  assert.equal(low.disposableSafePerDay, 100);
  assert.equal(low.isEatingIntoIpon, false);

  // 4. Overspent / Eating into Ipon: 200 available, 5 days left (250 ipon needed)
  const danger = computeDualSegmentSafeToSpend(allowanceAmount, 200, 5, totalDailyIpon);
  assert.equal(danger.disposableAvailable, 0, 'Disposable is 0 when eating into Ipon');
  assert.equal(danger.disposableSafePerDay, 0);
  assert.equal(danger.pctDisposable, 0, 'Green bar is 0%');
  assert.equal(danger.pctIpon, 20, 'Blue bar is 20% (200 of 1000)');
  assert.equal(danger.isEatingIntoIpon, true, 'Flagged as eating into Ipon savings');
});

test('index.html contains dual-segment Safe to Spend bar and correct hero text format', () => {
  const html = fs.readFileSync(path.join(__dirname, '../www/index.html'), 'utf8');

  // Multi-segment classes
  assert.match(html, /\.fc-bar-spend/, 'Must contain .fc-bar-spend style');
  assert.match(html, /\.fc-bar-ipon/, 'Must contain .fc-bar-ipon style');
  assert.match(html, /safe\/day to hit ipon goal/, 'Must contain secondary line: safe/day to hit ipon goal');
});

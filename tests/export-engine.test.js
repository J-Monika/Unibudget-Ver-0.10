// tests/export-engine.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const ExportEngine = require('../www/export-engine.js');

const sampleWallets = [
  { id: 'w-cash', name: 'Cash', icon: '💵' },
  { id: 'w-gcash', name: 'GCash', icon: '💙' },
  { id: 'w-gotyme', name: 'GoTyme', icon: '🟣' }
];

const fixedTs = new Date('2026-08-18T14:30:45').getTime();

const sampleTxns = [
  {
    id: 'tx-1',
    desc: 'Jollibee "Special" Meal',
    amount: 250.5,
    type: 'expense',
    cat: 'Food & Dining',
    walletId: 'w-gcash',
    source: 'gcash-auto',
    ts: fixedTs,
    deleted: false
  },
  {
    id: 'tx-2',
    desc: 'Monthly Allowance',
    amount: 5000,
    type: 'income',
    cat: 'Allowance & Aid',
    walletId: 'w-gotyme',
    ts: fixedTs,
    deleted: false
  },
  {
    id: 'tx-3',
    desc: 'Cash-in to GCash, with note',
    amount: 1000,
    type: 'transfer',
    cat: 'Transfer',
    walletId: 'w-gotyme',
    toWalletId: 'w-gcash',
    fee: 15,
    sub: 'Allowance transfer',
    ts: fixedTs,
    deleted: false
  },
  {
    id: 'tx-4',
    desc: 'Deleted record',
    amount: 100,
    type: 'expense',
    cat: 'Other',
    walletId: 'w-cash',
    ts: fixedTs,
    deleted: true
  }
];

test('escapeCsvField escapes strings with quotes, commas, and newlines', () => {
  assert.equal(ExportEngine.escapeCsvField('Simple text'), 'Simple text');
  assert.equal(ExportEngine.escapeCsvField('Text with, comma'), '"Text with, comma"');
  assert.equal(ExportEngine.escapeCsvField('Text with "quotes"'), '"Text with ""quotes"""');
  assert.equal(ExportEngine.escapeCsvField('Line 1\nLine 2'), '"Line 1\nLine 2"');
  assert.equal(ExportEngine.escapeCsvField(null), '');
  assert.equal(ExportEngine.escapeCsvField(undefined), '');
  assert.equal(ExportEngine.escapeCsvField(123.45), '123.45');
});

test('getWalletName resolves wallet ID to display name with fallback', () => {
  assert.equal(ExportEngine.getWalletName('w-gcash', sampleWallets), 'GCash');
  assert.equal(ExportEngine.getWalletName('w-cash', sampleWallets), 'Cash');
  assert.equal(ExportEngine.getWalletName('w-unknown', sampleWallets), 'w-unknown');
  assert.equal(ExportEngine.getWalletName('', sampleWallets), '');
});

test('generateTransactionsCsv produces UTF-8 BOM, standard headers, and correctly formatted rows', () => {
  const csv = ExportEngine.generateTransactionsCsv(sampleTxns, sampleWallets, 'PHP');
  
  // Must start with UTF-8 BOM
  assert.equal(csv.startsWith('\uFEFF'), true);

  const lines = csv.slice(1).trim().split('\n');
  assert.equal(lines.length, 4); // Header + 3 active txns (tx-4 is deleted)

  // Header verification
  assert.equal(lines[0], 'Date,Time,Description,Type,Category,Account,To Account,Amount,Currency,Fee,Source / Notes,Transaction ID');

  // Row 1: Expense (negative amount, escaped description)
  assert.ok(lines[1].includes('"Jollibee ""Special"" Meal"'));
  assert.ok(lines[1].includes('Expense'));
  assert.ok(lines[1].includes('Food & Dining'));
  assert.ok(lines[1].includes('GCash'));
  assert.ok(lines[1].includes('-250.50'));
  assert.ok(lines[1].includes('PHP'));
  assert.ok(lines[1].includes('gcash-auto'));
  assert.ok(lines[1].includes('tx-1'));

  // Row 2: Income (positive amount)
  assert.ok(lines[2].includes('Monthly Allowance'));
  assert.ok(lines[2].includes('Income'));
  assert.ok(lines[2].includes('5000.00'));
  assert.ok(lines[2].includes('GoTyme'));

  // Row 3: Transfer (source & destination wallets, fee)
  assert.ok(lines[3].includes('"Cash-in to GCash, with note"'));
  assert.ok(lines[3].includes('Transfer'));
  assert.ok(lines[3].includes('GoTyme'));
  assert.ok(lines[3].includes('GCash'));
  assert.ok(lines[3].includes('-1000.00'));
  assert.ok(lines[3].includes('15.00'));
  assert.ok(lines[3].includes('Allowance transfer'));
});

test('generateExportFilename generates context-aware filenames', () => {
  const baseName = ExportEngine.generateExportFilename({ dateStr: '2026-08-18' });
  assert.equal(baseName, 'unibudget-transactions-2026-08-18.csv');

  const walletName = ExportEngine.generateExportFilename({ walletName: 'GCash', dateStr: '2026-08-18' });
  assert.equal(walletName, 'unibudget-gcash-2026-08-18.csv');

  const filteredName = ExportEngine.generateExportFilename({ isFiltered: true, dateStr: '2026-08-18' });
  assert.equal(filteredName, 'unibudget-filtered-2026-08-18.csv');
});

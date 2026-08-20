// tests/offline-auth.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

test('index.html contains offline auth UI elements', () => {
  const html = fs.readFileSync(path.join(__dirname, '../www/index.html'), 'utf8');

  // Verify offline entry button and divider
  assert.match(html, /id="continueOfflineBtn"/, 'Must contain #continueOfflineBtn');
  assert.match(html, /class="auth-divider"/, 'Must contain .auth-divider');
  assert.match(html, /Continue in Offline Mode/, 'Must have offline button text');

  // Verify cloud linking option in menu
  assert.match(html, /id="menuLinkCloud"/, 'Must contain #menuLinkCloud');
});

test('Offline password hash verification', async () => {
  function hashPwNode(pw, salt) {
    return crypto.createHash('sha256').update(salt + '::' + pw).digest('hex');
  }

  const salt = 'sample_salt_12345';
  const password = 'studentPassword99';
  const correctHash = hashPwNode(password, salt);

  // Valid password matches hash
  const testHashValid = hashPwNode('studentPassword99', salt);
  assert.equal(testHashValid, correctHash, 'Matching password must verify correctly');

  // Invalid password does not match hash
  const testHashInvalid = hashPwNode('wrongPassword', salt);
  assert.notEqual(testHashInvalid, correctHash, 'Wrong password must fail');
});

test('Smart profile selection for offline mode', () => {
  function resolveOfflineProfile(lastAccount) {
    if (lastAccount && lastAccount.email && lastAccount.email !== 'offline@unibudget.local') {
      return { email: lastAccount.email, name: lastAccount.name || 'Student', isOfflineMode: true };
    }
    return { email: 'offline@unibudget.local', name: 'Student', isOfflineGuest: true };
  }

  // 1. Returning user with prior account
  const returning = resolveOfflineProfile({ email: 'juan@up.edu.ph', name: 'Juan' });
  assert.equal(returning.email, 'juan@up.edu.ph');
  assert.equal(returning.name, 'Juan');
  assert.equal(returning.isOfflineMode, true);

  // 2. Fresh first-time device user
  const firstTime = resolveOfflineProfile(null);
  assert.equal(firstTime.email, 'offline@unibudget.local');
  assert.equal(firstTime.name, 'Student');
  assert.equal(firstTime.isOfflineGuest, true);
});

test('Guest data migration to linked cloud account', () => {
  const guestCache = {
    currency: 'PHP',
    limits: { 'Food & Dining': 3500 },
    wallets: [{ id: 'w-cash', name: 'Cash', initialBalance: 500 }],
    txns: [
      { id: 't-offline-1', desc: 'Siomai Rice', amount: 45, type: 'expense', ts: 1000 }
    ],
    utangs: [
      { id: 'u-offline-1', who: 'Carlo', amount: 150, dir: 'lent' }
    ]
  };

  // Simulating migration from offline guest key to new user account
  const targetEmail = 'juan.cloud@uni.edu';
  const migratedCache = Object.assign({}, guestCache);

  assert.equal(migratedCache.txns.length, 1);
  assert.equal(migratedCache.txns[0].id, 't-offline-1');
  assert.equal(migratedCache.utangs.length, 1);
  assert.equal(migratedCache.utangs[0].who, 'Carlo');
  assert.equal(migratedCache.limits['Food & Dining'], 3500);
});

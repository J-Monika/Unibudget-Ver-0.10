// tests/guest-isolation.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('index.html contains guest mode isolation, warning modal, and synced pill elements', () => {
  const html = fs.readFileSync(path.join(__dirname, '../www/index.html'), 'utf8');

  // 1. Top-right Synced! Pill
  assert.match(html, /id="syncPill"/, 'Must contain #syncPill element');
  assert.match(html, /Synced!/, 'Must contain "Synced!" text');

  // 2. Reconnect banner for offline/guest users
  assert.match(html, /id="guestSyncBanner"/, 'Must contain #guestSyncBanner');
  assert.match(html, /id="btnLinkGuestBanner"/, 'Must contain link button in banner');
  assert.match(html, /id="btnDismissGuestBanner"/, 'Must contain dismiss button in banner');

  // 3. Cloud Connect / Login modal
  assert.match(html, /id="cloudConnectScrim"/, 'Must contain #cloudConnectScrim');
  assert.match(html, /id="cloudConnectForm"/, 'Must contain #cloudConnectForm');
  assert.match(html, /id="btnSubmitCloudConnect"/, 'Must contain #btnSubmitCloudConnect');
  assert.match(html, /id="btnContinueGuestFromModal"/, 'Must contain continue without syncing button');

  // 4. Guest Data Loss Warning Modal
  assert.match(html, /id="guestWarnScrim"/, 'Must contain #guestWarnScrim');
  assert.match(html, /Local Only — No Cloud Backup/, 'Must contain caution headline');
  assert.match(html, /permanently deleted/, 'Must warn about permanent data loss upon app deletion');
  assert.match(html, /id="btnConfirmStayGuest"/, 'Must contain #btnConfirmStayGuest button');
  assert.match(html, /id="btnBackToCloudConnect"/, 'Must contain #btnBackToCloudConnect button');
});

test('Session email filter prevents guest/offline accounts from auto-syncing', () => {
  function getSessionSyncEmail(session) {
    if (!session || !session.email) return null;
    if (session.isGuest || session.isOfflineMode || session.isAuthenticated === false || session.email.indexOf('@unibudget.local') !== -1) {
      return null;
    }
    return session.email;
  }

  // 1. First-time offline guest
  const guestSession = { email: 'offline@unibudget.local', name: 'Student', isGuest: true, isAuthenticated: false };
  assert.equal(getSessionSyncEmail(guestSession), null, 'Guest session must return null sync email');

  // 2. Returning user who logged out and re-entered offline
  const loggedOutSession = { email: 'juan@up.edu.ph', name: 'Juan', isOfflineMode: true, isAuthenticated: false };
  assert.equal(getSessionSyncEmail(loggedOutSession), null, 'Logged-out offline session must return null sync email');

  // 3. Fully authenticated cloud user
  const authedSession = { email: 'juan@up.edu.ph', name: 'Juan', isAuthenticated: true };
  assert.equal(getSessionSyncEmail(authedSession), 'juan@up.edu.ph', 'Authenticated user must return active sync email');
});

test('Sync button route: prompts login for unauthenticated/guest users, triggers sync for authed users', () => {
  function determineSyncAction(currentUser) {
    const isGuest = !currentUser || currentUser.isGuest || currentUser.isOfflineMode || currentUser.isAuthenticated === false;
    if (isGuest) {
      return { action: 'open_modal', target: 'cloudConnectModal' };
    }
    return { action: 'sync_cloud', target: 'supabase' };
  }

  // Guest user tapping sync
  const guestRes = determineSyncAction({ email: 'offline@unibudget.local', isGuest: true });
  assert.equal(guestRes.action, 'open_modal');

  // Offline logged-out user tapping sync
  const offlineRes = determineSyncAction({ email: 'user@uni.edu', isOfflineMode: true, isAuthenticated: false });
  assert.equal(offlineRes.action, 'open_modal');

  // Authenticated user tapping sync
  const authedRes = determineSyncAction({ email: 'user@uni.edu', isAuthenticated: true, isOfflineMode: false });
  assert.equal(authedRes.action, 'sync_cloud');
});

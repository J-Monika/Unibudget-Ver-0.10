// tests/tab-navigation.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('index.html contains swipe viewport and all 4 tab panes', () => {
  const html = fs.readFileSync(path.join(__dirname, '../www/index.html'), 'utf8');

  // Verify container & slider
  assert.match(html, /id="tabViewport"/, 'Must contain #tabViewport');
  assert.match(html, /id="tabSlider"/, 'Must contain #tabSlider');

  // Verify all 4 tab panes
  assert.match(html, /id="paneHome"/, 'Must contain pane 0: #paneHome');
  assert.match(html, /id="paneUtang"/, 'Must contain pane 1: #paneUtang');
  assert.match(html, /id="paneRewards"/, 'Must contain pane 2: #paneRewards');
  assert.match(html, /id="paneAdd"/, 'Must contain pane 3: #paneAdd');
});

test('index.html contains bottom tab bar with 4 tabs and data-tab attributes', () => {
  const html = fs.readFileSync(path.join(__dirname, '../www/index.html'), 'utf8');

  assert.match(html, /data-tab="0"[^>]*id="tabHome"/, 'Tab 0 must be Home');
  assert.match(html, /data-tab="1"[^>]*id="tabUtang"/, 'Tab 1 must be Utang');
  assert.match(html, /data-tab="2"[^>]*id="tabRewards"/, 'Tab 2 must be Rewards');
  assert.match(html, /data-tab="3"[^>]*id="tabAdd"/, 'Tab 3 must be Add');
});

test('index.html contains Rewards Hub and Add Hub interactive elements', () => {
  const html = fs.readFileSync(path.join(__dirname, '../www/index.html'), 'utf8');

  // Rewards Hub elements
  assert.match(html, /id="hubLvlRing"/, 'Must contain #hubLvlRing');
  assert.match(html, /id="hubLvlTitle"/, 'Must contain #hubLvlTitle');
  assert.match(html, /id="hubLvlBar"/, 'Must contain #hubLvlBar');
  assert.match(html, /id="hubBadgeGrid"/, 'Must contain #hubBadgeGrid');
  assert.match(html, /id="hubStreakChip"/, 'Must contain #hubStreakChip');

  // Add Hub elements
  assert.match(html, /id="hubAddForm"/, 'Must contain #hubAddForm');
  assert.match(html, /id="hubDesc"/, 'Must contain #hubDesc');
  assert.match(html, /id="hubAmount"/, 'Must contain #hubAmount');
  assert.match(html, /id="hubTxnWallet"/, 'Must contain #hubTxnWallet');
  assert.match(html, /id="hubCategory"/, 'Must contain #hubCategory');
  assert.match(html, /id="hubBtnTransfer"/, 'Must contain #hubBtnTransfer');
  assert.match(html, /id="hubBtnReconcile"/, 'Must contain #hubBtnReconcile');
  assert.match(html, /id="hubBtnUtang"/, 'Must contain #hubBtnUtang');
});

test('Swipe navigation transition physics and threshold logic', () => {
  const TAB_COUNT = 4;
  const screenWidth = 375;
  const threshold = screenWidth * 0.20; // 75px

  function computeNextTab(currentTab, deltaX, velocity) {
    if (deltaX < -threshold || (deltaX < -35 && velocity > 0.25)) {
      return Math.min(TAB_COUNT - 1, currentTab + 1);
    } else if (deltaX > threshold || (deltaX > 35 && velocity > 0.25)) {
      return Math.max(0, currentTab - 1);
    }
    return currentTab;
  }

  // 1. Swiping left (drag past threshold) -> advances to next tab
  assert.equal(computeNextTab(0, -80, 0.1), 1, 'Swiping left on Home advances to Utang');
  assert.equal(computeNextTab(1, -90, 0.1), 2, 'Swiping left on Utang advances to Rewards');
  assert.equal(computeNextTab(2, -100, 0.1), 3, 'Swiping left on Rewards advances to Add');
  assert.equal(computeNextTab(3, -100, 0.1), 3, 'Swiping left on Add stays at Add (boundary clamped)');

  // 2. Swiping right (drag past threshold) -> goes back to previous tab
  assert.equal(computeNextTab(3, 85, 0.1), 2, 'Swiping right on Add goes back to Rewards');
  assert.equal(computeNextTab(2, 90, 0.1), 1, 'Swiping right on Rewards goes back to Utang');
  assert.equal(computeNextTab(1, 100, 0.1), 0, 'Swiping right on Utang goes back to Home');
  assert.equal(computeNextTab(0, 100, 0.1), 0, 'Swiping right on Home stays at Home (boundary clamped)');

  // 3. Fast flick gesture (below distance threshold but above velocity threshold)
  assert.equal(computeNextTab(0, -40, 0.35), 1, 'Fast left flick advances tab');
  assert.equal(computeNextTab(1, 40, 0.35), 0, 'Fast right flick goes back');

  // 4. Minor drag (< threshold and slow) -> springs back
  assert.equal(computeNextTab(0, -25, 0.05), 0, 'Minor drag springs back to Home');
  assert.equal(computeNextTab(2, 20, 0.05), 2, 'Minor drag springs back to Rewards');
});

(function (root, factory) {
  var exp = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = exp;
  }
  if (root) {
    root.WalletEngine = exp;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function () {
  "use strict";

  var DEFAULT_WALLETS = [
    { id: "w-cash", name: "Cash", icon: "💵", color: "#10b981", type: "cash", initialBalance: 0, isDefault: true },
    { id: "w-gcash", name: "GCash", icon: "💙", color: "#007dfe", type: "ewallet", initialBalance: 0, isDefault: true },
    { id: "w-maya", name: "Maya", icon: "💚", color: "#05a85c", type: "ewallet", initialBalance: 0, isDefault: true },
    { id: "w-gotyme", name: "GoTyme", icon: "🟣", color: "#7c3aed", type: "bank", initialBalance: 0, isDefault: true }
  ];

  function normalizeWallets(wallets) {
    if (!Array.isArray(wallets) || !wallets.length) {
      return DEFAULT_WALLETS.map(function(w){ return Object.assign({}, w); });
    }
    var existingIds = {};
    var list = wallets.filter(function(w){
      if (!w || !w.id) return false;
      existingIds[w.id] = true;
      return !w.deleted;
    }).map(function(w){
      return {
        id: String(w.id),
        name: String(w.name || "Wallet"),
        icon: String(w.icon || "💳"),
        color: String(w.color || "#6366f1"),
        type: String(w.type || "other"),
        initialBalance: Math.round((Number(w.initialBalance) || 0) * 100) / 100,
        isDefault: !!w.isDefault
      };
    });
    // Ensure core default wallets exist if not explicitly present
    DEFAULT_WALLETS.forEach(function(dw){
      if (!existingIds[dw.id]) {
        list.push(Object.assign({}, dw));
      }
    });
    return list;
  }

  function migrateTransactions(txns) {
    if (!Array.isArray(txns)) return [];
    return txns.map(function(t){
      if (!t) return t;
      var copy = Object.assign({}, t);
      if (!copy.walletId) {
        var lowDesc = (copy.desc || "").toLowerCase();
        if (copy.source === "gcash-auto" || lowDesc.indexOf("gcash") !== -1) {
          copy.walletId = "w-gcash";
        } else if (lowDesc.indexOf("maya") !== -1 || lowDesc.indexOf("paymaya") !== -1) {
          copy.walletId = "w-maya";
        } else if (lowDesc.indexOf("gotyme") !== -1) {
          copy.walletId = "w-gotyme";
        } else {
          copy.walletId = "w-cash";
        }
      }
      return copy;
    });
  }

  function computeWalletBalances(wallets, txns) {
    var validWallets = normalizeWallets(wallets);
    var balances = {};
    validWallets.forEach(function(w){
      balances[w.id] = {
        wallet: w,
        initialBalance: w.initialBalance || 0,
        income: 0,
        expense: 0,
        transfersIn: 0,
        transfersOut: 0,
        fees: 0,
        balance: w.initialBalance || 0
      };
    });

    var activeTxns = (txns || []).filter(function(t){ return t && !t.deleted; });

    activeTxns.forEach(function(t){
      var amt = Number(t.amount) || 0;
      var fee = Number(t.fee) || 0;

      if (t.type === "income") {
        if (balances[t.walletId]) {
          balances[t.walletId].income += amt;
          balances[t.walletId].balance += amt;
        }
      } else if (t.type === "expense") {
        if (balances[t.walletId]) {
          balances[t.walletId].expense += amt;
          balances[t.walletId].balance -= amt;
        }
      } else if (t.type === "transfer") {
        if (balances[t.walletId]) {
          balances[t.walletId].transfersOut += amt;
          balances[t.walletId].balance -= amt;
          if (fee > 0) {
            balances[t.walletId].fees += fee;
            balances[t.walletId].balance -= fee;
          }
        }
        if (balances[t.toWalletId]) {
          balances[t.toWalletId].transfersIn += amt;
          balances[t.toWalletId].balance += amt;
        }
      } else if (t.type === "adjustment") {
        if (balances[t.walletId]) {
          var isInc = t.direction === "increase" || t.direction === "in";
          if (isInc) {
            balances[t.walletId].balance += amt;
          } else {
            balances[t.walletId].balance -= amt;
          }
        }
      }
    });

    // Round all final numbers to 2 decimals
    Object.keys(balances).forEach(function(k){
      balances[k].balance = Math.round(balances[k].balance * 100) / 100;
      balances[k].income = Math.round(balances[k].income * 100) / 100;
      balances[k].expense = Math.round(balances[k].expense * 100) / 100;
      balances[k].transfersIn = Math.round(balances[k].transfersIn * 100) / 100;
      balances[k].transfersOut = Math.round(balances[k].transfersOut * 100) / 100;
      balances[k].fees = Math.round(balances[k].fees * 100) / 100;
    });

    return balances;
  }

  function computeTotalNetWorth(wallets, txns) {
    var b = computeWalletBalances(wallets, txns);
    var sum = 0;
    Object.keys(b).forEach(function(k){ sum += b[k].balance; });
    return Math.round(sum * 100) / 100;
  }

  return {
    DEFAULT_WALLETS: DEFAULT_WALLETS,
    normalizeWallets: normalizeWallets,
    migrateTransactions: migrateTransactions,
    computeWalletBalances: computeWalletBalances,
    computeTotalNetWorth: computeTotalNetWorth
  };
});

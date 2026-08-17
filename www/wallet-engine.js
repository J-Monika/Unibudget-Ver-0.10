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

  function strHash(s) {
    var str = String(s || "");
    var hash = 5381;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  function generateGcashTxnId(parsed, meta) {
    if (!parsed) return "gcash-" + Date.now();
    meta = meta || {};
    var ref = parsed.ref || meta.ref;
    if (ref) {
      return "gcash-ref-" + ref;
    }
    if (meta.key) {
      return "gcash-key-" + strHash(parsed.walletId + ":" + parsed.type + ":" + parsed.amount + ":" + (parsed.who || "") + ":" + meta.key);
    }
    if (meta.postTime && Number(meta.postTime) > 0) {
      return "gcash-post-" + strHash(parsed.walletId + ":" + parsed.type + ":" + parsed.amount + ":" + (parsed.who || "") + ":" + meta.postTime);
    }
    var rawText = (meta.text || parsed.desc || "").trim().toLowerCase();
    return "gcash-fp-" + strHash(parsed.walletId + ":" + parsed.type + ":" + parsed.amount + ":" + (parsed.who || "") + ":" + rawText);
  }

  function getStartOfWeek(date) {
    var d = new Date(date || Date.now());
    var day = d.getDay();
    var diff = d.getDate() - day + (day === 0 ? -6 : 1);
    var monday = new Date(d.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    return monday.getTime();
  }

  function getStartOfMonth(date) {
    var d = new Date(date || Date.now());
    return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0).getTime();
  }

  function filterTransactions(txns, options, wallets) {
    if (!Array.isArray(txns)) return [];
    options = options || {};
    var query = (options.query || "").trim().toLowerCase();
    var dateRange = options.dateRange || "all";
    var customFrom = options.customFrom ? new Date(options.customFrom).setHours(0, 0, 0, 0) : null;
    var customTo = options.customTo ? new Date(options.customTo).setHours(23, 59, 59, 999) : null;
    var type = options.type || "all";
    var walletId = options.walletId || null;

    var walletMap = {};
    if (Array.isArray(wallets)) {
      wallets.forEach(function(w){ if (w && w.id) walletMap[w.id] = w; });
    }

    var now = Date.now();
    var weekStart = getStartOfWeek(now);
    var monthStart = getStartOfMonth(now);

    return txns.filter(function(t) {
      if (!t || t.deleted) return false;

      // 1. Wallet Filter
      if (walletId) {
        var matchW = t.walletId === walletId || (t.type === "transfer" && t.toWalletId === walletId);
        if (!matchW) return false;
      }

      // 2. Type Filter
      if (type !== "all") {
        if (type === "expense" && t.type !== "expense") return false;
        if (type === "income" && t.type !== "income") return false;
        if (type === "transfer" && t.type !== "transfer") return false;
        if (type === "adjustment" && t.type !== "adjustment") return false;
      }

      // 3. Date Range Filter
      var ts = Number(t.ts) || 0;
      if (dateRange === "this-week") {
        if (ts < weekStart) return false;
      } else if (dateRange === "this-month") {
        if (ts < monthStart) return false;
      } else if (dateRange === "custom") {
        if (customFrom && ts < customFrom) return false;
        if (customTo && ts > customTo) return false;
      }

      // 4. Query Matching
      if (query) {
        var wSrcName = (walletMap[t.walletId] || {}).name || "";
        var wDstName = (t.toWalletId && walletMap[t.toWalletId]) ? walletMap[t.toWalletId].name : "";
        var matchString = (
          (t.desc || "") + " " +
          (t.sub || "") + " " +
          (t.cat || "") + " " +
          (t.ref || "") + " " +
          wSrcName + " " +
          wDstName + " " +
          String(t.amount || "")
        ).toLowerCase();

        if (matchString.indexOf(query) === -1) return false;
      }

      return true;
    });
  }

  return {
    DEFAULT_WALLETS: DEFAULT_WALLETS,
    normalizeWallets: normalizeWallets,
    migrateTransactions: migrateTransactions,
    computeWalletBalances: computeWalletBalances,
    computeTotalNetWorth: computeTotalNetWorth,
    strHash: strHash,
    generateGcashTxnId: generateGcashTxnId,
    getStartOfWeek: getStartOfWeek,
    getStartOfMonth: getStartOfMonth,
    filterTransactions: filterTransactions
  };
});

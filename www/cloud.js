// ============================================================
//  UniBudget — Supabase cloud adapter (offline-first, per-row sync)
//  Exposes window.Cloud & window.CloudEngine.
//  - Offline-first: instant local cache read/write with zero latency.
//  - Automatic two-way sync upon reconnection for authenticated users.
//  - Strict local isolation for Guest / Unauthenticated offline users.
//  - Per-record Last-Write-Wins (LWW) timestamp conflict resolution.
//  - Tombstones for deletion propagation across devices.
// ============================================================
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    var engine = factory();
    root.CloudEngine = engine;
    root.Cloud = engine.initClient ? engine.initClient() : engine;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---- Pure LWW Merging & Serialization Helpers ----
  function getTimestamp(item) {
    if (!item) return 0;
    var t = item.updated_at || item.ts || 0;
    if (typeof t === "string") {
      var d = new Date(t).getTime();
      return isNaN(d) ? 0 : d;
    }
    return Number(t) || 0;
  }

  function rowFromTxn(uid, t) {
    var ts = typeof t.ts === "number" ? t.ts : (new Date(t.ts || Date.now()).getTime());
    var updated = typeof t.updated_at === "number" ? t.updated_at : (t.updated_at ? new Date(t.updated_at).getTime() : ts);

    return {
      user_id: uid,
      id: String(t.id),
      amount: Number(t.amount) || 0,
      type: t.type === "income" ? "income" : "expense",
      category: t.cat || null,
      description: t.desc || null,
      occurred_at: new Date(ts).toISOString(),
      updated_at: new Date(updated).toISOString(),
      deleted: !!t.deleted
    };
  }

  function txnFromRow(r, extraMeta) {
    var ts = r.occurred_at ? new Date(r.occurred_at).getTime() : Date.now();
    var updated = r.updated_at ? new Date(r.updated_at).getTime() : ts;
    var meta = (extraMeta && extraMeta[r.id]) ? extraMeta[r.id] : {};

    var t = {
      id: String(r.id),
      amount: Number(r.amount) || 0,
      type: r.type || "expense",
      cat: r.category || meta.cat || "Other",
      desc: r.description || meta.desc || "",
      ts: ts,
      updated_at: updated,
      deleted: !!r.deleted,
      walletId: meta.walletId || (String(r.id).indexOf("gcash-") === 0 ? "w-gcash" : "w-cash")
    };

    if (meta.toWalletId) t.toWalletId = meta.toWalletId;
    if (meta.fee !== undefined) t.fee = meta.fee;
    if (meta.who) t.who = meta.who;
    if (meta.ref) t.ref = meta.ref;
    if (meta.sub) t.sub = meta.sub;
    if (meta.isUtangOrigin) t.isUtangOrigin = meta.isUtangOrigin;
    if (meta.source || String(r.id).indexOf("gcash-") === 0) t.source = meta.source || "gcash-auto";

    return t;
  }

  function mergeTransactions(localTxns, remoteTxns, remoteMeta) {
    localTxns = Array.isArray(localTxns) ? localTxns : [];
    remoteTxns = Array.isArray(remoteTxns) ? remoteTxns : [];

    var byId = {};
    var unpushed = [];
    var changedLocal = false;

    // 1. Index local transactions
    localTxns.forEach(function (t) {
      if (t && t.id) byId[String(t.id)] = t;
    });

    // 2. Merge incoming remote rows using LWW
    remoteTxns.forEach(function (r) {
      var incoming = r.occurred_at ? txnFromRow(r, remoteMeta) : r;
      var id = String(incoming.id);
      var cur = byId[id];

      if (!cur) {
        byId[id] = incoming;
        changedLocal = true;
      } else {
        var inTime = getTimestamp(incoming);
        var curTime = getTimestamp(cur);

        if (inTime >= curTime) {
          // Remote is newer or equal -> remote wins
          if (inTime > curTime || JSON.stringify(incoming) !== JSON.stringify(cur)) {
            byId[id] = incoming;
            changedLocal = true;
          }
        } else {
          // Local is newer -> keep local and queue for push
          unpushed.push(cur);
        }
      }
    });

    var merged = Object.keys(byId).map(function (k) { return byId[k]; });
    return {
      merged: merged,
      changedLocal: changedLocal,
      unpushed: unpushed
    };
  }

  function mergeUtangs(localUtangs, remoteUtangs) {
    localUtangs = Array.isArray(localUtangs) ? localUtangs : [];
    remoteUtangs = Array.isArray(remoteUtangs) ? remoteUtangs : [];

    var byId = {};
    var changedLocal = false;

    localUtangs.forEach(function (u) {
      if (u && u.id) byId[String(u.id)] = u;
    });

    remoteUtangs.forEach(function (r) {
      if (!r || !r.id) return;
      var id = String(r.id);
      var cur = byId[id];

      if (!cur) {
        byId[id] = r;
        changedLocal = true;
      } else {
        var inTime = getTimestamp(r);
        var curTime = getTimestamp(cur);

        if (inTime >= curTime) {
          // Merge payments collection across both records by payment ID
          var payMap = {};
          (cur.payments || []).forEach(function (p) { if (p && p.id) payMap[p.id] = p; });
          (r.payments || []).forEach(function (p) { if (p && p.id) payMap[p.id] = p; });
          var mergedPayments = Object.keys(payMap).map(function (k) { return payMap[k]; });

          var updatedU = Object.assign({}, r, { payments: mergedPayments });
          var paidSum = mergedPayments.reduce(function (a, p) { return a + (Number(p.amount) || 0); }, 0);
          if (paidSum >= (Number(updatedU.amount) || 0) && Number(updatedU.amount) > 0) {
            updatedU.settled = true;
          }

          byId[id] = updatedU;
          if (inTime > curTime || JSON.stringify(updatedU) !== JSON.stringify(cur)) {
            changedLocal = true;
          }
        }
      }
    });

    return {
      merged: Object.keys(byId).map(function (k) { return byId[k]; }),
      changedLocal: changedLocal
    };
  }

  function mergeWallets(localWallets, remoteWallets) {
    localWallets = Array.isArray(localWallets) ? localWallets : [];
    remoteWallets = Array.isArray(remoteWallets) ? remoteWallets : [];

    var byId = {};
    var changedLocal = false;

    localWallets.forEach(function (w) {
      if (w && w.id) byId[String(w.id)] = w;
    });

    remoteWallets.forEach(function (w) {
      if (!w || !w.id) return;
      var id = String(w.id);
      var cur = byId[id];
      if (!cur) {
        byId[id] = w;
        changedLocal = true;
      } else {
        var inTime = getTimestamp(w);
        var curTime = getTimestamp(cur);
        if (inTime >= curTime) {
          byId[id] = w;
          if (inTime > curTime) changedLocal = true;
        }
      }
    });

    return {
      merged: Object.keys(byId).map(function (k) { return byId[k]; }),
      changedLocal: changedLocal
    };
  }

  function mergeSettings(localState, remoteBudgetData) {
    localState = localState || {};
    remoteBudgetData = remoteBudgetData || {};
    var changedLocal = false;

    var remoteTime = getTimestamp(remoteBudgetData);
    var localTime = getTimestamp(localState.settingsUpdated);

    if (remoteTime >= localTime) {
      if (remoteBudgetData.currency && remoteBudgetData.currency !== localState.currency) {
        localState.currency = remoteBudgetData.currency;
        changedLocal = true;
      }
      if (remoteBudgetData.limits && Object.keys(remoteBudgetData.limits).length) {
        localState.limits = Object.assign({}, localState.limits, remoteBudgetData.limits);
        changedLocal = true;
      }
      if (remoteBudgetData.allowance && typeof remoteBudgetData.allowance === "object") {
        localState.allowance = Object.assign({}, remoteBudgetData.allowance);
        changedLocal = true;
      }
    }

    return {
      state: localState,
      changedLocal: changedLocal
    };
  }

  function getPendingOutbox(txns, lastPushTimestamp) {
    if (!Array.isArray(txns)) return [];
    var lastPush = Number(lastPushTimestamp) || 0;
    return txns.filter(function (t) {
      return getTimestamp(t) > lastPush;
    });
  }

  // ---- Client Initialization (for Browser / Hybrid App) ----
  function initClient() {
    var cfg = (typeof window !== "undefined" && window.UNIBUDGET_CONFIG) ? window.UNIBUDGET_CONFIG : {};
    var hasKeys =
      typeof window !== "undefined" &&
      window.supabase &&
      cfg.SUPABASE_URL && cfg.SUPABASE_URL.indexOf("YOUR-") === -1 &&
      cfg.SUPABASE_ANON_KEY && cfg.SUPABASE_ANON_KEY.indexOf("YOUR-") === -1;

    if (!hasKeys) {
      return {
        enabled: false,
        syncStatus: "offline",
        pushState: function () {},
        pull: async function () { return false; },
        syncNow: async function () { return { ok: false, reason: "no-keys" }; }
      };
    }

    var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true }
    });

    function dataKey(email) { return "unibudget:data:" + email.toLowerCase(); }
    function pushWM(email) { return "unibudget:push:" + email.toLowerCase(); }
    function pullWM(email) { return "unibudget:pull:" + email.toLowerCase(); }
    function sessionEmail() {
      try {
        var s = JSON.parse(localStorage.getItem("unibudget:session"));
        if (!s || !s.email) return null;
        if (s.isGuest || s.isOfflineMode || s.isAuthenticated === false || s.email.indexOf("@unibudget.local") !== -1) {
          return null;
        }
        return s.email;
      } catch (e) { return null; }
    }
    function readCache(email) {
      try { return JSON.parse(localStorage.getItem(dataKey(email))); } catch (e) { return null; }
    }
    function writeCache(email, s) {
      localStorage.setItem(dataKey(email), JSON.stringify(s));
    }

    function setSyncStatus(status) {
      var dot = document.getElementById("syncDot");
      var lab = document.getElementById("syncLabel");
      if (dot) {
        dot.className = "sync-dot " + status;
      }
      if (lab) {
        if (status === "synced") lab.textContent = "Synced ✓";
        else if (status === "syncing") lab.textContent = "Syncing...";
        else if (status === "guest") lab.textContent = "Guest Mode (Local)";
        else if (status === "offline") lab.textContent = "Offline ☁";
        else if (status === "error") lab.textContent = "Sync Error";
      }
    }

    async function currentUser() {
      try { return (await sb.auth.getUser()).data.user; } catch (e) { return null; }
    }

    function friendly(msg) {
      msg = String(msg || "");
      if (/invalid login/i.test(msg)) return "Wrong email or password. Please try again.";
      if (/already registered/i.test(msg)) return "An account with this email already exists. Try logging in.";
      if (/email.*not.*confirm/i.test(msg)) return "Please confirm your email first (check your inbox).";
      if (/rate limit/i.test(msg)) return "Too many attempts. Please wait a minute and retry.";
      return msg || "Something went wrong. Please try again.";
    }

    // ---- PUSH: flush pending outbox changes to cloud ----
    var pushTimer = null, isPushing = false;
    function pushState(state) {
      clearTimeout(pushTimer);
      var email = sessionEmail();
      if (!email) {
        setSyncStatus("guest");
        return;
      }
      if (!navigator.onLine) {
        setSyncStatus("offline");
        return;
      }
      setSyncStatus("syncing");
      pushTimer = setTimeout(function () { flush(state); }, 600);
    }

    async function flush(stateMaybe) {
      if (isPushing) return false;
      var email = sessionEmail();
      if (!email) {
        setSyncStatus("guest");
        return false;
      }
      if (!navigator.onLine) {
        setSyncStatus("offline");
        return false;
      }
      isPushing = true;
      try {
        var u = await currentUser();
        if (!u) { setSyncStatus("guest"); return false; }
        var state = stateMaybe || readCache(email);
        if (!state) return false;

        var wmKey = pushWM(email);
        var lastPush = Number(localStorage.getItem(wmKey) || 0);
        var changedTxns = getPendingOutbox(state.txns, lastPush);

        // 1. Push changed transaction rows
        if (changedTxns.length) {
          var rows = changedTxns.map(function (t) { return rowFromTxn(u.id, t); });
          var res = await sb.from("transactions").upsert(rows, { onConflict: "user_id,id" });
          if (res.error) throw res.error;
        }

        // 2. Build metadata map for extra transfer & wallet attributes
        var txnsMeta = {};
        (state.txns || []).forEach(function (t) {
          if (t && t.id) {
            txnsMeta[t.id] = {
              walletId: t.walletId,
              toWalletId: t.toWalletId,
              fee: t.fee,
              who: t.who,
              ref: t.ref,
              sub: t.sub,
              isUtangOrigin: t.isUtangOrigin,
              source: t.source,
              cat: t.cat,
              desc: t.desc
            };
          }
        });

        // 3. Push budgets, custom wallets, utangs, and settings
        var budgetPayload = {
          currency: state.currency,
          limits: state.limits,
          wallets: state.wallets,
          utangs: state.utangs,
          allowance: state.allowance,
          txnsMeta: txnsMeta,
          updated_at: Date.now()
        };

        var res2 = await sb.from("budgets").upsert({
          user_id: u.id,
          data: budgetPayload,
          updated_at: new Date().toISOString()
        }, { onConflict: "user_id" });
        if (res2.error) throw res2.error;

        var maxU = changedTxns.reduce(function (a, t) { return Math.max(a, getTimestamp(t)); }, lastPush);
        localStorage.setItem(wmKey, String(Math.max(maxU, Date.now())));
        setSyncStatus("synced");
        return true;
      } catch (e) {
        setSyncStatus(navigator.onLine ? "error" : "offline");
        return false;
      } finally {
        isPushing = false;
      }
    }

    // ---- PULL: fetch cloud changes and merge using LWW ----
    var isPulling = false;
    async function pull() {
      if (isPulling) return false;
      var email = sessionEmail();
      if (!email) {
        setSyncStatus("guest");
        return false;
      }
      if (!navigator.onLine) {
        setSyncStatus("offline");
        return false;
      }
      isPulling = true;
      var changedLocal = false;
      try {
        var u = await currentUser();
        if (!u) { setSyncStatus("guest"); return false; }

        var wmKey = pullWM(email);
        var lastPull = Number(localStorage.getItem(wmKey) || 0);

        // 1. Fetch remote transaction rows modified since lastPull
        var res = await sb.from("transactions").select("*")
          .eq("user_id", u.id).gt("updated_at", new Date(lastPull).toISOString());
        if (res.error) throw res.error;

        // 2. Fetch remote budget & metadata blob
        var sres = await sb.from("budgets").select("data").eq("user_id", u.id).maybeSingle();
        var remoteData = (sres.data && sres.data.data) ? sres.data.data : {};

        var cache = readCache(email) || { currency: "PHP", limits: {}, wallets: [], txns: [], utangs: [] };

        // 3. Merge Transactions
        var txnMerge = mergeTransactions(cache.txns, res.data || [], remoteData.txnsMeta);
        if (txnMerge.changedLocal) {
          cache.txns = txnMerge.merged;
          changedLocal = true;
        }

        // 4. Merge Utangs
        if (Array.isArray(remoteData.utangs)) {
          var utangMerge = mergeUtangs(cache.utangs, remoteData.utangs);
          if (utangMerge.changedLocal) {
            cache.utangs = utangMerge.merged;
            changedLocal = true;
          }
        }

        // 5. Merge Wallets
        if (Array.isArray(remoteData.wallets)) {
          var walletMerge = mergeWallets(cache.wallets, remoteData.wallets);
          if (walletMerge.changedLocal) {
            cache.wallets = walletMerge.merged;
            changedLocal = true;
          }
        }

        // 6. Merge Settings (Currency, Limits, Allowance)
        var settingsMerge = mergeSettings(cache, remoteData);
        if (settingsMerge.changedLocal) {
          changedLocal = true;
        }

        // Normalize state with wallet engine
        if (window.WalletEngine) {
          cache.wallets = WalletEngine.normalizeWallets(cache.wallets);
          cache.txns = WalletEngine.migrateTransactions(cache.txns);
        }

        writeCache(email, cache);
        localStorage.setItem(wmKey, String(Date.now()));
        setSyncStatus("synced");

        // If local data changed from cloud pull, trigger reactive UI re-render
        if (changedLocal && window.UniBudget && window.UniBudget.reload) {
          window.UniBudget.reload();
        }

        // If we found newer local items that need to be pushed back, schedule flush
        if (txnMerge.unpushed && txnMerge.unpushed.length > 0) {
          flush(cache);
        }

        return changedLocal;
      } catch (e) {
        setSyncStatus(navigator.onLine ? "error" : "offline");
        return false;
      } finally {
        isPulling = false;
      }
    }

    async function hydrate(email) {
      localStorage.setItem(pullWM(email), "0");
      localStorage.setItem(pushWM(email), "0");
      await pull();
    }

    async function syncNow() {
      var email = sessionEmail();
      if (!email) {
        return { ok: false, isGuest: true, message: "Guest mode is local only. Log in to sync to cloud." };
      }
      if (!navigator.onLine) {
        setSyncStatus("offline");
        return { ok: false, offline: true, message: "Working offline — changes saved locally on this device." };
      }
      setSyncStatus("syncing");
      var fRes = await flush();
      var pRes = await pull();
      setSyncStatus("synced");
      return { ok: true, pushed: fRes, pulled: pRes, message: "Synced with cloud ✓" };
    }

    // ---- Auto-sync triggers on Reconnect & Resume for Authenticated Cloud Users ----
    function handleReconnect() {
      var email = sessionEmail();
      if (email && navigator.onLine) {
        setSyncStatus("syncing");
        flush().then(function () {
          return pull();
        }).then(function () {
          if (typeof window !== "undefined" && window.showSyncedPill) {
            window.showSyncedPill();
          }
        });
      } else if (!email) {
        setSyncStatus("guest");
        if (typeof window !== "undefined" && window.checkGuestBanner) {
          window.checkGuestBanner();
        }
      } else {
        setSyncStatus("offline");
      }
    }

    window.addEventListener("online", handleReconnect);
    window.addEventListener("offline", function () {
      if (sessionEmail()) setSyncStatus("offline");
      else setSyncStatus("guest");
    });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) handleReconnect();
    });
    window.addEventListener("focus", handleReconnect);
    setInterval(function () {
      if (navigator.onLine && sessionEmail()) {
        flush().then(function () { return pull(); });
      }
    }, 25000);

    if (sessionEmail()) {
      setTimeout(handleReconnect, 800);
    }

    return {
      enabled: true,
      client: sb,
      setSyncStatus: setSyncStatus,
      pushState: pushState,
      flush: flush,
      pull: pull,
      syncNow: syncNow,
      async signup(name, email, pass) {
        email = email.toLowerCase().trim();
        var r = await sb.auth.signUp({ email: email, password: pass, options: { data: { name: name } } });
        if (r.error) throw new Error(friendly(r.error.message));
        if (!r.data.session) throw new Error("Account created — check your email to confirm it, then log in.");
        await hydrate(email);
        return { email: email, name: name, isAuthenticated: true };
      },
      async login(email, pass) {
        email = email.toLowerCase().trim();
        var r = await sb.auth.signInWithPassword({ email: email, password: pass });
        if (r.error) throw new Error(friendly(r.error.message));
        var u = r.data.user;
        var name = (u.user_metadata && u.user_metadata.name) || email.split("@")[0];
        await hydrate(email);
        return { email: email, name: name, isAuthenticated: true };
      },
      async logout() {
        try { await sb.auth.signOut(); } catch (e) {}
      }
    };
  }

  return {
    getTimestamp: getTimestamp,
    rowFromTxn: rowFromTxn,
    txnFromRow: txnFromRow,
    mergeTransactions: mergeTransactions,
    mergeUtangs: mergeUtangs,
    mergeWallets: mergeWallets,
    mergeSettings: mergeSettings,
    getPendingOutbox: getPendingOutbox,
    initClient: initClient
  };
});

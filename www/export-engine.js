// www/export-engine.js
(function (root, factory) {
  var exp = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = exp;
  }
  if (root) {
    root.ExportEngine = exp;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function () {
  "use strict";

  var UTF8_BOM = "\uFEFF";
  var CSV_HEADERS = [
    "Date",
    "Time",
    "Description",
    "Type",
    "Category",
    "Account",
    "To Account",
    "Amount",
    "Currency",
    "Fee",
    "Source / Notes",
    "Transaction ID"
  ];

  function padZero(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function formatDate(timestamp) {
    if (!timestamp) return "";
    var d = new Date(timestamp);
    if (isNaN(d.getTime())) return "";
    return d.getFullYear() + "-" + padZero(d.getMonth() + 1) + "-" + padZero(d.getDate());
  }

  function formatTime(timestamp) {
    if (!timestamp) return "";
    var d = new Date(timestamp);
    if (isNaN(d.getTime())) return "";
    return padZero(d.getHours()) + ":" + padZero(d.getMinutes()) + ":" + padZero(d.getSeconds());
  }

  function escapeCsvField(val) {
    if (val === null || val === undefined) return "";
    var str = String(val);
    if (str.indexOf('"') !== -1 || str.indexOf(',') !== -1 || str.indexOf('\n') !== -1 || str.indexOf('\r') !== -1) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function getWalletName(walletId, wallets) {
    if (!walletId) return "";
    if (Array.isArray(wallets)) {
      for (var i = 0; i < wallets.length; i++) {
        if (wallets[i] && wallets[i].id === walletId) {
          return wallets[i].name || walletId;
        }
      }
    }
    return walletId;
  }

  function formatSignedAmount(txn) {
    var amt = Number(txn.amount) || 0;
    if (txn.type === "expense") {
      return "-" + amt.toFixed(2);
    } else if (txn.type === "income") {
      return amt.toFixed(2);
    } else if (txn.type === "transfer") {
      return "-" + amt.toFixed(2);
    } else if (txn.type === "adjustment") {
      return amt.toFixed(2);
    }
    return amt.toFixed(2);
  }

  function computeSummaryMetrics(txns, wallets, options) {
    var opts = options || {};
    var activeList = Array.isArray(txns) ? txns.filter(function (t) { return t && !t.deleted && t.type !== "adjustment"; }) : [];
    var totalIncome = 0;
    var totalSpent = 0;
    var totalFees = 0;

    activeList.forEach(function (t) {
      var amt = Number(t.amount) || 0;
      if (t.type === "income") {
        totalIncome += amt;
      } else if (t.type === "expense") {
        totalSpent += amt;
      } else if (t.type === "transfer") {
        if (t.fee && t.fee > 0) {
          totalFees += Number(t.fee);
          totalSpent += Number(t.fee);
        }
      }
    });

    totalIncome = Math.round(totalIncome * 100) / 100;
    totalSpent = Math.round(totalSpent * 100) / 100;
    totalFees = Math.round(totalFees * 100) / 100;
    var netBalance = Math.round((totalIncome - totalSpent) * 100) / 100;

    var accountBalance = null;
    var accountName = null;
    if (opts.walletId && Array.isArray(wallets)) {
      for (var i = 0; i < wallets.length; i++) {
        if (wallets[i] && wallets[i].id === opts.walletId) {
          accountName = wallets[i].name;
          break;
        }
      }
      if (opts.walletBalances && opts.walletBalances[opts.walletId]) {
        accountBalance = opts.walletBalances[opts.walletId].balance;
      }
    }

    var totalNetWorth = (opts.totalNetWorth !== undefined && opts.totalNetWorth !== null) ? opts.totalNetWorth : null;

    return {
      recordCount: activeList.length,
      totalIncome: totalIncome,
      totalSpent: totalSpent,
      totalFees: totalFees,
      netBalance: netBalance,
      accountName: accountName,
      accountBalance: accountBalance,
      totalNetWorth: totalNetWorth
    };
  }

  function generateTransactionsCsv(txns, wallets, defaultCurrency, options) {
    var currency = defaultCurrency || "PHP";
    var rows = [CSV_HEADERS.join(",")];
    var activeList = Array.isArray(txns) ? txns.filter(function (t) { return t && !t.deleted && t.type !== "adjustment"; }) : [];

    activeList.forEach(function (t) {
      var dateStr = formatDate(t.ts);
      var timeStr = formatTime(t.ts);
      var descStr = escapeCsvField(t.desc || "");
      var typeStr = escapeCsvField(t.type ? (t.type.charAt(0).toUpperCase() + t.type.slice(1)) : "Expense");
      var catStr = escapeCsvField(t.cat || (t.type === "transfer" ? "Transfer" : "Other"));
      var fromWalletStr = escapeCsvField(getWalletName(t.walletId, wallets));
      var toWalletStr = escapeCsvField(t.type === "transfer" ? getWalletName(t.toWalletId, wallets) : "");
      var amtStr = formatSignedAmount(t);
      var feeStr = (t.fee && t.fee > 0) ? Number(t.fee).toFixed(2) : "0.00";
      var noteStr = escapeCsvField(t.sub || t.source || "");
      var idStr = escapeCsvField(t.id || "");

      var row = [
        dateStr,
        timeStr,
        descStr,
        typeStr,
        catStr,
        fromWalletStr,
        toWalletStr,
        amtStr,
        currency,
        feeStr,
        noteStr,
        idStr
      ].join(",");

      rows.push(row);
    });

    // Append Summary Section
    var summary = computeSummaryMetrics(activeList, wallets, options);
    rows.push("");
    rows.push(escapeCsvField("--- SUMMARY ---") + ",,,,,,,,,,");
    rows.push(",,," + escapeCsvField("Total Income") + ",,,," + summary.totalIncome.toFixed(2) + "," + currency + ",,,");
    rows.push(",,," + escapeCsvField("Total Spent") + ",,,,-" + summary.totalSpent.toFixed(2) + "," + currency + ",,,");
    rows.push(",,," + escapeCsvField("Net Balance (Cash Flow)") + ",,,," + summary.netBalance.toFixed(2) + "," + currency + ",,,");
    if (summary.accountName && summary.accountBalance !== null) {
      rows.push(",,," + escapeCsvField("Account Balance (" + summary.accountName + ")") + ",,,," + Number(summary.accountBalance).toFixed(2) + "," + currency + ",,,");
    } else if (summary.totalNetWorth !== null) {
      rows.push(",,," + escapeCsvField("Total Net Worth") + ",,,," + Number(summary.totalNetWorth).toFixed(2) + "," + currency + ",,,");
    }

    return UTF8_BOM + rows.join("\n");
  }

  function generateExportFilename(options) {
    var opts = options || {};
    var d = opts.dateStr || formatDate(Date.now());
    if (opts.walletName) {
      var cleanWallet = String(opts.walletName).toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-");
      return "unibudget-" + cleanWallet + "-" + d + ".csv";
    }
    if (opts.isFiltered) {
      return "unibudget-filtered-" + d + ".csv";
    }
    return "unibudget-transactions-" + d + ".csv";
  }

  function triggerCsvDownload(csvContent, filename) {
    return new Promise(function (resolve) {
      try {
        // 1. Check for Capacitor native Android/iOS bridge
        if (typeof window !== "undefined" && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NativeExport) {
          window.Capacitor.Plugins.NativeExport.exportCsv({
            content: csvContent,
            filename: filename,
            share: true
          }).then(function (res) {
            resolve({
              success: true,
              method: "native",
              filePath: (res && res.filePath) || ("/Download/" + filename)
            });
          }).catch(function (err) {
            console.warn("Native export failed, trying web fallback:", err);
            fallbackWebDownload(csvContent, filename, resolve);
          });
          return;
        }

        // 2. Standard Web fallback
        fallbackWebDownload(csvContent, filename, resolve);
      } catch (err) {
        resolve({ success: false, error: err });
      }
    });
  }

  function fallbackWebDownload(csvContent, filename, resolve) {
    try {
      var blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });

      // Check if Web Share API with files is available and supported
      if (typeof navigator !== "undefined" && navigator.canShare && typeof File !== "undefined") {
        var file = new File([blob], filename, { type: "text/csv" });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({
            files: [file],
            title: "UniBudget Export",
            text: "UniBudget Transactions Export"
          }).then(function () {
            resolve({ success: true, method: "share", filePath: filename });
          }).catch(function () {
            // User cancelled share or failed, fallback to direct download
            directDownload(blob, filename);
            resolve({ success: true, method: "download", filePath: filename });
          });
          return;
        }
      }

      // Direct standard blob download
      directDownload(blob, filename);
      resolve({ success: true, method: "download", filePath: filename });
    } catch (err) {
      resolve({ success: false, error: err });
    }
  }

  function directDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);
  }

  return {
    UTF8_BOM: UTF8_BOM,
    CSV_HEADERS: CSV_HEADERS,
    formatDate: formatDate,
    formatTime: formatTime,
    escapeCsvField: escapeCsvField,
    getWalletName: getWalletName,
    computeSummaryMetrics: computeSummaryMetrics,
    generateTransactionsCsv: generateTransactionsCsv,
    generateExportFilename: generateExportFilename,
    triggerCsvDownload: triggerCsvDownload
  };
});

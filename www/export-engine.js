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

  function generateTransactionsCsv(txns, wallets, defaultCurrency) {
    var currency = defaultCurrency || "PHP";
    var rows = [CSV_HEADERS.join(",")];
    var activeList = Array.isArray(txns) ? txns.filter(function (t) { return t && !t.deleted; }) : [];

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
              resolve({ success: true, method: "share" });
            }).catch(function () {
              // User cancelled share or failed, fallback to direct download
              directDownload(blob, filename);
              resolve({ success: true, method: "download" });
            });
            return;
          }
        }

        // Direct standard blob download
        directDownload(blob, filename);
        resolve({ success: true, method: "download" });
      } catch (err) {
        resolve({ success: false, error: err });
      }
    });
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
    generateTransactionsCsv: generateTransactionsCsv,
    generateExportFilename: generateExportFilename,
    triggerCsvDownload: triggerCsvDownload
  };
});

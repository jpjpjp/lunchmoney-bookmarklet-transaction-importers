// Fixtures below are synthetic. They mirror the row markup CFNA renders, but
// every merchant, amount, cardholder, and Ref# is invented.
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "cfna-exporter.js"), "utf8");

const mkRow = ({ date, desc, amt, cardholder, details, text }) => ({
  innerText: text,
  querySelector: (sel) => {
    if (sel === "td:nth-child(1)") return { innerText: date };
    if (sel === ".transaction-description") return { innerText: desc };
    if (sel === "td:nth-child(4)") return { innerText: amt };
    if (sel === "td:nth-child(3) .mt-1") return cardholder ? { innerText: cardholder } : null;
    if (sel === "td:nth-child(3) .initials") return null;
    return null;
  },
  querySelectorAll: () => (details || []).map((d) => ({ innerText: d })),
});

// The recent-activity widget on the account page.
const widgetRows = [
  mkRow({ date: "08/25/2026", desc: "EXAMPLE  FUEL", amt: "$41.02", cardholder: "AC", details: ["Ref# REF-0001"], text: "Ref# REF-0001" }),
  mkRow({ date: "08/24/2026", desc: "PENDING THING", amt: "$9.99", cardholder: "AC", details: ["Transaction Pending"], text: "" }),
  // Payments are negative on CFNA, which already matches Lunch Money.
  mkRow({ date: "08/07/2026", desc: "WEB ACH PMT - THANK YOU", amt: "-$35.00", cardholder: "", details: ["Ref# REF-0002"], text: "Ref# REF-0002" }),
];

// The transaction-history page: one table per statement period. It repeats the
// widget's purchase (same Ref#) and adds older rows the widget never shows.
const historyRows = [
  mkRow({ date: "08/25/2026", desc: "EXAMPLE FUEL", amt: "$41.02", cardholder: "", details: ["Ref# REF-0001"], text: "Ref# REF-0001" }),
  mkRow({ date: "03/03/2026", desc: "EXAMPLE TIRE CENTER", amt: "$798.82", cardholder: "A CARDHOLDER", details: ["Ref# REF-0003"], text: "Ref# REF-0003" }),
  mkRow({ date: "08/22/2025", desc: "EXAMPLE REWARDS REBATE", amt: "-$114.45", cardholder: "", details: ["Ref# REF-0004"], text: "Ref# REF-0004" }),
];

let downloaded = null;
let fetchCalls = 0;
const alerts = [];

global.document = {
  querySelectorAll: (sel) => (sel.includes("latest-account-transactions-table") ? widgetRows : []),
  createElement: () => ({ click() {}, set href(v) {}, get href() { return "blob:x"; } }),
};
global.alert = (m) => alerts.push(m);
global.Blob = class { constructor(p) { this.text = p.join(""); } };
global.URL = { createObjectURL: (b) => { downloaded = b.text; return "blob:x"; }, revokeObjectURL() {} };
global.DOMParser = class {
  parseFromString() {
    return { querySelectorAll: (sel) => (sel.includes("statement-table") ? historyRows : []) };
  }
};
global.fetch = async () => { fetchCalls += 1; return { text: async () => "<html></html>" }; };

eval(src);

setTimeout(() => {
  const fail = [];
  const eq = (l, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail.push(`${l}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); };

  if (!downloaded) { console.log("FAILED: nothing exported. alerts=", alerts); process.exit(1); }
  const out = JSON.parse(downloaded);

  eq("envelope format", out.format, "lm-bookmarklet-export/1");
  eq("institution", out.institution, "cfna");
  eq("has transactions array", Array.isArray(out.transactions), true);

  // The statement pages hold far more history than the widget, so they are
  // always fetched and merged rather than used only as a fallback.
  eq("history pages are always fetched", fetchCalls >= 1, true);
  eq("widget + statement rows merged, duplicate Ref# collapsed", out.transactions.length, 4);
  eq("sorted newest first", out.transactions.map((t) => t.date),
     ["2026-08-25", "2026-08-07", "2026-03-03", "2025-08-22"]);
  eq("duplicate Ref# appears once", out.transactions.filter((t) => t.external_id === "REF-0001").length, 1);
  eq("older statement rows included", out.transactions.map((t) => t.external_id).sort(),
     ["REF-0001", "REF-0002", "REF-0003", "REF-0004"]);
  eq("all external_ids unique", new Set(out.transactions.map((t) => t.external_id)).size, 4);

  eq("pending excluded", out.transactions.some((t) => t.payee === "PENDING THING"), false);
  eq("date converted to ISO", out.transactions[0].date, "2026-08-25");
  eq("payee whitespace collapsed", out.transactions[0].payee, "EXAMPLE FUEL");
  eq("external_id from Ref#", out.transactions[0].external_id, "REF-0001");
  eq("amount unchanged sign (CFNA already positive for purchases)", out.transactions[0].amount, "41.02");
  eq("payment stays negative", out.transactions[1].amount, "-35.00");

  const purchase = out.transactions[0].custom_metadata;
  const payment = out.transactions[1].custom_metadata;
  eq("envelope keys", Object.keys(purchase).sort(), ["cfna", "institution", "source", "source_version"]);
  eq("envelope institution", purchase.institution, "cfna");
  eq("envelope version", purchase.source_version, "2.0.0");

  // Nothing may restate a Lunch Money column or invent a value CFNA never gave.
  const banned = ["amount", "posted_date", "transaction_id", "transaction_date", "institution_name",
                  "credit_debit_indicator", "transaction_description", "extra"];
  for (const k of banned) if (k in purchase.cfna) fail.push(`cfna block still carries manufactured key "${k}"`);

  eq("cardholder kept", purchase.cfna.cardholder, "AC");
  eq("raw strings kept", [purchase.cfna.raw_date, purchase.cfna.raw_amount], ["08/25/2026", "$41.02"]);
  eq("payment omits empty cardholder", "cardholder" in payment.cfna, false);
  eq("payment keeps its raw amount", payment.cfna.raw_amount, "-$35.00");

  console.log(fail.length ? "FAILURES:\n" + fail.join("\n") : "All CFNA exporter assertions passed.");
  if (fail.length) process.exitCode = 1;
}, 50);

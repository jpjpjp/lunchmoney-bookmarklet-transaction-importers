// Template spec for a new institution exporter.
//
// Copy alongside example-exporter.js into exporters/<name>/ and rename to
// <name>-exporter.spec.js. Fill in the fixture and the assertions marked TODO.
//
// There is no test framework and no dependencies. A spec stubs the browser
// globals the exporter expects, feeds it a fixture, and asserts on the JSON it
// produces. `node tools/run-tests.js` runs every *.spec.js under exporters/
// and importer/, each in its own process.
//
// Worked examples:
//   exporters/sofi/sofi-exporter.spec.js  - stubs fetch for a GraphQL API,
//                                           including schema-degradation and
//                                           remembered-account paths
//   exporters/cfna/cfna-exporter.spec.js  - stubs document/DOMParser for
//                                           scraped markup across two pages

// FIXTURES MUST BE SYNTHETIC. Copy the *shape* of your institution's real
// responses, but invent every id, merchant, amount, and name. Real account data
// must never be committed.

const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "example-exporter.js"), "utf8");

// TODO: a fixture matching your institution's real response shape.
const RAW_TRANSACTIONS = [
  // { id: "TXN-0001", description: "EXAMPLE MERCHANT", amount: "-12.34", date: "2026-08-25", pending: false },
  // { id: "TXN-0002", description: "PENDING THING",    amount: "-4.25",  date: "2026-08-26", pending: true  },
];

const run = () => new Promise((resolve) => {
  let downloaded = null;
  const alerts = [];

  global.location = { hostname: "www.example.com" };
  global.alert = (m) => alerts.push(m);
  global.Blob = class { constructor(parts) { this.text = parts.join(""); } };
  global.URL = { createObjectURL: (b) => { downloaded = b.text; return "blob:x"; }, revokeObjectURL() {} };
  global.document = { createElement: () => ({ click() {}, set href(v) {}, get href() { return "blob:x"; } }) };

  // TODO: stub whatever your exporter reads.
  //   - API-based:  global.fetch = async (url, init) => ({ status: 200, text: async () => "..." });
  //   - DOM-based:  global.document.querySelectorAll = (sel) => [...];
  //                 global.DOMParser = class { parseFromString() { ... } };

  eval(src);
  setTimeout(() => resolve({ downloaded, alerts }), 60);
});

(async () => {
  const fail = [];
  const eq = (label, actual, expected) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      fail.push(`${label}: got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
    }
  };

  const result = await run();
  if (!result.downloaded) {
    console.log("FAILED: nothing exported. alerts=", result.alerts);
    process.exit(1);
  }
  const out = JSON.parse(result.downloaded);

  eq("envelope format", out.format, "lm-bookmarklet-export/1");
  eq("institution", out.institution, "example"); // TODO: your institution slug

  // The assertions below are the ones most worth having. Fill in the values
  // your fixture should produce.

  // TODO: money out must be POSITIVE, money in NEGATIVE, whichever way your
  // institution reports it. This is the single most valuable assertion here.
  // eq("purchase sign normalized", out.transactions[0].amount, "12.34");
  // eq("payment sign normalized", out.transactions[1].amount, "-50.00");

  // TODO: external_id comes from the institution and is unique.
  // eq("external_id", out.transactions[0].external_id, "TXN-0001");
  // eq("ids unique", new Set(out.transactions.map((t) => t.external_id)).size, out.transactions.length);

  // TODO: pending rows excluded.
  // eq("pending excluded", out.transactions.length, 1);

  // TODO: dates are YYYY-MM-DD and prefer the authorization date.
  // eq("date", out.transactions[0].date, "2026-08-24");

  // Metadata must not restate a Lunch Money column or invent values.
  const meta = out.transactions[0] && out.transactions[0].custom_metadata;
  if (meta) {
    eq("envelope institution", meta.institution, out.institution);
    const banned = ["amount", "transaction_id", "transaction_description", "transaction_date",
                    "institution_name", "credit_debit_indicator", "account_display_name"];
    for (const k of banned) {
      if (k in meta[out.institution]) fail.push(`metadata restates "${k}"`);
    }
    eq("metadata within size cap", JSON.stringify(meta).length < 4096, true);
  }

  console.log(fail.length ? "FAILURES:\n" + fail.join("\n") : "All example exporter assertions passed.");
  if (fail.length) process.exitCode = 1;
})();

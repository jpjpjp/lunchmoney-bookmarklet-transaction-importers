// Fixtures below are synthetic. They mirror the shape of SoFi's GraphQL
// responses exactly, but every id, merchant, and amount is invented.
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "sofi-exporter.js"), "utf8");

const TXNS = [
  { id: "SE-1000000001", description: "EXAMPLE  GROCERY #001, SPRINGFIELD, IL", state: "POSTED", displayType: "OTHER",
    amount: { unformatted: "-13.64", isNegative: true, withCurrencyCode: "-$13.64" }, createdDate: { iso8601: "2026-08-25" },
    isDebit: false, affectsBalance: true,
    expandedFields: [{ title: "Date authorized", type: "DATE", value: "2026-08-24", subtext: null }] },
  { id: "SE-1000000002", description: "PAYMENT THANK YOU", state: "POSTED", displayType: "OTHER",
    amount: { unformatted: "500.00", isNegative: false, withCurrencyCode: "$500.00" }, createdDate: { iso8601: "2026-08-20" },
    isDebit: true, affectsBalance: true, expandedFields: [] },
  { id: "SE-1000000003", description: "PENDING COFFEE", state: "PENDING", displayType: "OTHER",
    amount: { unformatted: "-4.25", isNegative: true, withCurrencyCode: "-$4.25" }, createdDate: { iso8601: "2026-08-26" }, expandedFields: [] },
];

// Mirrors the real schema: only __typename and id exist on Account. Everything
// else the exporter asks for must be rejected so the degrade path is exercised.
const SUPPORTED_ACCOUNT_FIELDS = new Set(["__typename", "id"]);
const CARD_ID = "700000007769";
const CHECKING_ID = "100000002646";
const ACCOUNTS = [
  { __typename: "CheckingAccount", id: CHECKING_ID },
  { __typename: "CardAccount", id: CARD_ID },
];

const run = (opts = {}) => new Promise((resolve) => {
  let downloaded = null, promptMsg = "", accountQueryCount = 0, promptCount = 0;
  const store = { ...(opts.storage || {}) };
  const alerts = [];

  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  global.location = { hostname: "www.sofi.com" };
  global.alert = (m) => alerts.push(m);
  global.prompt = (m) => { promptMsg = m; promptCount += 1; return opts.answer || "2"; };
  global.Blob = class { constructor(p) { this.text = p.join(""); } };
  global.URL = { createObjectURL: (b) => { downloaded = b.text; return "blob:x"; }, revokeObjectURL() {} };
  global.document = { createElement: () => ({ click() {}, set href(v) {}, get href() { return "blob:x"; } }) };

  global.fetch = async (url, init) => {
    const q = JSON.parse(init.body).query;
    const reply = (o) => ({ status: 200, text: async () => JSON.stringify(o) });

    if (/LMAccounts/.test(q)) {
      accountQueryCount += 1;
      const requested = (q.match(/accounts \{ ([^}]+) \}/) || [, ""])[1].trim().split(/\s+/);
      const bad = requested.filter((f) => !SUPPORTED_ACCOUNT_FIELDS.has(f));
      if (bad.length) {
        return reply({ errors: bad.map((f) => ({ message: `Validation error (FieldUndefined@[me/accounts/${f}]) : Field '${f}' in type 'Account' is undefined` })) });
      }
      return reply({ data: { me: { accounts: ACCOUNTS } } });
    }

    const type = (q.match(/\.\.\. on (\w+)/) || [, ""])[1];
    if (opts.noTxOnType === type) {
      return reply({ errors: [{ message: `Validation error (FieldUndefined@[me/accounts/transactions]) : Field 'transactions' in type '${type}' is undefined` }] });
    }
    return reply({ data: { me: { accounts: [
      { __typename: "CheckingAccount", id: CHECKING_ID },
      { __typename: "CardAccount", id: CARD_ID, transactions: { pageSize: 5000, list: TXNS.map((t) => ({ transaction: t })) } },
    ] } } });
  };

  eval(src);
  setTimeout(() => resolve({ downloaded, alerts, promptMsg, accountQueryCount, promptCount, store }), 60);
});

(async () => {
  const fail = [];
  const eq = (l, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail.push(`${l}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); };

  const r = await run();
  if (!r.downloaded) { console.log("FAILED: nothing exported. alerts=", r.alerts); process.exit(1); }
  const out = JSON.parse(r.downloaded);

  // The exporter must retry without the label fields this schema rejects.
  eq("degraded past unsupported fields", r.accountQueryCount > 1, true);
  eq("institution", out.institution, "sofi");
  eq("account_hint", out.account_hint, CARD_ID);
  eq("label falls back to type + id tail", out.label, "Card Account (...7769)");
  eq("picker listed both accounts", /1\. Checking Account \(\.\.\.2646\)[\s\S]*2\. Card Account \(\.\.\.7769\)/.test(r.promptMsg), true);
  eq("pending excluded", out.transactions.length, 2);

  const purchase = out.transactions[0];
  const credit = out.transactions[1];

  // SoFi reports purchases negative; Lunch Money wants money-out positive.
  eq("purchase amount sign flipped", purchase.amount, "13.64");
  eq("credit amount sign flipped", credit.amount, "-500.00");
  eq("payee whitespace collapsed", purchase.payee, "EXAMPLE GROCERY #001, SPRINGFIELD, IL");
  eq("external_id is SoFi's own id", purchase.external_id, "SE-1000000001");

  // Lunch Money's date is when the purchase was made, not when it settled.
  eq("date is the AUTHORIZED date", purchase.date, "2026-08-24");
  eq("posted date moved to notes", purchase.notes, "Posted: 2026-08-25");
  eq("credit with no auth date falls back to posted", credit.date, "2026-08-20");
  eq("credit notes empty when dates match", credit.notes, "");

  const pm = purchase.custom_metadata;
  eq("envelope keys", Object.keys(pm).sort(), ["institution", "sofi", "source", "source_version"]);
  eq("envelope institution", pm.institution, "sofi");
  eq("envelope version", pm.source_version, "2.0.0");

  // Nothing in the block may restate a column Lunch Money already stores, and
  // nothing may be invented where the institution supplied no value.
  const banned = ["amount", "transaction_id", "transaction_description", "transaction_date",
                  "transaction_type", "institution_name", "credit_debit_indicator",
                  "account_display_name", "is_pending", "status", "extra"];
  for (const k of banned) if (k in pm.sofi) fail.push(`sofi block still carries manufactured key "${k}"`);

  eq("posted_date kept (additive)", pm.sofi.posted_date, "2026-08-25");
  eq("state", pm.sofi.state, "POSTED");
  eq("display_type once only", pm.sofi.display_type, "OTHER");
  eq("account_id", pm.sofi.account_id, CARD_ID);
  eq("account_type", pm.sofi.account_type, "CardAccount");
  eq("raw is_debit kept", pm.sofi.is_debit, false);
  eq("expanded_fields kept verbatim", pm.sofi.expanded_fields, { "Date authorized": "2026-08-24" });
  eq("credit posted_date still recorded", credit.custom_metadata.sofi.posted_date, "2026-08-20");
  eq("metadata within Lunch Money's size cap", JSON.stringify(pm).length < 4096, true);

  // The chosen account is remembered and reused without asking again.
  eq("first run asks", r.promptCount, 1);
  eq("choice persisted", r.store["lm_export_selected_account__sofi"], CARD_ID);
  eq("prompt explains how to change it", /LM Import Settings Reset/.test(r.promptMsg), true);

  const rRemembered = await run({ storage: { lm_export_selected_account__sofi: CARD_ID } });
  eq("second run does not ask", rRemembered.promptCount, 0);
  eq("second run still exports the right account", JSON.parse(rRemembered.downloaded).account_hint, CARD_ID);

  const rStale = await run({ storage: { lm_export_selected_account__sofi: "999-gone" } });
  eq("stale remembered account re-prompts", rStale.promptCount, 1);
  eq("and overwrites the stale value", rStale.store["lm_export_selected_account__sofi"], CARD_ID);

  // An account type with no transactions field fails cleanly, not fatally.
  const rNoTx = await run({ noTxOnType: "CardAccount" });
  eq("clean message when type lacks transactions", /does not expose transactions/.test(rNoTx.alerts.join(" ")), true);

  console.log(fail.length ? "FAILURES:\n" + fail.join("\n") : "All SoFi exporter assertions passed.");
  if (fail.length) process.exitCode = 1;
})();

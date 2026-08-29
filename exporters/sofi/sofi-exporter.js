(() => {
  const INSTITUTION = "sofi";
  const GRAPHQL_URL = "/bff/graphql";
  const PAGE_SIZE = 5000;

  // "authorized" dates a transaction when the purchase was made; "posted" dates
  // it when SoFi settled it. They differ by 1-2 days, which puts month-boundary
  // spending in the wrong budget month. Whichever is not used lands in notes.
  const DATE_SOURCE = "authorized"; // "authorized" | "posted"

  // Lunch Money rejects custom_metadata larger than this.
  const MAX_METADATA_BYTES = 4096;

  // custom_metadata follows the shape used by other Lunch Money importers:
  // `source` / `source_version` identify the producing app, and one nested
  // object named for the upstream data source carries the provider's own data.
  const SOURCE = "lm-bookmarklets";
  const SOURCE_VERSION = "2.0.0";

  // Remembers which account was chosen so the picker only appears once.
  // Cleared by the "LM Import Settings Reset" bookmarklet.
  const SELECTED_ACCOUNT_KEY = `lm_export_selected_account__${INSTITUTION}`;

  // Only `__typename` and `id` are known to exist on every account. Nicer label
  // fields are requested optimistically and dropped if the schema rejects them.
  const OPTIONAL_LABEL_FIELDS = ["displayName", "nickname", "name", "last4", "productType"];

  // Every field SoFi exposes on a transaction, verified against the live API.
  // `balance` and `amountOnHold` are Currency objects and need a subselection.
  const TX_FRAGMENT = `
    fragment TxFields on PaginatedMoneyTransactionList {
      pageSize
      list {
        transaction {
          id
          actionId
          description
          state
          displayType
          categoryDisplayName
          isDebit
          affectsBalance
          transactionCode
          movementId
          moneyTransactionRuleId
          moneyTransactionRuleIsEditable
          disputeStatusDisplayText
          availableActions
          balance { unformatted }
          amountOnHold { unformatted }
          amount { unformatted isNegative withCurrencyCode }
          createdDate { iso8601 }
          expandedFields { title type value subtext }
        }
      }
    }`;

  const gql = async (query) => {
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });

    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch (_) {
      throw new Error(`Non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }

    // An expired session answers with a single "error" key, not GraphQL "errors".
    if (body && body.error) throw new Error(`${body.error} - log in to SoFi and retry.`);
    if (body && body.errors) throw new Error(body.errors.map((e) => e.message).join("; ").slice(0, 400));
    if (!body || !body.data) throw new Error(`Unexpected response (HTTP ${res.status}).`);

    return body.data;
  };

  const undefinedFieldsFrom = (message) =>
    [...String(message || "").matchAll(/FieldUndefined@\[me\/accounts\/([A-Za-z0-9_]+)\]/g)].map((m) => m[1]);

  // Ask for the pretty label fields, then retry without whichever ones this
  // schema does not have. Falls back to the bare minimum that always works.
  const fetchAccounts = async () => {
    let fields = [...OPTIONAL_LABEL_FIELDS];

    for (let attempt = 0; attempt <= OPTIONAL_LABEL_FIELDS.length; attempt += 1) {
      const selection = ["__typename", "id", ...fields].join(" ");
      try {
        const data = await gql(`query LMAccounts { me { accounts { ${selection} } } }`);
        return (data.me && data.me.accounts) || [];
      } catch (e) {
        const bad = undefinedFieldsFrom(e && e.message);
        if (!bad.length) throw e;
        fields = fields.filter((f) => bad.indexOf(f) === -1);
      }
    }

    const data = await gql(`query LMAccounts { me { accounts { __typename id } } }`);
    return (data.me && data.me.accounts) || [];
  };

  // pageSize is inlined rather than passed as a GraphQL variable so we do not
  // have to declare its input type, which introspection will not tell us. The
  // fragment targets only the chosen account's type, so an account type that
  // has no `transactions` field cannot break the whole query.
  const transactionsQuery = (typeName) => `query LMTransactions {
    me {
      accounts {
        __typename
        id
        ... on ${typeName} { transactions(pageSize: ${PAGE_SIZE}) { ...TxFields } }
      }
    }
  }
  ${TX_FRAGMENT}`;

  const humanizeType = (typeName) => String(typeName || "Account").replace(/([a-z])([A-Z])/g, "$1 $2");

  const accountLabel = (account) => {
    const name =
      account.displayName || account.nickname || account.name || account.productType || humanizeType(account.__typename);
    const tail = account.last4 || String(account.id || "").slice(-4);
    return tail ? `${name} (...${tail})` : String(name);
  };

  const pickAccount = (accounts) => {
    if (!accounts.length) return null;
    if (accounts.length === 1) return accounts[0];

    // A remembered choice is reused silently. If that account has since
    // disappeared the picker comes back rather than guessing.
    let remembered = null;
    try {
      remembered = localStorage.getItem(SELECTED_ACCOUNT_KEY);
    } catch (_) {
      remembered = null;
    }
    if (remembered) {
      const match = accounts.find((a) => String(a.id) === remembered);
      if (match) {
        console.log("[SoFi exporter] using remembered account", accountLabel(match));
        return match;
      }
    }

    const menu = accounts.map((a, i) => `${i + 1}. ${accountLabel(a)}`).join("\n");
    const answer = prompt(
      `Which SoFi account do you want to export?\n\n${menu}\n\nThis choice is remembered. Run "LM Import Settings Reset" to change it.\n\nEnter a number (1-${accounts.length}):`,
      "1"
    );
    if (answer === null) return null;

    const index = Number(String(answer).trim()) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= accounts.length) {
      alert("Not a valid selection. Export cancelled.");
      return null;
    }

    const chosen = accounts[index];
    try {
      localStorage.setItem(SELECTED_ACCOUNT_KEY, String(chosen.id));
    } catch (_) {
      // Remembering is a convenience; a failure here must not stop the export.
    }
    return chosen;
  };

  // SoFi reports card purchases as negative. Lunch Money treats money out as
  // positive, so every amount is flipped on the way out.
  const toLunchMoneyAmount = (unformatted) => {
    const n = Number(String(unformatted == null ? "" : unformatted).replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n)) return null;
    const flipped = -n;
    return (flipped === 0 ? 0 : flipped).toFixed(2);
  };

  const expandedValue = (tx, titleRe) => {
    const field = (tx.expandedFields || []).find((f) => f && titleRe.test(String(f.title || "")));
    const value = field && field.value ? String(field.value).trim() : "";
    return value;
  };

  const isIsoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));

  const buildNotes = (tx, { date, postedDate, authorizedDate }) => {
    const parts = [];

    // Only worth noting when it is not already the transaction's own date.
    if (postedDate && postedDate !== date) parts.push(`Posted: ${postedDate}`);
    if (authorizedDate && authorizedDate !== date) parts.push(`Date authorized: ${authorizedDate}`);

    for (const f of tx.expandedFields || []) {
      const title = (f && f.title ? String(f.title) : "").trim();
      const value = (f && f.value ? String(f.value) : "").trim();
      if (!value) continue;
      if (/date authorized/i.test(title)) continue; // represented above when relevant
      parts.push(title ? `${title}: ${value}` : value);
    }

    return [...new Set(parts)].join(" | ");
  };

  const isEmptyValue = (v) =>
    v === null ||
    v === undefined ||
    v === "" ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);

  // Only fields SoFi itself supplies, and only those Lunch Money's own columns
  // cannot already hold. Nothing here restates date/payee/amount/external_id,
  // and nothing is synthesized or inferred.
  const buildMetadata = (tx, account, { postedDate }) => {
    const currency = (c) => (c && c.unformatted != null ? String(c.unformatted) : null);

    const expanded = {};
    for (const f of tx.expandedFields || []) {
      const title = (f && f.title ? String(f.title) : "").trim();
      const value = (f && f.value ? String(f.value) : "").trim();
      if (title && value) expanded[title] = value;
    }

    const payload = {
      account_id: String(account.id || ""),
      account_type: account.__typename,
      // Additive: Lunch Money's `date` holds the authorization date, so the
      // posted date is not otherwise stored in a structured field.
      posted_date: postedDate,
      state: tx.state,
      display_type: tx.displayType,
      category_display_name: tx.categoryDisplayName,
      is_debit: tx.isDebit,
      affects_balance: tx.affectsBalance,
      transaction_code: tx.transactionCode,
      movement_id: tx.movementId,
      dispute_status: tx.disputeStatusDisplayText,
      available_actions: tx.availableActions,
      rule_is_editable: tx.moneyTransactionRuleIsEditable,
      balance: currency(tx.balance),
      amount_on_hold: currency(tx.amountOnHold),
      expanded_fields: expanded,
    };

    // Identical to `id` on everything seen so far; kept only if SoFi diverges.
    if (tx.actionId && tx.actionId !== tx.id) payload.action_id = String(tx.actionId);
    if (tx.moneyTransactionRuleId && tx.moneyTransactionRuleId !== tx.id) {
      payload.rule_id = String(tx.moneyTransactionRuleId);
    }

    for (const k of Object.keys(payload)) {
      if (isEmptyValue(payload[k]) && typeof payload[k] !== "boolean") delete payload[k];
    }

    const meta = {
      source: SOURCE,
      source_version: SOURCE_VERSION,
      institution: INSTITUTION,
      [INSTITUTION]: payload,
    };

    return JSON.stringify(meta).length > MAX_METADATA_BYTES ? null : meta;
  };

  const toTransaction = (tx, account) => {
    const postedDate = tx && tx.createdDate ? tx.createdDate.iso8601 : "";
    const rawAuthorized = expandedValue(tx, /date authorized/i);
    const authorizedDate = isIsoDate(rawAuthorized) ? rawAuthorized : "";

    // Payments and credits often carry no authorization date; fall back to posted.
    const date = DATE_SOURCE === "authorized" ? authorizedDate || postedDate : postedDate;

    const payee = (tx && tx.description ? String(tx.description) : "").replace(/\s+/g, " ").trim();
    const amount = toLunchMoneyAmount(tx && tx.amount ? tx.amount.unformatted : null);

    if (!date || !payee || amount === null) return null;

    const transaction = {
      date,
      payee,
      amount,
      notes: buildNotes(tx, { date, postedDate, authorizedDate }),
      external_id: tx.id ? String(tx.id) : undefined,
      status: "unreviewed",
    };

    const metadata = buildMetadata(tx, account, { postedDate });
    if (metadata) transaction.custom_metadata = metadata;

    return transaction;
  };

  const exportJsonFile = (payload, account) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sofi-${account.id}-lunchmoney-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const run = async () => {
    if (!/(^|\.)sofi\.com$/i.test(location.hostname)) {
      alert("Run this bookmarklet on a logged-in sofi.com page.");
      return;
    }

    const accounts = await fetchAccounts();
    if (!accounts.length) {
      alert("No SoFi accounts were found.");
      return;
    }

    const chosen = pickAccount(accounts);
    if (!chosen) return;

    let txData;
    try {
      txData = await gql(transactionsQuery(chosen.__typename));
    } catch (e) {
      if (/FieldUndefined@\[me\/accounts\/transactions\]/.test(String(e && e.message))) {
        alert(`${accountLabel(chosen)} does not expose transactions in SoFi's API.`);
        return;
      }
      throw e;
    }

    const account = ((txData.me && txData.me.accounts) || []).find((a) => a.id === chosen.id);
    const list = (account && account.transactions && account.transactions.list) || [];

    const skipped = { notPosted: 0, unparsable: 0 };
    const transactions = [];

    for (const entry of list) {
      const tx = entry && entry.transaction;
      if (!tx) continue;

      if (String(tx.state || "").toUpperCase() !== "POSTED") {
        skipped.notPosted += 1;
        continue;
      }

      const mapped = toTransaction(tx, chosen);
      if (!mapped) {
        skipped.unparsable += 1;
        continue;
      }
      transactions.push(mapped);
    }

    if (!transactions.length) {
      alert(`No posted SoFi transactions found for ${accountLabel(chosen)}.`);
      return;
    }

    const payload = {
      format: "lm-bookmarklet-export/1",
      institution: INSTITUTION,
      label: accountLabel(chosen),
      account_hint: String(chosen.id),
      exported_at: new Date().toISOString(),
      transactions,
    };

    exportJsonFile(payload, chosen);
    console.log("[SoFi exporter] exported", transactions.length, "transactions", { skipped, sample: transactions.slice(0, 5) });

    const skippedNote = skipped.notPosted || skipped.unparsable
      ? `\nSkipped: ${skipped.notPosted} not posted, ${skipped.unparsable} unparsable.`
      : "";
    alert(`Exported ${transactions.length} transaction(s) from ${accountLabel(chosen)} to JSON.${skippedNote}`);
  };

  run().catch((e) => {
    console.error("[SoFi exporter] fatal", e);
    alert(`SoFi exporter failed: ${e && e.message ? e.message : e}`);
  });
})();

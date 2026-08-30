// Template for a new institution exporter.
//
// Copy this directory's two files into exporters/<name>/ and rename them:
//
//   exporters/acme/acme-exporter.js
//   exporters/acme/acme-exporter.spec.js
//
// Then fill in the three TODOs below. Everything outside them is boilerplate
// that should work unchanged. See CONTRIBUTING.md for the reconnaissance
// playbook and the traps worth knowing before you start.
//
// Two working exporters are worth reading alongside this:
//   exporters/sofi/sofi-exporter.js  - calls a JSON/GraphQL API (preferred)
//   exporters/cfna/cfna-exporter.js  - scrapes the DOM (when there is no API)

(() => {
  // ---------------------------------------------------------------------------
  // Identity. `INSTITUTION` must be unique across the project and is the key
  // your metadata is namespaced under.
  // ---------------------------------------------------------------------------
  const INSTITUTION = "example";
  const SOURCE = "lm-bookmarklets";
  const SOURCE_VERSION = "2.0.0"; // must match PROJECT_VERSION in tools/make-bookmarklet.js

  // Lunch Money rejects custom_metadata larger than this.
  const MAX_METADATA_BYTES = 4096;

  // Only run on the institution's own site.
  const HOSTNAME_PATTERN = /(^|\.)example\.com$/i;

  // ---------------------------------------------------------------------------
  // TODO 1: fetch the raw transactions.
  //
  // Prefer the institution's own JSON API over scraping — you get stable ids,
  // real dates, and unformatted amounts for free. Check the network tab before
  // assuming there isn't one.
  //
  // See `fetchAccounts` and `transactionsQuery` in sofi-exporter.js for the API
  // approach (including how it degrades when the schema rejects a field), or
  // `parseDoc` and `fetchAndParse` in cfna-exporter.js for DOM scraping across
  // several pages.
  //
  // Use same-origin relative URLs and `credentials: "include"`. Never send data
  // anywhere but the institution's own origin.
  // ---------------------------------------------------------------------------
  const fetchRawTransactions = async () => {
    throw new Error("TODO: fetch raw transactions from the institution");
  };

  // ---------------------------------------------------------------------------
  // TODO 2: map one raw transaction to the Lunch Money shape.
  //
  // Return null to skip a row (pending transactions, unparsable rows).
  //
  //   date        YYYY-MM-DD. Prefer the date the purchase was MADE
  //               (authorized) over the date it settled. If the institution
  //               gives both and they differ, put the other in `notes`.
  //   payee       Human-readable merchant/description, whitespace collapsed.
  //   amount      String with 2 decimals. MONEY OUT IS POSITIVE.
  //               Institutions disagree on this: SoFi reports purchases
  //               negative and CFNA reports them positive. Check yours against
  //               a known purchase before trusting it — getting this backwards
  //               inverts every transaction you import.
  //   external_id The institution's own transaction id. This is what makes
  //               re-imports idempotent; Lunch Money dedups on it. Synthesize
  //               one only as a last resort, and say so in your PR.
  //   status      "unreviewed"
  //
  // See `toTransaction` in either exporter.
  // ---------------------------------------------------------------------------
  const toTransaction = (raw) => {
    throw new Error("TODO: map a raw transaction to the Lunch Money shape");
  };

  // ---------------------------------------------------------------------------
  // TODO 3: build custom_metadata for one transaction, or return null.
  //
  // Rules, in order of how often they get broken:
  //   - Only what the institution actually supplies.
  //   - Never restate date / payee / amount / external_id. Lunch Money already
  //     stores those; repeating them in another vocabulary is noise.
  //   - Never invent a value. A field the institution does not provide is
  //     ABSENT, not an empty string or a plausible default.
  //   - Drop empty values, so a field that is null today fills itself in if the
  //     institution starts populating it.
  //
  // See `buildMetadata` in sofi-exporter.js (rich) or cfna-exporter.js (sparse,
  // because the page simply offers little).
  // ---------------------------------------------------------------------------
  const buildMetadata = (raw) => {
    return null; // TODO: return an object of institution-supplied fields, or null
  };

  // ---------------------------------------------------------------------------
  // Boilerplate below. This should not need changing.
  // ---------------------------------------------------------------------------

  const isEmptyValue = (v) =>
    v === null ||
    v === undefined ||
    v === "" ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);

  const dropEmpty = (obj) => {
    const out = { ...obj };
    for (const k of Object.keys(out)) {
      if (isEmptyValue(out[k]) && typeof out[k] !== "boolean") delete out[k];
    }
    return out;
  };

  const wrapMetadata = (payload) => {
    const cleaned = dropEmpty(payload || {});
    if (!Object.keys(cleaned).length) return null;

    const meta = {
      source: SOURCE,
      source_version: SOURCE_VERSION,
      institution: INSTITUTION,
      [INSTITUTION]: cleaned,
    };

    // Oversized metadata fails the whole import, so drop it instead.
    return JSON.stringify(meta).length > MAX_METADATA_BYTES ? null : meta;
  };

  // A stable id is the reliable identity; fall back to visible values so rows
  // without one still deduplicate rather than importing twice.
  const dedupeKey = (t) => t.external_id || `${t.date}|${t.payee}|${t.amount}`;

  const mergeTransactions = (...lists) => {
    const seen = new Set();
    const merged = [];
    for (const list of lists) {
      for (const t of list) {
        const key = dedupeKey(t);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(t);
      }
    }
    return merged.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  };

  const exportJsonFile = (transactions, { label = "", accountHint = "" } = {}) => {
    const payload = {
      format: "lm-bookmarklet-export/1",
      institution: INSTITUTION,
      label,
      account_hint: accountHint,
      exported_at: new Date().toISOString(),
      transactions,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${INSTITUTION}-lunchmoney-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const run = async () => {
    if (!HOSTNAME_PATTERN.test(location.hostname)) {
      alert(`Run this bookmarklet on a logged-in ${INSTITUTION} page.`);
      return;
    }

    const raws = await fetchRawTransactions();

    const transactions = [];
    let skipped = 0;
    for (const raw of raws) {
      const mapped = toTransaction(raw);
      if (!mapped) {
        skipped += 1;
        continue;
      }
      const metadata = wrapMetadata(buildMetadata(raw));
      if (metadata) mapped.custom_metadata = metadata;
      transactions.push(mapped);
    }

    const merged = mergeTransactions(transactions);
    if (!merged.length) {
      alert(`No ${INSTITUTION} transactions found.`);
      return;
    }

    exportJsonFile(merged);
    console.log(`[${INSTITUTION} exporter] exported`, merged.length, "transactions", {
      skipped,
      sample: merged.slice(0, 5),
    });
    alert(`Exported ${merged.length} transaction(s) to JSON.${skipped ? `\nSkipped: ${skipped}.` : ""}`);
  };

  run().catch((e) => {
    console.error(`[${INSTITUTION} exporter] fatal`, e);
    alert(`${INSTITUTION} exporter failed: ${e && e.message ? e.message : e}`);
  });
})();

(() => {
  const INSTITUTION = "cfna";
  const SOURCE = "lm-bookmarklets";
  const SOURCE_VERSION = "2.0.0";

  // Lunch Money rejects custom_metadata larger than this.
  const MAX_METADATA_BYTES = 4096;

  const extractRefId = (text) => {
    const m = (text || "").match(/Ref#\s*([A-Za-z0-9-]+)/i);
    return m ? m[1].trim() : "";
  };

  const toISO = (s) => {
    const m = (s || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[1]}-${m[2]}` : (s || "").trim();
  };

  const parseAmount = (s) => {
    const t = (s || "").replace(/\s+/g, "");
    const neg = t.includes("-") ? -1 : 1;
    const n = Number(((t.match(/[\d,]+(?:\.\d+)?/) || ["0"])[0]).replace(/,/g, ""));
    return (neg * n).toFixed(2);
  };

  const uniq = (arr) => [...new Set(arr.filter(Boolean).map((x) => x.trim()).filter(Boolean))];

  const isEmptyValue = (v) =>
    v === null ||
    v === undefined ||
    v === "" ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);

  // Only what the CFNA page actually provides beyond the fields Lunch Money
  // already stores. The page exposes no account id, category, or transaction
  // type, so those keys are simply absent rather than invented.
  const buildMetadata = ({ cardholder, cleanedDetails, rawDate, rawAmount }) => {
    const payload = {
      cardholder,
      detail_rows: cleanedDetails,
      raw_date: rawDate,
      raw_amount: rawAmount,
    };
    for (const k of Object.keys(payload)) {
      if (isEmptyValue(payload[k])) delete payload[k];
    }

    if (!Object.keys(payload).length) return null;

    const meta = {
      source: SOURCE,
      source_version: SOURCE_VERSION,
      institution: INSTITUTION,
      [INSTITUTION]: payload,
    };
    return JSON.stringify(meta).length > MAX_METADATA_BYTES ? null : meta;
  };

  // The account page shows a recent-activity widget; the transaction-history
  // page renders one table per statement period. Both use the same row markup.
  const ROW_SELECTOR = "#latest-account-transactions-table tbody tr, table.statement-table tbody tr";

  const parseDoc = (doc) => {
    const rows = [...doc.querySelectorAll(ROW_SELECTOR)];

    return rows
      .map((tr) => {
        const date = toISO(tr.querySelector("td:nth-child(1)")?.innerText);
        const payee = (tr.querySelector(".transaction-description")?.innerText || "")
          .replace(/\s+/g, " ")
          .trim();
        const amount = parseAmount(tr.querySelector("td:nth-child(4)")?.innerText || "");

        const cardholder = (
          tr.querySelector("td:nth-child(3) .mt-1")?.innerText ||
          tr.querySelector("td:nth-child(3) .initials")?.innerText ||
          ""
        ).trim();

        const details = uniq([...tr.querySelectorAll(".accordion-collapse > div, .accordion-collapse li")].map((d) => d.innerText));
        const external_id =
          extractRefId(details.find((x) => /Ref#/i.test(x)) || "") ||
          extractRefId(tr.innerText || "");
        const isPending = details.some((x) => /transaction pending/i.test(x));

        if (isPending) return null;

        const cleanedDetails = details.filter(
          (x) => !/^Ref#\s*/i.test(x) && !/transaction pending/i.test(x) && x !== cardholder
        );

        const notes = uniq([cardholder ? `Cardholder: ${cardholder}` : "", ...cleanedDetails]).join(" | ");

        if (!date || !payee) return null;

        const rawDate = (tr.querySelector("td:nth-child(1)")?.innerText || "").replace(/\s+/g, " ").trim();
        const rawAmount = (tr.querySelector("td:nth-child(4)")?.innerText || "").replace(/\s+/g, " ").trim();

        const transaction = {
          date,
          payee,
          amount,
          notes,
          external_id: external_id || undefined,
          status: "unreviewed",
        };

        const metadata = buildMetadata({ cardholder, cleanedDetails, rawDate, rawAmount });
        if (metadata) transaction.custom_metadata = metadata;

        return transaction;
      })
      .filter(Boolean);
  };

  const fetchAndParse = async (endpoint) => {
    try {
      const res = await fetch(endpoint, { credentials: "include" });
      const html = await res.text();
      return parseDoc(new DOMParser().parseFromString(html, "text/html"));
    } catch (_) {
      return [];
    }
  };

  // A Ref# is the reliable identity; fall back to the visible values so rows
  // without one still dedupe rather than importing twice.
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

  const exportJsonFile = (txns) => {
    const payload = {
      format: "lm-bookmarklet-export/1",
      institution: INSTITUTION,
      label: "CFNA (Firestone)",
      account_hint: "",
      exported_at: new Date().toISOString(),
      transactions: txns,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cfna-lunchmoney-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const run = async () => {
    // The statement pages carry far more history than the recent-activity
    // widget, so they are always fetched rather than used only as a fallback.
    const fromPage = parseDoc(document);
    const fromHistory = await fetchAndParse("/cardholder/transaction-history");
    const fromLatest = await fetchAndParse("/cardholder/latest-account-transactions");

    const txns = mergeTransactions(fromPage, fromHistory, fromLatest);

    if (!txns.length) {
      alert("No CFNA transactions found.");
      return;
    }

    exportJsonFile(txns);
    console.log("[CFNA exporter] exported", txns.length, "transactions", {
      fromPage: fromPage.length,
      fromHistory: fromHistory.length,
      fromLatest: fromLatest.length,
      sample: txns.slice(0, 5),
    });
    alert(`Exported ${txns.length} transaction(s) to JSON.`);
  };

  run().catch((e) => {
    console.error("[CFNA exporter] fatal", e);
    alert(`CFNA exporter failed: ${e?.message || e}`);
  });
})();

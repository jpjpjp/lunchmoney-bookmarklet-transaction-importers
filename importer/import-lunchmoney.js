#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const usage = () => {
  console.error("Usage: LM_TOKEN=... (LM_ACCOUNT_ID=... for v1 | LM_MANUAL_ACCOUNT_ID=... for v2) node import-lunchmoney.js <transactions.json> [LM_BASE]");
  process.exit(1);
};

const [inputArg, baseArg] = process.argv.slice(2);
if (!inputArg) usage();

const LM_TOKEN = process.env.LM_TOKEN;
const LM_BASE = (baseArg || process.env.LM_BASE || "https://api.lunchmoney.dev/v2").replace(/\/+$/, "");
const IS_V2 = /\/v2(?:$|\/)/.test(LM_BASE);

const LM_ACCOUNT_ID = Number(process.env.LM_ACCOUNT_ID);
const LM_MANUAL_ACCOUNT_ID = Number(process.env.LM_MANUAL_ACCOUNT_ID || process.env.LM_ACCOUNT_ID);

if (!LM_TOKEN) {
  console.error("Missing LM_TOKEN env var.");
  process.exit(1);
}

if (IS_V2 && !Number.isFinite(LM_MANUAL_ACCOUNT_ID)) {
  console.error("Missing or invalid LM_MANUAL_ACCOUNT_ID (or LM_ACCOUNT_ID fallback) for v2 import.");
  process.exit(1);
}

if (!IS_V2 && !Number.isFinite(LM_ACCOUNT_ID)) {
  console.error("Missing or invalid LM_ACCOUNT_ID for v1 import.");
  process.exit(1);
}

const inputPath = path.resolve(process.cwd(), inputArg);
if (!fs.existsSync(inputPath)) {
  console.error(`File not found: ${inputPath}`);
  process.exit(1);
}

const raw = fs.readFileSync(inputPath, "utf8");
const parsedInput = JSON.parse(raw);

// Exporters emit an envelope; bare arrays are the pre-envelope format.
const isEnvelope = parsedInput && !Array.isArray(parsedInput) && Array.isArray(parsedInput.transactions);
if (!Array.isArray(parsedInput) && !isEnvelope) {
  console.error("Input JSON must be an array of transactions or an export envelope with a `transactions` array.");
  process.exit(1);
}

let txns = isEnvelope ? parsedInput.transactions : parsedInput;
if (isEnvelope) {
  console.log(`Source: ${parsedInput.label || parsedInput.institution || "unknown"}`);
}

const summarizeExternalIds = (transactions) => {
  let missing = 0;
  const seen = new Set();
  const dupes = new Set();

  for (const t of transactions) {
    const id = String(t?.external_id || "").trim();
    if (!id) {
      missing += 1;
      continue;
    }
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }

  return { missing, duplicates: [...dupes] };
};

txns = txns.map((t) => {
  const tx = { ...t };
  if (IS_V2) {
    tx.status = "unreviewed";
    tx.manual_account_id = LM_MANUAL_ACCOUNT_ID;
    delete tx.account_id;
  } else {
    tx.account_id = LM_ACCOUNT_ID;
  }
  return tx;
});

const payload = { transactions: txns };
const ext = summarizeExternalIds(txns);
if (ext.missing || ext.duplicates.length) {
  console.warn("[LM CLI importer] external_id issues:", ext);
}

(async () => {
  const res = await fetch(`${LM_BASE}/transactions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LM_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();

  console.log(`Status: ${res.status}`);
  if (text) console.log(text);

  if (!res.ok) {
    process.exit(1);
  }
})();

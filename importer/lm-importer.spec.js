// Fixtures below are synthetic; no real account ids or transactions.
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "lm-importer.js"), "utf8");

const run = (fileContent, presetStorage, fileName = "export.json") =>
  new Promise((resolve) => {
    const store = { ...presetStorage };
    const prompts = [];
    let posted = null;

    global.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
      get length() { return Object.keys(store).length; },
      key: (i) => Object.keys(store)[i],
    };
    global.location = { hostname: "my.lunchmoney.app" };
    global.alert = () => {};
    global.prompt = (msg, def) => {
      prompts.push({ msg, def });
      if (/API base URL/.test(msg)) return def || "https://api.lunchmoney.dev/v2";
      if (/account_id/.test(msg)) return def || "999111";
      if (/API token/.test(msg)) return def || "tok_abc";
      return def || "";
    };
    global.FileReader = class {
      readAsText() { this.result = fileContent; setTimeout(() => this.onload(), 0); }
    };
    global.document = {
      body: { appendChild() {} },
      createElement: () => {
        const handlers = {};
        return {
          style: {}, files: [{ name: fileName }],
          addEventListener: (e, fn) => { handlers[e] = fn; },
          remove() {}, click() { setTimeout(() => handlers.change && handlers.change(), 0); },
          set type(v) {}, set accept(v) {},
        };
      },
    };
    global.fetch = async (url, init) => {
      posted = { url, body: JSON.parse(init.body), auth: init.headers.Authorization };
      return { ok: true, status: 200, text: async () => JSON.stringify({ transactions: posted.body.transactions }) };
    };

    eval(src);
    setTimeout(() => resolve({ store, prompts, posted }), 60);
  });

(async () => {
  const fail = [];
  const eq = (label, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail.push(`${label}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); };

  // 1. New SoFi envelope -> scoped key, label used in prompt.
  const sofiFile = JSON.stringify({
    format: "lm-bookmarklet-export/1", institution: "sofi", label: "Example Card (...7769)",
    account_hint: "700000007769", exported_at: "2026-08-28T00:00:00Z",
    transactions: [{ date: "2026-08-25", payee: "EXAMPLE MERCHANT", amount: "13.64", external_id: "SE-1", status: "unreviewed" }],
  });
  const a = await run(sofiFile, {});
  eq("sofi scoped key saved", a.store["lm_import_v2_manual_account_id__sofi__700000007769"], "999111");
  eq("sofi did not write unscoped key", a.store["lm_import_v2_manual_account_id"], undefined);
  eq("sofi manual_account_id on tx", a.posted.body.transactions[0].manual_account_id, 999111);
  if (!a.prompts.some((p) => /Example Card/.test(p.msg))) fail.push("prompt did not name the account");

  // 2. Legacy bare-array CFNA file with an existing unscoped id -> reuses it, no re-prompt from scratch.
  const legacyFile = JSON.stringify([{ date: "2026-08-01", payee: "EXAMPLE MERCHANT", amount: "50.00", external_id: "R1" }]);
  const b = await run(legacyFile, { lm_import_v2_manual_account_id: "900001", lm_import_token: "tok", lm_import_api_base: "https://api.lunchmoney.dev/v2" });
  eq("legacy reuses existing id", b.posted.body.transactions[0].manual_account_id, 900001);
  const accountPrompt = b.prompts.find((p) => /account_id/.test(p.msg));
  eq("legacy prompt prefilled from old key", accountPrompt.def, "900001");

  // 3. Two different SoFi accounts get independent keys.
  const otherFile = JSON.stringify({
    format: "lm-bookmarklet-export/1", institution: "sofi", label: "SoFi Checking (...1111)",
    account_hint: "100000002646", transactions: [{ date: "2026-08-02", payee: "X", amount: "1.00", external_id: "S2" }],
  });
  const c = await run(otherFile, { "lm_import_v2_manual_account_id__sofi__700000007769": "555" });
  const checkingPrompt = c.prompts.find((p) => /account_id/.test(p.msg));
  eq("second sofi account not prefilled from the card", checkingPrompt.def, "");
  eq("second sofi account has its own key", c.store["lm_import_v2_manual_account_id__sofi__100000002646"], "999111");
  eq("card key untouched", c.store["lm_import_v2_manual_account_id__sofi__700000007769"], "555");

  // 4. Garbage input is rejected cleanly.
  const d = await run(JSON.stringify({ nope: true }), {});
  eq("bad envelope posts nothing", d.posted, null);

  // 5. Legacy bare array named by the old CFNA exporter -> inferred as cfna.
  const e = await run(legacyFile, { lm_import_v2_manual_account_id: "900001" }, "cfna-lunchmoney-2026-08-27.json");
  const p5 = e.prompts.find((p) => /account_id/.test(p.msg));
  if (!/for cfna transactions/.test(p5.msg)) fail.push(`filename inference: prompt said "${p5.msg}"`);
  eq("inferred cfna still prefills from legacy key", p5.def, "900001");

  // 6. An unrelated filename must NOT be mistaken for an institution.
  const f = await run(legacyFile, {}, "my-random-download.json");
  const p6 = f.prompts.find((p) => /account_id/.test(p.msg));
  if (!/for unknown transactions/.test(p6.msg)) fail.push(`bad inference from unrelated name: "${p6.msg}"`);

  // 7. SoFi-named legacy file infers sofi.
  const g = await run(legacyFile, {}, "sofi-700000007769-lunchmoney-2026-08-28.json");
  const p7 = g.prompts.find((p) => /account_id/.test(p.msg));
  if (!/for sofi transactions/.test(p7.msg)) fail.push(`sofi inference: "${p7.msg}"`);

  console.log(fail.length ? "FAILURES:\n" + fail.join("\n") : "All importer assertions passed.");
  if (fail.length) process.exitCode = 1;
})();

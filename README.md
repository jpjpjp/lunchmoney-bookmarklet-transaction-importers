# Bank -> Lunch Money Bookmarklets

**Version 2.0.0**

A browser workflow for importing transactions from banks that Lunch Money cannot sync automatically.

- Export transactions from a supported institution to JSON.
- Import that JSON into Lunch Money.

Direct API calls from a bank's site to Lunch Money are blocked, so this is intentionally a two-step process.

## Supported institutions

| Institution | Exporter | How it reads transactions |
|---|---|---|
| CFNA (Firestone credit card) | [`cfna-exporter.js`](exporters/cfna/cfna-exporter.js) | Scrapes the recent-activity widget **and** every per-statement table |
| SoFi (Smart Card) | [`sofi-exporter.js`](exporters/sofi/sofi-exporter.js) | Calls SoFi's GraphQL API with your session cookie |

There is **one importer** for all institutions. Each export file records which institution it came from, and the importer remembers a separate Lunch Money account id per institution and per source account.

**Bank not listed? Add it.** An exporter is a single file, and the list above only reflects the banks its contributors happen to use — not a judgment about which are worth supporting. See [Adding your bank](#adding-your-bank).

Need Help?
- Join the conversation in the [Lunch Money Bookmarklets Channel on Discord](https://discord.com/channels/842337014556262411/1480708918391996588)

## Recommended Setup (No Clone)

### Option A: Loader flow (recommended)

This is the most reliable setup and the one used in testing. The loader bookmark stays fixed; it reads the `.js` file from disk and caches it in `localStorage`.

> **Expect to click twice.** Any step that opens a file picker — installing a script, or choosing an export file to import — often does nothing on the first click. Browsers only open a file dialog in response to a direct user gesture, and the confirmation dialog these bookmarklets show first tends to consume it. Click the same bookmark again and the picker appears.
>
> This is normal, not a sign anything is wrong. The bookmarklets say so in their own prompts, but it catches everyone the first time.

1. Open the loader files you need in GitHub (no clone needed) and click **Raw**:
- [`cfna-exporter.loader.bookmarklet.txt`](exporters/cfna/cfna-exporter.loader.bookmarklet.txt)
- [`sofi-exporter.loader.bookmarklet.txt`](exporters/sofi/sofi-exporter.loader.bookmarklet.txt)
- [`lm-importer.loader.bookmarklet.txt`](importer/lm-importer.loader.bookmarklet.txt)
2. Copy each full line and save as a bookmark:
- `CFNA Export (Loader)`
- `SoFi Export (Loader)`
- `LM Import (Loader)`
3. Optional but useful: add these reset bookmarks too:
- [`loader-reset.bookmarklet.txt`](loader-reset.bookmarklet.txt) -> `LM Loader Reset`
- [`import-settings-reset.bookmarklet.txt`](import-settings-reset.bookmarklet.txt) -> `LM Import Settings Reset`
4. On the bank site, run the matching export bookmarklet and save the JSON file.
5. On Lunch Money, run `LM Import (Loader)`.
6. When prompted, choose `lm-importer.js`.
7. Use the file picker to pick the exported JSON file.
8. Enter:
- API base URL (default: `https://api.lunchmoney.dev/v2`)
- Manual account ID (asked once per source account, then remembered)
- API token
9. Import.

### Option B: Direct bookmarklets (advanced)

Single bookmarklets with no loader:

- [`cfna-exporter.bookmarklet.txt`](exporters/cfna/cfna-exporter.bookmarklet.txt)
- [`sofi-exporter.bookmarklet.txt`](exporters/sofi/sofi-exporter.bookmarklet.txt)
- [`lm-importer.bookmarklet.txt`](importer/lm-importer.bookmarklet.txt)

They are shorter but must be re-copied every time a source file changes, and can fail in some browsers when bookmarklet strings are truncated or edited. Use Option A if import reliability is your priority.

### Practical limit note

There is no single universal browser limit for bookmarklet length. Behavior varies by browser/version/OS and the page used to copy/paste the URL. That variability is why this project ships loader versions.

## Updating after a change

The loader bookmark URL rarely changes, but the **cached script does**. The loader silently runs whatever it cached, so a stale script produces stale output with no warning.

`localStorage` is per-origin, so a reset only clears the site you run it on. Repeat these on each bank site and on Lunch Money:

```js
// On www.cfna.com / www.sofi.com / my.lunchmoney.app respectively:
localStorage.removeItem("lm_bookmarklet_cfna_exporter_src");
localStorage.removeItem("lm_bookmarklet_sofi_exporter_src");
localStorage.removeItem("lm_bookmarklet_lm_importer_src");
```

Then click the loader bookmark. **You must see the "Install ... in this browser now?" dialog.** If the bookmark runs without asking, the cache was not cleared and the old script is still in use.

Verify what is cached at any time:

```js
(() => {
  const k = "lm_bookmarklet_cfna_exporter_src"; // or _sofi_exporter_ / _lm_importer_
  const s = localStorage.getItem(k) || "";
  console.log({ origin: location.origin, cachedChars: s.length });
})();
```

## Per-institution usage

### CFNA (Firestone)

1. Open CFNA and log in.
2. Click `CFNA Export (Loader)`.
3. If prompted, install [`cfna-exporter.js`](exporters/cfna/cfna-exporter.js).
4. Save the exported JSON file.

Notes:

- The exporter reads the recent-activity widget on the account page **and** fetches `/cardholder/transaction-history`, which renders one table per statement period. Results are merged and deduplicated on `Ref#`, so it returns the full available history rather than only the handful of recent rows.
- Pending transactions are excluded.
- `external_id` comes from the `Ref#` in each row's detail panel.
- CFNA reports purchases positive and payments negative, which already matches Lunch Money, so amounts pass through unchanged.

### SoFi

1. Log in to SoFi and open any `www.sofi.com` page.
2. Click `SoFi Export (Loader)`.
3. If prompted, install [`sofi-exporter.js`](exporters/sofi/sofi-exporter.js).
4. Pick the **Smart Card** account. See the warning below before picking anything else. The choice is remembered, so the picker only appears once.
5. Save the exported JSON file.

> **Only export the Smart Card.**
>
> The picker lists every account on your SoFi profile, including checking and savings. Those are generally syncable through Plaid, and if Lunch Money is already syncing one, exporting and importing it will create a **second copy of every transaction**. The imported rows carry SoFi's `external_id` and the Plaid rows do not, so Lunch Money's duplicate detection will not catch it and you will be deleting them by hand.
>
> This exporter exists for the Smart Card, which Plaid does not cover. A future version will stop offering the others.

Notes:

- The exporter calls SoFi's GraphQL endpoint (`/bff/graphql`) using your logged-in session rather than scraping the page, so it works from any `sofi.com` page.
- If you see `Unauthorized: Login required`, your SoFi session expired. Log in again and re-run.
- Only `POSTED` transactions are exported; pending and scheduled are skipped.
- `external_id` is SoFi's own transaction id, so re-running export and import is safe and will not create duplicates.
- **Amounts are negated on export.** SoFi reports card purchases as negative; Lunch Money treats money out as positive.
- SoFi's API exposes no date-range filter, so the exporter always pulls the full list the API returns.
- The selected account is stored as `lm_export_selected_account__sofi`. To pick a different account, run `LM Import Settings Reset`. If the remembered account no longer exists, the picker reappears on its own.

## Dates

The Lunch Money `date` is the date the purchase was **made** (authorized), not the date it settled, so spending falls in the month you spent it.

- SoFi supplies both. `date` is the authorization date and the posted date goes into `notes` as `Posted: YYYY-MM-DD` (and into `custom_metadata`).
- Payments and credits usually carry no authorization date; those fall back to the posted date, and no redundant note is added.
- CFNA shows a single date, so there is nothing to distinguish.

To use the posted date instead, set `DATE_SOURCE = "posted"` at the top of [`sofi-exporter.js`](exporters/sofi/sofi-exporter.js).

## What gets stored

Alongside each transaction the importer sends a small `custom_metadata` block recording which exporter produced it and any extra detail the bank supplied that Lunch Money has no field for. Read it back from the API with `include_metadata=true`. The exact shape is documented in [CONTRIBUTING.md](CONTRIBUTING.md#custom_metadata).

## How the importer picks an account

The importer saves the Lunch Money account id under a key scoped to the institution and source account, for example:

```
lm_import_v2_manual_account_id__sofi__700000007769
```

Each card or bank account is asked about once and remembered separately. Existing CFNA setups keep working: if no scoped key exists for a CFNA or unknown export, the importer falls back to the older unscoped `lm_import_v2_manual_account_id` value.

## Troubleshooting

### Export looks stale, or is missing fields you expect

The loader is running a cached copy of an older script. See [Updating after a change](#updating-after-a-change).

### Export says it succeeded but no file appears

Chrome and Brave allow a site one programmatic download, then silently block further ones from that origin. There is no console error and the exporter still reports success, because the block happens below the page.

Look for a blocked-download indicator at the right of the address bar and allow downloads for the site, or add it under `brave://settings/content/automaticDownloads` (`chrome://` equivalent on Chrome).

To confirm the download path itself is working, run this on the bank's page; if `lm-download-test.txt` does not appear, the block is the cause and it is unrelated to the exporter:

```js
const url = URL.createObjectURL(new Blob(["hello"], { type: "text/plain" }));
const a = document.createElement("a");
a.href = url; a.download = "lm-download-test.txt";
document.body.appendChild(a); a.click(); a.remove();
```

### File picker does not open (Chrome/Brave)

Click the same bookmark a second time — see [Expect to click twice](#option-a-loader-flow-recommended). This affects both installing a script and choosing a file to import.

If a second click still does nothing, keep DevTools closed and try again.

### File picker opens but cannot be controlled (Brave)

Allow popups/redirects for Lunch Money:

1. Open `brave://settings/content/popups`
2. Add `https://my.lunchmoney.app` to Allowed
3. Reload and retry

### Loader install prompt appears but no picker

Use this console fallback to install importer source manually:

```js
(() => {
  const key = "lm_bookmarklet_lm_importer_src";
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".js,text/javascript";
  input.onchange = () => {
    const file = input.files && input.files[0];
    if (!file) return alert("No file selected.");
    const r = new FileReader();
    r.onload = () => {
      localStorage.setItem(key, String(r.result || ""));
      alert("LM importer script installed.");
    };
    r.onerror = () => alert("Failed to read file.");
    r.readAsText(file);
  };
  input.click();
})();
```

Then choose [`lm-importer.js`](importer/lm-importer.js) and retry `LM Import (Loader)`.

## Reset behavior

- `LM Loader Reset` clears cached loader source only, on the current origin:
  - `lm_bookmarklet_cfna_exporter_src`
  - `lm_bookmarklet_sofi_exporter_src`
  - `lm_bookmarklet_lm_importer_src`
- `LM Import Settings Reset` clears saved settings only:
  - `lm_import_token`
  - `lm_import_api_base`
  - every `lm_import_v1_account_id*` and `lm_import_v2_manual_account_id*` key,
    including the per-institution scoped ones
  - every `lm_export_selected_account*` key, so exporters ask which account to
    use again

## Optional CLI import

If you would rather not use the importer bookmarklet:

```bash
LM_TOKEN='YOUR_TOKEN' LM_MANUAL_ACCOUNT_ID='123456' node importer/import-lunchmoney.js ~/Downloads/sofi-<account-id>-lunchmoney-YYYY-MM-DD.json
```

Accepts both envelope files and older bare-array exports.

## Adding your bank

Contributions are welcome, and adding an institution is deliberately small: **one file in one directory**, plus a one-line registry entry. You should not have to touch the importer, the build, or anything another bank depends on.

What it takes:

- An account at the bank, and the willingness to poke at its transactions page. [CONTRIBUTING.md](CONTRIBUTING.md) walks through how to find the best data source — many banks have a JSON endpoint behind the page, which is far easier than scraping.
- Copying [`templates/example-exporter.js`](templates/example-exporter.js) and filling in three functions: fetch the transactions, map one to Lunch Money's shape, build its metadata. The rest is boilerplate that already works.
- A test with a made-up fixture, so your mapping can be reviewed by someone who does not bank where you do.

Worth knowing before you start:

- **You do not need permission or a plan.** Open a PR, or ask in [Discord](https://discord.com/channels/842337014556262411/1480708918391996588) first if you would rather talk it through.
- **You do not have to write it by hand.** An AI coding agent can do most of the work if you can log into the bank; [CONTRIBUTING.md](CONTRIBUTING.md#working-with-an-agent) explains how, and what to watch for.
- **Nobody can test your bank but you.** Exporters are accepted on the strength of readable code and a good test rather than a maintainer reproducing your setup, so say plainly in the PR what you verified and what you could not. Honest gaps are fine.
- **The hard parts are documented.** Amount signs differ between banks, deduplication depends on getting transaction ids right, and pending transactions will bite you. [CONTRIBUTING.md](CONTRIBUTING.md) has a Traps section covering each, written from mistakes this project already made.

Fixes, better docs, and bug reports are just as welcome as new banks.

## License

[MIT](LICENSE)

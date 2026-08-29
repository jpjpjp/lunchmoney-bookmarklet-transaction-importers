# Bank -> Lunch Money Bookmarklets

**Version 2.0.0**

A browser workflow for importing transactions from banks that Lunch Money cannot
sync automatically.

- Export transactions from a supported institution to JSON.
- Import that JSON into Lunch Money.

Direct API calls from a bank's site to Lunch Money are blocked, so this is
intentionally a two-step process.

## Supported institutions

| Institution | Exporter | How it reads transactions |
|---|---|---|
| CFNA (Firestone credit card) | [`cfna-exporter.js`](exporters/cfna/cfna-exporter.js) | Scrapes the recent-activity widget **and** every per-statement table |
| SoFi | [`sofi-exporter.js`](exporters/sofi/sofi-exporter.js) | Calls SoFi's GraphQL API with your session cookie |

There is **one importer** for all institutions. Each export file records which
institution it came from, and the importer remembers a separate Lunch Money
account id per institution and per source account.

Need Help?
- Join the conversation in the [Lunch Money Bookmarklets Channel on Discord](https://discord.com/channels/842337014556262411/1480708918391996588)

## Repository layout

```
exporters/<institution>/   one directory per institution: source, generated
                           bookmarklets, and its spec
importer/                  the single importer shared by every institution,
                           plus the optional CLI
tools/                     build and test scripts
*-reset.bookmarklet.txt    cross-cutting reset bookmarks
```

Everything for one institution lives in its own directory, so a new-institution
change touches exactly one place.

## Recommended Setup (No Clone)

### Option A: Loader flow (recommended)

This is the most reliable setup and the one used in testing. The loader bookmark
stays fixed; it reads the `.js` file from disk and caches it in `localStorage`.

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

If the file picker does not open on the first click, run `LM Import (Loader)` again.

### Option B: Direct bookmarklets (advanced)

Single bookmarklets with no loader:

- [`cfna-exporter.bookmarklet.txt`](exporters/cfna/cfna-exporter.bookmarklet.txt)
- [`sofi-exporter.bookmarklet.txt`](exporters/sofi/sofi-exporter.bookmarklet.txt)
- [`lm-importer.bookmarklet.txt`](importer/lm-importer.bookmarklet.txt)

They are shorter but must be re-copied every time a source file changes, and can
fail in some browsers when bookmarklet strings are truncated or edited.
Use Option A if import reliability is your priority.

### Practical limit note

There is no single universal browser limit for bookmarklet length.
Behavior varies by browser/version/OS and the page used to copy/paste the URL.
That variability is why this project ships loader versions.

## Updating after a change

The loader bookmark URL rarely changes, but the **cached script does**. The
loader silently runs whatever it cached, so a stale script produces stale output
with no warning.

`localStorage` is per-origin, so a reset only clears the site you run it on.
Repeat these on each bank site and on Lunch Money:

```js
// On www.cfna.com / www.sofi.com / my.lunchmoney.app respectively:
localStorage.removeItem("lm_bookmarklet_cfna_exporter_src");
localStorage.removeItem("lm_bookmarklet_sofi_exporter_src");
localStorage.removeItem("lm_bookmarklet_lm_importer_src");
```

Then click the loader bookmark. **You must see the "Install ... in this browser
now?" dialog.** If the bookmark runs without asking, the cache was not cleared
and the old script is still in use.

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

- The exporter reads the recent-activity widget on the account page **and**
  fetches `/cardholder/transaction-history`, which renders one table per
  statement period. Results are merged and deduplicated on `Ref#`, so it returns
  the full available history rather than only the handful of recent rows.
- Pending transactions are excluded.
- `external_id` comes from the `Ref#` in each row's detail panel.
- CFNA reports purchases positive and payments negative, which already matches
  Lunch Money, so amounts pass through unchanged.

### SoFi

1. Log in to SoFi and open any `www.sofi.com` page.
2. Click `SoFi Export (Loader)`.
3. If prompted, install [`sofi-exporter.js`](exporters/sofi/sofi-exporter.js).
4. If you have more than one SoFi account, pick which one to export. **The
   choice is remembered**, so the picker only appears once.
5. Save the exported JSON file.

Notes:

- The exporter calls SoFi's GraphQL endpoint (`/bff/graphql`) using your
  logged-in session rather than scraping the page, so it works from any
  `sofi.com` page.
- If you see `Unauthorized: Login required`, your SoFi session expired. Log in
  again and re-run.
- Only `POSTED` transactions are exported; pending and scheduled are skipped.
- `external_id` is SoFi's own transaction id, so re-running export and import is
  safe and will not create duplicates.
- **Amounts are negated on export.** SoFi reports card purchases as negative;
  Lunch Money treats money out as positive.
- SoFi's API exposes no date-range filter, so the exporter always pulls the full
  list the API returns.
- The selected account is stored as `lm_export_selected_account__sofi`. To pick a
  different account, run `LM Import Settings Reset`. If the remembered account no
  longer exists, the picker reappears on its own.

## Dates

The Lunch Money `date` is the date the purchase was **made** (authorized), not
the date it settled, so spending falls in the month you spent it.

- SoFi supplies both. `date` is the authorization date and the posted date goes
  into `notes` as `Posted: YYYY-MM-DD` (and into `custom_metadata`).
- Payments and credits usually carry no authorization date; those fall back to
  the posted date, and no redundant note is added.
- CFNA shows a single date, so there is nothing to distinguish.

To use the posted date instead, set `DATE_SOURCE = "posted"` at the top of
[`sofi-exporter.js`](exporters/sofi/sofi-exporter.js).

## Export file format

Exporters emit an envelope so the importer knows what it is reading:

```json
{
  "format": "lm-bookmarklet-export/1",
  "institution": "sofi",
  "label": "Card Account (...7769)",
  "account_hint": "700000007769",
  "exported_at": "2026-08-28T14:00:00.000Z",
  "transactions": [ ... ]
}
```

Older export files that are a bare JSON array still import fine. If such a file
is named the way an exporter names them (`cfna-lunchmoney-2026-08-27.json`), the
importer infers the institution from the filename; otherwise it is `unknown`.

## custom_metadata

Each transaction carries a `custom_metadata` envelope identifying the producing
app, plus one object named for the institution:

```json
{
  "source": "lm-bookmarklets",
  "source_version": "2.0.0",
  "institution": "sofi",
  "sofi": {
    "account_id": "700000007769",
    "account_type": "CardAccount",
    "posted_date": "2026-08-25",
    "state": "POSTED",
    "display_type": "OTHER",
    "is_debit": false,
    "affects_balance": true,
    "available_actions": ["DISPUTABLE"],
    "rule_is_editable": false,
    "expanded_fields": { "Date authorized": "2026-08-24" }
  }
}
```

```json
{
  "source": "lm-bookmarklets",
  "source_version": "2.0.0",
  "institution": "cfna",
  "cfna": {
    "cardholder": "A CARDHOLDER",
    "raw_date": "08/22/2025",
    "raw_amount": "$114.45"
  }
}
```

Rules the exporters follow:

- **Only what the institution provides.** Nothing restates `date`, `payee`,
  `amount`, or `external_id`, which Lunch Money already stores.
- **Nothing is manufactured.** A field the institution does not supply is
  absent, never an empty string or an invented default.
- **Empty values are dropped**, so a field that is null today appears
  automatically if the institution starts populating it.
- Lunch Money rejects `custom_metadata` over **4096 bytes**. If a block would
  exceed it, the exporter omits metadata rather than fail the whole import.

Read it back with the `include_metadata=true` query parameter.

## How the importer picks an account

The importer saves the Lunch Money account id under a key scoped to the
institution and source account, for example:

```
lm_import_v2_manual_account_id__sofi__700000007769
```

Each card or bank account is asked about once and remembered separately.
Existing CFNA setups keep working: if no scoped key exists for a CFNA or unknown
export, the importer falls back to the older unscoped
`lm_import_v2_manual_account_id` value.

## Troubleshooting

### Export looks stale, or is missing fields you expect

The loader is running a cached copy of an older script. See
[Updating after a change](#updating-after-a-change).

### Export says it succeeded but no file appears

Chrome and Brave allow a site one programmatic download, then silently block
further ones from that origin. There is no console error and the exporter still
reports success, because the block happens below the page.

Look for a blocked-download indicator at the right of the address bar and allow
downloads for the site, or add it under
`brave://settings/content/automaticDownloads` (`chrome://` equivalent on Chrome).

To confirm the download path itself is working, run this on the bank's page; if
`lm-download-test.txt` does not appear, the block is the cause and it is
unrelated to the exporter:

```js
const url = URL.createObjectURL(new Blob(["hello"], { type: "text/plain" }));
const a = document.createElement("a");
a.href = url; a.download = "lm-download-test.txt";
document.body.appendChild(a); a.click(); a.remove();
```

### File picker does not open (Chrome/Brave)

- Click `LM Import (Loader)` a second time.
- Keep DevTools closed while testing.

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

## Advanced (maintainers)

Edit these source files:

- [`cfna-exporter.js`](exporters/cfna/cfna-exporter.js)
- [`sofi-exporter.js`](exporters/sofi/sofi-exporter.js)
- [`lm-importer.js`](importer/lm-importer.js)

Rebuild generated bookmarklet files:

```bash
node tools/make-bookmarklet.js
```

`make-bookmarklet.js` generates all `*.bookmarklet.txt` files, refuses to write
one that does not parse, and fails if an exporter's `SOURCE_VERSION` disagrees
with `PROJECT_VERSION`.

### Tests

```bash
node tools/run-tests.js
```

Each `*.spec.js` sits beside the code it exercises, runs in its own process, stubs the browser globals an
exporter or the importer expects, feeds it a synthetic fixture, and asserts on
the JSON it produces. There are no dependencies and no test framework.

Fixtures are **synthetic**: they copy the exact shape of each institution's
responses or markup, but every id, merchant, amount, and name is invented. Real
account data must never be committed.

The suites cover the things most likely to break silently: amount sign
normalization, `external_id` stability, pending exclusion, date selection,
dedupe across pages, and the rule that `custom_metadata` never restates a Lunch
Money column or invents a value the institution did not supply.

### Versioning

`PROJECT_VERSION` in [`make-bookmarklet.js`](tools/make-bookmarklet.js) is the version
of the project. Every exporter that stamps `source_version` into
`custom_metadata` declares a matching `SOURCE_VERSION`. Because the loader flow
reads the raw `.js` from disk, the version cannot be injected at build time, so
the build enforces agreement instead.

Bump the major version when adding an institution or changing the
`custom_metadata` shape.

### Adding an institution

1. Create `exporters/<name>/` and write `<name>-exporter.js` in it. The exporter
   must emit the envelope described above with a unique `institution` value, an
   `account_hint` when the source has a stable account identifier, and
   `SOURCE_VERSION` matching `PROJECT_VERSION`.
2. Add `exporters/<name>/<name>-exporter.spec.js` with a **synthetic** fixture.
3. Add one entry to the `EXPORTERS` array at the top of
   [`make-bookmarklet.js`](tools/make-bookmarklet.js), giving its `dir` and
   `source`.
4. Run `node tools/make-bookmarklet.js` and `node tools/run-tests.js`.

Loader storage keys, generated filenames, and the reset bookmarklets are all
derived from that array. The importer needs no changes.

### Optional CLI import

```bash
LM_TOKEN='YOUR_TOKEN' LM_MANUAL_ACCOUNT_ID='123456' LM_BASE='https://api.lunchmoney.dev/v2' node importer/import-lunchmoney.js ~/Downloads/sofi-<account-id>-lunchmoney-YYYY-MM-DD.json
```

The CLI accepts both envelope files and bare arrays.

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

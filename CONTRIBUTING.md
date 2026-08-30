# Contributing

This project turns bank websites Lunch Money cannot sync into JSON that Lunch Money can import. Adding your own bank means writing one file.

The [README](README.md) covers using the bookmarklets. This document covers how they work and what a new exporter has to do.

**You do not have to do this by hand.** If you use an AI coding agent, it can do most of the work — see [Working with an agent](#working-with-an-agent). Writing an exporter yourself is entirely fine too; the rest of this document is written for that.

## How it works

Banks block direct API calls from their pages to Lunch Money, so the flow is deliberately two steps:

1. An **exporter** bookmarklet runs on the bank's site, reads your transactions, and downloads a JSON file.
2. The **importer** bookmarklet runs on Lunch Money, reads that file, and POSTs to the Lunch Money API.

There is one importer for every institution. It is institution-agnostic: the export file says where it came from, and the importer remembers which Lunch Money account to use for each source account. **You should not need to touch the importer to add a bank.**

### Loaders

A bookmarklet long enough to hold a real exporter is fragile — browsers truncate and mangle long `javascript:` URLs. So each exporter ships twice:

- A **direct** bookmarklet containing the whole script.
- A **loader** bookmarklet, which is small and stable. The first time you click it, it asks for the `.js` file and caches it in `localStorage`; after that it runs the cached copy.

The loader is the recommended path. It also means **the cached script, not the bookmark, is what runs** — the most common confusion when testing changes. See "Updating after a change" in the README.

## Repository layout

```
exporters/<institution>/   one directory per institution: source, generated
                           bookmarklets, and its spec
importer/                  the shared importer, plus the optional CLI
tools/                     build and test scripts
templates/                 starting point for a new exporter
*-reset.bookmarklet.txt    cross-cutting reset bookmarks
```

Everything for one institution lives in its own directory. A new-institution PR should touch exactly one place.

## The contract

### The export file

```json
{
  "format": "lm-bookmarklet-export/1",
  "institution": "acme",
  "label": "Acme Card (...1234)",
  "account_hint": "9876543210",
  "exported_at": "2026-08-29T14:00:00.000Z",
  "transactions": [ ... ]
}
```

`institution` must be unique across the project. `account_hint` is the institution's own account identifier when there is one — the importer keys the saved Lunch Money account id on `institution + account_hint`, so people with two cards at the same bank are asked once per card.

### A transaction

| Field | Notes |
|---|---|
| `date` | `YYYY-MM-DD`. Prefer the date the purchase was **made**, not when it settled. |
| `payee` | Merchant or description, whitespace collapsed. |
| `amount` | String, 2 decimals. **Money out is positive**, money in is negative. |
| `external_id` | The institution's own transaction id. |
| `status` | `"unreviewed"`. |
| `notes` | Optional. Anything a human would want to read. |
| `custom_metadata` | Optional. See below. |

### custom_metadata

Lunch Money's insert-transactions API accepts an **optional `custom_metadata` object on each transaction**. It is free-form JSON with a variable schema — Lunch Money stores it and hands it back, but does not interpret it.

That makes it the right home for detail a bank exposes that Lunch Money has no column for: a settlement date, a transaction state, a merchant category, whatever internal identifiers the bank attaches. Without it that information is simply discarded at import time.

Read it back with `include_metadata=true` on the transactions endpoint. Without that parameter the API returns null and you will think it never saved.

#### The convention

Two parts: an **envelope** identifying what produced the row, and a **single object named after the institution** holding that bank's own data.

```json
{
  "source": "lm-bookmarklets",
  "source_version": "2.0.0",
  "institution": "acme",
  "acme": {
    "posted_date": "2026-08-25",
    "state": "POSTED",
    "category_display_name": "Groceries"
  }
}
```

The envelope is fixed and the same for every exporter:

| Key | Meaning |
|---|---|
| `source` | Always `lm-bookmarklets`. Says which tool wrote the row, since other importers write `custom_metadata` too. |
| `source_version` | The project version that produced it, useful when triaging a row that looks wrong. |
| `institution` | Your slug. Gives a consumer a fixed path to check without knowing which bank key to look under. |

Everything the bank gave you goes in the object named by your slug — `acme` above. Namespacing it that way means two banks that both call something `status` never collide, and anyone reading a row can tell whose schema they are looking at.

Field names inside that object are yours to choose. Prefer the bank's own naming, converted to `snake_case`, so the mapping back to the source is obvious.

#### Guidelines for useful custom_metadata content

1. **Only what the institution supplies.** Not what you can compute.
2. **Never invent a value.** A field the institution does not provide is *absent* — not an empty string, not a plausible default. A consumer cannot tell "this bank has no such concept" from "this bank said it was empty."
3. **Drop empty values.** A field that is null today then fills itself in if the institution starts populating it, with no code change.

#### Omit it entirely when there is nothing to say

If the bank supplies nothing beyond what Lunch Money already stores, **do not send `custom_metadata` at all**. An envelope wrapping an empty object is pure overhead: it costs bytes on every transaction and tells a reader nothing.

This is a real outcome, not a hypothetical. The CFNA exporter scrapes a page that offers almost nothing beyond the date, description, amount, and reference number that already become Lunch Money columns — so its metadata is three fields, and a row without a cardholder or detail text gets no metadata block at all.

The boilerplate in `templates/example-exporter.js` already does this: `buildMetadata` may return `null`, and `wrapMetadata` drops empty values first and returns `null` if nothing survives.

#### Size

Lunch Money rejects `custom_metadata` over **4096 bytes**, and an oversized block fails the entire import batch rather than the one transaction. Check the size and drop the metadata instead of letting the import fail. For reference, a fairly rich block runs about 350 bytes, so this only becomes a concern if you are storing something large like line items.

## Before you write code: reconnaissance

Work down this list. The order matters more than anything else in this document, because it decides how much pain you are signing up for.

**1. Is there a JSON or GraphQL endpoint?** Open the network tab and load the transactions page. If the table is populated by an XHR, that is your source: stable ids, real dates, unformatted amounts, explicit pending flags. The SoFi exporter is 100 lines of mapping because of this.

**2. Is there a CSV or OFX export?** Less good than an API but far better than scraping, and immune to redesigns.

**3. Only then, scrape the DOM.** You will be parsing formatted dates and currency strings out of rendered markup, and it will break when the bank ships a redesign.

While you are in there, also check:

- **Does the page you are on show everything?** A "recent activity" widget is often a small subset. CFNA's showed 3 transactions; its statement pages held
  16. Look for a fuller history view and read both.
- **Is there a stable transaction id?** This is the difference between an exporter you can run weekly and one that duplicates everything.
- **How does the institution sign amounts?** Find a known purchase and look.

## Traps

Every one of these has already bitten this project.

**Sign conventions differ per institution.** SoFi reports purchases negative; CFNA reports them positive. Both must end up positive in Lunch Money, which means one of them needs its sign flipped and the other does not. Verify against a purchase you recognize before trusting your mapping — getting this backwards inverts every transaction you import, and it is not obvious from the JSON.

**`external_id` is the whole ballgame.** Lunch Money deduplicates on it, which is what makes re-running an export safe. Use the institution's own id. If you must synthesize one, make it deterministic and say so in your PR — and know that a hash of date+payee+amount breaks when a pending transaction's payee changes as it posts.

**Dedup cuts both ways.** If you import transactions with wrong dates, fixing the exporter and re-importing will *not* correct them — Lunch Money sees a known `external_id` and skips. Get it right before importing at scale.

**Exclude pending transactions.** They change: amounts get adjusted, payees get cleaned up, some vanish. Import them and you get permanent wrong rows.

**Authorized vs posted dates.** If the institution gives both, use the authorization date — that is when you spent the money, and it puts month-boundary spending in the right budget month. Put the other in `notes`, but only when they differ; a note repeating the transaction's own date is noise.

**An auth failure can look like a schema answer.** While probing a GraphQL schema, an expired session returned `{"error": "Unauthorized"}` — singular — while validation errors come back as `{"errors": [...]}`. Code that checked for `errors` concluded that fourteen non-existent fields existed. Check that your session is alive before trusting any probe.

**Introspection is often disabled.** You may have to discover field names by asking for them and reading the validation errors. GraphQL reports every undefined field in one response, so you can probe a long candidate list in a single request.

## Testing

```bash
node tools/run-tests.js
```

Each `*.spec.js` sits beside the code it exercises and runs in its own process, because specs install conflicting browser globals. No framework, no dependencies.

A spec stubs what the exporter reads (`fetch`, or `document` and `DOMParser`), feeds it a fixture, and asserts on the JSON it produces.

**Fixtures must be synthetic.** Copy the exact *shape* of your institution's responses or markup, but invent every id, merchant, amount, and name. Real account data must never be committed. This is not negotiable — it is a public repository and the data is financial.

Because the maintainer usually cannot get an account at your bank, **your spec is how your exporter gets reviewed.** A fixture that mirrors the real shape, plus assertions on sign normalization, `external_id`, pending exclusion, and date selection, lets someone verify your mapping logic without credentials.

## Security

An exporter runs with full page privileges on a logged-in banking session, and anyone who installs it is running your code against their bank. Treat that seriously.

- **No network calls to anything but the institution's own origin.** Use same-origin relative URLs. An exporter has no reason to contact a third party.
- **No `eval`, `Function()`, dynamic `import()`, or injected `<script>` tags.**
- **No storage writes outside the documented `lm_export_*` keys.**
- **Readable source.** Not minified, not obfuscated, no base64 blobs. The generated `.bookmarklet.txt` is minified by the build; the `.js` you write is what gets reviewed.

`node tools/check-exporter-safety.js` enforces the mechanical parts of this — absolute URLs, dynamic code execution, script injection, storage writes outside `lm_export_*`, and encoded blobs — across everything under `exporters/` and `templates/`. It also checks that each file parses. The build runs it first and refuses to produce a bookmarklet from source that fails.

It cannot tell whether an exporter *works*. It can tell that an exporter cannot quietly send someone's banking session somewhere else, which is the property a reviewer has the hardest time confirming by eye.

Exporters are reviewed before merging, but neither review nor the checker is a guarantee. Anyone installing one is trusting its author and this project's maintainer.

## Working with an agent

An exporter is a good fit for an AI coding agent, because the work splits cleanly: **you have an account at the bank and it does not**, and it has the patience for reverse-engineering a transactions page. If you would rather not write JavaScript, this is a reasonable way to contribute.

This is an option, not a requirement, and it is not a shortcut past review — an agent-written exporter is held to exactly the same bar as a hand-written one.

[AGENTS.md](AGENTS.md) is a runbook written for the agent. Point it there:

> Read AGENTS.md and CONTRIBUTING.md in this repository, then help me add an exporter for <my bank>.

What to expect:

- **You log in, always.** A well-behaved agent will not type your password or an MFA code, and will not click through a CAPTCHA. It works inside the session after you have signed in.
- **Your transaction data will pass through the agent's context** while it works out how the page is structured. That is unavoidable when writing a scraper, and worth knowing before you start.
- **It will ask you things only you can answer.** Whether a given row is a purchase or a payment, whether the list looks complete, whether the account is already syncing into Lunch Money another way. Answer carefully — the sign question in particular is one nothing in the data reveals, and getting it wrong inverts every amount.
- **Test fixtures will be invented, not copied.** Nothing real should reach the repository.

If the agent goes off the rails — pasting real transactions into a test, calling an outside URL, wanting to import into your live account to "check" — stop it. Those are the specific things the runbook forbids, and `node tools/check-exporter-safety.js` catches some of them mechanically.

## Adding an institution

1. Copy `templates/example-exporter.js` and `templates/example-exporter.spec.js` into `exporters/<name>/`, renamed to `<name>-exporter.js` and `<name>-exporter.spec.js`.
2. Fill in the three TODOs: fetch the raw transactions, map one to the Lunch Money shape, build the metadata block.
3. Add an entry to `EXPORTERS` at the top of [`tools/make-bookmarklet.js`](tools/make-bookmarklet.js) with your `id`, `label`, `dir`, and `source`.
4. Run `node tools/make-bookmarklet.js` and commit the generated files.
5. Run `node tools/run-tests.js` and `node tools/check-exporter-safety.js`.
6. Open a PR and fill in the checklist.

The loader storage keys, generated filenames, and the reset bookmarklets are all derived from that `EXPORTERS` entry. The importer needs no changes.

## Versioning

`PROJECT_VERSION` in `tools/make-bookmarklet.js` is the version of the project. Every exporter declares a matching `SOURCE_VERSION`, and the build fails if they disagree — because the loader reads the raw `.js` from disk, the version cannot be injected at build time, so agreement is enforced instead.

Bump the major version when adding an institution or changing the `custom_metadata` shape.

## What a good PR looks like

- Touches one directory under `exporters/`, plus one line in `EXPORTERS`.
- Includes a synthetic fixture and passing tests.
- Says plainly what you tested against a live account and what you could not.

Honest gaps are fine and useful. Silent ones are not.

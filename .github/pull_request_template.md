## What this changes

<!-- One or two sentences. If this adds an institution, name it. -->

## For a new exporter

Delete this section if it does not apply.

**Institution:** <!-- e.g. Acme Bank -->
**How it reads transactions:** <!-- JSON/GraphQL API | CSV export | DOM scraping -->

- [ ] Lives entirely in `exporters/<name>/`
- [ ] Emits the export envelope with a unique `institution` value
- [ ] `SOURCE_VERSION` matches `PROJECT_VERSION`
- [ ] `external_id` is the institution's own transaction id, or the PR explains
      why it cannot be and what is used instead
- [ ] **Amount signs normalized**: money out is positive, money in is negative,
      verified against the institution's own convention
- [ ] Pending / unsettled transactions are excluded
- [ ] `custom_metadata` carries only what the institution supplies, and restates
      nothing Lunch Money already stores
- [ ] Spec added with a **synthetic** fixture — no real account data anywhere in
      the diff (ids, merchants, amounts, names)
- [ ] `node tools/run-tests.js` passes
- [ ] `node tools/make-bookmarklet.js` runs and generated files are committed

## Safety

- [ ] No network calls to anything but the institution's own origin
- [ ] No `eval`, `Function()`, dynamic `import()`, or injected `<script>` tags
- [ ] No storage writes outside the documented `lm_export_*` keys
- [ ] Source is readable — not minified, obfuscated, or base64-encoded

## Testing done

<!-- Whether you ran this against a live account, and what you saw.
     Say so plainly if you could not test some path. -->

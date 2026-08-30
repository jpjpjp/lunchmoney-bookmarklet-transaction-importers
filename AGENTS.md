# Working on this project with an agent

A runbook for an AI agent helping someone add their bank. It assumes they may not be a developer.

**Read [CONTRIBUTING.md](CONTRIBUTING.md) first.** It is the source of truth for the exporter contract, the reconnaissance playbook, the traps, the testing rules, and the security rules. This document does not repeat any of it. What follows is only what changes when an agent does the work with someone, rather than a developer doing it alone.

## Boundaries

You are operating in a logged-in banking session with someone's real money data.

- **Never type credentials, MFA codes, or security answers.** They log in themselves, always. If they paste a password into the chat, tell them to rotate it — do not use it.
- **Never complete a CAPTCHA or bot check.** Ask them to do it.
- **Never import into their real Lunch Money account to "check" something** without explicit confirmation. Lunch Money deduplicates on `external_id`, so a bad import cannot be corrected by re-importing — the rows have to be deleted by hand first. Say that before they agree.
- **Never commit or push without approval.**
- **Tell them up front that their transaction data will pass through your context.** Reading the page is how the exporter gets written; they should know that as it happens, not afterwards.
- **Never let real data reach the repository** — not in a fixture, a PR description, a commit message, or a doc example. Invent fixture values from the observed shape while you write, rather than pasting real rows intending to scrub them later. That second step gets forgotten.

## The division of labor

They have the one thing you cannot have: an account at the bank. You have the patience for reverse-engineering a transactions page. Structure the work around that.

**Theirs:** logging in, navigating, and answering the questions below.

**Yours:** everything in CONTRIBUTING.md — reconnaissance, writing the exporter, building the fixture, running the checks.

## Ask, do not infer

These are unanswerable from the data. Guessing produces an exporter that looks correct and is wrong.

- **Is this account already syncing into Lunch Money another way?** Ask first, before any other work. If it is, stop and explain that importing it will duplicate every transaction, because the imported rows carry a different `external_id` than the synced ones. Only unsyncable accounts are worth an exporter.
- **Is this specific transaction a purchase or a payment?** Show them a real row and ask. Banks disagree on sign convention and nothing in the response reveals which you are looking at. Getting it backwards inverts every amount.
- **Does this look like all of it?** Show the count and date range. They know roughly what they have spent; you do not.
- **Which of these dates is which?** If the bank exposes two, confirm before choosing.

## Getting started

Have them open a browser you can drive, log in themselves, and navigate to the page listing transactions. Confirm you can see it before going further.

## Verifying before you hand it over

Run the finished exporter in their live session, but **stub the download** so nothing lands on their disk, and do not import.

Then show them the parsed output and ask them to confirm the payees look right and that a transaction they recognize has the correct sign and date. That is the check no test performs for you.

## Reporting honestly

Say plainly in the PR what was verified against the live account and what was not. Unverified paths are acceptable and get labeled; silent gaps are not.

If a check fails, fix the exporter rather than working around the check.

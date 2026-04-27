## (from /devx-init) Stack: which language for the first dev story?

Empty repo — no stack file detected. The first slice's spec needs a primary
language so language_runners + lint/test commands can be wired up.

**Options:** TypeScript / Python / Rust / Go / Flutter / other.
**Recommendation:** TypeScript (default for the first dev story unless you
say otherwise — broadest tooling, fastest iteration).

- [ ] Pick a primary language for the first dev story.

## (from /devx-init) CI: when should GitHub Actions run?

`.github/workflows/devx-ci.yml` was just scaffolded. It needs trigger filters.

**Options:**
- on PR + push to main (default, runs every change before merge)
- on push only (cheaper; PRs go through review without CI)
- on schedule + on PR (nightly + per-PR)

**Recommendation:** on PR + push to main.

- [ ] Confirm CI trigger filters.

## (from /devx-init) Browser harness — Playwright, Cypress, or none?

If the first slice has any UI, this gates Layer-1 (scripted) browser tests.
If it's pure CLI / API, pick none — devx will skip browser harness setup.

**Options:** Playwright (default) / Cypress / none.
**Recommendation:** Playwright (covers Chromium + WebKit + Firefox in one run).

- [ ] Pick a browser harness (or `none`).

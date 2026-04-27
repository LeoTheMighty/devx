## (from /devx-init) Edition — 2021 or 2024?

A `Cargo.toml` was detected. Rust edition shapes lints + idiom defaults.

**Options:** 2021 (stable, broadest) / 2024 (latest stable as of write).
**Recommendation:** 2024 unless you have a dependency that pins 2021.

- [ ] Confirm the edition for new crates.

## (from /devx-init) CI matrix — stable only, stable + nightly, or stable + beta + nightly?

Wider matrix catches more, costs more CI minutes.

**Options:** stable only / stable + nightly / stable + beta + nightly.
**Recommendation:** stable only for solo dogfood (default); add nightly once
you depend on a `nightly`-gated feature.

- [ ] Pick a CI matrix.

## (from /devx-init) Lint level — warn-level or deny-level (clippy::all)?

Under YOLO, lints are informational. Under PROD, deny-level fails CI.

**Options:** warn (default — informational) / deny clippy::all (gating).
**Recommendation:** warn while bootstrapping; flip to deny once the
codebase is clean and you're heading to BETA.

- [ ] Pick a clippy lint level.

## (from /devx-init) Go version — pin to which minor?

A `go.mod` was detected. The version in `go.mod`'s `go` directive shapes
language features available + which CI image gets pulled.

**Options:** Go 1.22 / 1.23 / 1.24 (latest stable as of write).
**Recommendation:** the latest stable unless a dep blocks you.

- [ ] Confirm the Go version pin for the project.

## (from /devx-init) Module layout — flat, or `cmd/` + `internal/` split?

Affects where new code lands. Flat is fine for a binary; split is the
idiomatic shape once you have multiple commands or want to discourage
external imports of internals.

**Options:** flat (default — single binary, single package) / `cmd/` + `internal/` split.
**Recommendation:** flat for a one-binary project; split once you have ≥2 commands.

- [ ] Pick a module layout.

## (from /devx-init) Linter — golangci-lint default config, or strict?

`golangci-lint` is the de-facto Go linter. Default config is conservative;
strict (e.g. enabling `errcheck`, `gocyclo`, `gocritic`) catches more but
fights you while bootstrapping.

**Options:** default / strict (enable extra linters) / none (rely on `go vet` only).
**Recommendation:** default while bootstrapping; tighten once codebase is clean.

- [ ] Pick a golangci-lint config preset.

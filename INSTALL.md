# Install — `@devx/cli`

The `devx` CLI is a single npm package — **currently unpublished**
(`private: true`; there is nothing on the npm registry). The one working
install path today is a **local global install from a checkout**:

```sh
git clone https://github.com/LeoTheMighty/devx ~/src/devx
cd ~/src/devx
npm ci
npm run install:global      # = npm run build && npm i -g .
devx --version              # → 0.1.0+<sha>  (git-SHA build provenance)
```

`npm run install:global` builds `dist/` (embedding the checkout's
`git rev-parse --short HEAD` into `dist/build-info.json`) and installs the
package globally from the local directory. `devx --version` reporting
`<semver>+<sha>` is how you confirm *which checkout* the global binary came
from; a plain `0.1.0` means no build provenance (e.g. a tarball without a
`.git` dir).

> **Do not use `npm link`.** A linked install points the global `devx` at
> your live working tree — every uncommitted edit, broken branch, and
> half-finished build in `~/src/devx` becomes the globally-installed CLI
> instantly, and `npm run build` output drifts out from under the symlink.
> `npm i -g .` (what `install:global` runs) copies a real install instead.
> If you have a stale link: `npm unlink -g @devx/cli` and reinstall.

To pick up upstream changes later:

```sh
cd ~/src/devx && git pull && npm ci && npm run install:global
```

---

## Using devx on shared / work repositories

Two things are the **operator's call, not devx's**:

- **Mode.** Shared and work repos should run **BETA or PROD** — never YOLO.
  YOLO auto-merges its own PRs on green CI; that is a pre-launch solo
  dogfood setting. Set `mode:` in `devx.config.yaml` (or answer the mode
  question in `/devx-init`) accordingly; the merge gate then requires the
  approvals those modes demand.
- **Org policy on AI tooling.** devx drives Claude Code, which sends
  repository content to Anthropic. Whether that is acceptable for a given
  work repo is governed by your organization's policy — check before
  pointing devx at code you don't personally own. (This repo tracked the
  question as INTERVIEW Q#11.)

---

## Requirements

- **Node ≥ 20** (declared in `package.json → engines.node`).
- **npm ≥ 10** (ships with Node 20).
- A shell with a writable global npm prefix.
- **git ≥ 2.30** and **gh** (authenticated) for the actual dev loop.

---

## Platform notes

The global-bin PATH issues are the same as for any npm global install; the
postinstall script prints a hint when it detects a problem (warn-only — it
never fails the install).

- **macOS**: if `devx` isn't found after install, npm's global bin isn't on
  PATH. Append `export PATH="$(npm config get prefix)/bin:$PATH"` to
  `~/.zshrc`, then `exec $SHELL`.
- **Native Linux**: `EACCES` on `/usr/lib/node_modules` means a
  system-package Node wants root. Give npm a user prefix:
  `mkdir -p ~/.npm-global && npm config set prefix ~/.npm-global` and add
  `~/.npm-global/bin` to PATH — or switch to nvm-managed Node.
- **WSL2-Ubuntu**: run the install **inside the WSL shell**, never from
  PowerShell. If `npm config get prefix` reports `/mnt/c/...`, the npm
  prefix is on the Windows host — binaries land on the *Windows* PATH and
  `devx` won't resolve in Linux. Reset inside WSL:
  `npm config set prefix "$HOME/.npm-global"` (the postinstall detects this
  crossover and prints the fix). Verify with `which devx` — expect
  `/home/<you>/...`, not `/mnt/c/...`.
- **Windows-host (PowerShell/cmd)**: best-effort, manually verified. If
  `devx` isn't recognized, add the output of `npm config get prefix` to
  your user PATH and restart the shell.

---

## Verifying the install

```sh
devx --version           # 0.1.0+<sha> from a checkout build
devx --help              # full command listing, sorted by phase
command -v devx          # absolute path to the binary
```

---

## Uninstall

```sh
npm uninstall -g @devx/cli
```

Removes the binary and packaged assets. devx project files in your repos
(`devx.config.yaml`, `DEV.md`, `dev/`, etc.) are untouched.

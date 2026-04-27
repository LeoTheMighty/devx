# Install — `@devx/cli`

The `devx` CLI is a single npm package. The install matrix below covers the
four environments Phase 0 supports: macOS, native Ubuntu, WSL2-Ubuntu (the
common foot-gun shape), and Windows-host PowerShell.

> **Note on file location:** the spec for cli305 calls this file
> `package/INSTALL.md`. The repo *is* the npm package — there is no nested
> `package/` directory — so the canonical path is `INSTALL.md` at the repo
> root. The file is shipped in the published tarball via `package.json →
> files`.

---

## Requirements

- **Node ≥ 20** (declared in `package.json → engines.node`).
- **npm ≥ 10** (ships with Node 20).
- A shell with a writable `~/.npmrc` and a writable global prefix.

---

## macOS

```sh
npm i -g @devx/cli
devx --version    # → 0.1.0
```

If `devx` is not found after install, the postinstall script prints a hint.
The usual cause on macOS is that npm's global bin (`$(npm config get
prefix)/bin`) is not on PATH. Append:

```sh
export PATH="$(npm config get prefix)/bin:$PATH"
```

…to `~/.zshrc` (default shell on macOS) or `~/.bash_profile`, then `exec $SHELL`.

---

## Native Ubuntu (and other Linux without WSL)

```sh
npm i -g @devx/cli
devx --version
```

If `npm i -g` errors with `EACCES` on `/usr/lib/node_modules`, you installed
Node via the system package manager and npm wants root. Two fixes:

1. **Recommended — give npm a user-writable prefix**:
   ```sh
   mkdir -p "$HOME/.npm-global"
   npm config set prefix "$HOME/.npm-global"
   echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.bashrc
   exec $SHELL
   npm i -g @devx/cli
   ```
2. **Alternative — switch to nvm-managed Node**:
   ```sh
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
   nvm install 20
   npm i -g @devx/cli
   ```

---

## WSL2-Ubuntu

WSL2 is the **single most common foot-gun** for Node CLIs because there are two
filesystems involved. Run the install **inside the WSL shell**, not from
PowerShell:

```sh
# Inside `wsl` / your Ubuntu shell, NOT in PowerShell:
npm i -g @devx/cli
devx --version
```

### What goes wrong

- If `npm config get prefix` reports something like `/mnt/c/Users/<you>/AppData/Roaming/npm`,
  the npm prefix is on the Windows host filesystem. Binaries land there, get
  added to the *Windows* PATH (not WSL's), and `devx` won't resolve from a
  Linux shell. The cli304 postinstall **detects this and prints a fix** as of
  cli305.
- If you ran `npm i -g` from PowerShell at any point, the prefix you see in
  WSL may be inherited from `%APPDATA%\npm`. Reset it explicitly inside WSL:
  ```sh
  npm config set prefix "$HOME/.npm-global"
  echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.bashrc
  exec $SHELL
  npm i -g @devx/cli
  ```

### How to verify you're on the Linux side

```sh
npm config get prefix
# Expect something like /home/<you>/.npm-global, NOT /mnt/c/...
which devx
# Expect /home/<you>/.npm-global/bin/devx, NOT /mnt/c/...
```

---

## Windows-host (PowerShell / cmd)

> **Caveat:** Windows-host install is **best-effort, manually verified** for
> Phase 0. The CI matrix runs only on macos-latest + ubuntu-latest. If you hit
> issues, file a `debug/debug-*.md` spec.

```powershell
npm i -g @devx/cli
devx --version
```

If `devx` is not recognized, npm's global bin (typically
`%APPDATA%\npm`) is not on your user PATH. Add it via:

- **System Properties → Environment Variables → User variables → Path → Edit
  → New →** paste the output of `npm config get prefix` (then append `\` if
  needed). Restart the shell.

---

## Verifying the install

```sh
devx --version           # current package version (e.g. 0.1.0)
devx --help              # full command listing, sorted by phase
command -v devx          # absolute path to the binary
```

Postinstall will print a single line of advice if any of these are likely to
fail. It is **warn-only** — it never causes `npm i -g` to fail, even on a
probe error.

---

## Uninstall

```sh
npm uninstall -g @devx/cli
```

This removes the binary and the `_devx/config-schema.json` shipped with the
package. devx project files in your repos (`devx.config.yaml`, `DEV.md`,
`dev/`, etc.) are untouched.

---

## Versions

- **0.1.0** — Phase 0: scaffolded CLI surface (cli301), stubs (cli302), help
  listing (cli303), `--version` + postinstall (cli304), cross-platform install
  matrix + WSL host-crossover detection (cli305).

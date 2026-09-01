#!/usr/bin/env bash
#
# update_devx.sh — ensure the installed `devx` CLI matches origin/main.
#
# Ported from `mycase/8am-harness` update_harness.sh: same contract (check,
# then update what is behind; `--check` reports and changes nothing), a
# different mechanism, because devx is not installed the way the harness is.
#
#   harness → a Claude Code plugin (harness@8am) whose installed copy is a
#             SEPARATE clone under ~/.claude/plugins/cache, refreshed with
#             `claude plugin install/update`. Edits in the working tree do
#             not change it.
#   devx    → an npm global whose bin symlinks INTO this working tree
#             (`npm i -g .` → devx → <repo>/dist/cli.js). The installed copy
#             *is* this checkout, so "update" means: fast-forward the
#             checkout, rebuild dist/, and confirm the global bin still
#             points here.
#
# Three axes can each leave `devx` behind main, so all three are checked:
#
#   1. checkout behind origin/main       → git pull --ff-only
#   2. dist/ behind the checkout's HEAD  → npm run build:swap
#   3. `devx` on PATH is not this repo   → npm i -g .
#
# Axis 2 is the one that bites in practice and the one `devx --version`
# already warns about (src/cli.ts warnIfBuildStale): every worktree gate
# builds its OWN dist/, so a merge can land on main while the CLI on PATH
# still runs pre-merge code. This script is the deliberate version of that
# warning's advice.
#
# Usage:
#   ./update_devx.sh            # check, and update whatever is behind
#   ./update_devx.sh --check    # check only; exit 1 if out of date (no changes)
#
# Exit codes:
#   0  up to date (or brought up to date)
#   1  out of date (--check), or an update ran but did not reach main
#   2  could not read the remote / not a git checkout — nothing attempted
#   3  an update step failed loudly (pull, install, build, or link)
#
set -euo pipefail

REMOTE="origin"
BRANCH="main"
BIN_NAME="devx"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

CHECK_ONLY=false
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=true

# --- helpers ---------------------------------------------------------------
installed_sha() {
  # Prints the sha embedded in dist/build-info.json by scripts/build-info.mjs
  # (the analogue of the plugin's gitCommitSha), or "" when dist/ has never
  # been built or the provenance file is malformed.
  python3 - "${REPO_ROOT}/dist/build-info.json" <<'PY'
import json, sys
try:
    with open(sys.argv[1]) as f:
        sha = json.load(f).get("sha", "")
except (OSError, ValueError):
    sha = ""
print(sha if isinstance(sha, str) else "")
PY
}

remote_main_sha() {
  git ls-remote "$REMOTE" "refs/heads/${BRANCH}" | awk '{print $1}'
}

# True when $1 is a prefix of $2 (build-info stores a SHORT sha; git ls-remote
# and rev-parse hand back full ones — comparing them raw is always unequal).
sha_matches() {
  local short="$1" full="$2"
  [[ -n "$short" && -n "$full" && "$full" == "$short"* ]]
}

linked_target() {
  # Absolute path of the file `devx` on PATH actually executes, or "".
  local bin
  bin="$(command -v "$BIN_NAME" 2>/dev/null || true)"
  [[ -z "$bin" ]] && return 0
  python3 - "$bin" <<'PY'
import os, sys
try:
    print(os.path.realpath(sys.argv[1]))
except OSError:
    print("")
PY
}

# --- check -----------------------------------------------------------------
echo "Checking devx against ${REMOTE}/${BRANCH}..."

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "ERROR: ${REPO_ROOT} is not a git checkout" >&2
  exit 2
fi

REMOTE_SHA="$(remote_main_sha)"
if [[ -z "$REMOTE_SHA" ]]; then
  echo "ERROR: could not read ${BRANCH} SHA from ${REMOTE}" >&2
  exit 2
fi

HEAD_SHA="$(git rev-parse HEAD)"
CUR_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
BUILT_SHA="$(installed_sha)"
LINK="$(linked_target)"
WANT_LINK="${REPO_ROOT}/dist/cli.js"

# "Behind" means main is NOT already contained in HEAD. A checkout that is
# merely AHEAD of main (local commits, a feature branch) is not stale — a
# fetch is needed first, since the ancestry test reads local objects only.
git fetch --quiet "$REMOTE" "$BRANCH" 2>/dev/null || true
CHECKOUT_BEHIND=false
git merge-base --is-ancestor "$REMOTE_SHA" HEAD 2>/dev/null || CHECKOUT_BEHIND=true

BUILD_STALE=false
sha_matches "$BUILT_SHA" "$HEAD_SHA" || BUILD_STALE=true

LINK_WRONG=false
[[ "$LINK" == "$WANT_LINK" ]] || LINK_WRONG=true

echo "  ${REMOTE}/${BRANCH}:   ${REMOTE_SHA:0:7}"
echo "  checkout HEAD:  ${HEAD_SHA:0:7} (${CUR_BRANCH})$($CHECKOUT_BEHIND && echo '  ← behind')"
echo "  built dist/:    ${BUILT_SHA:-<never built>}$($BUILD_STALE && echo '  ← stale')"
echo "  ${BIN_NAME} on PATH:  ${LINK:-<not installed>}$($LINK_WRONG && echo '  ← not this repo')"

if ! $CHECKOUT_BEHIND && ! $BUILD_STALE && ! $LINK_WRONG; then
  echo "✅ devx is up to date with ${REMOTE}/${BRANCH}."
  exit 0
fi

echo "⚠️  devx is NOT up to date with ${REMOTE}/${BRANCH}."

if $CHECK_ONLY; then
  exit 1
fi

# --- update ----------------------------------------------------------------
# 1. Fast-forward the checkout. Refused rather than forced on a dirty tree or
#    a non-default branch: unlike the harness's plugin cache, this is the
#    user's working tree, and a script that stashes or checks out branches
#    behind their back is a script nobody can trust mid-story. The rebuild
#    below still runs, so a stale dist/ on a feature branch is still fixed.
if $CHECKOUT_BEHIND; then
  echo
  if [[ "$CUR_BRANCH" != "$BRANCH" ]]; then
    echo "  SKIP pull: on '${CUR_BRANCH}', not '${BRANCH}' — switch branches yourself, then re-run."
  elif [[ -n "$(git status --porcelain)" ]]; then
    echo "  SKIP pull: working tree is dirty — commit or stash, then re-run."
  else
    echo "Fast-forwarding ${BRANCH} from ${REMOTE}..."
    git pull --ff-only "$REMOTE" "$BRANCH" || {
      echo "ERROR: git pull --ff-only failed (diverged history?) — resolve by hand" >&2
      exit 3
    }
    HEAD_SHA="$(git rev-parse HEAD)"
    BUILD_STALE=true
  fi
fi

# 2. Dependencies, but only when the lockfile actually moved between the built
#    commit and HEAD. `npm ci` is ~40s of nothing when it did not. The rev has
#    to be resolvable first: a build from a squash-merged branch leaves a sha
#    that is no longer in local history, and `git diff` against it exits
#    non-zero — which, negated, would read as "lockfile changed" and reinstall
#    on every run.
if [[ -n "$BUILT_SHA" ]] && git rev-parse --verify --quiet "${BUILT_SHA}^{commit}" >/dev/null; then
  if ! git diff --quiet "$BUILT_SHA" HEAD -- package-lock.json; then
    echo
    echo "package-lock.json changed since the last build — installing dependencies..."
    npm ci || {
      echo "ERROR: npm ci failed — dependencies are now in an unknown state" >&2
      exit 3
    }
  fi
fi

# 3. Rebuild. build:swap compiles into dist.next and renames it in, so a peer
#    session invoking `devx` mid-rebuild never loads a half-emitted tree
#    (scripts/swap-dist.mjs). It takes a lock and exits 0 doing nothing if a
#    concurrent swap holds it — which the post-check below catches.
if $BUILD_STALE || $LINK_WRONG; then
  echo
  echo "Rebuilding dist/ (atomic swap)..."
  npm run build:swap || {
    echo "ERROR: build failed — dist/ is left at the previous build" >&2
    exit 3
  }
fi

# 4. Re-link the global bin only when it is missing or points elsewhere.
if $LINK_WRONG; then
  echo
  echo "Linking ${BIN_NAME} → ${WANT_LINK}..."
  npm i -g . || {
    echo "ERROR: npm i -g . failed — ${BIN_NAME} on PATH is unchanged" >&2
    exit 3
  }
fi

# --- verify ----------------------------------------------------------------
NEW_SHA="$(installed_sha)"
NEW_LINK="$(linked_target)"
HEAD_SHA="$(git rev-parse HEAD)"

echo
echo "  built dist/:    ${NEW_SHA:-<none>}"
echo "  ${BIN_NAME} on PATH:  ${NEW_LINK:-<not installed>}"

if sha_matches "$NEW_SHA" "$HEAD_SHA" && [[ "$NEW_LINK" == "$WANT_LINK" ]]; then
  echo "✅ devx updated to ${HEAD_SHA:0:7}."
  echo "   Skill bodies (.claude/commands/) are read at session start — start a"
  echo "   fresh Claude Code session to pick up changed ones."
  exit 0
fi

echo "ℹ️  Update ran but devx is still not level with HEAD."
echo "   (A concurrent build:swap may have held the lock, or main advanced"
echo "    during the run — re-run to confirm.)"
exit 1

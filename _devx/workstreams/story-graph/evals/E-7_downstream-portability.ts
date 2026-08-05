// E-7 (P1): ships in the package for downstream repos (G-2, CAP-5, FR-6).
// RED until Phase 7 closes (the command itself is Phase 3; this proves the
// PACKAGED artifact in a downstream-shaped repo). Runnable standalone:
// `npx tsx <this file>`.
//
// Pack-and-run harness (T7.1): builds dist when missing (same stale-dist
// policy as _fixture.runBuiltCli — a stale-but-present dist is the
// operator's to refresh), runs `npm pack`, extracts the tarball, and runs
// the extracted CLI in a downstream-shaped fixture laid out like
// friend-finder-mesh / palateful including their audited drift, with an
// fs-audit preload (NODE_OPTIONS --require) recording every path the
// process opens. Asserts GRAPH.md lands at the fixture root and that no
// recorded read touches devx-repo state (the only reads allowed outside
// the fixture + extracted package are the repo's node_modules — the
// tarball ships no deps, so the harness symlinks the repo's node_modules
// into the extracted package for offline resolution; node internals don't
// route through fs).
// Permanent suite: none (this eval IS the Phase 7 verification).

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { mkFx, nodeBin, repoRoot, row, runBuiltCli } from "./_fixture.js";

// The repo's dep tree, resolved the way Node actually finds it — in a git
// worktree, <repoRoot>/node_modules does not exist (deps walk up to the
// main checkout), so a join(repoRoot, "node_modules") symlink would dangle.
// Resolve a runtime dep's entry and walk up to its node_modules segment
// (commander doesn't export ./package.json, so resolve the bare specifier).
const nodeModulesDir = (() => {
  let d = dirname(createRequire(import.meta.url).resolve("commander"));
  while (basename(d) !== "node_modules" && dirname(d) !== d) d = dirname(d);
  return d;
})();

const failures: string[] = [];
const fx = mkFx({ prefix: "e7-downstream" });
const workDir = mkdtempSync(join(tmpdir(), "e7-pack-"));
const auditLog = join(workDir, "paths.log");
const preload = join(workDir, "fs-audit.cjs");

try {
  // Downstream-shaped state incl. audited drift (hyphen key, prose-only
  // edge, heading variants) — the shapes the packaged CLI must tolerate.
  // dwn000 ←(prose-only row edge)− dwn111 ←(hyphen-key frontmatter)− dwn222
  // is deliberately acyclic: a cycle is refused by design, not tolerated
  // drift.
  fx.writeSpec({ type: "dev", hash: "dwn000", slug: "down-zero", title: "Down zero", status: "done" });
  fx.writeSpec({ type: "dev", hash: "dwn111", slug: "down-one", title: "Down one", status: "ready" });
  fx.writeSpec({ type: "dev", hash: "dwn222", slug: "down-two", title: "Down two", status: "in-progress", fm: ["blocked-by: [dwn111]"] });
  fx.write("_devx/workstreams/down-flow/plan.md", "# Plan — down-flow\n");
  fx.write("DEV.md", [
    "# DEV",
    "",
    "### down-flow (workstream wsd001)",
    "",
    row("x", "dev", "dwn000", "down-zero", "Down zero", "done"),
    row(" ", "dev", "dwn111", "down-one", "Down one", "ready", ["Blocked-by: dwn000."]),
    row("/", "dev", "dwn222", "down-two", "Down two", "in-progress"),
    "",
  ].join("\n"));
  fx.commitAll("fixture: downstream repo");

  // Build (when dist is missing) + pack + extract — the packaged CLI, not
  // the repo's dist, is what runs in the fixture. runBuiltCli's --version
  // probe doubles as the build-when-missing step so pack never tars an
  // absent dist.
  const probe = runBuiltCli(["--version"], repoRoot);
  if (probe.status !== 0) {
    throw new Error(`built CLI --version probe failed: ${probe.stderr || probe.stdout}`);
  }
  const packOut = execFileSync("npm", ["pack", "--pack-destination", workDir], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 300_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const tarball = packOut.trim().split("\n").at(-1)?.trim() ?? "";
  if (tarball === "" || !existsSync(join(workDir, tarball))) {
    throw new Error(`npm pack produced no tarball (stdout: ${packOut.slice(0, 200)})`);
  }
  execFileSync("tar", ["-xzf", join(workDir, tarball), "-C", workDir], {
    encoding: "utf8",
    timeout: 120_000,
  });
  const pkgDir = join(workDir, "package");
  const packedCli = join(pkgDir, "dist", "cli.js");
  if (!existsSync(packedCli)) {
    failures.push("npm pack tarball does not carry dist/cli.js — package `files:` list is broken for downstream installs");
  }
  // The tarball ships no node_modules; a real install resolves deps from
  // the registry, which this eval must not depend on. Symlink the repo's
  // node_modules for offline resolution — dep reads realpath into
  // <repo>/node_modules, which the audit allows below.
  symlinkSync(nodeModulesDir, join(pkgDir, "node_modules"), "dir");

  writeFileSync(preload, [
    'const fs = require("fs");',
    `const log = ${JSON.stringify(auditLog)};`,
    "const append = fs.appendFileSync.bind(fs);",
    "function record(p) {",
    '  try { if (typeof p === "string") append(log, p + "\\n"); } catch {}',
    "}",
    'for (const name of ["readFileSync", "readdirSync", "statSync", "lstatSync", "openSync", "existsSync", "realpathSync"]) {',
    "  const fn = fs[name];",
    "  fs[name] = function (p, ...rest) { record(p); return fn.call(this, p, ...rest); };",
    "}",
    "",
  ].join("\n"));
  writeFileSync(auditLog, "");

  let res = { status: -1, stdout: "", stderr: "" };
  if (failures.length === 0) {
    try {
      const stdout = execFileSync(nodeBin, [packedCli, "graph"], {
        cwd: fx.root,
        encoding: "utf8",
        timeout: 120_000,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, NODE_OPTIONS: `--require ${preload}` },
      });
      res = { status: 0, stdout, stderr: "" };
    } catch (err) {
      const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
      res = { status: e.status ?? -1, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? "") };
    }
    if (res.status !== 0) {
      failures.push(
        `packaged CLI \`devx graph\` exited ${res.status} in the downstream fixture — the packaged CLI does not carry the graph surface yet (Phase 3 code, Phase 7 verification): ${(res.stderr || res.stdout).slice(0, 200)}`,
      );
    } else {
      if (!fx.exists("GRAPH.md")) {
        failures.push("packaged CLI exited 0 but GRAPH.md was not written at the downstream fixture root");
      }
      // 0 reads of devx-repo state: any recorded path under the devx repo
      // that is not the symlinked dep tree (node_modules) is a portability
      // leak — e.g. the config-walk finding the devx repo's own
      // devx.config.yaml or backlogs. The packaged CLI runs from pkgDir,
      // so even repo dist/package.json reads would be leaks here. Guard
      // BOTH repoRoot and the checkout that owns node_modules — from a git
      // worktree they differ, and a baked-in absolute path would point at
      // the main checkout, invisible to a worktree-only guard.
      const nmReal = realpathSync(nodeModulesDir);
      const guardRoots = [...new Set([realpathSync(repoRoot), dirname(nmReal)])];
      const leaks = new Set<string>();
      for (const line of readFileSync(auditLog, "utf8").split("\n")) {
        if (line === "" || !line.startsWith("/")) continue;
        let real = line;
        try {
          real = realpathSync(line);
        } catch {
          continue; // exists-probe on a missing path — not a read
        }
        if (!guardRoots.some((r) => real === r || real.startsWith(r + "/"))) continue;
        if (real === nmReal || real.startsWith(nmReal + "/")) continue;
        leaks.add(real);
      }
      if (leaks.size > 0) {
        failures.push(
          `packaged CLI read ${leaks.size} devx-repo state path(s) from a downstream cwd: ${[...leaks].slice(0, 5).join(", ")}`,
        );
      }
    }
  }
} finally {
  rmSync(fx.root, { recursive: true, force: true });
  rmSync(workDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error("E-7 RED — the packaged CLI does not serve downstream repos yet:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-7 GREEN — packaged CLI (npm pack tarball) writes GRAPH.md at the downstream root with zero devx-repo state reads.");

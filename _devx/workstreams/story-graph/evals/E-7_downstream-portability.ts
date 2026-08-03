// E-7 (P1): ships in the package for downstream repos (G-2, CAP-5, FR-6).
// RED until Phase 7 closes (the command itself is Phase 3; this proves the
// BUILT artifact in a downstream-shaped repo). Runnable standalone:
// `npx tsx <this file>`.
//
// Runs the built CLI (dist/cli.js — _fixture.runBuiltCli builds when
// missing) in a downstream-shaped fixture laid out like friend-finder-mesh
// / palateful including their audited drift, with an fs-audit preload
// (NODE_OPTIONS --require) recording every path the process opens.
// Asserts GRAPH.md lands at the fixture root and that no recorded read
// touches devx-repo state (the only reads allowed outside the fixture are
// package code: dist/, node_modules/, package.json — node internals don't
// route through fs). Phase 7's T7.1 may extend this harness to the
// npm-pack tarball; the fixture + audit assertions are the durable part.
// Permanent suite: none (this eval IS the Phase 7 verification).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import { mkFx, repoRoot, row, runBuiltCli } from "./_fixture.js";

const failures: string[] = [];
const fx = mkFx({ prefix: "e7-downstream" });
const auditDir = mkdtempSync(join(tmpdir(), "e7-audit-"));
const auditLog = join(auditDir, "paths.log");
const preload = join(auditDir, "fs-audit.cjs");

try {
  // Downstream-shaped state incl. audited drift (hyphen key, prose-only
  // edge, heading variants) — the shapes the packaged CLI must tolerate.
  fx.writeSpec({ type: "dev", hash: "dwn111", slug: "down-one", title: "Down one", status: "ready" });
  fx.writeSpec({ type: "dev", hash: "dwn222", slug: "down-two", title: "Down two", status: "in-progress", fm: ["blocked-by: [dwn111]"] });
  fx.write("_devx/workstreams/down-flow/plan.md", "# Plan — down-flow\n");
  fx.write("DEV.md", [
    "# DEV",
    "",
    "### down-flow (workstream wsd001)",
    "",
    row(" ", "dev", "dwn111", "down-one", "Down one", "ready", ["Blocked-by: dwn222."]),
    row("/", "dev", "dwn222", "down-two", "Down two", "in-progress"),
    "",
  ].join("\n"));
  fx.commitAll("fixture: downstream repo");

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

  const res = runBuiltCli(["graph"], fx.root, {
    NODE_OPTIONS: `--require ${preload}`,
  });
  if (res.status !== 0) {
    failures.push(
      `built CLI \`devx graph\` exited ${res.status} in the downstream fixture — the packaged CLI does not carry the graph surface yet (Phase 3 code, Phase 7 verification): ${(res.stderr || res.stdout).slice(0, 200)}`,
    );
  } else {
    if (!fx.exists("GRAPH.md")) {
      failures.push("packaged CLI exited 0 but GRAPH.md was not written at the downstream fixture root");
    }
    // 0 reads of devx-repo state: any recorded path under repoRoot that is
    // not package code (dist/, node_modules/, package.json) is a
    // portability leak — e.g. the config-walk finding the devx repo's own
    // devx.config.yaml or backlogs.
    const repoReal = realpathSync(repoRoot);
    const allowed = ["dist", "node_modules", "package.json"].map((s) => join(repoReal, s));
    const leaks = new Set<string>();
    for (const line of readFileSync(auditLog, "utf8").split("\n")) {
      if (line === "" || !line.startsWith("/")) continue;
      let real = line;
      try {
        real = realpathSync(line);
      } catch {
        continue; // exists-probe on a missing path — not a read
      }
      if (!real.startsWith(repoReal + "/") && real !== repoReal) continue;
      if (allowed.some((a) => real === a || real.startsWith(a + "/"))) continue;
      leaks.add(real);
    }
    if (leaks.size > 0) {
      failures.push(
        `packaged CLI read ${leaks.size} devx-repo state path(s) from a downstream cwd: ${[...leaks].slice(0, 5).join(", ")}`,
      );
    }
  }
} finally {
  rmSync(fx.root, { recursive: true, force: true });
  rmSync(auditDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error("E-7 RED — the packaged CLI does not serve downstream repos yet:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-7 GREEN — packaged CLI writes GRAPH.md at the downstream root with zero devx-repo state reads.");

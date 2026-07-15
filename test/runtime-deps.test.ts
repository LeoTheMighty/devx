// debug-b365ac — every bare-specifier import reachable at runtime must be a
// production dependency.
//
// `npm i -g <tarball>` installs `dependencies` only, so a devDependency
// imported from shipped code crashes every invocation on a clean machine
// (yaml in config-io did exactly this: ERR_MODULE_NOT_FOUND before commander
// even parsed argv). Dev-repo runs never catch it because devDependencies are
// present locally. This pins runtime imports ⊆ dependencies by scanning the
// built dist/ output plus the shipped postinstall scripts. Skipped when dist
// hasn't been built — `npm test` runs the build before vitest, so CI always
// exercises it.
//
// Spec: debug/debug-b365ac-2026-07-15T12:14-yaml-devdep-breaks-tarball-install.md

import { builtinModules } from "node:module";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(repoRoot, "dist");

// Files shipped in the npm package (package.json `files`) that execute at
// install or run time. skills/ and _devx/templates are data, not code.
const SHIPPED_SCRIPT_FILES = [
  "scripts/postinstall.js",
  "scripts/postinstall-lib.mjs",
];

const BUILTINS = new Set(builtinModules);

function listJsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFiles(full));
    else if (/\.(m?js|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

// Bare package name from an import specifier, or null for relative/absolute/
// builtin/URL specifiers. "@scope/pkg/sub" → "@scope/pkg"; "pkg/sub" → "pkg".
function packageNameOf(spec: string): string | null {
  if (spec.startsWith(".") || spec.startsWith("/") || spec.includes(":")) return null;
  const parts = spec.split("/");
  const name = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
  return BUILTINS.has(name) ? null : name;
}

// Static import/export-from and dynamic import()/require() of string-literal
// specifiers. Dynamic imports of computed values (e.g. migration-file URLs)
// have no literal to check and are out of scope. The specifier must be
// whitespace-free so quoted prose that happens to contain "from" (e.g. error
// messages in code) doesn't match.
const SPECIFIER_RE =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s*)["']([^"'\s]+)["']/gm;

function runtimeImports(files: string[]): Map<string, string[]> {
  const byPackage = new Map<string, string[]>();
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(SPECIFIER_RE)) {
      const name = packageNameOf(match[1]!);
      if (!name) continue;
      const sites = byPackage.get(name) ?? [];
      sites.push(file.slice(repoRoot.length + 1));
      byPackage.set(name, sites);
    }
  }
  return byPackage;
}

describe("debug-b365ac — runtime imports ⊆ dependencies", () => {
  it.skipIf(!existsSync(distDir))(
    "every bare import in dist/ and shipped scripts is a production dependency",
    () => {
      const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
      };
      const dependencies = new Set(Object.keys(pkg.dependencies ?? {}));

      const shipped = SHIPPED_SCRIPT_FILES.map((f) => resolve(repoRoot, f)).filter(existsSync);
      const imports = runtimeImports([...listJsFiles(distDir), ...shipped]);

      const missing = [...imports.entries()]
        .filter(([name]) => !dependencies.has(name))
        .map(([name, sites]) => `${name} (imported from ${[...new Set(sites)].join(", ")})`);

      expect(missing, `runtime imports not in dependencies:\n  ${missing.join("\n  ")}`).toEqual([]);
    },
  );

  it("the scan itself sees the known runtime packages (guards against a silent no-op)", () => {
    // If the regex or walker breaks, `missing` would be empty and the gate
    // above would pass vacuously. Pin that the scan finds commander + yaml.
    if (!existsSync(distDir)) return;
    const imports = runtimeImports(listJsFiles(distDir));
    expect([...imports.keys()]).toEqual(expect.arrayContaining(["commander", "yaml"]));
  });
});

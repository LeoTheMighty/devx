// Version surface with git-SHA build provenance (pin104).
//
// `resolveVersion()` is the single string every version consumer renders:
// `devx --version` (src/cli.ts), the skills header (`installSkills`
// version param via src/commands/init.ts), and init's `devx_version`
// config stamp (init-questions buildConfig). Shape:
//
//   dist/build-info.json present → `<semver>+<sha>`  (e.g. 0.1.0+9f7cdef)
//   absent                       → `<semver>`        (dev runs, tarballs)
//
// No codegen in src/: the semver comes from package.json at call time and
// the sha from the build-embedded dist/build-info.json (scripts/
// build-info.mjs). Both are resolved module-relative so the same code
// works from src/lib (tsx, vitest) and dist/lib (built CLI).
//
// Spec: dev/dev-pin104-2026-07-14T12:03-install-global-sha-docs.md

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface ResolveVersionOpts {
  /** Override the package root (tests point at a fixture dir containing
   *  package.json and optionally dist/build-info.json). */
  pkgRoot?: string;
}

function defaultPkgRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/lib/version.ts → ../../ ; dist/lib/version.js → ../../
  return join(here, "..", "..");
}

/** Resolve `<semver>` or `<semver>+<sha>`. Throws if package.json is
 *  missing/invalid — a broken install should fail loud, not report a
 *  made-up version. A malformed build-info.json is treated as absent
 *  (provenance is best-effort; the semver is not). */
export function resolveVersion(opts: ResolveVersionOpts = {}): string {
  const pkgRoot = opts.pkgRoot ?? defaultPkgRoot();

  const pkgPath = join(pkgRoot, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown };
  if (typeof pkg.version !== "string" || pkg.version.length === 0) {
    throw new Error(`package.json at ${pkgPath} has no string "version" field`);
  }

  const infoPath = join(pkgRoot, "dist", "build-info.json");
  if (!existsSync(infoPath)) return pkg.version;
  try {
    const info = JSON.parse(readFileSync(infoPath, "utf8")) as { sha?: unknown };
    if (typeof info.sha === "string" && /^[0-9a-f]{7,}$/.test(info.sha)) {
      return `${pkg.version}+${info.sha}`;
    }
  } catch {
    // fall through — malformed provenance never breaks the version surface
  }
  return pkg.version;
}

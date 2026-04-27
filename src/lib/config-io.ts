// Comment-preserving YAML I/O for devx.config.yaml (project) and the user-level
// override at ~/.devx/config.yaml (or platform equivalent).
//
// Built on eemeli/yaml's `parseDocument` mode — the only Node YAML lib that
// preserves comments + key order + anchors/aliases through a write. Phase 0
// supports leaf-scalar writes only; sub-tree writes throw with a Phase 1
// pointer per the cfg202 spec.
//
// Spec: dev/dev-cfg202-2026-04-26T19:35-config-yaml-roundtrip-lib.md
// Epic: _bmad-output/planning-artifacts/epic-config-schema.md

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir, platform } from "node:os";
import { Document, isScalar, parseDocument } from "yaml";

export type LeafValue = string | number | boolean;
export type Target = "project" | "user";

export interface LoadOpts {
  /** Override the resolved file path. Used by tests and by callers that
   *  already know where the file lives. */
  path?: string;
}

export interface SetLeafOpts {
  projectPath?: string;
  userPath?: string;
}

const PROJECT_FILENAME = "devx.config.yaml";
const LEAF_ONLY_MSG =
  "Phase 0 supports leaf scalar writes only — see Phase 1";

/** Walk up from `start` looking for devx.config.yaml. Returns absolute path or null. */
export function findProjectConfig(start: string = process.cwd()): string | null {
  let dir = resolve(start);
  for (;;) {
    const candidate = join(dir, PROJECT_FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Cross-platform user-config path per spec ACs:
 *   Linux / WSL: $XDG_CONFIG_HOME/devx/config.yaml → ~/.config/devx/config.yaml
 *   macOS:       ~/.devx/config.yaml
 *   Windows:     %APPDATA%/devx/config.yaml → ~/.devx/config.yaml fallback
 */
export function userConfigPath(): string {
  const home = homedir();
  const plat = platform();
  if (plat === "darwin") {
    return join(home, ".devx", "config.yaml");
  }
  if (plat === "win32") {
    const appdata = process.env.APPDATA;
    if (appdata) return join(appdata, "devx", "config.yaml");
    return join(home, ".devx", "config.yaml");
  }
  // linux (incl. WSL — Linux platform value, no need to detect)
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return join(xdg, "devx", "config.yaml");
  return join(home, ".config", "devx", "config.yaml");
}

/** Parse the project devx.config.yaml as a comment-preserving Document. */
export function loadProject(opts: LoadOpts = {}): Document {
  const path = opts.path ?? findProjectConfig();
  if (!path) {
    throw new Error(
      `devx.config.yaml not found in ${process.cwd()} or any parent directory`,
    );
  }
  if (!existsSync(path)) {
    throw new Error(`devx.config.yaml not found at ${path}`);
  }
  return parseDocument(readFileSync(path, "utf8"));
}

/** Parse the user-level config if present; null if the file does not exist. */
export function loadUser(opts: LoadOpts = {}): Document | null {
  const path = opts.path ?? userConfigPath();
  if (!existsSync(path)) return null;
  return parseDocument(readFileSync(path, "utf8"));
}

/** Project overrides user; arrays are replaced (not concatenated). */
function deepMerge(user: unknown, project: unknown): unknown {
  if (project === undefined) return user;
  if (user === undefined) return project;
  if (Array.isArray(project) || Array.isArray(user)) return project;
  if (typeof project !== "object" || project === null) return project;
  if (typeof user !== "object" || user === null) return project;
  const out: Record<string, unknown> = { ...(user as Record<string, unknown>) };
  const p = project as Record<string, unknown>;
  for (const k of Object.keys(p)) {
    out[k] = deepMerge((user as Record<string, unknown>)[k], p[k]);
  }
  return out;
}

/** Load both files, return a deep-merged plain JS object (project wins). */
export function loadMerged(opts: SetLeafOpts = {}): unknown {
  const projectDoc = loadProject({ path: opts.projectPath });
  const userDoc = loadUser({ path: opts.userPath });
  const projectJs = projectDoc.toJS();
  const userJs = userDoc ? userDoc.toJS() : {};
  return deepMerge(userJs, projectJs);
}

/** Atomic write: tmp + rename. Creates parent dirs as needed. */
function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  try {
    writeFileSync(tmp, content, "utf8");
    renameSync(tmp, path);
  } catch (err) {
    // Best-effort cleanup of the tmp file on any failure (write or rename).
    if (existsSync(tmp)) {
      try {
        unlinkSync(tmp);
      } catch {
        /* swallow — original error is what the caller cares about */
      }
    }
    throw err;
  }
}

function isLeafValue(value: unknown): value is LeafValue {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/**
 * Write a leaf scalar at `path` in the target file. Comments, key order, and
 * anchors/aliases are preserved.
 *
 * Implementation note: when the path already points at a Scalar node, we
 * mutate its `.value` in place rather than going through `doc.setIn(path,
 * value)`. setIn replaces the Scalar with a freshly-constructed one, which
 * loses any inline comment attached to the original — and the spec's diff
 * regression test is precisely about not losing those comments. We fall back
 * to `setIn` for paths that don't exist yet (creating the leaf).
 */
export function setLeaf(
  path: string[],
  value: LeafValue,
  target: Target,
  opts: SetLeafOpts = {},
): void {
  if (path.length === 0) {
    throw new Error(LEAF_ONLY_MSG);
  }
  if (!isLeafValue(value)) {
    throw new Error(LEAF_ONLY_MSG);
  }

  let filePath: string;
  let doc: Document;

  if (target === "project") {
    const resolved = opts.projectPath ?? findProjectConfig();
    if (!resolved) {
      throw new Error(
        `devx.config.yaml not found in ${process.cwd()} or any parent directory`,
      );
    }
    filePath = resolved;
    doc = parseDocument(readFileSync(filePath, "utf8"));
  } else {
    filePath = opts.userPath ?? userConfigPath();
    doc = existsSync(filePath)
      ? parseDocument(readFileSync(filePath, "utf8"))
      : parseDocument("");
  }

  const existing = doc.getIn(path, true);

  if (existing === undefined || existing === null) {
    // Path doesn't resolve to a node — let setIn create the leaf (and any
    // intermediate maps along the way).
    doc.setIn(path, value);
  } else if (isScalar(existing)) {
    // In-place mutation preserves the scalar's attached comment, source range,
    // and quote/representation style (e.g., a double-quoted string stays
    // double-quoted, a literal block stays literal). doc.setIn would replace
    // the whole Scalar node and lose all of that.
    existing.value = value;
  } else {
    // Existing node is a Map, Seq, Alias, or other collection — refuse.
    throw new Error(LEAF_ONLY_MSG);
  }

  atomicWrite(filePath, doc.toString());
}

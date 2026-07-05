// Shared CLI-driver context for the engine commands (v2e101): locate
// devx.config.yaml (walk-up, same as merge-gate/plan-helper), load the
// merged config, and narrow the engine knobs. One helper so the four
// command files (workstream, gate, revise, next) can't drift on the
// resolution order.
//
// Spec: dev/dev-v2e101-2026-07-05T13:01-engine-cli-primitives.md

import { dirname } from "node:path";

import { findProjectConfig, loadMerged } from "../config-io.js";
import { type EngineConfig, engineConfigFrom } from "./config.js";

export interface EngineContext {
  repoRoot: string;
  /** Full merged config blob (projects: runners live here). */
  merged: unknown;
  engine: EngineConfig;
}

export type EngineContextResult =
  | { ok: true; ctx: EngineContext }
  | { ok: false; error: string };

export function loadEngineContext(projectPath?: string): EngineContextResult {
  const configPath = projectPath ?? findProjectConfig();
  if (!configPath) {
    return {
      ok: false,
      error: "devx.config.yaml not found (walked up from cwd)",
    };
  }
  let merged: unknown;
  try {
    merged = loadMerged({ projectPath: configPath });
  } catch (e) {
    return {
      ok: false,
      error: `config load failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  return {
    ok: true,
    ctx: {
      repoRoot: dirname(configPath),
      merged,
      engine: engineConfigFrom(merged),
    },
  };
}

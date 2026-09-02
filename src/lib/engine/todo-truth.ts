// todo.md IO seam + ground-truth builder (hfi103, workstream
// harness-fold-in Phase 3).
//
// The pure module (todo.ts) transforms text; this sibling owns the two
// things every consumer (devx todo sync, devx next both forms, devx
// status) needs from disk: the parsed todo.md (absent → null, FR-1
// grandfathering — absence reads as silence everywhere) and the
// TodoGroundTruth phase-pointer map (dev-hash → linked dev spec `status:
// done`; design §Assumptions — done ⇒ verified because merge happens
// after the /devx verification tail).
//
// NEVER imported by gate code — test/gate-todo-isolation.test.ts (E-2)
// keeps gate modules todo-free.
//
// Spec: dev/dev-hfi103-2026-07-24T10:41-todo-sync-renderers-status.md
// Design: _devx/workstreams/harness-fold-in/design/agent.md §Interfaces


import { type EngineState, readEngineState } from "./frontmatter.js";
import { type ResolvedBase, TODO_REL, todoAbs } from "./artifacts.js";
import {
  type TodoDoc,
  type TodoGroundTruth,
  type TodoItem,
  parseTodo,
} from "./todo.js";
import { findSpecForHashInFs } from "./workstream.js";

/** Read-only fs shape — both EngineFs and NextFs qualify structurally. */
export interface TodoReadFs {
  readFile(path: string): string;
  exists(path: string): boolean;
  readdir(path: string): string[];
}

export const TODO_FILENAME = TODO_REL;

/**
 * Read + parse the doc set's todo.md. Null when the file is absent
 * (grandfathered workstream — every renderer omits its lines). A present
 * but unreadable file throws; callers map that to a warning/exit per
 * their own contract.
 *
 * Takes the resolved base rather than a bare `workstreamAbs` (dlr104): the
 * hand-join it replaced put todo.md under a directory that does not exist in
 * a flat repo, so `devx next`'s focus line and every drift row read as
 * silence there.
 */
export function loadTodoDoc(
  fs: TodoReadFs,
  base: ResolvedBase,
): { content: string; doc: TodoDoc } | null {
  const abs = todoAbs(base);
  if (!fs.exists(abs)) return null;
  const content = fs.readFile(abs);
  return { content, doc: parseTodo(content) };
}

/**
 * dev-hash → linked dev spec has `status: done`, for every phase pointer
 * in the doc. Unresolvable / unreadable / status-less specs read false —
 * the conservative direction (an unverifiable phase never renders done).
 */
export function phaseDoneFor(
  fs: TodoReadFs,
  repoRoot: string,
  doc: TodoDoc,
): Record<string, boolean> {
  const phaseDone: Record<string, boolean> = {};
  const visit = (items: TodoItem[]): void => {
    for (const item of items) {
      if (item.kind === "phase" && item.pointer !== null) {
        phaseDone[item.pointer] = devSpecDone(fs, repoRoot, item.pointer);
      }
      visit(item.children);
    }
  };
  visit(doc.items);
  return phaseDone;
}

function devSpecDone(fs: TodoReadFs, repoRoot: string, hash: string): boolean {
  // The whole probe is inside the try — findSpecForHashInFs readdirs dev/,
  // and an unreadable dir (permissions, exists→readdir race) must read
  // "not done", not throw out of an advisory-only computation.
  try {
    const specAbs = findSpecForHashInFs(fs, repoRoot, "dev", hash);
    if (specAbs === null) return false;
    const status = readEngineState(fs.readFile(specAbs)).status;
    return status?.toLowerCase() === "done";
  } catch {
    return false;
  }
}

/** Assemble the full TodoGroundTruth for one workstream's doc. */
export function todoGroundTruth(
  fs: TodoReadFs,
  repoRoot: string,
  state: EngineState,
  doc: TodoDoc,
): TodoGroundTruth {
  return { state, phaseDone: phaseDoneFor(fs, repoRoot, doc) };
}

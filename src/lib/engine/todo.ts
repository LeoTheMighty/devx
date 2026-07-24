// Pure todo.md engine module (hfi101, workstream harness-fold-in Phase 1).
//
// Owns the parse contract for the per-workstream `todo.md` working-memory
// file, the frontmatter-rooted focus walk (FR-5), drift computation (FR-4),
// and derived-line truing (the `devx todo sync` core). Pure by contract:
// no I/O — callers read/write the file; this module only transforms text.
//
// The parse contract (design §"todo.md parse contract"):
//   - Top-level derived lines (column 0) match the fixed vocabulary
//     `/^- \[( |x)\] (Stage|Gate|Phase \d+): .+$/`. Gate labels are the
//     fixed set `prd | coverage(design) | coverage(plan) | evals`.
//   - Phase pointer lines nest one level under `Stage: Execute`, shape
//     `  - [ ] Phase <n>: <title> → <dev-hash>` — a pointer, never a copy.
//   - Anything nested deeper is opaque free text `{checked, depth, text}` —
//     parsed generically, never validated, never trued.
//   - todo.md is NEVER a gate input (FR-3) — no gate module may import this
//     file; pinned by test/gate-todo-isolation.test.ts (E-2).
//
// Spec: dev/dev-hfi101-2026-07-24T10:41-todo-core.md
// Design: _devx/workstreams/harness-fold-in/design.md §Interfaces

import {
  type EngineState,
  type GateFlag,
  type Stage,
  stageIndex,
} from "./frontmatter.js";
import { isOutcomeVerdict } from "./outcome.js";

// ---------------------------------------------------------------------------
// Types (design §Interfaces)
// ---------------------------------------------------------------------------

export interface TodoItem {
  kind: "stage" | "gate" | "phase" | "free";
  /** "Design" | "coverage(design)" | "3" (phase number) | free text. */
  label: string;
  checked: boolean;
  /** 0 = top-level derived; free items are ≥1 (2 spaces per level). */
  depth: number;
  /** 1-indexed, for drift reports. */
  line: number;
  /** dev-hash on phase pointer lines (`… → <dev-hash>`). */
  pointer: string | null;
  children: TodoItem[];
  /** Raw text after the checkbox marker — what the focus walk renders. */
  text: string;
}

export interface TodoDoc {
  /** Top-level (depth-0) forest; nesting lives in `children`. */
  items: TodoItem[];
  /** 1-indexed lines of top-level checkboxes violating the derived
   *  vocabulary — a fresh scaffold has none. */
  unparsedTopLevel: number[];
}

export interface TodoGroundTruth {
  /** Spec frontmatter (the only stage/gate/outcome truth). */
  state: EngineState;
  /** dev-hash → linked dev spec has `status: done`. */
  phaseDone: Record<string, boolean>;
}

export type TodoDriftClass = "gate-flag" | "phase-pointer";

export interface TodoDrift {
  class: TodoDriftClass;
  /** 1-indexed line of the contradicting checkbox. */
  line: number;
  message: string;
}

// ---------------------------------------------------------------------------
// Vocabulary maps
// ---------------------------------------------------------------------------

/** The full derived-line contract regex — exported so suites pin the exact
 *  vocabulary rather than restating it. */
export const DERIVED_LINE_RE = /^- \[( |x)\] (Stage|Gate|Phase \d+): .+$/;

/** Gate label (todo vocabulary) → gate_status flag. */
export const GATE_LABEL_TO_FLAG: Readonly<Record<string, GateFlag>> = {
  prd: "prd_validated",
  "coverage(design)": "design_verified",
  "coverage(plan)": "plan_verified",
  evals: "evals_red",
};

/** Stage label (todo vocabulary) → engine stage whose ordinal gates the
 *  checkbox. Retro/Outcome are absent — they key off `status: done` and a
 *  scored `outcome.status` respectively, not the stage ordinal. */
const STAGE_LABEL_TO_STAGE: Readonly<Record<string, Stage>> = {
  PRD: "prd",
  Design: "design",
  Plan: "plan",
  RED: "red",
  Execute: "executing",
};

/** Engine stage → the skeleton section the focus walk roots at. `retired`
 *  maps to null: an abandoned workstream has no next action. */
const STAGE_TO_SECTION: Readonly<Record<Stage, string | null>> = {
  intake: "PRD",
  prd: "PRD",
  design: "Design",
  plan: "Plan",
  red: "RED",
  executing: "Execute",
  done: "Retro",
  retired: null,
};

const CHECKBOX_RE = /^( *)- \[( |x)\] (.*)$/;
const POINTER_RE = /\s+→\s+(\S+)\s*$/;

// ---------------------------------------------------------------------------
// parseTodo
// ---------------------------------------------------------------------------

/**
 * Parse todo.md content into a depth-nested forest. Lenient by contract:
 * never throws; non-checkbox lines (the header comment, blanks, prose) are
 * skipped; a top-level checkbox outside the derived vocabulary is kept as a
 * free item AND reported in `unparsedTopLevel`.
 */
export function parseTodo(content: string): TodoDoc {
  const items: TodoItem[] = [];
  const unparsedTopLevel: number[] = [];
  const stack: TodoItem[] = []; // ancestors, strictly increasing depth

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = CHECKBOX_RE.exec(lines[i].replace(/\r$/, ""));
    if (!m) continue;
    const depth = Math.floor(m[1].length / 2);
    const checked = m[2] === "x";
    const text = m[3];
    const line = i + 1;

    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }
    const parent = stack.length > 0 ? stack[stack.length - 1] : null;

    const item = classify(text, { checked, depth, line, parent });
    if (depth === 0 && item.kind === "free") unparsedTopLevel.push(line);

    if (parent) parent.children.push(item);
    else items.push(item);
    stack.push(item);
  }

  return { items, unparsedTopLevel };
}

function classify(
  text: string,
  ctx: {
    checked: boolean;
    depth: number;
    line: number;
    parent: TodoItem | null;
  },
): TodoItem {
  const base = {
    checked: ctx.checked,
    depth: ctx.depth,
    line: ctx.line,
    pointer: null as string | null,
    children: [] as TodoItem[],
    text,
  };
  const stage = /^Stage: (.+)$/.exec(text);
  const gate = /^Gate: (.+)$/.exec(text);
  const phase = /^Phase (\d+): .+$/.exec(text);

  if (ctx.depth === 0) {
    if (stage) return { kind: "stage", label: stage[1], ...base };
    if (gate) return { kind: "gate", label: gate[1], ...base };
    if (phase) {
      return { kind: "phase", label: phase[1], ...base, pointer: pointerOf(text) };
    }
    return { kind: "free", label: text, ...base };
  }
  // Nested: only the phase-pointer shape directly under a Stage parent is
  // derived; everything else is opaque free text — never validated.
  if (phase && ctx.parent?.kind === "stage") {
    return { kind: "phase", label: phase[1], ...base, pointer: pointerOf(text) };
  }
  return { kind: "free", label: text, ...base };
}

function pointerOf(text: string): string | null {
  const m = POINTER_RE.exec(text);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// currentFocus (FR-5)
// ---------------------------------------------------------------------------

/**
 * The focus walk: root at the frontmatter-derived current stage — NEVER at
 * checkbox state (E-5's stale-checkbox mitigation) — then DFS into the
 * first unchecked child until a node has no unchecked children. Section
 * fully checked or empty → the section parent's own text. Section missing
 * from the doc (hand-deleted) or stage `retired` → null.
 */
export function currentFocus(doc: TodoDoc, stage: Stage): string | null {
  const sectionLabel = STAGE_TO_SECTION[stage] ?? null;
  if (sectionLabel === null) return null;
  const section = doc.items.find(
    (i) => i.kind === "stage" && i.label === sectionLabel,
  );
  if (!section) return null;

  let node = section;
  for (;;) {
    const next = node.children.find((c) => !c.checked);
    if (!next) break;
    node = next;
  }
  return node.text;
}

// ---------------------------------------------------------------------------
// computeTodoDrift (FR-4)
// ---------------------------------------------------------------------------

/**
 * Both contradiction classes, either direction, with 1-indexed lines:
 * (a) gate-flag — a `Gate: <g>` checkbox vs its `gate_status` flag;
 * (b) phase-pointer — a phase pointer checkbox vs the linked dev spec's
 * done-state. Advisory only: pure computation, no verdict, no mutation.
 */
export function computeTodoDrift(
  doc: TodoDoc,
  truth: TodoGroundTruth,
): TodoDrift[] {
  const drift: TodoDrift[] = [];
  walk(doc.items, (item) => {
    if (item.kind === "gate") {
      const flag = GATE_LABEL_TO_FLAG[item.label];
      if (flag === undefined) return; // unknown label — never validated
      const actual = truth.state.gateStatus?.[flag] === true;
      if (item.checked !== actual) {
        drift.push({
          class: "gate-flag",
          line: item.line,
          message:
            `todo line ${item.line}: 'Gate: ${item.label}' is ` +
            `${item.checked ? "checked" : "unchecked"} but gate_status.` +
            `${flag} is ${actual}`,
        });
      }
    } else if (item.kind === "phase" && item.pointer !== null) {
      const done = truth.phaseDone?.[item.pointer] === true;
      if (item.checked !== done) {
        drift.push({
          class: "phase-pointer",
          line: item.line,
          message:
            `todo line ${item.line}: 'Phase ${item.label}' (→ ${item.pointer}) ` +
            `is ${item.checked ? "checked" : "unchecked"} but the linked dev ` +
            `spec is ${done ? "done" : "not done"}`,
        });
      }
    }
  });
  return drift;
}

function walk(items: TodoItem[], visit: (item: TodoItem) => void): void {
  for (const item of items) {
    visit(item);
    walk(item.children, visit);
  }
}

// ---------------------------------------------------------------------------
// trueDerivedLines (the `devx todo sync` core)
// ---------------------------------------------------------------------------

/**
 * True derived lines only; free items (and every non-checkbox byte) are
 * preserved exactly. Derived truth (design §"Derived-truth mapping"):
 *   - `Gate: <g>` checked ⟺ its gate_status flag is true;
 *   - `Stage: <s>` checked ⟺ the frontmatter stage ordinal is past it
 *     (Retro ⟺ spec `status: done`; Outcome ⟺ `outcome.status` scored);
 *   - phase pointer checked ⟺ the linked dev spec is done.
 * Returns the new content plus a human-readable list of lines trued.
 */
export function trueDerivedLines(
  content: string,
  truth: TodoGroundTruth,
): { content: string; trued: string[] } {
  const doc = parseTodo(content);
  const desired = new Map<number, { checked: boolean; describe: string }>();
  walk(doc.items, (item) => {
    const want = desiredChecked(item, truth);
    if (want !== null && want !== item.checked) {
      const describe =
        item.kind === "phase" ? `Phase ${item.label}` : item.text;
      desired.set(item.line, { checked: want, describe });
    }
  });

  if (desired.size === 0) return { content, trued: [] };

  const trued: string[] = [];
  const lines = content.split("\n");
  for (const [line, { checked, describe }] of [...desired.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    lines[line - 1] = lines[line - 1].replace(
      /\[( |x)\]/,
      checked ? "[x]" : "[ ]",
    );
    trued.push(`${describe} → ${checked ? "checked" : "unchecked"}`);
  }
  return { content: lines.join("\n"), trued };
}

/** Desired checkbox state for a derived item; null = not derivable (free
 *  items, unknown labels, phase lines without a pointer) — leave untouched. */
function desiredChecked(
  item: TodoItem,
  truth: TodoGroundTruth,
): boolean | null {
  if (item.kind === "gate") {
    const flag = GATE_LABEL_TO_FLAG[item.label];
    if (flag === undefined) return null;
    return truth.state.gateStatus?.[flag] === true;
  }
  if (item.kind === "phase") {
    if (item.pointer === null) return null;
    return truth.phaseDone?.[item.pointer] === true;
  }
  if (item.kind === "stage") {
    if (item.label === "Retro") return truth.state.status === "done";
    if (item.label === "Outcome") {
      return isOutcomeVerdict(truth.state.outcome?.status ?? null);
    }
    const gatedBy = STAGE_LABEL_TO_STAGE[item.label];
    if (gatedBy === undefined) return null;
    const current = truth.state.stage;
    if (current === null) return false;
    return stageIndex(current) > stageIndex(gatedBy);
  }
  return null; // free — byte-preserved
}

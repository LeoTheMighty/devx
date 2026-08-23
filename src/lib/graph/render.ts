// Story-graph renderer (sgr103 / plan Phase 3, T3.1).
//
// `renderStoryGraph(model)` turns the Phase-2 read model into the whole
// GRAPH.md document: banner → legend → ONE fenced ```mermaid flowchart →
// sorted Warnings section.
//
// The contract this module exists to hold is BYTE-STABILITY: the same model
// renders the same bytes, forever. `devx graph --check` (T3.3) is a raw
// byte-compare against the committed file, and the regen hooks (Phases 4–5)
// fire on every claim — a renderer that leaks a timestamp or an insertion-
// ordered Map into its output turns every one of those into a spurious diff.
// So: nothing here reads the clock, the environment, or the filesystem, and
// every collection is explicitly sorted before it is emitted (groups by
// kind-rank then id, nodes by hash within a group, edges by from/to/kind,
// warnings by the model's own key).
//
// Mermaid dialect notes (design § Renderer — unresolved Q1 settled here):
//   - GitHub renders `flowchart TD` with `subgraph`/`classDef`/`class`.
//   - Node ids ARE the spec hashes — already `[a-z0-9]{3,12}`, so they need
//     no sanitization and the rendered source stays greppable by hash.
//   - Three visually distinct edge classes: `-->` blocking (solid arrow),
//     `-.->` lineage (dotted arrow), `--- |par|` parallel-safe (undirected
//     open link carrying a `par` label). The parallel form is deliberately
//     BOTH arrowless and labeled, so the class stays distinguishable even if
//     one of those two signals is later restyled.
//
// Spec: dev/dev-sgr103-2026-08-02T13:57-graph-render-cli.md
// Design: _devx/workstreams/story-graph/design/agent.md §Architecture 3, §Data

import {
  type EdgeKind,
  type GraphEdge,
  type GraphGroup,
  type GraphModel,
  type GraphNode,
  type GroupKind,
  STANDALONE_GROUP,
} from "./model.js";

/** Regen command named by the banner, the legend, and `--check`'s drift
 *  message. One constant so the three can never disagree about what the
 *  reader is supposed to type. */
export const REGEN_COMMAND = "devx graph";

/** Max rendered title length inside a node label. Long enough for a real
 *  spec title, short enough that a wide board still lays out. */
export const TITLE_MAX = 42;

/** Group render order — mirrors the model's own kind ranking so document
 *  order and `model.groups` order agree. Re-declared rather than shared:
 *  the model's copy is an internal sort key, this one is a rendering
 *  decision that may diverge later. */
const GROUP_KIND_RANK: Record<GroupKind, number> = {
  workstream: 0,
  epic: 1,
  standalone: 2,
};

/** Mermaid class per effective status. A status this map doesn't know falls
 *  back to `unknownStatus` — a new SpecStatus must never render an
 *  undefined class name into the document. */
const STATUS_CLASS: Record<string, string> = {
  ready: "ready",
  "in-progress": "wip",
  blocked: "blocked",
  done: "done",
  deleted: "dropped",
  superseded: "dropped",
};

/**
 * Status palettes, in THREE-digit hex only.
 *
 * This is not a style preference: a spec hash is `[a-z0-9]{3,12}`, so a
 * six-digit color like `#ffffff` is itself hash-shaped. Every hash-grep over
 * GRAPH.md — the eval's phantom check, a human's `grep <hash> GRAPH.md`, any
 * future consumer — would match the palette and report a spec that does not
 * exist. Three-digit hex cannot collide (a bare `#eef` is not a `{6}` token)
 * and renders identically. Keep it that way.
 */
const CLASS_DEFS: ReadonlyArray<string> = [
  "classDef ready fill:#eef,stroke:#39f,color:#036",
  "classDef wip fill:#fe9,stroke:#e90,color:#740",
  "classDef blocked fill:#fee,stroke:#e44,color:#811",
  "classDef done fill:#efe,stroke:#2c5,color:#152",
  "classDef dropped fill:#eee,stroke:#aaa,color:#444",
  "classDef unknownStatus fill:#fff,stroke:#777,color:#222",
  "classDef collapsed fill:#eee,stroke:#777,color:#222",
];

const EDGE_KIND_RANK: Record<EdgeKind, number> = {
  blocks: 0,
  lineage: 1,
  parallel: 2,
};

/**
 * Escape a title for a Mermaid quoted label and truncate it.
 *
 * Every character here is neutralized because it can terminate or reinterpret
 * the enclosing `id["…"]` construct:
 *   - `"` closes the quoted label;
 *   - `]` closes the node bracket — one spec titled `Fix the [x] checkbox`
 *     would corrupt the ENTIRE diagram, not just its own node, because
 *     Mermaid fails the whole block on a parse error;
 *   - `#` opens an entity escape;
 *   - `<`/`>` are dropped since Mermaid renders labels as HTML.
 * Newlines collapse to spaces — the edge and node assertions (and every human
 * reading the source) rely on one element per line.
 *
 * Truncation is applied to the ESCAPED text so the emitted width is bounded
 * regardless of how a substitution expanded it; an unbounded label is what
 * pushes a wide board past GitHub's Mermaid size ceiling.
 */
export function escapeLabel(raw: string, max: number = TITLE_MAX): string {
  const flat = raw
    .replace(/[\r\n]+/g, " ")
    .replace(/"/g, "'")
    .replace(/#/g, "＃")
    .replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (flat.length <= max) return flat;
  // Reserve one char for the ellipsis so the result is at most `max` wide.
  return `${flat.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function statusClass(status: string): string {
  return STATUS_CLASS[status] ?? "unknownStatus";
}

/**
 * Node label: `<hash> <short-title>`, plus badge markers when the node is
 * gated on a human (FR-2g). A titleless node degrades to its bare hash —
 * never to `"<hash> "` with a trailing space, which would show up as a
 * one-byte diff the first time a title lands.
 */
export function nodeLabel(node: GraphNode): string {
  const title = escapeLabel(node.title);
  const head = title === "" ? node.hash : `${node.hash} ${title}`;
  if (node.badges.length === 0) return head;
  // PARENTHESES, not brackets: `id["… [MANUAL M1]"]` puts a `]` inside the
  // node bracket, the one character that can break the whole block. No spec
  // carries a badge on today's board, so the live render would not have
  // caught it — the first INTERVIEW-gated spec would have.
  const badges = node.badges.map((b) => escapeLabel(b, 24)).join(", ");
  return `${head} (${badges})`;
}

/** Summary label for a collapsed (all-settled) group. */
function collapsedLabel(group: GraphGroup): string {
  const { done, total, lastMerged } = group.stats;
  const tail = lastMerged === null ? "" : `, last merged ${lastMerged}`;
  return escapeLabel(`${group.title} — ${done}/${total} done${tail}`, 64);
}

/** Human-facing subgraph title. `standalone` gets a spelled-out label — the
 *  mechanical `"standalone (standalone)"` reads like a bug. */
function groupTitle(group: GraphGroup): string {
  if (group.kind === "standalone" && group.id === STANDALONE_GROUP) {
    return escapeLabel("standalone — no workstream or epic", 64);
  }
  return escapeLabel(`${group.title} (${group.kind})`, 64);
}

/** Mermaid-safe slug for a group id (group ids are free-form slugs, unlike
 *  spec hashes). Non-alphanumerics collapse to `_`. */
function slugify(groupId: string): string {
  const s = groupId.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return s === "" ? "x" : s;
}

/**
 * Assign each group a unique Mermaid id base.
 *
 * Slugification is lossy — `a-b` and `a.b` both slugify to `a_b` — and two
 * groups sharing an id would emit duplicate node/subgraph ids, silently
 * merging two unrelated parts of the board. Collisions get a numeric suffix
 * in sorted-group order, which keeps the assignment deterministic.
 */
function assignGroupIds(
  groups: readonly GraphGroup[],
): { ids: Map<string, string>; used: Set<string> } {
  const ids = new Map<string, string>();
  const used = new Set<string>();
  const claim = (base: string): string => {
    let id = base;
    let n = 2;
    while (used.has(id)) id = `${base}_${n++}`;
    used.add(id);
    return id;
  };
  for (const group of groups) ids.set(group.id, claim(slugify(group.id)));
  return { ids, used };
}

/** Claim an id not already taken by a group (the orphan bucket's subgraph). */
function claimSpare(used: Set<string>, base: string): string {
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}_${n++}`;
  used.add(id);
  return id;
}

function sortGroups(groups: readonly GraphGroup[]): GraphGroup[] {
  return [...groups].sort(
    (a, b) =>
      GROUP_KIND_RANK[a.kind] - GROUP_KIND_RANK[b.kind] ||
      a.id.localeCompare(b.id),
  );
}

function sortEdges(edges: readonly GraphEdge[]): GraphEdge[] {
  return [...edges].sort(
    (a, b) =>
      a.from.localeCompare(b.from) ||
      a.to.localeCompare(b.to) ||
      EDGE_KIND_RANK[a.kind] - EDGE_KIND_RANK[b.kind],
  );
}

/** One edge line. `from`/`to` are already-resolved Mermaid node ids (a
 *  member hash, or a collapsed group's summary id). */
function edgeLine(from: string, to: string, kind: EdgeKind): string {
  switch (kind) {
    case "blocks":
      // The model's `from` is the BLOCKED spec, so the arrow points at its
      // prerequisite: `A --> B` reads "A is blocked by B".
      return `  ${from} --> ${to}`;
    case "lineage":
      return `  ${from} -.-> ${to}`;
    case "parallel":
      return `  ${from} --- |par| ${to}`;
  }
}

const BANNER: ReadonlyArray<string> = [
  "<!-- GENERATED FILE — do not hand-edit.",
  `     Regenerate with \`${REGEN_COMMAND}\`; \`${REGEN_COMMAND} --check\` fails on drift.`,
  "     Source of truth is the backlog rows + spec frontmatter this renders. -->",
];

const LEGEND: ReadonlyArray<string> = [
  "## Legend",
  "",
  "| Glyph | Meaning |",
  "|---|---|",
  "| `A --> B` | A is **blocked by** B — B must land first |",
  "| `A -.-> B` | **lineage** — A spawned, or was superseded by, B |",
  "| `A --- \\|par\\| B` | **parallel-safe** — A and B may run at once |",
  "| subgraph | one workstream or epic; a fully-settled one collapses to a summary node |",
  "| node fill | `ready` blue · `in-progress` amber · `blocked` red · `done` green · `deleted`/`superseded` grey |",
  "| `(INTERVIEW Q＃n)` / `(MANUAL Mx)` | the item is gated on a human decision or action |",
];

/**
 * Render the full GRAPH.md document. Pure and deterministic: the same model
 * always produces the same bytes.
 */
export function renderStoryGraph(model: GraphModel): string {
  const groups = sortGroups(model.groups);
  const { ids: groupIds, used: usedIds } = assignGroupIds(groups);

  const nodesByGroup = new Map<string, GraphNode[]>();
  for (const node of model.nodes) {
    const id = node.group ?? STANDALONE_GROUP;
    const list = nodesByGroup.get(id);
    if (list) list.push(node);
    else nodesByGroup.set(id, [node]);
  }
  for (const list of nodesByGroup.values()) {
    list.sort((a, b) => a.hash.localeCompare(b.hash));
  }

  // A collapsed group renders ONE summary node; its members render nothing,
  // and every edge touching a member is redirected onto that summary node.
  const collapsedOf = new Map<string, string>(); // member hash → summary id
  for (const group of groups) {
    if (!group.collapsed) continue;
    const summary = `grp_${groupIds.get(group.id) ?? slugify(group.id)}`;
    for (const node of nodesByGroup.get(group.id) ?? []) {
      collapsedOf.set(node.hash, summary);
    }
  }
  const resolveId = (hash: string): string => collapsedOf.get(hash) ?? hash;

  // ── mermaid body ───────────────────────────────────────────────────────
  const mermaid: string[] = ["flowchart TD"];
  const classAssignments: string[] = [];
  const rendered = new Set<string>();
  /** Mermaid ids actually DECLARED as nodes above — the edge guard's domain. */
  const declared = new Set<string>();

  const emitGroup = (group: GraphGroup, members: GraphNode[]): void => {
    // An empty group would emit `subgraph … end` with nothing between it —
    // a Mermaid parse hazard and visual noise.
    if (members.length === 0) return;
    const gid = groupIds.get(group.id) ?? slugify(group.id);
    mermaid.push(`  subgraph sg_${gid}["${groupTitle(group)}"]`);
    if (group.collapsed) {
      const id = `grp_${gid}`;
      mermaid.push(`    ${id}["${collapsedLabel(group)}"]`);
      classAssignments.push(`  class ${id} collapsed`);
      declared.add(id);
    } else {
      for (const node of members) {
        mermaid.push(`    ${node.hash}["${nodeLabel(node)}"]`);
        classAssignments.push(
          `  class ${node.hash} ${statusClass(node.status)}`,
        );
        declared.add(node.hash);
      }
    }
    mermaid.push("  end");
    for (const node of members) rendered.add(node.hash);
  };

  for (const group of groups) {
    emitGroup(group, nodesByGroup.get(group.id) ?? []);
  }

  // Safety net: a node whose `group` names no entry in `model.groups` would
  // otherwise vanish from the board silently. Bucket the orphans into one
  // synthetic group rather than dropping them — a visible oddity beats a
  // missing spec.
  const orphans = model.nodes
    .filter((n) => !rendered.has(n.hash))
    .sort((a, b) => a.hash.localeCompare(b.hash));
  if (orphans.length > 0) {
    // The bucket's own id goes through the same uniquifier as the groups —
    // a real group whose slug IS `ungrouped` would otherwise collide with it.
    const gid = claimSpare(usedIds, "ungrouped");
    mermaid.push(`  subgraph sg_${gid}["ungrouped — group id not in model"]`);
    for (const node of orphans) {
      mermaid.push(`    ${node.hash}["${nodeLabel(node)}"]`);
      classAssignments.push(`  class ${node.hash} ${statusClass(node.status)}`);
      declared.add(node.hash);
    }
    mermaid.push("  end");
  }

  // Edges come after every subgraph so Mermaid attributes each node to its
  // declaring subgraph rather than to whichever subgraph first mentioned it
  // in an edge.
  const seenEdgeLines = new Set<string>();
  for (const edge of sortEdges(model.edges)) {
    const from = resolveId(edge.from);
    const to = resolveId(edge.to);
    // Both endpoints collapsed into the SAME summary node: the edge is
    // internal to settled history and would render as a self-loop.
    if (from === to) continue;
    // Phantom guard. Mermaid MINTS a bare node for any id it meets in an
    // edge but never saw declared — which is precisely the phantom class
    // this workstream exists to kill, arriving through the back door. The
    // model validates its own edges, so this should never fire today; it is
    // here for Phase 6's `derived` edges and for any future caller that
    // hands us a hand-built model.
    if (!declared.has(from) || !declared.has(to)) continue;
    const line = edgeLine(from, to, edge.kind);
    // Two distinct member edges can collapse onto the same summary-node
    // pair; emit that link once.
    if (seenEdgeLines.has(line)) continue;
    seenEdgeLines.add(line);
    mermaid.push(line);
  }

  mermaid.push(...CLASS_DEFS.map((d) => `  ${d}`));
  mermaid.push(...classAssignments);

  // ── warnings ───────────────────────────────────────────────────────────
  // The model already sorts these; re-sorting on the same key is a cheap
  // guarantee that a caller handing us an unsorted array still renders
  // stably.
  const warnings = [...model.warnings].sort(
    (a, b) =>
      a.code.localeCompare(b.code) ||
      (a.hash ?? "").localeCompare(b.hash ?? "") ||
      (a.source ?? "").localeCompare(b.source ?? "") ||
      a.message.localeCompare(b.message),
  );
  const warningLines: string[] = ["## Warnings", ""];
  if (warnings.length === 0) {
    warningLines.push("None — every edge resolved and every heading linked.");
  } else {
    warningLines.push(
      `${warnings.length} warning${warnings.length === 1 ? "" : "s"} — reported, never auto-fixed.`,
      "",
    );
    for (const w of warnings) {
      warningLines.push(`- \`${w.code}\` — ${w.message}`);
    }
  }

  // ── document ───────────────────────────────────────────────────────────
  return [
    ...BANNER,
    "",
    "# Story graph",
    "",
    countTotals(model),
    "",
    ...LEGEND,
    "",
    "## Board",
    "",
    "```mermaid",
    ...mermaid,
    "```",
    "",
    ...warningLines,
    "",
  ].join("\n");
}

/** One-line state summary under the title. Counts only — no timestamps. */
function countTotals(model: GraphModel): string {
  const byStatus = new Map<string, number>();
  for (const n of model.nodes) {
    byStatus.set(n.status, (byStatus.get(n.status) ?? 0) + 1);
  }
  const parts = [...byStatus.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([status, n]) => `${n} ${status}`);
  const nodes = model.nodes.length;
  const groups = model.groups.length;
  const edges = model.edges.length;
  return (
    `${nodes} spec${nodes === 1 ? "" : "s"} across ` +
    `${groups} group${groups === 1 ? "" : "s"}` +
    `${parts.length > 0 ? ` — ${parts.join(" · ")}` : ""}; ` +
    `${edges} edge${edges === 1 ? "" : "s"}.`
  );
}

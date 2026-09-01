// Unit tests for the split primitive (mss101, workstream mid-story-split
// phase 1). The `"E-1:"` describe marker is load-bearing: the RED eval
// wrapper `_devx/workstreams/mid-story-split/evals/E-1_split-roundtrip.ts`
// asserts this case group exists and passes — do not rename it.
//
// E-1 threshold (plan.md phase 1 Verification plan): ≥6 cases green —
// merge-first round-trip via the shared backlog parser (blocked-by wiring),
// branch-handoff round-trip (branch recorded, parent row struck +
// `status: superseded`), injected rename failure leaves DEV.md
// byte-identical (0 changed bytes), ownership-mismatch refusal exits 3,
// all carried-forward section headings present.
//
// Spec: dev/dev-mss101-2026-07-28T13:43-split-primitive-lib-cli.md

import { describe, expect, it, vi } from "vitest";

import type { ClaimFs, Exec, ExecResult } from "../src/lib/devx/claim.js";
import { claimSpec } from "../src/lib/devx/claim.js";
import { parseSpecClaimFields } from "../src/lib/devx/verify-claim.js";
import { type RegenFn, regenerateGraph } from "../src/lib/graph/regen.js";
import { decideRepoNext } from "../src/lib/next/decide.js";
import { gatherRepoSnapshot } from "../src/lib/next/gather.js";
import {
  type SplitPayload,
  SplitError,
  SplitOwnershipError,
  composeSplit,
  parseFrontmatterBranch,
  performSplit,
  validateSplitPayload,
  writeSplitAtomically,
} from "../src/lib/devx/split.js";
import { runSplit } from "../src/commands/split.js";
import { parseDevMd } from "../src/lib/backlog/parse.js";
import { generateHash } from "../src/lib/engine/workstream.js";
import { insertDevMdRow } from "../src/lib/plan/emit-retro-story.js";

// ---------------------------------------------------------------------------
// Fixtures — in-memory fake repo (same posture as devx-claim.test.ts's
// fake-fs layer; identity backlog lock since /repo has no real .devx-cache).
// ---------------------------------------------------------------------------

const REPO = "/repo";
const PARENT_PATH = "dev/dev-abc123-2026-07-01T10:00-parent-item.md";
const PARENT_ABS = `${REPO}/${PARENT_PATH}`;
const LOCK_PATH = `${REPO}/.devx-cache/locks/spec-abc123.lock`;
const DEV_MD_ABS = `${REPO}/DEV.md`;

const PARENT_SPEC = `---
hash: abc123
type: dev
created: 2026-07-01T10:00:00-06:00
title: "Parent item"
status: in-progress
from: plan/plan-e0a67e-2026-07-28T12:15-mid-story-split.md
blocked_by: []
branch: feat/dev-abc123
owner: /devx-sess-1
---

## Goal

Do the parent thing.

## Acceptance criteria

- [ ] AC 1: first half (done in this session).
- [ ] AC 2: second half (remaining).

## Status log

- 2026-07-01T10:00 — emitted by /devx-plan.
- 2026-07-01T11:00 — claimed by /devx in session /devx-sess-1
`;

const DEV_MD = `# DEV — backlog

### Epic X

- [/] \`dev/dev-abc123-2026-07-01T10:00-parent-item.md\` — Parent item. Status: in-progress. From: epic-x.
- [ ] \`dev/dev-def456-2026-07-01T10:00-other-item.md\` — Other item. Status: ready. Blocked-by: abc123.
`;

const LOCK_BODY = `${JSON.stringify({
  schema: 1,
  pid: 12345,
  pid_started_at: null,
  session: "sess-1",
  claimed_at: "2026-07-01T11:00:00-06:00",
})}\n`;

const PAYLOAD: SplitPayload = {
  title: "Parent item — remaining work",
  remaining_acs: ["AC 2: second half (remaining)."],
  carried_forward: {
    state_to_trust: ["First half is merged and green."],
    gotchas: ["The fixture path only exists in the main worktree."],
    do_not: ["Do not re-run the migration."],
  },
  learnings: ["vitest run needs the tsx runner here."],
};

const FIXED_NOW = new Date(2026, 6, 28, 14, 0, 0);

function makeFiles(): Map<string, string> {
  return new Map([
    [DEV_MD_ABS, DEV_MD],
    [PARENT_ABS, PARENT_SPEC],
    [LOCK_PATH, LOCK_BODY],
  ]);
}

function makeFakeFs(files: Map<string, string>): ClaimFs {
  return {
    openExclusive: (p, c) => {
      if (files.has(p)) {
        const e = new Error(`EEXIST: ${p}`) as NodeJS.ErrnoException;
        e.code = "EEXIST";
        throw e;
      }
      files.set(p, c);
    },
    readFile: (p) => {
      const v = files.get(p);
      if (v === undefined) {
        const e = new Error(`ENOENT: no such file '${p}'`) as NodeJS.ErrnoException;
        e.code = "ENOENT";
        throw e;
      }
      return v;
    },
    writeFile: (p, c) => {
      files.set(p, c);
    },
    rename: (a, b) => {
      const v = files.get(a);
      if (v === undefined) {
        throw new Error(`ENOENT: rename source '${a}'`);
      }
      files.set(b, v);
      files.delete(a);
    },
    exists: (p) => {
      if (files.has(p)) return true;
      for (const k of files.keys()) {
        if (k.startsWith(`${p}/`)) return true;
      }
      return false;
    },
    mkdirRecursive: () => {},
    unlink: (p) => {
      files.delete(p);
    },
    readdir: (p) => {
      const names = new Set<string>();
      for (const k of files.keys()) {
        if (k.startsWith(`${p}/`)) {
          names.add(k.slice(p.length + 1).split("/")[0]);
        }
      }
      return [...names];
    },
  };
}

interface SplitRun {
  files: Map<string, string>;
  fs: ClaimFs;
}

function splitOpts(run: SplitRun, extra: Record<string, unknown> = {}) {
  return {
    sessionToken: "sess-1",
    repoRoot: REPO,
    config: {},
    payload: PAYLOAD,
    fs: run.fs,
    now: () => FIXED_NOW,
    lock: <T>(_label: string, fn: () => T): T => fn(),
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// E-1 case group — marker "E-1:" pinned by the eval wrapper.
// ---------------------------------------------------------------------------

describe("E-1: split primitive round-trip (mss101)", () => {
  it("merge-first round-trip: follow-up row wired Blocked-by parent, spliced directly after the parent row", () => {
    const files = makeFiles();
    const fs = makeFakeFs(files);
    const result = performSplit("abc123", splitOpts({ files, fs }));

    expect(result.shape).toBe("merge-first");
    expect(result.followUpHash).toMatch(/^[0-9a-f]{6}$/);
    expect(result.followUpSpecPath).toBe(
      `dev/dev-${result.followUpHash}-2026-07-28T14:00-parent-item-remaining-work.md`,
    );

    // Backlog round-trip through the shared parser (blocked-by wiring).
    const rows = parseDevMd(files.get(DEV_MD_ABS)!);
    const parentRow = rows.find((r) => r.hash === "abc123");
    const followUpRow = rows.find((r) => r.hash === result.followUpHash);
    expect(parentRow).toBeDefined();
    expect(followUpRow).toBeDefined();
    expect(followUpRow!.status).toBe("ready");
    expect(followUpRow!.blocked_by).toEqual(["abc123"]);
    expect(followUpRow!.struck).toBe(false);
    // Parent stays in-progress (it lands via the normal merge tail).
    expect(parentRow!.status).toBe("in-progress");
    expect(parentRow!.struck).toBe(false);
    // Spliced directly after the parent row, before def456.
    expect(followUpRow!.lineIndex).toBe(parentRow!.lineIndex + 1);

    // Follow-up spec: blocked_by + own fresh branch + lineage.
    const followUp = files.get(`${REPO}/${result.followUpSpecPath}`)!;
    expect(followUp).toContain(`hash: ${result.followUpHash}`);
    expect(followUp).toContain("status: ready");
    expect(followUp).toContain("blocked_by: [abc123]");
    expect(followUp).toContain(`branch: feat/dev-${result.followUpHash}`);
    expect(followUp).toContain(`from: ${PARENT_PATH}`);
    expect(followUp).toContain("- [ ] AC 2: second half (remaining).");

    // Parent patched: spawned append + append-only status-log line; owner
    // and status untouched on merge-first.
    const parent = files.get(PARENT_ABS)!;
    expect(parent).toContain(`spawned: [${result.followUpHash}]`);
    expect(parent).toContain("status: in-progress");
    expect(parent).toContain("owner: /devx-sess-1");
    expect(parent).toContain(
      `split (merge-first): emitted follow-up ${result.followUpHash}`,
    );
    // Prior status-log lines untouched (append-only).
    expect(parent).toContain("claimed by /devx in session /devx-sess-1");
  });

  it("branch-handoff round-trip: branch inherited, parent row struck + status superseded", () => {
    const files = makeFiles();
    const fs = makeFakeFs(files);
    const result = performSplit(
      "abc123",
      splitOpts({ files, fs }, { shape: "branch-handoff" }),
    );

    expect(result.shape).toBe("branch-handoff");

    // Follow-up inherits the parent's WIP branch, starts ready, unblocked.
    const followUp = files.get(`${REPO}/${result.followUpSpecPath}`)!;
    expect(followUp).toContain("branch: feat/dev-abc123");
    expect(followUp).toContain("blocked_by: []");
    expect(followUp).toContain("status: ready");

    // Parent terminal: superseded vocabulary (zero parser changes).
    const parent = files.get(PARENT_ABS)!;
    expect(parent).toContain("status: superseded");
    expect(parent).toContain(`superseded_by: ${result.followUpHash}`);
    expect(parent).toContain("owner: null");
    expect(parent).not.toContain("owner: /devx-sess-1");

    // Backlog: parent row struck + superseded; follow-up row ready with no
    // Blocked-by (parent never merges).
    const rows = parseDevMd(files.get(DEV_MD_ABS)!);
    const parentRow = rows.find((r) => r.hash === "abc123")!;
    const followUpRow = rows.find((r) => r.hash === result.followUpHash)!;
    expect(parentRow.struck).toBe(true);
    expect(parentRow.status).toBe("superseded");
    expect(parentRow.raw).toContain(`superseded by ${result.followUpHash}`);
    expect(followUpRow.status).toBe("ready");
    expect(followUpRow.blocked_by).toEqual([]);
    expect(followUpRow.lineIndex).toBe(parentRow.lineIndex + 1);
  });

  it("injected rename failure leaves DEV.md and the parent spec byte-identical, follow-up absent, zero tmp residue", () => {
    const files = makeFiles();
    const inner = makeFakeFs(files);
    // Fail the LAST rename in the fixed order (backlog) — the worst case:
    // follow-up + parent renames already landed and must be rolled back.
    const failingFs: ClaimFs = {
      ...inner,
      rename: (a, b) => {
        if (b === DEV_MD_ABS) {
          throw new Error("EIO: injected rename failure");
        }
        inner.rename(a, b);
      },
    };
    const devMdBefore = files.get(DEV_MD_ABS)!;
    const parentBefore = files.get(PARENT_ABS)!;

    expect(() =>
      performSplit("abc123", splitOpts({ files, fs: failingFs }, { fs: failingFs })),
    ).toThrow(SplitError);

    // 0 changed bytes on both pre-existing files.
    expect(files.get(DEV_MD_ABS)).toBe(devMdBefore);
    expect(files.get(PARENT_ABS)).toBe(parentBefore);
    // The half-created follow-up was restored to absence.
    const residue = [...files.keys()].filter(
      (k) => k.includes(".tmp.") || /dev\/dev-[0-9a-f]{6}-2026-07-28/.test(k),
    );
    expect(residue).toEqual([]);
    // Exactly the three original files remain.
    expect([...files.keys()].sort()).toEqual(
      [DEV_MD_ABS, PARENT_ABS, LOCK_PATH].sort(),
    );
  });

  it("ownership mismatch refuses: library throws SplitOwnershipError; CLI exits 3", () => {
    // Lock held by a different session.
    const files = makeFiles();
    files.set(
      LOCK_PATH,
      `${JSON.stringify({ schema: 1, pid: 999, pid_started_at: null, session: "sess-OTHER", claimed_at: "2026-07-01T11:00:00-06:00" })}\n`,
    );
    const fs = makeFakeFs(files);
    expect(() => performSplit("abc123", splitOpts({ files, fs }))).toThrow(
      SplitOwnershipError,
    );

    // Missing lock is also not-yours (claim it first).
    const files2 = makeFiles();
    files2.delete(LOCK_PATH);
    const fs2 = makeFakeFs(files2);
    expect(() => performSplit("abc123", splitOpts({ files: files2, fs: fs2 }))).toThrow(
      /no spec lock held/,
    );

    // CLI: exit 3 + owned-by-other-session JSON.
    const stdout: string[] = [];
    const code = runSplit(
      ["abc123", "--payload", "payload.json", "--session-token", "sess-1"],
      {
        out: (s) => stdout.push(s),
        err: () => {},
        repoRoot: REPO,
        config: {},
        readFile: (p) => {
          if (p === "payload.json") return JSON.stringify(PAYLOAD);
          return fs.readFile(p);
        },
        resolveSpec: () => ({ path: PARENT_ABS, type: "dev" }),
        splitOpts: { fs, lock: (_l, fn) => fn(), now: () => FIXED_NOW },
      },
    );
    expect(code).toBe(3);
    const parsed = JSON.parse(stdout.join("")) as {
      error: string;
      lockOwner: string;
      currentSession: string;
    };
    expect(parsed.error).toBe("owned-by-other-session");
    expect(parsed.lockOwner).toBe("sess-OTHER");
    expect(parsed.currentSession).toBe("sess-1");
  });

  it("carried-forward section headings are all present, with learnings folded under Gotchas", () => {
    const files = makeFiles();
    const fs = makeFakeFs(files);
    const result = performSplit("abc123", splitOpts({ files, fs }));
    const followUp = files.get(`${REPO}/${result.followUpSpecPath}`)!;

    expect(followUp).toContain("## Carried forward");
    expect(followUp).toContain("### State to trust");
    expect(followUp).toContain("### Gotchas (save time — don't rediscover)");
    expect(followUp).toContain("### Do NOT");
    expect(followUp).toContain("- First half is merged and green.");
    expect(followUp).toContain("- The fixture path only exists in the main worktree.");
    expect(followUp).toContain("- vitest run needs the tsx runner here.");
    expect(followUp).toContain("- Do not re-run the migration.");
    expect(followUp).toContain(
      `created by devx split from \`${PARENT_PATH}\` (merge-first)`,
    );
  });

  it("validateSplitPayload enforces the title/acs/carried-forward rules", () => {
    const base = JSON.parse(JSON.stringify(PAYLOAD)) as Record<string, unknown>;
    expect(validateSplitPayload(base)).toMatchObject({ title: PAYLOAD.title });

    expect(() => validateSplitPayload(null)).toThrow(/JSON object/);
    expect(() => validateSplitPayload({ ...base, title: "a; b" })).toThrow(/';'/);
    expect(() => validateSplitPayload({ ...base, title: "a\nb" })).toThrow(
      /single-line/,
    );
    expect(() => validateSplitPayload({ ...base, title: "  " })).toThrow(
      /non-empty/,
    );
    expect(() => validateSplitPayload({ ...base, remaining_acs: [] })).toThrow(
      /remaining_acs must be non-empty/,
    );
    expect(() =>
      validateSplitPayload({ ...base, remaining_acs: ["ok", ""] }),
    ).toThrow(/remaining_acs\[1\]/);
    expect(() =>
      validateSplitPayload({
        ...base,
        carried_forward: { state_to_trust: [], gotchas: [] },
      }),
    ).toThrow(/do_not/);
    expect(() => validateSplitPayload({ ...base, carried_forward: "x" })).toThrow(
      /carried_forward must be an object/,
    );
    // Review BH-1/EC-2: backlog-row marker collision — a title carrying
    // `Status:`/`Blocked-by:`/`Blocks:` would hijack parseDevMd's
    // first-match marker regexes on the composed row.
    expect(() =>
      validateSplitPayload({ ...base, title: "Harden Status: done reconciliation" }),
    ).toThrow(/marker collision/);
    expect(() =>
      validateSplitPayload({ ...base, title: "document Blocked-by: semantics" }),
    ).toThrow(/marker collision/);
    // Review BH-5: multi-line goal could inject a `## Status log` heading.
    expect(() =>
      validateSplitPayload({ ...base, goal: "ok\n## Status log\nnot ok" }),
    ).toThrow(/goal must be single-line/);
    // Empty carried-forward lists are legal (a loop split may have no
    // gotchas yet) — they render "(none)".
    const minimal = validateSplitPayload({
      title: "T",
      remaining_acs: ["one"],
      carried_forward: { state_to_trust: [], gotchas: [], do_not: [] },
    });
    expect(minimal.carried_forward.do_not).toEqual([]);
  });

  it("CLI: usage/refusal exit codes — 64 missing token, 2 unsplittable type, 2 unpushed branch-handoff, 0 happy path", () => {
    const files = makeFiles();
    const fs = makeFakeFs(files);
    const errs: string[] = [];
    const baseOpts = (stdout: string[]) => ({
      out: (s: string) => stdout.push(s),
      err: (s: string) => errs.push(s),
      repoRoot: REPO,
      config: {},
      readFile: (p: string) =>
        p === "payload.json" ? JSON.stringify(PAYLOAD) : fs.readFile(p),
      resolveSpec: () => ({ path: PARENT_ABS, type: "dev" }),
      splitOpts: {
        fs,
        lock: <T>(_l: string, fn: () => T): T => fn(),
        now: () => FIXED_NOW,
      },
    });

    // 64: --session-token missing (never auto-derived).
    expect(
      runSplit(["abc123", "--payload", "payload.json"], baseOpts([])),
    ).toBe(64);
    // 64: bad shape.
    expect(
      runSplit(
        ["abc123", "--payload", "payload.json", "--session-token", "s", "--shape", "sideways"],
        baseOpts([]),
      ),
    ).toBe(64);

    // 2: unsplittable type (plan specs are planning-stage artifacts).
    expect(
      runSplit(
        ["abc123", "--payload", "payload.json", "--session-token", "sess-1"],
        {
          ...baseOpts([]),
          resolveSpec: () => ({ path: "/repo/plan/plan-abc123-2026-07-01T10:00-x.md", type: "plan" }),
        },
      ),
    ).toBe(2);

    // 2: branch-handoff refused when the WIP branch isn't on origin.
    expect(
      runSplit(
        [
          "abc123",
          "--payload",
          "payload.json",
          "--session-token",
          "sess-1",
          "--shape",
          "branch-handoff",
        ],
        {
          ...baseOpts([]),
          exec: () => ({ stdout: "", stderr: "", exitCode: 0 }),
        },
      ),
    ).toBe(2);
    expect(errs.join("")).toContain("push the WIP branch");

    // 0: happy path (branch-handoff with the branch present on origin).
    const stdout: string[] = [];
    const code = runSplit(
      [
        "abc123",
        "--payload",
        "payload.json",
        "--session-token",
        "sess-1",
        "--shape",
        "branch-handoff",
      ],
      {
        ...baseOpts(stdout),
        exec: () => ({
          stdout: "deadbeef\trefs/heads/feat/dev-abc123\n",
          stderr: "",
          exitCode: 0,
        }),
      },
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.join("")) as { followUpHash: string; shape: string };
    expect(parsed.shape).toBe("branch-handoff");
    expect(parsed.followUpHash).toMatch(/^[0-9a-f]{6}$/);
  });

  it("generateHash is exported with the collision scan widened to all spec type dirs", () => {
    // A fake repo where dev/ (not plan/) is populated: the widened scan
    // must consult dev/ — the pre-mss101 plan/-only scan never did.
    const consulted: string[] = [];
    const files = makeFiles();
    const inner = makeFakeFs(files);
    const fs = {
      exists: (p: string) => {
        consulted.push(p);
        return inner.exists(p);
      },
      readdir: (p: string) => inner.readdir(p),
    };
    const hash = generateHash(fs, REPO);
    expect(hash).toMatch(/^[0-9a-f]{6}$/);
    expect(consulted).toContain(`${REPO}/dev`);
    expect(consulted).toContain(`${REPO}/debug`);
    expect(consulted).toContain(`${REPO}/plan`);
  });

  it("insertDevMdRow after-parent anchor splices directly below the parent row (type-parameterized)", () => {
    const debugMd = [
      "# DEBUG — no section headers here",
      "",
      "- [/] `debug/debug-aaa111-2026-07-01T10:00-crash.md` — Crash. Status: in-progress.",
      "- [ ] `debug/debug-bbb222-2026-07-01T10:00-flake.md` — Flake. Status: ready.",
    ].join("\n");
    const row =
      "- [ ] `debug/debug-ccc333-2026-07-28T14:00-crash-continued.md` — Crash continued. Status: ready. Blocked-by: aaa111.";
    const out = insertDevMdRow(debugMd, ["aaa111"], row, {
      type: "debug",
      anchor: "after-parent",
    });
    const lines = out.split("\n");
    expect(lines[3]).toBe(row);
    expect(lines[4]).toContain("bbb222");
    // Unknown parent still throws.
    expect(() =>
      insertDevMdRow(debugMd, ["zzz999"], row, { type: "debug", anchor: "after-parent" }),
    ).toThrow(/no backlog row found/);
  });

  it("composeSplit is pure and writeSplitAtomically refuses to overwrite an existing follow-up", () => {
    const composed = composeSplit({
      parent: { path: PARENT_PATH, content: PARENT_SPEC },
      backlog: DEV_MD,
      payload: PAYLOAD,
      shape: "merge-first",
      followUpHash: "fff000",
      now: FIXED_NOW,
      followUpBranch: "feat/dev-fff000",
    });
    expect(composed.followUpSpecPath).toBe(
      "dev/dev-fff000-2026-07-28T14:00-parent-item-remaining-work.md",
    );
    expect(composed.devMdRow).toContain("Blocked-by: abc123.");
    // Pure: inputs untouched (strings are immutable; assert the compose
    // did not depend on disk by running it twice identically).
    const again = composeSplit({
      parent: { path: PARENT_PATH, content: PARENT_SPEC },
      backlog: DEV_MD,
      payload: PAYLOAD,
      shape: "merge-first",
      followUpHash: "fff000",
      now: FIXED_NOW,
      followUpBranch: "feat/dev-fff000",
    });
    expect(again).toEqual(composed);

    const files = makeFiles();
    files.set(`${REPO}/${composed.followUpSpecPath}`, "already here");
    const fs = makeFakeFs(files);
    expect(() =>
      writeSplitAtomically(composed, {
        repoRoot: REPO,
        parentSpecAbs: PARENT_ABS,
        backlogAbs: DEV_MD_ABS,
        fs,
      }),
    ).toThrow(/refusing to overwrite/);

    // parseFrontmatterBranch reads the recorded WIP branch.
    expect(parseFrontmatterBranch(PARENT_SPEC)).toBe("feat/dev-abc123");
    expect(parseFrontmatterBranch("---\nhash: x\n---\nbody")).toBeNull();
  });

  it("review fixes: title backslash escaping, spawned block-list absorption, EOF status-log heading", () => {
    // BH-2/EC-1: a backslash in the title must not corrupt the YAML
    // double-quoted scalar (trailing `\` would escape the closing quote).
    const composed = composeSplit({
      parent: { path: PARENT_PATH, content: PARENT_SPEC },
      backlog: DEV_MD,
      payload: {
        ...PAYLOAD,
        title: "Fix the \\d probe regex ending in \\",
      },
      shape: "merge-first",
      followUpHash: "fff000",
      now: FIXED_NOW,
      followUpBranch: "feat/dev-fff000",
    });
    expect(composed.followUpBody).toContain(
      'title: "Fix the \\\\d probe regex ending in \\\\"',
    );

    // BH-6: block-list `spawned:` absorbed into the flow rewrite (no
    // orphaned `- item` lines under the rewritten key) and flow list with
    // a trailing comment preserved.
    const blockListParent = PARENT_SPEC.replace(
      "blocked_by: []",
      "spawned:\n  - aaa111\n  - bbb222\nblocked_by: []",
    );
    const c2 = composeSplit({
      parent: { path: PARENT_PATH, content: blockListParent },
      backlog: DEV_MD,
      payload: PAYLOAD,
      shape: "merge-first",
      followUpHash: "fff000",
      now: FIXED_NOW,
      followUpBranch: "feat/dev-fff000",
    });
    expect(c2.parentAfter).toContain("spawned: [aaa111, bbb222, fff000]");
    expect(c2.parentAfter).not.toMatch(/^\s+-\s+aaa111$/m);
    const commentParent = PARENT_SPEC.replace(
      "blocked_by: []",
      "spawned: [ccc333] # keep me\nblocked_by: []",
    );
    const c3 = composeSplit({
      parent: { path: PARENT_PATH, content: commentParent },
      backlog: DEV_MD,
      payload: PAYLOAD,
      shape: "merge-first",
      followUpHash: "fff000",
      now: FIXED_NOW,
      followUpBranch: "feat/dev-fff000",
    });
    expect(c3.parentAfter).toContain("spawned: [ccc333, fff000] # keep me");

    // EC-4: parent whose last line is `## Status log` with no trailing
    // newline gets the log line appended, not a duplicate section.
    const eofParent = `${PARENT_SPEC.slice(0, PARENT_SPEC.indexOf("## Status log"))}## Status log`;
    const c4 = composeSplit({
      parent: { path: PARENT_PATH, content: eofParent },
      backlog: DEV_MD,
      payload: PAYLOAD,
      shape: "merge-first",
      followUpHash: "fff000",
      now: FIXED_NOW,
      followUpBranch: "feat/dev-fff000",
    });
    expect(c4.parentAfter.match(/^## Status log/gm)).toHaveLength(1);
    expect(c4.parentAfter).toContain("split (merge-first): emitted follow-up fff000");
  });

  it("review fixes: after-parent anchor ignores rows that merely mention the parent's path", () => {
    // BH-4/EC-3: a row whose TITLE cross-references the parent's filename
    // must not capture the splice — only the parent's own row (path in the
    // row-leading backtick position) anchors.
    const trickyDevMd = [
      "# DEV",
      "",
      "### Epic X",
      "",
      "- [ ] `dev/dev-xyz999-2026-07-01T09:00-port-helpers.md` — Port `dev/dev-abc123-2026-07-01T10:00-parent-item.md` helpers. Status: ready.",
      "- [/] `dev/dev-abc123-2026-07-01T10:00-parent-item.md` — Parent item. Status: in-progress.",
      "- [ ] `dev/dev-def456-2026-07-01T10:00-other-item.md` — Other item. Status: ready. Blocked-by: abc123.",
    ].join("\n");
    const row = "- [ ] `dev/dev-fff000-2026-07-28T14:00-x.md` — X. Status: ready. Blocked-by: abc123.";
    const out = insertDevMdRow(trickyDevMd, ["abc123"], row, {
      type: "dev",
      anchor: "after-parent",
    });
    const lines = out.split("\n");
    expect(lines[5]).toContain("dev-abc123-");
    expect(lines[6]).toBe(row);
  });

  it("review fixes: CLI exits — 64 for a token that normalizes empty, 1 on backlog-lock timeout; empty lock body names the right refusal", async () => {
    const files = makeFiles();
    const fs = makeFakeFs(files);
    const errs: string[] = [];
    const opts = {
      out: () => {},
      err: (s: string) => errs.push(s),
      repoRoot: REPO,
      config: {},
      readFile: (p: string) =>
        p === "payload.json" ? JSON.stringify(PAYLOAD) : fs.readFile(p),
      resolveSpec: () => ({ path: PARENT_ABS, type: "dev" }),
      splitOpts: {
        fs,
        lock: <T>(_l: string, fn: () => T): T => fn(),
        now: () => FIXED_NOW,
      },
    };

    // EC-7: `/devx-` normalizes to empty → usage error, not a deep exit 2.
    expect(
      runSplit(
        ["abc123", "--payload", "payload.json", "--session-token", "/devx-"],
        opts,
      ),
    ).toBe(64);

    // Auditor-5: backlog-lock contention maps to exit 1.
    const { BacklogLockTimeoutError } = await import("../src/lib/backlog/mutate.js");
    expect(
      runSplit(
        ["abc123", "--payload", "payload.json", "--session-token", "sess-1"],
        {
          ...opts,
          splitOpts: {
            ...opts.splitOpts,
            lock: () => {
              throw new BacklogLockTimeoutError("/repo/.devx-cache/locks/backlog.lock", "split-abc123", 42);
            },
          },
        },
      ),
    ).toBe(1);

    // EC-6: an existing-but-empty lock body refuses with the lock-exists
    // message (not "no spec lock held"), still ownership-shaped.
    const files2 = makeFiles();
    files2.set(LOCK_PATH, "   \n");
    const fs2 = makeFakeFs(files2);
    try {
      performSplit("abc123", splitOpts({ files: files2, fs: fs2 }));
      expect.unreachable("performSplit should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SplitOwnershipError);
      expect((e as SplitOwnershipError).lockExists).toBe(true);
      expect((e as Error).message).toContain("no attributable owner");
    }
  });
});

// ---------------------------------------------------------------------------
// E-5 case group — marker "E-5:" pinned by the eval wrapper
// `_devx/workstreams/mid-story-split/evals/E-5_fresh-claim-viability.ts`.
// Fixtures are built by phase 1's performSplit (both shapes), then driven
// through the REAL dispatcher (gatherRepoSnapshot + decideRepoNext — zero
// gather.ts edits, per plan.md phase 2 Context) and the REAL claimSpec.
// ---------------------------------------------------------------------------

/** NextFs adapter over the same in-memory Map the split fixtures use. */
function makeNextFs(files: Map<string, string>) {
  const fake = makeFakeFs(files);
  return {
    readFile: (p: string) => fake.readFile(p),
    exists: (p: string) => fake.exists(p),
    readdir: (p: string) => fake.readdir(p),
    statMtimeMs: () => 0,
  };
}

function gatherSplitFixture(files: Map<string, string>) {
  return gatherRepoSnapshot({
    repoRoot: REPO,
    merged: {},
    engine: {
      workstreamsRoot: "_devx/workstreams",
      expectationsMin: 3,
      proseBudgetKb: 60,
      readingGuideRoles: ["pm", "architect", "dev", "qa"],
    },
    fs: makeNextFs(files),
    now: () => FIXED_NOW,
    sessionToken: "sess-1",
    skipGh: true,
  });
}

/** Simulate the parent's normal merge tail (merge-first shape only): spec
 *  done, row flipped [x]/done, spec lock released by Phase 8 cleanup.
 *  Asserts it actually changed something — silently no-op'ing on a
 *  branch-handoff fixture (whose parent is already `superseded` + struck)
 *  would leave a test claiming a pre-state it never established
 *  (review EC-7). */
function markParentMerged(files: Map<string, string>): void {
  const specBefore = files.get(PARENT_ABS)!;
  const devMdBefore = files.get(DEV_MD_ABS)!;
  const specAfter = specBefore.replace("status: in-progress", "status: done");
  const devMdAfter = devMdBefore
    .replace("- [/] `dev/dev-abc123", "- [x] `dev/dev-abc123")
    .replace("Parent item. Status: in-progress.", "Parent item. Status: done.");
  if (specAfter === specBefore || devMdAfter === devMdBefore) {
    throw new Error(
      "markParentMerged is only meaningful on a merge-first fixture (parent still in-progress)",
    );
  }
  files.set(PARENT_ABS, specAfter);
  files.set(DEV_MD_ABS, devMdAfter);
  files.delete(LOCK_PATH);
}

interface ClaimExecOpts {
  /** Fully-qualified refs that exist locally / as tracking refs. */
  existingRefs?: string[];
  /** Branch names origin has, reachable by a targeted fetch. */
  originBranches?: string[];
  /** branch name → worktree path holding it checked out. */
  checkedOut?: Record<string, string>;
  /** Force `git branch <b> <start>` to fail. */
  failBranchCreate?: boolean;
}

/** Fake exec for claimSpec. `show-ref` answers with a real `<sha> <ref>`
 *  line (the shape the production probe requires); a targeted `git fetch`
 *  of an origin branch materializes its tracking ref; `worktree list
 *  --porcelain` renders the checked-out map; everything else
 *  blanket-succeeds, which keeps indeterminate results on the derive path. */
function makeClaimExec(opts: ClaimExecOpts | string[]): {
  exec: Exec;
  calls: Array<{ cmd: string; args: string[] }>;
} {
  const o: ClaimExecOpts = Array.isArray(opts) ? { existingRefs: opts } : opts;
  const refs = new Set(o.existingRefs ?? []);
  const originBranches = new Set(o.originBranches ?? []);
  const checkedOut = o.checkedOut ?? {};
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const exec: Exec = (cmd, args): ExecResult => {
    calls.push({ cmd, args: [...args] });
    if (cmd === "git" && args[0] === "show-ref") {
      const ref = args[args.length - 1];
      return refs.has(ref)
        ? { stdout: `deadbeefdeadbeefdeadbeefdeadbeefdeadbeef ${ref}\n`, stderr: "", exitCode: 0 }
        : { stdout: "", stderr: "", exitCode: 1 };
    }
    if (cmd === "git" && args[0] === "fetch") {
      // `+refs/heads/<b>:refs/remotes/origin/<b>`
      const spec = args[args.length - 1];
      const b = spec.replace(/^\+?refs\/heads\//, "").split(":")[0];
      if (!originBranches.has(b)) {
        return { stdout: "", stderr: `couldn't find remote ref refs/heads/${b}`, exitCode: 128 };
      }
      refs.add(`refs/remotes/origin/${b}`);
      return { stdout: "", stderr: "", exitCode: 0 };
    }
    if (cmd === "git" && args[0] === "branch" && args[1] !== "-D") {
      if (o.failBranchCreate) {
        return { stdout: "", stderr: "fatal: cannot create branch", exitCode: 128 };
      }
      refs.add(`refs/heads/${args[1]}`);
      return { stdout: "", stderr: "", exitCode: 0 };
    }
    if (cmd === "git" && args[0] === "worktree" && args[1] === "list") {
      const lines: string[] = ["worktree /repo", "branch refs/heads/main", ""];
      for (const [b, path] of Object.entries(checkedOut)) {
        lines.push(`worktree ${path}`, `branch refs/heads/${b}`, "");
      }
      return { stdout: lines.join("\n"), stderr: "", exitCode: 0 };
    }
    if (cmd === "git" && args[0] === "rev-parse" && args[1] === "HEAD") {
      return { stdout: "cafe0000cafe\n", stderr: "", exitCode: 0 };
    }
    return { stdout: "", stderr: "", exitCode: 0 };
  };
  return { exec, calls };
}

/** Build a branch-handoff follow-up and return its hash + fixture state,
 *  with the parent's lock released and its worktree already gone. */
function handoffFixture(): { files: Map<string, string>; fs: ClaimFs; followUpHash: string } {
  const files = makeFiles();
  const fs = makeFakeFs(files);
  const result = performSplit(
    "abc123",
    splitOpts({ files, fs }, { shape: "branch-handoff" }),
  );
  files.delete(LOCK_PATH);
  return { files, fs, followUpHash: result.followUpHash };
}

function claimOpts(run: SplitRun, exec: Exec) {
  return {
    sessionId: "sess-2",
    repoRoot: REPO,
    config: {
      git: { default_branch: "main", branch_prefix: "feat/", integration_branch: null },
    },
    fs: run.fs,
    exec,
    now: () => FIXED_NOW,
    lock: <T>(_label: string, fn: () => T): T => fn(),
    // sgr104: route the claim's GRAPH.md regen through the fake disk. The
    // real `regenerateGraph` reads the seam it is handed but writes with
    // `writeAtomic` — and this fixture's root is the imaginary `/repo`, whose
    // `exists()` returns true on a prefix match, so the regen's own
    // missing-root guard can't save us here. Without this the claim would
    // attempt a real `mkdir('/repo')` on the host and then warn its way past
    // the failure, silently un-testing the hook.
    regen: ((readSeam, repoRoot, engine) =>
      regenerateGraph(readSeam, repoRoot, engine, {
        write: (p, c) => run.fs.writeFile(p, c),
      })) as RegenFn,
  };
}

describe("E-5: fresh-claim viability of a follow-up (mss102)", () => {
  it("parseSpecClaimFields surfaces the branch: frontmatter field on the claim path", () => {
    const fields = parseSpecClaimFields(PARENT_SPEC);
    expect(fields.branch).toBe("feat/dev-abc123");
    expect(parseSpecClaimFields("---\nstatus: ready\n---\nbody").branch).toBeNull();
  });

  it("branch-handoff fixture: devx next routes row 8 to the follow-up immediately; split-attributable drift = 0", () => {
    const files = makeFiles();
    const fs = makeFakeFs(files);
    const result = performSplit(
      "abc123",
      splitOpts({ files, fs }, { shape: "branch-handoff" }),
    );
    files.delete(LOCK_PATH); // driver releases the parent's lock post-split

    const snapshot = gatherSplitFixture(files);
    expect(snapshot.drift).toEqual([]);
    expect(snapshot.devReady.map((i) => i.hash)).toEqual([result.followUpHash]);

    const decision = decideRepoNext(snapshot);
    expect(decision.row).toBe(8);
    expect(decision.command).toBe(`/devx ${result.followUpHash}`);
  });

  it("merge-first fixture: follow-up blocked until the parent merges, then the row-8 ready pick; drift = 0 in both states", () => {
    const files = makeFiles();
    const fs = makeFakeFs(files);
    const result = performSplit("abc123", splitOpts({ files, fs }));

    // Pre-merge: blocked-by the in-progress parent — not a ready pick.
    const before = gatherSplitFixture(files);
    expect(before.drift).toEqual([]);
    expect(before.devReady.map((i) => i.hash)).not.toContain(result.followUpHash);
    expect(before.blocked.map((b) => b.hash)).toContain(result.followUpHash);

    // Parent merges via the normal tail → blockersResolved flips with zero
    // gather.ts edits (follow-up rows are ordinary ready+Blocked-by rows).
    markParentMerged(files);
    const after = gatherSplitFixture(files);
    expect(after.drift).toEqual([]);
    const decision = decideRepoNext(after);
    expect(decision.row).toBe(8);
    expect(decision.command).toBe(`/devx ${result.followUpHash}`);
  });

  it("claim honors recorded branch inheritance on the branch-handoff fixture: attach, not -b (local branch present)", async () => {
    const { files, fs, followUpHash } = handoffFixture();
    const { exec, calls } = makeClaimExec({
      existingRefs: ["refs/heads/feat/dev-abc123"],
    });
    const claimed = await claimSpec(followUpHash, claimOpts({ files, fs }, exec));

    // The recorded WIP branch is inherited, not a fresh derived one — and
    // the result SAYS so, so disposal paths can tell inherited from created
    // without re-deriving the name themselves (b41f7c AC 2).
    expect(claimed.branch).toBe("feat/dev-abc123");
    expect(claimed.attached).toBe(true);
    const worktreeAdd = calls.find(
      (c) => c.cmd === "git" && c.args[0] === "worktree" && c.args[1] === "add",
    );
    expect(worktreeAdd!.args).toEqual([
      "worktree",
      "add",
      `${REPO}/.worktrees/dev-${followUpHash}`,
      "feat/dev-abc123",
    ]);
    expect(worktreeAdd!.args).not.toContain("-b");
    // A local hit needs no network and no tracking-ref consult.
    expect(calls.filter((c) => c.args[0] === "fetch")).toEqual([]);
  });

  it("cold session: the inherited branch is fetched from origin by targeted refspec, then attached without single-remote DWIM", async () => {
    // The flagship scenario — a session that has never seen the branch.
    // Pre-fix the probe consulted only the local ref store, silently
    // deriving from main and stranding the parent's pushed WIP (BH-1).
    const { files, fs, followUpHash } = handoffFixture();
    const { exec, calls } = makeClaimExec({
      existingRefs: [],
      originBranches: ["feat/dev-abc123"],
    });
    const claimed = await claimSpec(followUpHash, claimOpts({ files, fs }, exec));
    expect(claimed.branch).toBe("feat/dev-abc123");
    expect(claimed.attached).toBe(true);

    const fetch = calls.find((c) => c.args[0] === "fetch");
    expect(fetch!.args).toEqual([
      "fetch",
      "origin",
      "+refs/heads/feat/dev-abc123:refs/remotes/origin/feat/dev-abc123",
    ]);
    // Local branch created explicitly from the fetched ref, so `worktree
    // add <path> <branch>` never depends on DWIM picking a remote.
    const branchCreate = calls.find(
      (c) => c.args[0] === "branch" && c.args[1] === "feat/dev-abc123",
    );
    expect(branchCreate!.args[2]).toBe("refs/remotes/origin/feat/dev-abc123");
    const worktreeAdd = calls.find(
      (c) => c.args[0] === "worktree" && c.args[1] === "add",
    );
    expect(worktreeAdd!.args).not.toContain("-b");
  });

  it("a stale tracking ref for a branch deleted upstream does NOT qualify: fetch fails → derive with a warning", async () => {
    const { files, fs, followUpHash } = handoffFixture();
    // Tracking ref lingers (git never prunes by default) but origin no
    // longer has the branch, so the targeted fetch fails.
    const { exec } = makeClaimExec({
      existingRefs: ["refs/remotes/origin/feat/dev-abc123"],
      originBranches: [],
    });
    const warnings: string[] = [];
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        warnings.push(String(chunk));
        return true;
      });
    try {
      const claimed = await claimSpec(followUpHash, claimOpts({ files, fs }, exec));
      expect(claimed.branch).toBe(`feat/dev-${followUpHash}`);
      // Refused/failed inheritance is a DERIVE — nothing was inherited, so
      // the branch is the claim's own and disposable (b41f7c).
      expect(claimed.attached).toBe(false);
    } finally {
      spy.mockRestore();
    }
    expect(warnings.join("")).toContain("neither locally nor on origin");
  });

  it("refuses to attach when the inherited branch is checked out elsewhere — and fails BEFORE mutating anything", async () => {
    // EC-1: the parent's worktree still holds the branch in the flagship
    // handoff shape. Pre-fix this wedged post-push with a rerun hint that
    // could never succeed.
    const { files, fs, followUpHash } = handoffFixture();
    const devMdBefore = files.get(DEV_MD_ABS)!;
    const { exec, calls } = makeClaimExec({
      existingRefs: ["refs/heads/feat/dev-abc123"],
      checkedOut: { "feat/dev-abc123": `${REPO}/.worktrees/dev-abc123` },
    });
    await expect(
      claimSpec(followUpHash, claimOpts({ files, fs }, exec)),
    ).rejects.toThrow(/checked out in the worktree at .*\.worktrees\/dev-abc123/);

    // Nothing was mutated: no commit, no push, no backlog flip, no lock.
    expect(files.get(DEV_MD_ABS)).toBe(devMdBefore);
    expect(calls.some((c) => c.args[0] === "commit" || c.args[0] === "push")).toBe(false);
    expect(files.has(`${REPO}/.devx-cache/locks/spec-${followUpHash}.lock`)).toBe(false);
  });

  it("refuses to attach to the default/integration branch", async () => {
    const { files, fs, followUpHash } = handoffFixture();
    const followUpAbs = [...files.keys()].find((k) => k.includes(followUpHash))!;
    files.set(
      followUpAbs,
      files.get(followUpAbs)!.replace(/^branch: .*$/m, "branch: main"),
    );
    const { exec, calls } = makeClaimExec({ existingRefs: ["refs/heads/main"] });
    const warnings: string[] = [];
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        warnings.push(String(chunk));
        return true;
      });
    try {
      const claimed = await claimSpec(followUpHash, claimOpts({ files, fs }, exec));
      expect(claimed.branch).toBe(`feat/dev-${followUpHash}`);
      // Refused/failed inheritance is a DERIVE — nothing was inherited, so
      // the branch is the claim's own and disposable (b41f7c).
      expect(claimed.attached).toBe(false);
    } finally {
      spy.mockRestore();
    }
    expect(warnings.join("")).toContain("default/integration branch");
    const worktreeAdd = calls.find(
      (c) => c.args[0] === "worktree" && c.args[1] === "add",
    );
    expect(worktreeAdd!.args).toContain("-b");
  });

  it("claim of a merge-first follow-up takes the derive path: it records its OWN derived branch, so -b creates it", async () => {
    const files = makeFiles();
    const fs = makeFakeFs(files);
    const result = performSplit("abc123", splitOpts({ files, fs }));
    markParentMerged(files);

    const { exec, calls } = makeClaimExec([]);
    const claimed = await claimSpec(
      result.followUpHash,
      claimOpts({ files, fs }, exec),
    );
    expect(claimed.branch).toBe(`feat/dev-${result.followUpHash}`);
    // Derive path → the claim CREATED this branch, so it stays disposable
    // for the loop's abandon hygiene (b41f7c).
    expect(claimed.attached).toBe(false);
    const worktreeAdd = calls.find(
      (c) => c.cmd === "git" && c.args[0] === "worktree" && c.args[1] === "add",
    );
    expect(worktreeAdd!.args).toEqual([
      "worktree",
      "add",
      `${REPO}/.worktrees/dev-${result.followUpHash}`,
      "-b",
      `feat/dev-${result.followUpHash}`,
      "main",
    ]);
  });

  it("recorded == derived is NOT inheritance: a leftover same-named branch still fails loudly at -b, never silently adopted", async () => {
    // BH-3/EC-2: every plan-emitted spec records its own derived name, so
    // keying attach on "recorded branch exists" would silently adopt debris
    // from a crashed run. Inheritance requires recorded != derived.
    const files = makeFiles();
    const fs = makeFakeFs(files);
    const result = performSplit("abc123", splitOpts({ files, fs }));
    markParentMerged(files);
    const derived = `feat/dev-${result.followUpHash}`;

    const { exec, calls } = makeClaimExec({
      existingRefs: [`refs/heads/${derived}`],
    });
    await expect(
      claimSpec(result.followUpHash, {
        ...claimOpts({ files, fs }, exec),
        // Debris branch exists → real git fails `worktree add -b`; the fake
        // reproduces that so the pre-mss102 loud failure is pinned.
        exec: (cmd, args, o) =>
          cmd === "git" && args[0] === "worktree" && args[1] === "add"
            ? { stdout: "", stderr: `fatal: a branch named '${derived}' already exists`, exitCode: 128 }
            : exec(cmd, args, o),
      }),
    ).rejects.toThrow(/already exists/);
    // No probing at all — recorded == derived short-circuits before any git.
    expect(calls.filter((c) => c.args[0] === "show-ref")).toEqual([]);
    expect(calls.filter((c) => c.args[0] === "fetch")).toEqual([]);
  });

  it("legal-YAML branch spellings still inherit: quoted, trailing comment, refs/heads/ prefix", async () => {
    for (const spelling of [
      '"feat/dev-abc123"',
      "feat/dev-abc123 # parent WIP",
      "refs/heads/feat/dev-abc123",
    ]) {
      const { files, fs, followUpHash } = handoffFixture();
      const followUpAbs = [...files.keys()].find((k) => k.includes(followUpHash))!;
      files.set(
        followUpAbs,
        files.get(followUpAbs)!.replace(/^branch: .*$/m, `branch: ${spelling}`),
      );
      const { exec } = makeClaimExec({
        existingRefs: ["refs/heads/feat/dev-abc123"],
      });
      const claimed = await claimSpec(followUpHash, claimOpts({ files, fs }, exec));
      expect(claimed.branch, `spelling: ${spelling}`).toBe("feat/dev-abc123");
    }
  });

  it("a transient spec-read failure at probe time fails the claim instead of silently deriving", async () => {
    // EC-3: swallowing every error here let a handoff follow-up be built
    // from main with the parent's pushed WIP stranded and no warning.
    const { files, fs, followUpHash } = handoffFixture();
    const followUpAbs = [...files.keys()].find((k) => k.includes(followUpHash))!;
    const flaky: ClaimFs = {
      ...fs,
      readFile: (p) => {
        if (p === followUpAbs) {
          const e = new Error("EIO: transient read failure") as NodeJS.ErrnoException;
          e.code = "EIO";
          throw e;
        }
        return fs.readFile(p);
      },
    };
    const { exec } = makeClaimExec({ existingRefs: ["refs/heads/feat/dev-abc123"] });
    await expect(
      claimSpec(followUpHash, {
        ...claimOpts({ files, fs: flaky }, exec),
        fs: flaky,
      }),
    ).rejects.toThrow(/resolve branch inheritance/);
  });

  it("specs without branch: never probe — the derive path runs with zero show-ref calls", async () => {
    const files = makeFiles();
    const fs = makeFakeFs(files);
    const result = performSplit("abc123", splitOpts({ files, fs }));
    markParentMerged(files);
    // Strip the recorded branch line from the follow-up spec.
    const followUpAbs = `${REPO}/${result.followUpSpecPath}`;
    files.set(
      followUpAbs,
      files.get(followUpAbs)!.replace(/^branch: .*\n/m, ""),
    );

    const { exec, calls } = makeClaimExec([]);
    const claimed = await claimSpec(
      result.followUpHash,
      claimOpts({ files, fs }, exec),
    );
    expect(claimed.branch).toBe(`feat/dev-${result.followUpHash}`);
    expect(calls.filter((c) => c.args[0] === "show-ref")).toEqual([]);
    const worktreeAdd = calls.find(
      (c) => c.cmd === "git" && c.args[0] === "worktree" && c.args[1] === "add",
    );
    expect(worktreeAdd!.args).toContain("-b");
  });
});

// ---------------------------------------------------------------------------
// branch-handoff `branch` override (mss103) — the loop driver's seam.
// claimSpec never writes `branch:` frontmatter, so the loop passes its
// claim's branch explicitly; the CLI path still reads the parent spec.
// ---------------------------------------------------------------------------

describe("performSplit — branch-handoff `branch` override (mss103)", () => {
  it("an explicit branch wins over the parent's `branch:` frontmatter", () => {
    const files = makeFiles();
    const fs = makeFakeFs(files);
    const result = performSplit(
      "abc123",
      splitOpts({ files, fs }, { shape: "branch-handoff", branch: "feat/dev-from-the-claim" }),
    );
    const followUp = files.get(`${REPO}/${result.followUpSpecPath}`)!;
    expect(followUp).toContain("branch: feat/dev-from-the-claim");
    expect(followUp).not.toContain("branch: feat/dev-abc123");
  });

  it("a blank/whitespace override falls back to the parent's frontmatter branch", () => {
    for (const branch of ["", "   "]) {
      const files = makeFiles();
      const fs = makeFakeFs(files);
      const result = performSplit(
        "abc123",
        splitOpts({ files, fs }, { shape: "branch-handoff", branch }),
      );
      expect(files.get(`${REPO}/${result.followUpSpecPath}`)!).toContain(
        "branch: feat/dev-abc123",
      );
    }
  });

  it("the override is ignored by merge-first, which always derives from the follow-up's own hash", () => {
    const files = makeFiles();
    const fs = makeFakeFs(files);
    const result = performSplit(
      "abc123",
      splitOpts({ files, fs }, { shape: "merge-first", branch: "feat/dev-should-be-ignored" }),
    );
    const followUp = files.get(`${REPO}/${result.followUpSpecPath}`)!;
    expect(followUp).not.toContain("should-be-ignored");
    expect(followUp).toContain(`branch: feat/dev-${result.followUpHash}`);
  });

  it("with no override and no parent `branch:` frontmatter, branch-handoff still refuses", () => {
    const files = makeFiles();
    files.set(PARENT_ABS, PARENT_SPEC.replace("branch: feat/dev-abc123\n", ""));
    const fs = makeFakeFs(files);
    expect(() =>
      performSplit("abc123", splitOpts({ files, fs }, { shape: "branch-handoff" })),
    ).toThrow(/branch-handoff needs the recorded WIP branch/);
  });
});

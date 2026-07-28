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

import { describe, expect, it } from "vitest";

import type { ClaimFs } from "../src/lib/devx/claim.js";
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

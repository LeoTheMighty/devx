// c808b1 — the durable artifact a *proposed* /devx-learn row leaves behind.
//
// The AC is "proposed rows leave a durable, findable artifact — an unattended
// tab's stdout is not a delivery channel". Four properties carry it, each one
// a way the prose version already fails:
//
//   1. **The backlog row and the thing it points at land together.** A DEV.md
//      row referencing a spec that was never written makes `devx next` offer a
//      dangling item forever, so the three writes are one transaction with
//      restore-on-partial.
//   2. **Findability.** Repo proposals land at `docs/updates/<date>-<slug>.md`
//      next to the hand-written ones; outlet-4 rows land under
//      `<learn-home>/proposals/` — never in the repo, never applied.
//   3. **Untrusted input.** Titles are mined session content: they may not
//      become path components except through `sanitizeLearnSlug`, may not
//      forge a YAML key in the spec's frontmatter, and may not forge a
//      frontmatter fence from the body.
//   4. **Idempotence.** A retried write must not double-file a row.
//
// Spec: dev/dev-c808b1-2026-08-05T11:25-devx-learn-unattended-apply.md

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { coerceLearnProposal, runLearnPropose } from "../src/commands/learn-helper.js";
import {
  LEARN_PROPOSAL_SECTION,
  type LearnProposal,
  frontmatterScalar,
  insertLearnProposalRow,
  proposalDate,
  proposalSlug,
  proposalsDir,
  renderProposalDevMdRow,
  renderProposalDoc,
  renderProposalSpec,
  safeBlock,
  writePersonalProposal,
  writeRepoProposal,
} from "../src/lib/learn/propose.js";

const AT = "2026-08-20T18:31:02.500Z";
const CLOCK = () => new Date(AT);

const BASE: LearnProposal = {
  title: "await-remote-ci empty-state retry budget is too tight",
  evidence: "the first probe after gh pr create returned empty and the run routed around the contract",
  bucket: "1 framework fix",
  question: "would another repo running devx hit this?",
  reason: "path .claude/commands/devx.md would hang on a confirmation prompt an unattended tab cannot accept",
  paths: [".claude/commands/devx.md"],
  change: "treat the first empty within 60s of PR creation as expected",
  sessionId: "abc123",
};

let repoRoot: string;
let home: string;

function seedRepo(devMd = "# DEV\n\n## Phase V2\n\n### Epic — something\n\n- [x] `dev/dev-aaa111-2026-01-01T00:00-x.md` — X. Status: done.\n"): void {
  repoRoot = mkdtempSync(join(tmpdir(), "devx-learn-propose-"));
  writeFileSync(join(repoRoot, "DEV.md"), devMd, "utf8");
}

beforeEach(() => {
  seedRepo();
  home = mkdtempSync(join(tmpdir(), "devx-learn-propose-home-"));
});

describe("pure helpers", () => {
  it("derives the date component from the run's finish time, degrading rather than throwing", () => {
    expect(proposalDate(AT)).toBe("2026-08-20");
    expect(proposalDate("not a date")).toBe("unknown-date");
    expect(proposalDate(undefined)).toBe("unknown-date");
  });

  it("routes every filename through the slug sanitizer — session text never becomes a path", () => {
    expect(proposalSlug({ title: "hello; rm -rf /" })).toBe("hello-rm-rf");
    expect(proposalSlug({ title: "../../etc/passwd" })).toBe("etc-passwd");
    expect(proposalSlug({ title: "" })).toBe("session-retro");
  });

  it("quotes a frontmatter scalar so a mined title cannot forge a YAML key", () => {
    expect(frontmatterScalar('title: with "quotes" and: colons')).toBe(
      '"title: with \\"quotes\\" and: colons"',
    );
    expect(frontmatterScalar("back\\slash")).toBe('"back\\\\slash"');
  });

  it("neutralizes a horizontal rule in a mined block so it cannot forge a frontmatter fence", () => {
    expect(safeBlock("before\n---\nafter")).not.toContain("\n---\n");
    expect(safeBlock("before\n---\nafter")).toContain("before");
    expect(safeBlock("   ")).toBe("_(not recorded)_");
    expect(safeBlock(undefined)).toBe("_(not recorded)_");
    // A rule that is part of a sentence is left alone — only whole-line rules.
    expect(safeBlock("a --- b")).toBe("a --- b");
  });
});

describe("rendering", () => {
  it("leads the doc with 'proposed, NOT applied' and names why it was not applied", () => {
    const doc = renderProposalDoc(BASE, { finishedAt: AT });
    expect(doc).toContain("proposed, NOT applied");
    expect(doc).toContain("2026-08-20");
    expect(doc).toContain(BASE.reason!);
    expect(doc).toContain(BASE.evidence!);
    expect(doc).toContain("`.claude/commands/devx.md`");
    expect(doc).toContain("would another repo running devx hit this?");
  });

  it("says locked machinery when that, not a wedge path, is the reason", () => {
    const doc = renderProposalDoc({ title: "loosen the merge gate", locked: true }, { finishedAt: AT });
    expect(doc).toMatch(/locked machinery/i);
    expect(doc).toMatch(/never apply it, in any mode/);
  });

  it("renders a spec whose frontmatter survives a hostile title", () => {
    const spec = renderProposalSpec(
      { ...BASE, title: 'status: done\nowner: someone-else' },
      { hash: "abc123", iso: "2026-08-20T12:31:02-06:00", docPath: "docs/updates/2026-08-20-x.md" },
    );
    const frontmatter = spec.split("---")[1];
    expect(frontmatter).toContain('title: "status: done owner: someone-else"');
    // The injected keys are inside the quoted scalar, not new lines.
    expect(frontmatter).toMatch(/status: ready/);
    expect(frontmatter).not.toMatch(/^owner: someone-else$/m);
    expect(spec).toContain("status: ready");
    expect(spec).toContain("docs/updates/2026-08-20-x.md");
  });

  it("renders a one-line, ready, unblocked backlog row pointing at the spec", () => {
    const row = renderProposalDevMdRow(BASE, "dev/dev-abc123-2026-08-20T12:31-slug.md");
    expect(row.split("\n")).toHaveLength(1);
    expect(row).toContain("`dev/dev-abc123-2026-08-20T12:31-slug.md`");
    expect(row).toMatch(/^- \[ \] /);
    expect(row).toContain("Status: ready");
  });

  it("flattens a multi-line mined title into the single-line backlog row", () => {
    const row = renderProposalDevMdRow({ title: "line one\nline two" }, "dev/x.md");
    expect(row.split("\n")).toHaveLength(1);
    expect(row).toContain("line one line two");
  });
});

describe("insertLearnProposalRow", () => {
  it("creates the section on first use and appends to it afterwards", () => {
    const first = insertLearnProposalRow("# DEV\n\n### Epic — a\n\n- [x] `dev/dev-old.md` — old.\n", "- [ ] `dev/dev-1.md` — one.", "dev/dev-1.md");
    expect(first).toContain(LEARN_PROPOSAL_SECTION);
    expect(first).toContain("- [ ] `dev/dev-1.md` — one.");

    const second = insertLearnProposalRow(first, "- [ ] `dev/dev-2.md` — two.", "dev/dev-2.md");
    const lines = second.split("\n");
    expect(lines.indexOf("- [ ] `dev/dev-1.md` — one.")).toBeLessThan(
      lines.indexOf("- [ ] `dev/dev-2.md` — two."),
    );
    // Exactly one section, no matter how many rows.
    expect(second.split(LEARN_PROPOSAL_SECTION)).toHaveLength(2);
  });

  it("appends inside the section, not after a later header", () => {
    const content = `# DEV\n\n${LEARN_PROPOSAL_SECTION}\n\n- [ ] \`dev/dev-1.md\` — one.\n\n### Epic — later\n\n- [x] \`dev/dev-9.md\` — nine.\n`;
    const out = insertLearnProposalRow(content, "- [ ] `dev/dev-2.md` — two.", "dev/dev-2.md");
    const lines = out.split("\n");
    expect(lines.indexOf("- [ ] `dev/dev-2.md` — two.")).toBeLessThan(lines.indexOf("### Epic — later"));
  });

  it("is idempotent on the spec path — a retry cannot double-file a row", () => {
    const once = insertLearnProposalRow("# DEV\n", "- [ ] `dev/dev-1.md` — one.", "dev/dev-1.md");
    const twice = insertLearnProposalRow(once, "- [ ] `dev/dev-1.md` — one.", "dev/dev-1.md");
    expect(twice).toBe(once);
  });

  it("leaves existing content byte-identical apart from the addition", () => {
    const original = "# DEV\n\n### Epic — a\n\n- [x] `dev/dev-old.md` — old.\n";
    const out = insertLearnProposalRow(original, "- [ ] `dev/dev-1.md` — one.", "dev/dev-1.md");
    expect(out.startsWith(original.replace(/\s*$/, ""))).toBe(true);
  });
});

describe("writeRepoProposal", () => {
  it("writes the doc, the spec and the backlog row together", () => {
    const written = writeRepoProposal(BASE, { repoRoot, now: CLOCK, finishedAt: AT });

    expect(written.docPath).toBe("docs/updates/2026-08-20-await-remote-ci-empty-state-retry-budget.md");
    expect(existsSync(join(repoRoot, written.docPath))).toBe(true);
    expect(existsSync(join(repoRoot, written.specPath))).toBe(true);

    const devMd = readFileSync(join(repoRoot, "DEV.md"), "utf8");
    expect(devMd).toContain(LEARN_PROPOSAL_SECTION);
    expect(devMd).toContain(`\`${written.specPath}\``);

    // The row points at a spec that exists and names the doc that exists.
    const spec = readFileSync(join(repoRoot, written.specPath), "utf8");
    expect(spec).toContain(written.docPath);
    expect(spec).toContain(`hash: ${written.hash}`);
  });

  it("mints a fresh 6-hex hash that does not collide with an existing spec", () => {
    mkdirSync(join(repoRoot, "dev"), { recursive: true });
    const a = writeRepoProposal(BASE, { repoRoot, now: CLOCK, finishedAt: AT });
    const b = writeRepoProposal({ ...BASE, title: "another lesson entirely" }, { repoRoot, now: CLOCK, finishedAt: AT });
    expect(a.hash).toMatch(/^[0-9a-f]{6}$/);
    expect(b.hash).not.toBe(a.hash);
    expect(readdirSync(join(repoRoot, "dev"))).toHaveLength(2);
  });

  it("disambiguates a same-date same-slug collision instead of overwriting", () => {
    const a = writeRepoProposal(BASE, { repoRoot, now: CLOCK, finishedAt: AT });
    const b = writeRepoProposal(BASE, { repoRoot, now: CLOCK, finishedAt: AT });
    expect(b.docPath).not.toBe(a.docPath);
    expect(b.docPath).toMatch(/-2\.md$/);
    expect(readFileSync(join(repoRoot, a.docPath), "utf8")).toContain("proposed, NOT applied");
  });

  it("restores the backlog and removes the new files when the transaction fails", () => {
    const original = readFileSync(join(repoRoot, "DEV.md"), "utf8");
    // Make DEV.md's directory the failure point: a read-only repo root means
    // the atomic rename of DEV.md cannot land.
    const before = readdirSync(repoRoot);
    chmodSync(join(repoRoot, "DEV.md"), 0o444);
    chmodSync(repoRoot, 0o555);
    let threw = false;
    try {
      writeRepoProposal(BASE, { repoRoot, now: CLOCK, finishedAt: AT });
    } catch {
      threw = true;
    } finally {
      chmodSync(repoRoot, 0o755);
      chmodSync(join(repoRoot, "DEV.md"), 0o644);
    }
    expect(threw).toBe(true);
    expect(readFileSync(join(repoRoot, "DEV.md"), "utf8")).toBe(original);
    expect(readdirSync(repoRoot).sort()).toEqual(before.sort());
  });

  it("files a proposal even when the backlog file does not exist yet", () => {
    const bare = mkdtempSync(join(tmpdir(), "devx-learn-propose-bare-"));
    const written = writeRepoProposal(BASE, { repoRoot: bare, now: CLOCK, finishedAt: AT });
    expect(readFileSync(join(bare, "DEV.md"), "utf8")).toContain(`\`${written.specPath}\``);
  });
});

describe("writePersonalProposal (outlet 4)", () => {
  it("writes under the learn home, never into a repo, and says it was not applied", () => {
    const path = writePersonalProposal({ ...BASE, bucket: "4 personal" }, { home, finishedAt: AT });
    expect(path.startsWith(proposalsDir(home))).toBe(true);
    expect(path).toContain("2026-08-20-");
    const body = readFileSync(path, "utf8");
    expect(body).toContain("proposed, NOT applied");
    expect(body).toMatch(/never committed/i);
    expect(body).toMatch(/not.*applied to any settings file/i);
    // Nothing landed in the repo.
    expect(existsSync(join(repoRoot, "docs", "updates"))).toBe(false);
  });

  it("disambiguates a collision rather than erasing the earlier snippet", () => {
    const a = writePersonalProposal(BASE, { home, finishedAt: AT });
    const b = writePersonalProposal(BASE, { home, finishedAt: AT });
    expect(b).not.toBe(a);
    expect(readFileSync(a, "utf8")).toContain("proposed, NOT applied");
  });
});

describe("coerceLearnProposal", () => {
  it("survives a payload with every field wrong", () => {
    const p = coerceLearnProposal({ title: 42, paths: "not-an-array", locked: "yes", evidence: null });
    expect(p.title).toBe("unnamed learn proposal");
    expect(p.paths).toBeUndefined();
    expect(p.locked).toBe(false);
    expect(p.evidence).toBeUndefined();
  });

  it("keeps only the string entries of paths", () => {
    expect(coerceLearnProposal({ title: "x", paths: ["a.ts", 3, null, "b.ts"] }).paths).toEqual(["a.ts", "b.ts"]);
  });

  it("treats a non-object payload as an unnamed proposal rather than throwing", () => {
    expect(coerceLearnProposal(["a"]).title).toBe("unnamed learn proposal");
    expect(coerceLearnProposal(null).title).toBe("unnamed learn proposal");
  });
});

describe("devx learn-helper propose", () => {
  it("prints the three repo paths it wrote, in doc/spec/backlog order", () => {
    const out: string[] = [];
    const code = runLearnPropose(undefined, {
      out: (s) => out.push(s),
      readInput: () => JSON.stringify(BASE),
      repoRoot,
      now: CLOCK,
    });
    expect(code).toBe(0);
    const printed = out.join("").trim().split("\n");
    expect(printed).toHaveLength(3);
    expect(printed[0]).toMatch(/^docs\/updates\//);
    expect(printed[1]).toMatch(/^dev\/dev-/);
    expect(printed[2]).toBe("DEV.md");
    expect(existsSync(join(repoRoot, printed[0]))).toBe(true);
    expect(existsSync(join(repoRoot, printed[1]))).toBe(true);
  });

  it("writes under the learn home for --target personal and touches no repo file", () => {
    const out: string[] = [];
    const code = runLearnPropose(undefined, {
      out: (s) => out.push(s),
      readInput: () => JSON.stringify({ ...BASE, bucket: "4 personal" }),
      target: "personal",
      home,
      now: CLOCK,
    });
    expect(code).toBe(0);
    const path = out.join("").trim();
    expect(path.startsWith(proposalsDir(home))).toBe(true);
    expect(existsSync(join(repoRoot, "docs", "updates"))).toBe(false);
    expect(readFileSync(join(repoRoot, "DEV.md"), "utf8")).not.toContain(LEARN_PROPOSAL_SECTION);
  });

  it("reads the payload from a file argument", () => {
    const file = join(home, "payload.json");
    writeFileSync(file, JSON.stringify({ ...BASE, title: "from a file" }), "utf8");
    const out: string[] = [];
    expect(runLearnPropose(file, { out: (s) => out.push(s), repoRoot, now: CLOCK })).toBe(0);
    expect(out.join("")).toContain("from-a-file");
  });

  it("exits 1 and writes nothing when the payload is not readable JSON", () => {
    const errs: string[] = [];
    const code = runLearnPropose(undefined, {
      out: () => {},
      err: (s) => errs.push(s),
      readInput: () => "{not json",
      repoRoot,
      now: CLOCK,
    });
    expect(code).toBe(1);
    expect(errs.join("")).toMatch(/not readable JSON/);
    expect(existsSync(join(repoRoot, "docs", "updates"))).toBe(false);
    expect(readFileSync(join(repoRoot, "DEV.md"), "utf8")).not.toContain(LEARN_PROPOSAL_SECTION);
  });

  it("exits 1 rather than half-filing when the write fails", () => {
    const errs: string[] = [];
    chmodSync(repoRoot, 0o555);
    let code: number;
    try {
      code = runLearnPropose(undefined, {
        out: () => {},
        err: (s) => errs.push(s),
        readInput: () => JSON.stringify(BASE),
        repoRoot,
        now: CLOCK,
      });
    } finally {
      chmodSync(repoRoot, 0o755);
    }
    expect(code!).toBe(1);
    expect(errs.join("")).toMatch(/could not write the proposal/);
  });
});

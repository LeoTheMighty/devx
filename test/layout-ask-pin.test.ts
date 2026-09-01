// The layout ask is single-sourced, and the pointers to it resolve.
//
// `engine.docs_layout` decides where every stage artifact is read and written
// (docs/CONFIG.md §15). `devx init` writes it explicitly (N14), so an unset
// key means a repo that predates the question — and three skills must then
// ask, once, before their first artifact write.
//
// Those three skills carry a POINTER, never a copy: the measured prose surface
// (test/engine-prose-budget.test.ts) has single-digit bytes of headroom, and
// three copies of an ask is three places for it to drift. Same shape the
// `nudge-canonical` marker already uses for the /devx-learn nudge.
//
// This pins both halves of that arrangement:
//   1. the canonical block exists exactly once, in devx-personalize.md, with
//      the rails that make the ask safe (ask once / never assume / never
//      block / never migrate);
//   2. every skill that points at it names a marker that actually exists.
//
// A pointer to a marker nobody defines is worse than a copy: it reads as
// authoritative and resolves to nothing.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "..");
const MARKER = "<!-- layout-ask-canonical -->";
const OWNER = ".claude/commands/devx-personalize.md";

/** Skills whose Step 0 points at the canonical block. */
const POINTERS = [
  ".claude/commands/devx.md",
  ".claude/commands/devx-plan.md",
  ".claude/commands/devx-walk.md",
];

const read = (rel: string): string => readFileSync(resolve(REPO_ROOT, rel), "utf8");

describe("layout ask — single source", () => {
  it("the canonical block lives exactly once, in devx-personalize", () => {
    const body = read(OWNER);
    expect(body.split(MARKER).length - 1).toBe(1);
  });

  it("carries the four rails that make an unset-key ask safe", () => {
    const body = read(OWNER);
    const block = body.slice(body.indexOf(MARKER));
    // Ask once — a repo answered by EITHER spelling is answered.
    expect(block).toContain("Ask once, ever");
    expect(block).toContain("personalization: docs.layout");
    // Never assume silently — the failure the ask exists to close.
    expect(block).toContain("Never assume silently");
    // Never block — devx loop and CI have nobody to interview.
    expect(block).toContain("Never block");
    expect(block).toMatch(/non-interactive run/i);
    // Never migrate as a side effect — moving a tree is the human's call.
    expect(block).toContain("Never migrate as a side effect");
  });

  it("names the config key as the destination, never a profile", () => {
    const body = read(OWNER);
    const block = body.slice(body.indexOf(MARKER));
    expect(block).toContain("engine:");
    expect(block).toContain("~/.claude/devx/");
    expect(block).toMatch(/never record it in/i);
  });
});

describe("layout ask — the pointers resolve", () => {
  it.each(POINTERS)("%s points at the canonical marker", (rel) => {
    const body = read(rel);
    expect(body).toContain("layout-ask-canonical");
    expect(body).toContain(OWNER);
    // A pointer, not a copy: the skill must not restate the question itself.
    expect(body).not.toContain(MARKER);
  });

  it.each(POINTERS)("%s reads the layout from config, not a profile", (rel) => {
    const body = read(rel);
    expect(body).toContain("engine.docs_layout");
    // The key was a preference-bank key until 2026-09-01; a skill declaring
    // it again would resolve it through layers no runtime reader consults.
    expect(body).not.toMatch(/\|\s*`docs\.layout`\s*\|/);
  });

  it.each([...POINTERS, OWNER])("%s is mirrored byte-identically into skills/", (rel) => {
    const mirror = rel.replace(".claude/commands/", "skills/");
    expect(read(mirror)).toBe(read(rel));
  });
});

// Drift pins for the tour surface (v2t101) — the dvx107 move: constants
// that two artifacts must agree on are asserted here so silent drift in
// either fails CI instead of shipping.
//
// Pinned pairs:
//   • render.ts slot/id constants ↔ the shipped tour template file;
//   • the template's no-CDN/no-font posture (its only http(s) URLs live in
//     inert places: an xmlns inside a data: URI, never a src/href);
//   • TOUR_PLACEHOLDER ↔ the canonical PR template on disk (the
//     BUILTIN_TEMPLATE ↔ on-disk byte-equality pin already lives in
//     devx-pr-body-substitution.test.ts);
//   • package.json pins diff2html + marked to EXACT versions (they're
//     inlined into every rendered tour — a silent minor bump changes every
//     tour byte-for-byte and can reintroduce CDN/network behavior);
//   • hold-check's marker ↔ D-5's literal `devx: hold`.
//
// Spec: dev/dev-v2t101-2026-07-05T13:04-review-tour.md

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { HOLD_MARKER } from "../src/lib/devx/hold-check.js";
import { TOUR_PLACEHOLDER } from "../src/lib/pr-body.js";
import {
  DATA_ISLAND_ID,
  SLOT_D2H_CSS,
  SLOT_D2H_JS,
  SLOT_DATA,
  SLOT_MARKED_JS,
  SLOT_TITLE,
  TEMPLATE_REL_PATH,
} from "../src/lib/tour/render.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function tourTemplate(): string {
  return readFileSync(join(repoRoot, TEMPLATE_REL_PATH), "utf8");
}

describe("tour template ↔ render constants", () => {
  it("template carries all five substitution slots exactly once", () => {
    const tpl = tourTemplate();
    for (const slot of [
      SLOT_TITLE,
      SLOT_DATA,
      SLOT_D2H_CSS,
      SLOT_D2H_JS,
      SLOT_MARKED_JS,
    ]) {
      expect(tpl.split(slot).length - 1, `slot ${slot}`).toBe(1);
    }
  });

  it("data island element id matches DATA_ISLAND_ID and is typed application/json", () => {
    const tpl = tourTemplate();
    expect(tpl).toContain(
      `<script type="application/json" id="${DATA_ISLAND_ID}">${SLOT_DATA}</script>`,
    );
  });

  it("template source has zero http(s):// in src/href attributes (no CDN, no fonts)", () => {
    const hits = tourTemplate().match(
      /\b(?:src|href)\s*=\s*["']https?:\/\/[^"']*/gi,
    );
    expect(hits).toBeNull();
  });

  it("template has no <link>/external <script src> elements at all", () => {
    const tpl = tourTemplate();
    expect(tpl).not.toMatch(/<link\b/i);
    expect(tpl).not.toMatch(/<script[^>]*\bsrc=/i);
  });

  it("template never calls fetch/XMLHttpRequest/WebSocket (no server anywhere)", () => {
    const tpl = tourTemplate();
    expect(tpl).not.toMatch(/\bfetch\s*\(/);
    expect(tpl).not.toMatch(/XMLHttpRequest/);
    expect(tpl).not.toMatch(/WebSocket/);
  });

  it("template has no mermaid runtime (v1 drops it; O-1 tracks re-adding)", () => {
    // The head comment documents the drop by name; what must be absent is
    // any mermaid CODE — runtime calls, containers, or class hooks.
    const tpl = tourTemplate();
    expect(tpl).not.toMatch(/mermaid\.(initialize|render)/i);
    expect(tpl).not.toMatch(/class="[^"]*mermaid/i);
    expect(tpl).not.toMatch(/\.mermaid-/);
  });

  it("template uses localStorage for the comment scratchpad", () => {
    const tpl = tourTemplate();
    expect(tpl).toContain("localStorage.setItem");
    expect(tpl).toContain("Copy as PR comment");
    expect(tpl).toContain("Export review → clipboard as markdown");
  });
});

describe("PR template ↔ tour placeholder", () => {
  it("the canonical PR template on disk carries the tour section + placeholder line", () => {
    const onDisk = readFileSync(
      join(repoRoot, "_devx", "templates", "pull_request_template.md"),
      "utf8",
    );
    expect(onDisk).toContain("## 🗺 Review tour");
    expect(onDisk).toContain(`\n${TOUR_PLACEHOLDER}\n`);
  });
});

describe("vendored dependency pins", () => {
  it("diff2html + marked are runtime deps pinned to exact versions", () => {
    const pkg = JSON.parse(
      readFileSync(join(repoRoot, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    const deps = pkg.dependencies ?? {};
    for (const name of ["diff2html", "marked"]) {
      const v = deps[name];
      expect(v, `${name} must be a runtime dependency`).toBeTruthy();
      expect(v, `${name} must be pinned exact (no ^/~/range)`).toMatch(
        /^\d+\.\d+\.\d+$/,
      );
    }
  });
});

describe("D-5 hold marker", () => {
  it("HOLD_MARKER is the decision ledger's literal", () => {
    expect(HOLD_MARKER).toBe("devx: hold");
  });
});

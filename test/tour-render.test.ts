// Tour render tests (v2t101).
//
// The load-bearing assertions per spec AC 2:
//   • output is ONE self-contained file;
//   • data rides the inline JSON island (id="tour-data");
//   • zero http(s):// URLs in src/href attributes (the no-network AC) —
//     scanned over the REAL rendered output with the REAL vendored bundles;
//   • `</script>` inside diff content survives the island escaping;
//   • rendering is deterministic given the same inputs.
//
// Spec: dev/dev-v2t101-2026-07-05T13:04-review-tour.md

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DATA_ISLAND_ID,
  TourRenderError,
  buildTourHtml,
  escapeDataIsland,
  escapeInlineScript,
  loadVendorAssets,
  renderTourHtml,
} from "../src/lib/tour/render.js";
import { validTour } from "./fixtures/tour-fixture.js";

let tmp: string | null = null;
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

function makeRepoRoot(): string {
  tmp = mkdtempSync(join(tmpdir(), "devx-tour-render-"));
  return tmp;
}

/** The AC's no-network scan: any http(s):// URL inside a src/href attribute
 *  is a network request waiting to happen. */
function networkAttrHits(html: string): string[] {
  const re = /\b(?:src|href)\s*=\s*["']https?:\/\/[^"']*/gi;
  return html.match(re) ?? [];
}

describe("escapeDataIsland", () => {
  it("escapes EVERY < (as backslash-u003c) so no HTML construct survives in the island", () => {
    const out = escapeDataIsland({ diff: "<script>x</script>" });
    expect(out).not.toContain("<");
    expect(out).toContain("\\u003cscript");
    // Round-trips: the unicode escape is a legal JSON escape for '<'.
    expect(JSON.parse(out)).toEqual({ diff: "<script>x</script>" });
  });

  it("neutralizes the <!-- + <script double-escape state (Blind Hunter #1)", () => {
    // Per the HTML script-data tokenizer, island content containing `<!--`
    // then `<script` would put the parser in double-escaped state where the
    // island's REAL closing tag no longer closes it. With every `<` escaped
    // neither construct is representable.
    const out = escapeDataIsland({
      diff: 'x <!-- then <script src="y"> and finally </script>',
    });
    expect(out).not.toContain("<!--");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("</script");
    expect(JSON.parse(out)).toEqual({
      diff: 'x <!-- then <script src="y"> and finally </script>',
    });
  });
});

describe("escapeInlineScript", () => {
  it("neutralizes </script inside vendored JS", () => {
    const out = escapeInlineScript('var s = "</script>";');
    expect(out).not.toContain("</script");
    expect(out).toContain("<\\/script");
  });

  it("is case-insensitive (HTML end-tag matching is) and preserves the original case", () => {
    const out = escapeInlineScript('var s = "</ScRiPt>"; var t = "</SCRIPT";');
    expect(out).not.toMatch(/<\/script/i);
    expect(out).toContain("<\\/ScRiPt>");
    expect(out).toContain("<\\/SCRIPT");
  });
});

describe("renderTourHtml (real vendored bundles)", () => {
  it("produces a single self-contained document with the data island and zero network src/href", () => {
    const html = renderTourHtml(validTour());
    // Single document.
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("</html>");
    // Data island present and carries the tour payload.
    expect(html).toContain(`id="${DATA_ISLAND_ID}"`);
    expect(html).toContain("static HTML review tour");
    // Vendored bundles actually inlined (not linked).
    expect(html).toContain("Diff2HtmlUI");
    expect(html).toContain("marked");
    expect(html.length).toBeGreaterThan(500_000); // ~1MB of inlined vendor code
    // The AC: zero http(s):// in src/href attributes.
    expect(networkAttrHits(html)).toEqual([]);
    // No leftover substitution slots.
    expect(html).not.toContain("__DEVX_TOUR_");
  });

  it("data island survives hostile diff content (<!-- before <script>, </script>, backticks)", () => {
    const t = validTour();
    // The dangerous ORDERING: comment-open first, then <script — the
    // double-escape state (Acceptance Auditor MED-1 / Blind Hunter #1).
    t.fullDiff += '+const x = "<!-- <script>alert(1)</script>";\n';
    t.stops[0].diff += '+`</ScRiPt>`\n';
    const html = renderTourHtml(t);
    const island = /<script type="application\/json" id="tour-data">([\s\S]*?)<\/script>/.exec(
      html,
    );
    expect(island).not.toBeNull();
    // Every `<` is escaped, so no HTML construct exists inside the island.
    expect(island?.[1]).not.toContain("<");
    // And it still parses back to the exact tour.
    expect(JSON.parse(island?.[1] ?? "")).toEqual(JSON.parse(JSON.stringify(t)));
  });

  it("slot literals inside tour CONTENT are not re-substituted (single-pass; Edge Case Hunter #1)", () => {
    const t = validTour();
    t.meta.title = "fix __DEVX_TOUR_DATA__ handling";
    t.fullDiff += "+template slot __DEVX_TOUR_D2H_JS__ mentioned in a diff\n";
    const html = renderTourHtml(t);
    // The title renders the literal, HTML-escaped — NOT the data island.
    const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(html);
    expect(titleMatch?.[1]).toBe("Tour · fix __DEVX_TOUR_DATA__ handling");
    // The island round-trips with the slot literals intact.
    const island = /<script type="application\/json" id="tour-data">([\s\S]*?)<\/script>/.exec(
      html,
    );
    const parsed = JSON.parse(island?.[1] ?? "{}") as {
      meta: { title: string };
      fullDiff: string;
    };
    expect(parsed.meta.title).toBe("fix __DEVX_TOUR_DATA__ handling");
    expect(parsed.fullDiff).toContain("__DEVX_TOUR_D2H_JS__");
  });

  it("is deterministic: same inputs → byte-identical output", () => {
    const a = renderTourHtml(validTour());
    const b = renderTourHtml(validTour());
    expect(a).toBe(b);
  });

  it("contains no mermaid runtime (v1 drops it)", () => {
    const html = renderTourHtml(validTour());
    expect(html).not.toMatch(/mermaid\.(initialize|render)/);
  });

  it("throws stage:template when a slot is missing from the template", () => {
    expect(() =>
      renderTourHtml(validTour(), { template: "<html>no slots</html>" }),
    ).toThrowError(TourRenderError);
  });
});

describe("buildTourHtml", () => {
  it("writes exactly one file to .devx-cache/tours/<hash>/tour.html", () => {
    const repoRoot = makeRepoRoot();
    const r = buildTourHtml("v2t101", validTour(), repoRoot);
    expect(r.outPath).toBe(
      join(repoRoot, ".devx-cache", "tours", "v2t101", "tour.html"),
    );
    expect(existsSync(r.outPath)).toBe(true);
    const dir = join(repoRoot, ".devx-cache", "tours", "v2t101");
    expect(readdirSync(dir)).toEqual(["tour.html"]);
    expect(networkAttrHits(readFileSync(r.outPath, "utf8"))).toEqual([]);
  });

  it("rejects an invalid tour with stage:validate + the typed error list", () => {
    const repoRoot = makeRepoRoot();
    const bad = JSON.parse(JSON.stringify(validTour())) as Record<
      string,
      unknown
    >;
    delete bad.orientation;
    try {
      buildTourHtml("v2t101", bad, repoRoot);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(TourRenderError);
      const err = e as TourRenderError;
      expect(err.stage).toBe("validate");
      expect(err.validationErrors?.some((v) => v.path === "orientation")).toBe(
        true,
      );
    }
    expect(
      existsSync(join(repoRoot, ".devx-cache", "tours", "v2t101", "tour.html")),
    ).toBe(false);
  });

  it("rejects a hash mismatch between CLI arg and tour.meta.hash", () => {
    const repoRoot = makeRepoRoot();
    try {
      buildTourHtml("other1", validTour(), repoRoot);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(TourRenderError);
      expect((e as TourRenderError).stage).toBe("validate");
      expect(
        (e as TourRenderError).validationErrors?.[0]?.path,
      ).toBe("meta.hash");
    }
  });
});

describe("vendored assets", () => {
  it("loads all three bundles from node_modules", () => {
    const v = loadVendorAssets();
    expect(v.diff2htmlJs.length).toBeGreaterThan(100_000);
    expect(v.diff2htmlCss.length).toBeGreaterThan(5_000);
    expect(v.markedJs.length).toBeGreaterThan(10_000);
  });
});

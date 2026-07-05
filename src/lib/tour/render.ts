// Tour render step (v2t101) — the deterministic third leg of
// `devx tour build` (v2/03-review-tour.md §2): validated tour.json +
// vendored template → ONE self-contained tour.html under
// `.devx-cache/tours/<hash>/`.
//
// Self-containment contract (spec AC 2):
//   • Data rides an inline `<script type="application/json" id="tour-data">`
//     island; `</` is escaped as `<\/` so diff content containing
//     `</script>` cannot terminate the island early.
//   • diff2html JS+CSS and marked are inlined from node_modules at render
//     time (pinned exact versions in package.json) — never CDN'd.
//   • NO mermaid (schema rejects it), system font stacks only, zero network
//     requests — asserted by the test scanning src/href attributes for
//     http(s):// URLs.
//   • Rendering is deterministic given the same inputs: no timestamps, no
//     randomness — a re-render of the same tour.json is byte-identical
//     (keeps the devx-tours publish branch quiet on no-op rebuilds).
//
// Substitution uses split/join, NEVER String.replace — the vendored bundles
// contain `$&`-style sequences that replace() would interpret as
// substitution patterns and silently corrupt.
//
// Spec: dev/dev-v2t101-2026-07-05T13:04-review-tour.md
// Design: v2/03-review-tour.md §1 changes 1–3

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type Tour,
  type TourValidationError,
  validateTour,
} from "./schema.js";

// ---------------------------------------------------------------------------
// Template + vendor asset constants (drift-pinned by test/tour-drift-pin.test.ts)
// ---------------------------------------------------------------------------

/** Substitution slots in the shipped template. split/join targets. */
export const SLOT_TITLE = "__DEVX_TOUR_TITLE__";
export const SLOT_DATA = "__DEVX_TOUR_DATA__";
export const SLOT_D2H_CSS = "__DEVX_TOUR_D2H_CSS__";
export const SLOT_D2H_JS = "__DEVX_TOUR_D2H_JS__";
export const SLOT_MARKED_JS = "__DEVX_TOUR_MARKED_JS__";

/** The data island's element id — the page's boot() reads it, the render
 *  test asserts it. */
export const DATA_ISLAND_ID = "tour-data";

/** Template path inside the shipped package (also the repo, when running
 *  from source under vitest/tsx). */
export const TEMPLATE_REL_PATH = join(
  "_devx",
  "templates",
  "tour",
  "tour-template.html",
);

/** Where rendered tours land, relative to the repo root. */
export const TOURS_CACHE_REL = join(".devx-cache", "tours");

export class TourRenderError extends Error {
  readonly stage: "template" | "vendor" | "validate" | "write";
  readonly validationErrors?: TourValidationError[];
  constructor(
    stage: TourRenderError["stage"],
    message: string,
    validationErrors?: TourValidationError[],
  ) {
    super(`tour render failed at stage '${stage}': ${message}`);
    this.name = "TourRenderError";
    this.stage = stage;
    this.validationErrors = validationErrors;
  }
}

// ---------------------------------------------------------------------------
// Asset loading
// ---------------------------------------------------------------------------

export interface VendorAssets {
  diff2htmlCss: string;
  diff2htmlJs: string;
  markedJs: string;
}

export interface RenderTourOpts {
  /** Test seam — vendor asset override (skip node_modules resolution). */
  vendor?: VendorAssets;
  /** Test seam — template text override (skip the on-disk template read). */
  template?: string;
}

/** Resolve the package root: `<here>/../../..` works from both
 *  `dist/lib/tour/render.js` (installed package) and `src/lib/tour/render.ts`
 *  (vitest/tsx in the repo) — same trick as cli.ts's readPackageVersion. */
function packageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

export function loadTemplate(): string {
  const path = join(packageRoot(), TEMPLATE_REL_PATH);
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new TourRenderError(
      "template",
      `could not read tour template at ${path}: ${msg}`,
    );
  }
}

/** Read the vendored bundles from node_modules. Resolution goes through
 *  createRequire so it follows the package's real dependency graph (works
 *  under npm global install where node_modules lives beside dist/). */
export function loadVendorAssets(): VendorAssets {
  const require = createRequire(import.meta.url);
  const read = (spec: string, resolveFrom?: string): string => {
    try {
      const resolved = resolveFrom
        ? join(dirname(require.resolve(resolveFrom)), spec)
        : require.resolve(spec);
      return readFileSync(resolved, "utf8");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new TourRenderError(
        "vendor",
        `could not load vendored asset '${spec}': ${msg} — are diff2html + marked installed?`,
      );
    }
  };
  return {
    // diff2html's exports map doesn't expose the bundles — resolve the
    // package.json and walk into bundles/ (the documented dist layout).
    diff2htmlCss: read(
      join("bundles", "css", "diff2html.min.css"),
      "diff2html/package.json",
    ),
    diff2htmlJs: read(
      join("bundles", "js", "diff2html-ui.min.js"),
      "diff2html/package.json",
    ),
    markedJs: read("marked/marked.min.js"),
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Serialize the tour for the inline data island with EVERY `<` emitted as
 *  its JSON unicode escape (backslash-u003c) — semantics-preserving:
 *  JSON.parse yields the identical document. Escaping only `</` is NOT
 *  enough: per the HTML
 *  script-data tokenizer, island content containing `<!--` followed by
 *  `<script` enters the double-escaped state, in which the island's real
 *  `</script>` closing tag is consumed as text and the rest of the page is
 *  swallowed (self-review finding, Blind Hunter #1 — reachable via any diff
 *  that slices an HTML comment-open into a hunk). Killing every `<` makes
 *  `</`, `<!--`, and `<script` all unrepresentable at once. In JSON output,
 *  `<` can only occur inside string values, so the global replace is safe. */
export function escapeDataIsland(tour: unknown): string {
  return JSON.stringify(tour).split("<").join("\\u003c");
}

/** Neutralize `</script` (any case — HTML end-tag matching is
 *  case-insensitive) inside an inline-JS vendor bundle. Inside a JS string
 *  literal `<\/script` parses identically; outside a string literal a bare
 *  `</script` was already a syntax error, so this cannot change program
 *  behavior. The match's original case is preserved (`</SCRIPT` →
 *  `<\/SCRIPT`) so string-literal CONTENT semantics shift only by the
 *  removable backslash. Note: the vendored bundles are drift-pinned to
 *  exact versions and verified free of the `<!--` + `<script`
 *  double-escape pattern; JSON-island content gets the stronger all-`<`
 *  treatment above because it's arbitrary diff text. */
export function escapeInlineScript(js: string): string {
  return js.replace(/<\/script/gi, (m) => `<\\/${m.slice(2)}`);
}

/** Minimal HTML-escape for the <title> text slot. */
function escapeHtml(s: string): string {
  return s
    .split("&")
    .join("&amp;")
    .split("<")
    .join("&lt;")
    .split(">")
    .join("&gt;");
}

/** Tokenizer for the single-pass substitution below. Capture group keeps
 *  the slot tokens in the split output. */
const SLOT_SPLIT_RE =
  /(__DEVX_TOUR_(?:TITLE|DATA|D2H_CSS|D2H_JS|MARKED_JS)__)/;

/**
 * Render a VALIDATED tour to the final single-file HTML string. Callers that
 * accept unvalidated input go through `buildTourHtml` below, which runs
 * `validateTour` first and surfaces typed errors for the agent retry loop.
 *
 * Substitution is SINGLE-PASS: the template is tokenized once and each slot
 * token maps to its value; substituted values are never re-scanned. Chained
 * split/join passes would re-substitute slot literals occurring inside an
 * earlier value — e.g. a spec titled "fix __DEVX_TOUR_DATA__ handling" would
 * inject the entire data island into <title> (self-review finding, Edge
 * Case Hunter #1). This repo is self-hosting, so slot literals inside tour
 * CONTENT (this very PR's diff contains them) are a normal input.
 */
export function renderTourHtml(tour: Tour, opts: RenderTourOpts = {}): string {
  const template = opts.template ?? loadTemplate();
  for (const slot of [
    SLOT_TITLE,
    SLOT_DATA,
    SLOT_D2H_CSS,
    SLOT_D2H_JS,
    SLOT_MARKED_JS,
  ]) {
    if (!template.includes(slot)) {
      throw new TourRenderError(
        "template",
        `template is missing substitution slot ${slot}`,
      );
    }
  }
  const vendor = opts.vendor ?? loadVendorAssets();

  const values: Record<string, () => string> = {
    [SLOT_TITLE]: () => escapeHtml(`Tour · ${tour.meta.title}`),
    [SLOT_DATA]: () => escapeDataIsland(tour),
    [SLOT_D2H_CSS]: () => vendor.diff2htmlCss,
    [SLOT_D2H_JS]: () => escapeInlineScript(vendor.diff2htmlJs),
    [SLOT_MARKED_JS]: () => escapeInlineScript(vendor.markedJs),
  };
  return template
    .split(SLOT_SPLIT_RE)
    .map((part) => (values[part] ? values[part]() : part))
    .join("");
}

export interface BuildTourResult {
  /** Absolute path of the written tour.html. */
  outPath: string;
}

/**
 * Validate + render + write `.devx-cache/tours/<hash>/tour.html`.
 * Throws TourRenderError with `stage: "validate"` + the typed error list
 * when the tour.json doesn't conform — the CLI surfaces those on stdout as
 * JSON so the narrating agent can fix + retry.
 */
export function buildTourHtml(
  hash: string,
  tourJson: unknown,
  repoRoot: string,
  opts: RenderTourOpts = {},
): BuildTourResult {
  const errors = validateTour(tourJson);
  if (errors.length > 0) {
    throw new TourRenderError(
      "validate",
      `tour.json failed validation with ${errors.length} error(s)`,
      errors,
    );
  }
  const tour = tourJson as Tour;
  if (tour.meta.hash !== hash) {
    throw new TourRenderError(
      "validate",
      `tour.meta.hash '${tour.meta.hash}' does not match requested hash '${hash}'`,
      [
        {
          path: "meta.hash",
          message: `must equal the spec hash '${hash}' this tour is being built for`,
        },
      ],
    );
  }

  const html = renderTourHtml(tour, opts);
  const outDir = join(repoRoot, TOURS_CACHE_REL, hash);
  const outPath = join(outDir, "tour.html");
  try {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(outPath, html);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new TourRenderError("write", `could not write ${outPath}: ${msg}`);
  }
  return { outPath };
}

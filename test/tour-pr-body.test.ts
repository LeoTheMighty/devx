// pr-body review-tour section tests (v2t101).
//
// The one non-negotiable: the tour section is FAIL-SOFT. No tour → the
// section renders the "unavailable (<reason>)" line; a stale template
// without the placeholder → the render still succeeds; a broken
// --tour-orientation file → stderr note, exit stays 0. Tour problems must
// never block PR open (v2/03-review-tour.md §3).
//
// Spec: dev/dev-v2t101-2026-07-05T13:04-review-tour.md

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  BUILTIN_TEMPLATE,
  TOUR_PLACEHOLDER,
  renderPrBody,
  renderTourSection,
} from "../src/lib/pr-body.js";
import { runPrBody } from "../src/commands/pr-body.js";
import { validTour } from "./fixtures/tour-fixture.js";

const SPEC_PATH = "dev/dev-v2t101-2026-07-05T13:04-review-tour.md";
const RAW_URL =
  "https://raw.githubusercontent.com/leo/devx/devx-tours/tours/v2t101/tour.html";
const PREVIEW_URL = `https://htmlpreview.github.io/?${RAW_URL}`;

function render(tour?: Parameters<typeof renderPrBody>[0]["tour"]) {
  return renderPrBody({
    template: BUILTIN_TEMPLATE,
    mode: "YOLO",
    specPath: SPEC_PATH,
    acChecklist: "- [ ] thing",
    tour,
  });
}

describe("renderTourSection", () => {
  it("renders the unavailable line when no tour data exists", () => {
    expect(renderTourSection(undefined)).toBe(
      "_Review tour unavailable (not generated)._",
    );
  });

  it("carries the caller's reason", () => {
    expect(renderTourSection({ unavailableReason: "publish failed" })).toBe(
      "_Review tour unavailable (publish failed)._",
    );
  });

  it("renders both links, deriving the raw fallback from the htmlpreview wrapper", () => {
    const s = renderTourSection({ url: PREVIEW_URL });
    expect(s).toContain(`[Take the tour](${PREVIEW_URL})`);
    expect(s).toContain(`[raw file fallback](${RAW_URL})`);
  });

  it("renders only the primary link for a non-htmlpreview URL without an explicit rawUrl", () => {
    const s = renderTourSection({ url: "https://example.github.io/tour.html" });
    expect(s).toContain("[Take the tour]");
    expect(s).not.toContain("raw file fallback");
  });

  it("renders the orientation <details> fallback: summary + time-boxed + stop list", () => {
    const s = renderTourSection({
      url: PREVIEW_URL,
      orientationSummary: "Adds the tour engine.",
      timeBoxed: "~10 min: Stop 1",
      stops: [
        { id: 1, priority: "must", title: "The engine" },
        { id: 2, priority: "skim", title: "Tests" },
      ],
    });
    expect(s).toContain("<details><summary>Orientation (text fallback)</summary>");
    expect(s).toContain("Adds the tour engine.");
    expect(s).toContain("**Time-boxed:** ~10 min: Stop 1");
    expect(s).toContain("- Stop 1 (must): The engine");
    expect(s).toContain("- Stop 2 (skim): Tests");
    expect(s).toContain("</details>");
  });

  it("omits the <details> block entirely when there's no orientation data", () => {
    const s = renderTourSection({ url: PREVIEW_URL });
    expect(s).not.toContain("<details>");
  });
});

describe("renderPrBody — tour section substitution", () => {
  it("substitutes the placeholder with links + never marks it unresolved", () => {
    const r = render({ url: PREVIEW_URL });
    expect(r.body).toContain("## 🗺 Review tour");
    expect(r.body).toContain(`[Take the tour](${PREVIEW_URL})`);
    expect(r.body).not.toContain(TOUR_PLACEHOLDER);
    expect(r.unresolvedPlaceholders).not.toContain("tour");
    expect(r.tourSectionSkipped).toBeUndefined();
  });

  it("fail-soft: no tour data → unavailable line, section still present, exit path unchanged", () => {
    const r = render(undefined);
    expect(r.body).toContain("## 🗺 Review tour");
    expect(r.body).toContain("_Review tour unavailable (not generated)._");
    expect(r.body).not.toContain(TOUR_PLACEHOLDER);
    // Fail-soft is the whole point: the tour never joins unresolved.
    expect(r.unresolvedPlaceholders).toEqual([
      "summary",
      "test-plan",
      "notes",
    ]);
  });

  it("stale template without the placeholder: render succeeds, tourSectionSkipped flags the loss", () => {
    const legacyTemplate = BUILTIN_TEMPLATE.split(
      `\n## 🗺 Review tour\n${TOUR_PLACEHOLDER}\n`,
    ).join("\n");
    expect(legacyTemplate).not.toContain(TOUR_PLACEHOLDER);
    const r = renderPrBody({
      template: legacyTemplate,
      mode: "YOLO",
      specPath: SPEC_PATH,
      acChecklist: "- [ ] thing",
      tour: { url: PREVIEW_URL },
    });
    expect(r.tourSectionSkipped).toBe(true);
    expect(r.body).not.toContain("Take the tour");
    // And without tour data there's nothing to flag.
    const r2 = renderPrBody({
      template: legacyTemplate,
      mode: "YOLO",
      specPath: SPEC_PATH,
      acChecklist: "- [ ] thing",
    });
    expect(r2.tourSectionSkipped).toBeUndefined();
  });

  it("line-anchoring: a placeholder quoted mid-line does NOT substitute", () => {
    const template = `${BUILTIN_TEMPLATE.split(TOUR_PLACEHOLDER).join("(section removed)")}
Some prose mentioning ${TOUR_PLACEHOLDER} inline must survive.
`;
    const r = renderPrBody({
      template,
      mode: "YOLO",
      specPath: SPEC_PATH,
      acChecklist: "- [ ] thing",
      tour: { url: PREVIEW_URL },
    });
    expect(r.body).toContain(`mentioning ${TOUR_PLACEHOLDER} inline`);
    expect(r.tourSectionSkipped).toBe(true);
  });

  it("orientation summary with $& replacement patterns survives verbatim", () => {
    const r = render({
      url: PREVIEW_URL,
      orientationSummary: "Costs $& and $' were considered.",
    });
    expect(r.body).toContain("Costs $& and $' were considered.");
  });
});

describe("runPrBody CLI — tour flags", () => {
  let tmp: string | null = null;
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = null;
  });

  interface Fixture {
    dir: string;
    configPath: string;
    specRel: string;
  }

  function makeFixture(): Fixture {
    tmp = mkdtempSync(join(tmpdir(), "devx-tour-prbody-"));
    const dir = tmp;
    const configPath = join(dir, "devx.config.yaml");
    writeFileSync(configPath, "mode: YOLO\n");
    mkdirSync(join(dir, "dev"), { recursive: true });
    const specRel = "dev/dev-v2t101-2026-07-05T13:04-review-tour.md";
    writeFileSync(
      join(dir, specRel),
      "---\nhash: v2t101\n---\n\n## Acceptance criteria\n\n- [ ] AC one.\n",
    );
    return { dir, configPath, specRel };
  }

  function run(fx: Fixture, flags: Partial<Parameters<typeof runPrBody>[0]>) {
    let stdout = "";
    let stderr = "";
    const code = runPrBody(
      { spec: fx.specRel, ...flags },
      {
        out: (s) => {
          stdout += s;
        },
        err: (s) => {
          stderr += s;
        },
        projectPath: fx.configPath,
      },
    );
    return { code, stdout, stderr };
  }

  it("--tour-url + --tour-orientation render the full section from tour.json", () => {
    const fx = makeFixture();
    const tourJsonPath = join(fx.dir, "tour.json");
    writeFileSync(tourJsonPath, JSON.stringify(validTour()));
    const r = run(fx, {
      tourUrl: PREVIEW_URL,
      tourOrientation: tourJsonPath,
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`[Take the tour](${PREVIEW_URL})`);
    expect(r.stdout).toContain(`[raw file fallback](${RAW_URL})`);
    expect(r.stdout).toContain("Orientation (text fallback)");
    expect(r.stdout).toContain("Adds the tour engine.");
    expect(r.stdout).toContain("**Time-boxed:** ~10 min: Stop 1");
    expect(r.stdout).toContain("- Stop 1 (must): The engine");
    expect(r.stderr).not.toContain("tour");
  });

  it("no tour flags → unavailable line; exit 0 (fail-soft, PR opens)", () => {
    const fx = makeFixture();
    const r = run(fx, {});
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("_Review tour unavailable (not generated)._");
  });

  it("--tour-unavailable carries the reason into the line", () => {
    const fx = makeFixture();
    const r = run(fx, { tourUnavailable: "publish lost the race 3 times" });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(
      "_Review tour unavailable (publish lost the race 3 times)._",
    );
  });

  it("unreadable --tour-orientation is fail-soft: stderr note, section renders, exit 0", () => {
    const fx = makeFixture();
    const r = run(fx, {
      tourUrl: PREVIEW_URL,
      tourOrientation: join(fx.dir, "nope.json"),
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`[Take the tour](${PREVIEW_URL})`);
    expect(r.stderr).toContain("tour-orientation:");
    expect(r.stderr).toContain("fail-soft");
  });

  it("malformed --tour-orientation JSON without a url → unavailable with 'orientation unreadable'", () => {
    const fx = makeFixture();
    const badPath = join(fx.dir, "bad.json");
    writeFileSync(badPath, "{not json");
    const r = run(fx, { tourOrientation: badPath });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(
      "_Review tour unavailable (orientation unreadable)._",
    );
  });
});

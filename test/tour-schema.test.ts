// validateTour() adversarial tests (v2t101).
//
// Strategy: one canonical valid fixture; each test clones + mutates one
// section and asserts a typed error lands at the right path. The two
// contract-defining rejections get their own blocks:
//   • severity vocabulary anywhere → error (the tour has NO severities);
//   • trails[].mermaid → error (v1 renders trail step tables only).
//
// Spec: dev/dev-v2t101-2026-07-05T13:04-review-tour.md

import { describe, expect, it } from "vitest";

import {
  TOUR_FLAGS,
  TOUR_JSON_SCHEMA,
  TOUR_PRIORITIES,
  TOUR_WEIGHTS,
  TRAIL_STEP_STATUSES,
  type Tour,
  validateTour,
} from "../src/lib/tour/schema.js";
import { validTour } from "./fixtures/tour-fixture.js";

function clone(): Tour {
  return JSON.parse(JSON.stringify(validTour())) as Tour;
}

function pathsOf(json: unknown): string[] {
  return validateTour(json).map((e) => e.path);
}

describe("validateTour — valid fixture", () => {
  it("passes with zero errors", () => {
    expect(validateTour(validTour())).toEqual([]);
  });

  it("passes after a JSON round-trip (what the CLI actually sees)", () => {
    expect(validateTour(JSON.parse(JSON.stringify(validTour())))).toEqual([]);
  });
});

describe("validateTour — document shape", () => {
  it("rejects non-object documents with a root-path error", () => {
    for (const doc of [null, [], "tour", 42]) {
      const errors = validateTour(doc);
      expect(errors).toHaveLength(1);
      expect(errors[0].path).toBe("");
    }
  });

  it("collects ALL errors in one pass (agent fixes everything in one retry)", () => {
    const t = clone() as unknown as Record<string, unknown>;
    delete t.meta;
    delete t.coverage;
    const paths = pathsOf(t);
    expect(paths).toContain("meta");
    expect(paths).toContain("coverage");
  });
});

describe("validateTour — per-section missing/wrong-typed", () => {
  it.each([
    "meta",
    "fullDiff",
    "orientation",
    "changeMap",
    "decisions",
    "stops",
    "trails",
    "blastRadius",
    "coverage",
  ])("missing %s produces a typed error at that path", (key) => {
    const t = clone() as unknown as Record<string, unknown>;
    delete t[key];
    expect(pathsOf(t)).toContain(key);
  });

  it("empty fullDiff is rejected (there is nothing to tour)", () => {
    const t = clone();
    t.fullDiff = "   ";
    expect(pathsOf(t)).toContain("fullDiff");
  });

  it("meta without title/hash errors on both", () => {
    const t = clone();
    (t.meta as unknown as Record<string, unknown>).title = "";
    delete (t.meta as unknown as Record<string, unknown>).hash;
    const paths = pathsOf(t);
    expect(paths).toContain("meta.title");
    expect(paths).toContain("meta.hash");
  });

  it("meta numeric fields reject strings", () => {
    const t = clone();
    (t.meta as unknown as Record<string, unknown>).additions = "10";
    expect(pathsOf(t)).toContain("meta.additions");
  });

  it("orientation requires summary/readingOrder/timeBoxed/flagIndex/standingPriorities", () => {
    const t = clone();
    t.orientation = {} as never;
    const paths = pathsOf(t);
    for (const k of [
      "orientation.summary",
      "orientation.readingOrder",
      "orientation.timeBoxed",
      "orientation.flagIndex",
      "orientation.standingPriorities",
    ]) {
      expect(paths).toContain(k);
    }
  });

  it("changeMap weight outside core|supporting|mechanical|tests is rejected", () => {
    const t = clone();
    (t.changeMap[0] as unknown as Record<string, unknown>).weight = "huge";
    const errors = validateTour(t);
    const e = errors.find((x) => x.path === "changeMap[0].weight");
    expect(e).toBeDefined();
    expect(e?.message).toContain("core|supporting|mechanical|tests");
  });

  it("changeMap stop references must resolve to a real stop", () => {
    const t = clone();
    t.changeMap[0].stops = [99];
    expect(pathsOf(t)).toContain("changeMap[0].stops[0]");
  });

  it("stop priority outside must|should|skim is rejected", () => {
    const t = clone();
    (t.stops[0] as unknown as Record<string, unknown>).priority = "critical";
    expect(pathsOf(t)).toContain("stops[0].priority");
  });

  it("duplicate stop ids are rejected", () => {
    const t = clone();
    t.stops[1].id = 1;
    expect(pathsOf(t)).toContain("stops[1].id");
  });

  it("stop diff must be a string (empty allowed for doc-only stops)", () => {
    const t = clone();
    delete (t.stops[0] as unknown as Record<string, unknown>).diff;
    expect(pathsOf(t)).toContain("stops[0].diff");
    const t2 = clone();
    t2.stops[0].diff = "";
    expect(pathsOf(t2)).not.toContain("stops[0].diff");
  });

  it("decision without where is rejected (path:line is the deep-link contract)", () => {
    const t = clone();
    delete (t.decisions[0] as unknown as Record<string, unknown>).where;
    expect(pathsOf(t)).toContain("decisions[0].where");
  });

  it("trail step status outside new|modified|unchanged is rejected", () => {
    const t = clone();
    (t.trails[0].steps[0] as unknown as Record<string, unknown>).status =
      "verified";
    expect(pathsOf(t)).toContain("trails[0].steps[0].status");
  });

  it("empty trail steps are rejected; empty trails array is fine", () => {
    const t = clone();
    t.trails[0].steps = [];
    expect(pathsOf(t)).toContain("trails[0].steps");
    const t2 = clone();
    t2.trails = [];
    expect(validateTour(t2)).toEqual([]);
  });

  it("coverage rows must reference real stops", () => {
    const t = clone();
    t.coverage.rows[0].stop = "42";
    expect(pathsOf(t)).toContain("coverage.rows[0].stop");
  });
});

describe("validateTour — NO mermaid (v1 contract)", () => {
  it("rejects a mermaid field on a trail with a pointed message", () => {
    const t = clone();
    (t.trails[0] as unknown as Record<string, unknown>).mermaid =
      "sequenceDiagram\n  A->>B: call";
    const errors = validateTour(t);
    const e = errors.find((x) => x.path === "trails[0].mermaid");
    expect(e).toBeDefined();
    expect(e?.message).toContain("step tables");
  });
});

describe("validateTour — NO severities (the tour presents and points)", () => {
  it("rejects a severity key on a stop", () => {
    const t = clone();
    (t.stops[0] as unknown as Record<string, unknown>).severity = "HIGH";
    const errors = validateTour(t);
    const e = errors.find((x) => x.path === "stops[0].severity");
    expect(e).toBeDefined();
    expect(e?.message).toContain("forbidden");
  });

  it("rejects severity keys at ANY depth (nested objects + arrays)", () => {
    const t = clone() as unknown as Record<string, unknown>;
    (t.blastRadius as Record<string, unknown>).severities = ["low"];
    const errors = validateTour(t);
    expect(errors.some((e) => e.path === "blastRadius.severities")).toBe(true);
  });

  it("severity flag values are rejected through the flag vocabulary", () => {
    const t = clone();
    (t.stops[0].flags as unknown as string[]).push("severity:high");
    expect(pathsOf(t)).toContain("stops[0].flags[1]");
  });

  it("does NOT flag the word 'severity' inside prose narration", () => {
    const t = clone();
    t.stops[0].narration =
      "This module deliberately has no severity concept anywhere.";
    expect(validateTour(t)).toEqual([]);
  });
});

describe("TOUR_JSON_SCHEMA — stays in lockstep with the validator vocabularies", () => {
  it("enums in the schema object match the exported constants", () => {
    const schema = TOUR_JSON_SCHEMA as unknown as {
      properties: Record<string, unknown>;
    };
    const changeMap = schema.properties.changeMap as {
      items: { properties: { weight: { enum: string[] } } };
    };
    expect(changeMap.items.properties.weight.enum).toEqual([...TOUR_WEIGHTS]);
    const stops = schema.properties.stops as {
      items: {
        properties: {
          priority: { enum: string[] };
          flags: { items: { enum: string[] } };
        };
      };
    };
    expect(stops.items.properties.priority.enum).toEqual([...TOUR_PRIORITIES]);
    expect(stops.items.properties.flags.items.enum).toEqual([...TOUR_FLAGS]);
    const trails = schema.properties.trails as {
      items: {
        properties: {
          steps: { items: { properties: { status: { enum: string[] } } } };
        };
      };
    };
    expect(
      trails.items.properties.steps.items.properties.status.enum,
    ).toEqual([...TRAIL_STEP_STATUSES]);
  });

  it("trails schema declares additionalProperties:false (the no-mermaid pin)", () => {
    const schema = TOUR_JSON_SCHEMA as unknown as {
      properties: { trails: { items: Record<string, unknown> } };
    };
    expect(schema.properties.trails.items.additionalProperties).toBe(false);
    expect(
      Object.keys(
        schema.properties.trails.items.properties as Record<string, unknown>,
      ),
    ).not.toContain("mermaid");
  });
});

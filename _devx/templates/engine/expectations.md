# Expectations — <workstream title>

<!-- Gate 1 input. Minimum 3 E-blocks (config: engine.expectations_min).
     Every business goal (G-) must be covered by at least one expectation;
     every Covers: ID must resolve in prd.md. EARS regex enforced by
     `devx gate prd`: "When .+, the system SHALL .+". A P0 with a vague
     Verified-by target fails the gate. `Measure:` is the command
     `devx outcome score --run` executes weeks later to score a numeric G-;
     name one (or a `metric` step in an evals/E-*.md manifest) on every
     expectation covering one, or Gate 1 warns. -->

## E-1: <human-readable name>

- **Priority:** <P0 | P1 | P2 | P3>
- **Covers:** <PRD item IDs, e.g. `G-2, UC-1, FR-3`>
- **Trigger:** <input shape>
- **Expectation (EARS):** When <trigger>, the system SHALL <behavior>.
- **Threshold:** <measurable — e.g. "p95 latency < 8s">
- **Verified by:** <concrete runnable target — test path or evals/E-1_<slug>.md>
- **Measure:** `<command printing the value>` · window: <e.g. trailing 30d>

## E-2: <name>

- **Priority:**
- **Covers:**
- **Trigger:**
- **Expectation (EARS):** When <trigger>, the system SHALL <behavior>.
- **Threshold:**
- **Verified by:**

## E-3: <name>

- **Priority:**
- **Covers:**
- **Trigger:**
- **Expectation (EARS):** When <trigger>, the system SHALL <behavior>.
- **Threshold:**
- **Verified by:**

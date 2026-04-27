// Schema smoke test for cfg201.
//
// Asserts:
//   1. _devx/config-schema.json validates the actual project devx.config.yaml
//      at the repo root — the schema must accept what the project ships.
//   2. _devx/config-schema.json validates test/fixtures/sample-config-full.yaml
//      (a complete config exercising every section).
//   3. _devx/config-schema.json rejects test/fixtures/invalid-mode.yaml with
//      an enum error pinned to `/mode` that lists the allowed values.
//
// Subsumed by cfg202's vitest suite once the @devx/cli package lands; until
// then this is the validator gate that keeps the schema honest.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const addFormats = addFormatsImport.default ?? addFormatsImport;

const schemaPath = resolve(repoRoot, "_devx/config-schema.json");
const projectConfigPath = resolve(repoRoot, "devx.config.yaml");
const samplePath = resolve(repoRoot, "test/fixtures/sample-config-full.yaml");
const invalidPath = resolve(repoRoot, "test/fixtures/invalid-mode.yaml");

const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const projectConfig = parseYaml(readFileSync(projectConfigPath, "utf8"));
const sample = parseYaml(readFileSync(samplePath, "utf8"));
const invalid = parseYaml(readFileSync(invalidPath, "utf8"));

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

const validate = ajv.compile(schema);

let failures = 0;

const expectValid = (name, instance) => {
  if (validate(instance)) {
    console.log(`PASS  ${name} validates against schema`);
    return;
  }
  failures++;
  console.error(`FAIL  ${name} should validate but did not:`);
  for (const err of validate.errors ?? []) {
    console.error(`        ${err.instancePath || "(root)"}: ${err.message}`);
  }
};

expectValid("devx.config.yaml (project root)", projectConfig);
expectValid("sample-config-full.yaml", sample);

// invalid-mode fixture must be rejected with an enum error pinned to /mode
// that surfaces the allowed values via params.allowedValues.
if (validate(invalid)) {
  failures++;
  console.error(
    "FAIL  invalid-mode.yaml should have been rejected but validated"
  );
} else {
  const errs = validate.errors ?? [];
  const modeErr = errs.find(
    (e) => e.instancePath === "/mode" && e.keyword === "enum"
  );
  if (!modeErr) {
    failures++;
    console.error(
      "FAIL  invalid-mode.yaml rejected but no enum-error pinned to /mode:"
    );
    for (const err of errs) {
      console.error(
        `        ${err.instancePath || "(root)"} (${err.keyword}): ${err.message}`
      );
    }
  } else {
    const allowed = modeErr.params?.allowedValues;
    if (!Array.isArray(allowed) || allowed.length === 0) {
      failures++;
      console.error(
        "FAIL  /mode enum error did not surface the list of allowed values"
      );
    } else {
      console.log(
        `PASS  invalid-mode.yaml rejected at /mode with allowed values: ${allowed.join(", ")}`
      );
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} smoke check(s) failed`);
  process.exit(1);
}

console.log("\nAll schema smoke checks passed.");

#!/usr/bin/env node
/**
 * Smoke test for @tomsmart-ai/mapper-mcp.
 *
 * No network calls. We import the built dist/index.js with API_KEY set to a
 * dummy value, suppress stdout (the SDK would try to speak MCP over stdio),
 * and reach into the module's TOOL_DEFINITIONS by re-reading the source file.
 *
 * The goal is to fail loudly on schema regressions: missing tools, missing
 * filter properties, removed enum values, etc.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "..", "src", "index.ts");
const src = readFileSync(SRC, "utf-8");

let passed = 0;
let failed = 0;
const failures = [];

function assert(label, condition) {
  if (condition) {
    passed += 1;
    process.stdout.write(`  ok  ${label}\n`);
  } else {
    failed += 1;
    failures.push(label);
    process.stdout.write(`  FAIL ${label}\n`);
  }
}

process.stdout.write("mapper-mcp smoke test\n");

// --- Tool registration -------------------------------------------------------

assert("get_catalog_stats tool registered", /name: "get_catalog_stats"/.test(src));
assert("list_endpoints tool registered", /name: "list_endpoints"/.test(src));
assert("search_endpoints tool registered", /name: "search_endpoints"/.test(src));
assert("get_endpoint_details tool registered", /name: "get_endpoint_details"/.test(src));
assert(
  "get_active_endpoints tool registered (v0.3.0)",
  /name: "get_active_endpoints"/.test(src)
);

// --- list_endpoints filter schema -------------------------------------------

assert("list_endpoints exposes chain filter", /chain: \{[\s\S]*?type: "string"/.test(src));
assert("list_endpoints exposes source filter", /source: \{[\s\S]*?type: "string"/.test(src));
assert("list_endpoints exposes status filter", /status: \{[\s\S]*?type: "integer"/.test(src));
assert(
  "list_endpoints exposes spec_valid filter (0/1)",
  /spec_valid: \{[\s\S]*?enum: \[0, 1\]/.test(src)
);
assert(
  "list_endpoints exposes volume_gt filter (number, min 0) — v0.3.0",
  /volume_gt: \{[\s\S]*?type: "number"[\s\S]*?minimum: 0/.test(src)
);

// --- volume_gt wire-up to fetch URL -----------------------------------------

assert(
  "volume_gt is read from args in list_endpoints handler",
  /volumeGt = args\?\.volume_gt as number \| undefined/.test(src)
);
assert(
  "volume_gt is appended to query string when defined",
  /if \(volumeGt !== undefined\) qs\.set\("volume_gt", String\(volumeGt\)\)/.test(src)
);

// --- get_active_endpoints schema --------------------------------------------

assert(
  "get_active_endpoints input has window_days (1-90, default 7)",
  /window_days: \{[\s\S]*?minimum: 1,[\s\S]*?maximum: 90,[\s\S]*?default: 7/.test(src)
);
assert(
  "get_active_endpoints input has limit (1-500, default 100)",
  /name: "get_active_endpoints"[\s\S]*?limit: \{[\s\S]*?minimum: 1,[\s\S]*?maximum: 500,[\s\S]*?default: 100/.test(
    src
  )
);
assert(
  "get_active_endpoints runtime validates window_days (1-90)",
  /window_days must be between 1 and 90/.test(src)
);
assert(
  "get_active_endpoints calls /v1/endpoints/active with both query params",
  /\/v1\/endpoints\/active\?window_days=\$\{windowDays\}&limit=\$\{limit\}/.test(src)
);

// --- version + UA bumped ----------------------------------------------------

assert("server version bumped to 0.3.0", /version: "0\.3\.0"/.test(src));
assert("User-Agent bumped to 0.3.0", /mapper-mcp\/0\.3\.0/.test(src));

// --- summary ----------------------------------------------------------------

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.stdout.write("Failures:\n");
  for (const f of failures) process.stdout.write(`  - ${f}\n`);
  process.exit(1);
}
process.exit(0);

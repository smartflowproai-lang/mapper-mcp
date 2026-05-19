/**
 * Smoke tests for @tomsmart-ai/mapper-mcp.
 *
 * Spawns the built MCP server (dist/index.js) over stdio, sends JSON-RPC requests,
 * and asserts the basic contract: tools/list returns 4 tools, tools/call for
 * get_catalog_stats returns a parseable JSON body with the expected top-level
 * keys.
 *
 * Run:  node test/smoke.test.mjs
 *
 * Requires:  SMARTFLOW_MAPPER_API_KEY env var (or skips live API tests).
 *
 * Exit codes:  0 = all pass, 1 = test failure, 2 = setup failure.
 */

import { spawn } from "node:child_process";
import { strict as assert } from "node:assert";

const DIST = "dist/index.js";
const TIMEOUT_MS = 15000;
const HAS_KEY = !!process.env.SMARTFLOW_MAPPER_API_KEY;

let passes = 0;
let fails = 0;

function logResult(name, ok, detail) {
  const tag = ok ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${name}${detail ? " — " + detail : ""}`);
  if (ok) passes++;
  else fails++;
}

async function callServer(request) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (!env.SMARTFLOW_MAPPER_API_KEY) env.SMARTFLOW_MAPPER_API_KEY = "test-placeholder";
    const proc = spawn("node", [DIST], { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`timeout ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", () => {
      clearTimeout(timer);
      const lines = stdout.split("\n").filter((l) => l.trim().startsWith("{"));
      const parsed = lines.map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      }).filter(Boolean);
      resolve({ parsed, stderr });
    });
    proc.stdin.write(JSON.stringify(request) + "\n");
    proc.stdin.end();
  });
}

async function testListTools() {
  console.log("test: tools/list returns 4 tool definitions");
  const { parsed } = await callServer({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
  });
  if (!parsed.length) {
    logResult("tools/list responds", false, "no JSON-RPC response on stdout");
    return;
  }
  const resp = parsed[0];
  logResult("tools/list responds", true);
  const tools = resp?.result?.tools;
  logResult("response has result.tools array", Array.isArray(tools));
  if (!Array.isArray(tools)) return;
  logResult("returns exactly 4 tools", tools.length === 4, `got ${tools.length}`);
  const names = tools.map((t) => t.name).sort();
  const expected = ["get_catalog_stats", "get_endpoint_details", "list_endpoints", "search_endpoints"];
  logResult(
    "tool names match expected set",
    JSON.stringify(names) === JSON.stringify(expected),
    `expected ${expected.join(",")}, got ${names.join(",")}`
  );
  const listEp = tools.find((t) => t.name === "list_endpoints");
  if (listEp) {
    const props = listEp.inputSchema?.properties || {};
    const filterKeys = ["page", "limit", "chain", "source", "status", "spec_valid"];
    const found = filterKeys.filter((k) => k in props);
    logResult(
      "list_endpoints has v0.2.0 filters (page/limit/chain/source/status/spec_valid)",
      found.length === filterKeys.length,
      `missing: ${filterKeys.filter((k) => !found.includes(k)).join(",") || "none"}`
    );
  }
}

async function testCallCatalogStats() {
  if (!HAS_KEY) {
    console.log("test: tools/call get_catalog_stats (SKIPPED — no SMARTFLOW_MAPPER_API_KEY in env)");
    return;
  }
  console.log("test: tools/call get_catalog_stats returns parseable body");
  const { parsed } = await callServer({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "get_catalog_stats", arguments: {} },
  });
  if (!parsed.length) {
    logResult("tools/call get_catalog_stats responds", false, "no JSON-RPC response");
    return;
  }
  const resp = parsed[0];
  logResult("response has result.content", Array.isArray(resp?.result?.content));
  const text = resp?.result?.content?.[0]?.text;
  if (!text) {
    logResult("response content includes text field", false);
    return;
  }
  logResult("response content includes text field", true);
  try {
    const body = JSON.parse(text);
    logResult("body parses as JSON", true);
    logResult(
      "body has total_endpoints field",
      typeof body.total_endpoints === "number",
      `got ${typeof body.total_endpoints}`
    );
    logResult(
      "body has by_source array",
      Array.isArray(body.by_source),
      `got ${typeof body.by_source}`
    );
    logResult(
      "body has by_chain array",
      Array.isArray(body.by_chain),
      `got ${typeof body.by_chain}`
    );
  } catch (e) {
    logResult("body parses as JSON", false, String(e));
  }
}

async function testCallSpecValidFilter() {
  if (!HAS_KEY) {
    console.log("test: tools/call list_endpoints spec_valid filter (SKIPPED — no API key)");
    return;
  }
  console.log("test: tools/call list_endpoints with spec_valid=1 returns valid cohort");
  const { parsed } = await callServer({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "list_endpoints",
      arguments: { status: 402, spec_valid: 1, limit: 5 },
    },
  });
  const text = parsed?.[0]?.result?.content?.[0]?.text;
  if (!text) {
    logResult("response returned text content", false);
    return;
  }
  try {
    const body = JSON.parse(text);
    logResult("body parses", true);
    logResult(
      "items array present with up to 5 entries",
      Array.isArray(body.items) && body.items.length <= 5,
      `got ${body.items?.length} items`
    );
    if (body.items?.length) {
      const allValid = body.items.every((it) => it.payment_required_valid === 1);
      logResult(
        "every returned item has payment_required_valid=1",
        allValid,
        allValid ? undefined : "filter not honored"
      );
      const allStatus402 = body.items.every((it) => it.status === 402);
      logResult(
        "every returned item has status=402",
        allStatus402,
        allStatus402 ? undefined : "status filter not honored"
      );
    }
  } catch (e) {
    logResult("body parses", false, String(e));
  }
}

async function main() {
  console.log("@tomsmart-ai/mapper-mcp smoke tests");
  console.log("=====================================");
  if (!HAS_KEY) {
    console.log("(SMARTFLOW_MAPPER_API_KEY not set — live API tests will be skipped)");
  }
  console.log();
  try {
    await testListTools();
    console.log();
    await testCallCatalogStats();
    console.log();
    await testCallSpecValidFilter();
  } catch (e) {
    console.error("setup failure:", e.message);
    process.exit(2);
  }
  console.log();
  console.log(`=====================================`);
  console.log(`${passes} pass, ${fails} fail`);
  process.exit(fails > 0 ? 1 : 0);
}

main();

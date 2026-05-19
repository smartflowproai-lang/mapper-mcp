#!/usr/bin/env node
/**
 * @tomsmart-ai/mapper-mcp
 *
 * MCP server exposing the SmartFlow x402 endpoint catalogue
 * (https://smartflowproai.com/catalog) over the Model Context Protocol.
 *
 * Tools
 *   - get_catalog_stats        : aggregate counts (total, by registry source)
 *   - list_endpoints           : paginated catalogue browse with optional filters
 *   - search_endpoints         : text search over URL / source / category
 *   - get_endpoint_details     : single endpoint detail
 *   - get_active_endpoints     : endpoints seen within last N days (1-90)
 *
 * Auth
 *   Set SMARTFLOW_MAPPER_API_KEY in the environment. Free-tier keys are
 *   issued at https://smartflowproai.com/catalog#access (100 req/day).
 *
 * Optional
 *   SMARTFLOW_MAPPER_BASE_URL  override base URL (default
 *                              https://api.smartflowproai.com)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";

const BASE_URL =
  process.env.SMARTFLOW_MAPPER_BASE_URL ?? "https://api.smartflowproai.com";
const API_KEY = process.env.SMARTFLOW_MAPPER_API_KEY ?? "";

if (!API_KEY) {
  process.stderr.write(
    "[mapper-mcp] SMARTFLOW_MAPPER_API_KEY env var is required. " +
      "Register a free key at https://smartflowproai.com/catalog#access.\n"
  );
}

const TOOL_DEFINITIONS = [
  {
    name: "get_catalog_stats",
    description:
      "Aggregate counts over the full SmartFlow x402 endpoint catalogue: " +
      "total endpoints, spec-valid (payment_required_valid=1) count, and " +
      "breakdown by registry source (402index, well-known-discovery, " +
      "Coinbase Bazaar, x402scan, apiosk-catalog, and others).",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_endpoints",
    description:
      "Paginated browse over the catalogue with optional filters. Returns " +
      "endpoint records with URL, registry source, declared chain/network, " +
      "HTTP probe status, first/last seen timestamps, the strict x402 v2 " +
      "spec-validity flag (payment_required_valid), and on-chain payment " +
      "metadata where available. Common patterns: filter by status=402 to " +
      "narrow to paid endpoints; combine with spec_valid=1 to get only " +
      "endpoints that emit a strict v2 schema body (11.5k of 13k as of the " +
      "2026-05-19 sweep). Use search_endpoints instead when you have a text query.",
    inputSchema: {
      type: "object",
      properties: {
        page: {
          type: "integer",
          minimum: 1,
          default: 1,
          description: "1-indexed page number (default 1).",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          default: 25,
          description: "Items per page (1-100, default 25).",
        },
        chain: {
          type: "string",
          description:
            "Filter by declared chain or network — accepts both formats. " +
            "Examples: 'eip155:8453' or 'Base' (Base mainnet), 'solana', " +
            "'Lightning', 'Tempo', 'Base Sepolia'.",
        },
        source: {
          type: "string",
          description:
            "Filter by registry source substring (LIKE-match). " +
            "Examples: 'bazaar' (Coinbase Bazaar), '402index', 'x402scan', " +
            "'apiosk-catalog', 'well-known-discovery'.",
        },
        status: {
          type: "integer",
          description:
            "Filter by last HTTP probe status code. Common: 402 (paid), " +
            "200 (alive landing), 404 (dead), 0 (probe timeout/error).",
        },
        spec_valid: {
          type: "integer",
          enum: [0, 1],
          description:
            "Filter by strict x402 v2 schema validity flag. 1 = body validates " +
            "(accepts[] array with scheme + network + payTo + maxAmountRequired); " +
            "0 = HTTP 402 returned but body is non-compliant.",
        },
        volume_gt: {
          type: "number",
          minimum: 0,
          description:
            "Filter by on_chain_volume_usdc > X (USDC float). Returns only " +
            "endpoints whose observed on-chain USDC payment volume strictly " +
            "exceeds the threshold. Useful for surfacing high-traffic endpoints.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "search_endpoints",
    description:
      "Text search over the catalogue across URL, declared chain, and " +
      "registry source. Use when an agent is looking for endpoints that " +
      "mention a specific provider, domain fragment, or chain identifier. " +
      "Search is substring-matched (case-insensitive).",
    inputSchema: {
      type: "object",
      properties: {
        q: {
          type: "string",
          minLength: 1,
          description: "Search string (e.g. 'cdp', 'lightning', 'asterpay').",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          default: 25,
          description: "Maximum items to return (1-100, default 25).",
        },
      },
      required: ["q"],
      additionalProperties: false,
    },
  },
  {
    name: "get_endpoint_details",
    description:
      "Fetch the full record for a single endpoint by URL: registry source, " +
      "declared chain/network, HTTP probe history, response shape, asset " +
      "address, payment-required amount/token, on-chain payment counts and " +
      "wallet, TLS issuer, and discovery provenance.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          format: "uri",
          description:
            "Full endpoint URL as it appears in the catalogue " +
            "(e.g. 'https://x402.quickintel.io/v1/scan/full').",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "get_active_endpoints",
    description:
      "Return the cohort of endpoints seen within the last N days, ordered " +
      "by last_seen DESC. Useful for tracking which endpoints in the " +
      "catalogue are currently alive vs. stale. The catalogue is re-probed " +
      "regularly; last_seen is the timestamp of the most recent successful " +
      "probe. Window is 1-90 days (default 7).",
    inputSchema: {
      type: "object",
      properties: {
        window_days: {
          type: "integer",
          minimum: 1,
          maximum: 90,
          default: 7,
          description:
            "Look-back window in days (1-90, default 7). Endpoints with " +
            "last_seen >= now - window_days are returned.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 500,
          default: 100,
          description: "Maximum endpoints to return (1-500, default 100).",
        },
      },
      additionalProperties: false,
    },
  },
] as const;

const server = new Server(
  {
    name: "@tomsmart-ai/mapper-mcp",
    version: "0.3.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_DEFINITIONS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

async function callMapperApi(path: string): Promise<unknown> {
  if (!API_KEY) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      "SMARTFLOW_MAPPER_API_KEY env var is not set. Register a free key at " +
        "https://smartflowproai.com/catalog#access."
    );
  }
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: {
      "X-API-Key": API_KEY,
      Accept: "application/json",
      "User-Agent": "@tomsmart-ai/mapper-mcp/0.3.0",
    },
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { detail: text };
  }
  if (!res.ok) {
    const detail =
      (body as { detail?: string } | null)?.detail ?? `HTTP ${res.status}`;
    if (res.status === 401) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `mapper-api auth rejected: ${detail}. Verify SMARTFLOW_MAPPER_API_KEY.`
      );
    }
    if (res.status === 429) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `mapper-api rate limit reached: ${detail}. Free tier is 100 req/day; ` +
          "upgrade tier at https://smartflowproai.com/catalog#tiers."
      );
    }
    throw new McpError(
      ErrorCode.InternalError,
      `mapper-api error (HTTP ${res.status}): ${detail}`
    );
  }
  return body;
}

function urlSafeBase64(input: string): string {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "get_catalog_stats": {
      const data = await callMapperApi("/v1/stats");
      return {
        content: [
          { type: "text", text: JSON.stringify(data, null, 2) },
        ],
      };
    }
    case "list_endpoints": {
      const page = (args?.page as number | undefined) ?? 1;
      const limit = (args?.limit as number | undefined) ?? 25;
      const chain = args?.chain as string | undefined;
      const source = args?.source as string | undefined;
      const status = args?.status as number | undefined;
      const specValid = args?.spec_valid as number | undefined;
      const volumeGt = args?.volume_gt as number | undefined;
      const qs = new URLSearchParams();
      qs.set("page", String(page));
      qs.set("limit", String(limit));
      if (chain) qs.set("chain", chain);
      if (source) qs.set("source", source);
      if (status !== undefined) qs.set("status", String(status));
      if (specValid !== undefined) qs.set("spec_valid", String(specValid));
      if (volumeGt !== undefined) qs.set("volume_gt", String(volumeGt));
      const data = await callMapperApi(`/v1/endpoints?${qs.toString()}`);
      return {
        content: [
          { type: "text", text: JSON.stringify(data, null, 2) },
        ],
      };
    }
    case "search_endpoints": {
      const q = args?.q as string | undefined;
      const limit = (args?.limit as number | undefined) ?? 25;
      if (!q) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "search_endpoints requires a non-empty 'q' string."
        );
      }
      const data = await callMapperApi(
        `/v1/endpoints/search?q=${encodeURIComponent(q)}&limit=${limit}`
      );
      return {
        content: [
          { type: "text", text: JSON.stringify(data, null, 2) },
        ],
      };
    }
    case "get_endpoint_details": {
      const url = args?.url as string | undefined;
      if (!url) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "get_endpoint_details requires a 'url' string."
        );
      }
      const encoded = urlSafeBase64(url);
      const data = await callMapperApi(`/v1/endpoints/${encoded}`);
      return {
        content: [
          { type: "text", text: JSON.stringify(data, null, 2) },
        ],
      };
    }
    case "get_active_endpoints": {
      const windowDays = (args?.window_days as number | undefined) ?? 7;
      const limit = (args?.limit as number | undefined) ?? 100;
      if (windowDays < 1 || windowDays > 90) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "get_active_endpoints: window_days must be between 1 and 90."
        );
      }
      if (limit < 1 || limit > 500) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "get_active_endpoints: limit must be between 1 and 500."
        );
      }
      const data = await callMapperApi(
        `/v1/endpoints/active?window_days=${windowDays}&limit=${limit}`
      );
      return {
        content: [
          { type: "text", text: JSON.stringify(data, null, 2) },
        ],
      };
    }
    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    "[mapper-mcp] server connected via stdio. Tools: " +
      TOOL_DEFINITIONS.map((t) => t.name).join(", ") +
      "\n"
  );
}

main().catch((err) => {
  process.stderr.write(`[mapper-mcp] fatal: ${String(err)}\n`);
  process.exit(1);
});

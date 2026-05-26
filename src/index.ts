#!/usr/bin/env node
/**
 * @tomsmart-ai/mapper-mcp
 *
 * MCP server exposing the SmartFlow x402 endpoint catalogue
 * (https://smartflowproai.com/catalog) over the Model Context Protocol.
 *
 * Tools
 *   - get_catalog_stats              : aggregate counts (total, by registry source)
 *   - list_endpoints                 : paginated catalogue browse with optional filters
 *   - search_endpoints               : text search over URL / source / category
 *   - get_endpoint_details           : single endpoint detail
 *   - get_active_endpoints           : endpoints seen within last N days (1-90)
 *   - get_chain_breakdown            : catalogue segmentation by chain/network
 *   - get_facilitator_breakdown      : actual facilitator-address aggregation (v0.5.0+)
 *   - get_facilitator_source_breakdown: legacy registry_source proxy (v0.4.0 alias)
 *   - risk_check                     : per-endpoint 0-100 risk score (v0.5.0+)
 *   - get_endpoint_lifecycle         : timeline + status transitions + zombie state (v0.6.0+)
 *   - get_facilitator_evolution      : registry growth + validity trends over time (v0.6.0+)
 *   - get_cohort_survival            : cohort tracking with status snapshot (v0.6.0+)
 *
 * Auth
 *   Set SMARTFLOW_MAPPER_API_KEY in the environment. Free-tier keys are
 *   issued at https://smartflowproai.com/catalog#access (100 req/day).
 *   Pro tier ($19/mo, 10k req/day) and Pro+ tier ($49/mo, 100k req/day) unlock
 *   real-time lifecycle queries, longer time windows, and cohort group_by.
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
  {
    name: "get_chain_breakdown",
    description:
      "Aggregate segmentation of the catalogue by declared chain/network. " +
      "Returns one row per chain with: total endpoint count, count of " +
      "endpoints currently returning HTTP 402 (paid + alive), and total " +
      "observed on-chain USDC payment volume. Useful for buyer agents that " +
      "need to size each chain's slice of the x402 economy before picking " +
      "where to deploy. Sorted by count DESC.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "get_facilitator_breakdown",
    description:
      "v0.5.0+: returns actual facilitator address aggregation joined from " +
      "payments.db. Each row is one facilitator wallet (tx_sender on USDC " +
      "x402 transfers) with: facilitator_address, facilitator_label (from " +
      "the on-chain labelled facilitators table when known, else 'unknown'), " +
      "tx_count (distinct tx hashes), distinct_recipients (distinct mapper- " +
      "catalogued endpoint wallets paid through this facilitator), and " +
      "total_volume_usdc. Joins payments.payments → mapper.endpoints on " +
      "to_wallet = on_chain_wallet (paid → catalogued endpoint), then " +
      "left-joins payments.facilitators on tx_sender = address for labels. " +
      "Top 100 by tx_count DESC. Supersedes the v0.4.0 registry_source proxy " +
      "(now exposed as get_facilitator_source_breakdown).",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "get_facilitator_source_breakdown",
    description:
      "Legacy v0.4.0 behaviour preserved as backwards-compatible alias: " +
      "aggregate segmentation by registry_source (discovery channel proxy — " +
      "402index, well-known-discovery, Coinbase Bazaar, x402scan, apiosk- " +
      "catalog, CDP Discord, direct crawl). This is NOT a facilitator wallet " +
      "breakdown; it segments the catalogue by where each endpoint was " +
      "discovered. Use get_facilitator_breakdown instead when you need the " +
      "actual on-chain facilitator address aggregation. Returns count + " +
      "total on-chain USDC volume per discovery source, sorted by count DESC, " +
      "capped at top 100. May be deprecated in a future major release.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "risk_check",
    description:
      "Compute a risk score (0-100) for a single x402 endpoint. Evaluates five " +
      "weighted factors: response shape consistency (25%), facilitator legitimacy " +
      "(25%), endpoint age (15%), payment volume pattern (20%), and strict x402 v2 " +
      "spec validity (15%). Lower score = lower risk. Returns per-factor breakdown " +
      "with detail strings and an overall confidence level (high/medium/low) based " +
      "on how many factors were assessable. Use this before routing payments to an " +
      "unfamiliar endpoint.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            "Full endpoint URL to assess " +
            "(e.g. 'https://x402.quickintel.io/v1/scan/full').",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "get_endpoint_lifecycle",
    description:
      "v0.6.0+: timeline for a single endpoint including status transitions, " +
      "performance trends, zombie-state flag, and registry-source attribution " +
      "history. Returns first_seen, last_seen, age_days, current_status, " +
      "consecutive_fails, status_transitions array (with timestamp + from/to " +
      "HTTP codes), and p50/p99 response time. Zombie state = status=402 + " +
      "consecutive_fails >= 25. Free tier: 14-day delayed transitions only. " +
      "Pro tier: real-time. Use this for endpoint forensics: 'when did this " +
      "endpoint last work', 'is it actually paying or stuck', 'has the " +
      "facilitator changed'.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          format: "uri",
          description: "Full canonical endpoint URL.",
        },
        resolution: {
          type: "string",
          enum: ["hourly", "daily"],
          default: "daily",
          description:
            "Time resolution for status_transitions and performance series. " +
            "'hourly' is Pro-only and limited to last 7 days. 'daily' (default) " +
            "is available on all tiers within the tier's retention window.",
        },
        max_events: {
          type: "integer",
          minimum: 1,
          maximum: 500,
          default: 100,
          description: "Maximum status_transitions events to return (1-500, default 100).",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "get_facilitator_evolution",
    description:
      "v0.6.0+: registry-source catalogue growth and spec-validity trends " +
      "over time. Returns time series segmented by registry_source (402index, " +
      "Coinbase Bazaar, apiosk-catalog, x402scan, etc.) with per-period " +
      "endpoint counts, strict_v2 valid counts, dead/zombie counts, and a " +
      "summary block highlighting the fastest-growing source + highest- " +
      "validity source for the window. Use this to spot 'which registry " +
      "added the most endpoints this month' or 'is Coinbase Bazaar's " +
      "strict-v2 validity rate dropping'. Free tier: last 30 days, weekly " +
      "resolution. Pro tier: up to 1 year, daily resolution.",
    inputSchema: {
      type: "object",
      properties: {
        start_date: {
          type: "string",
          format: "date",
          description:
            "ISO 8601 date (YYYY-MM-DD). Default: 30 days before end_date.",
        },
        end_date: {
          type: "string",
          format: "date",
          description:
            "ISO 8601 date (YYYY-MM-DD). Default: today.",
        },
        resolution: {
          type: "string",
          enum: ["daily", "weekly"],
          default: "weekly",
          description:
            "Time bucket resolution. 'daily' is Pro-only. 'weekly' (default) " +
            "is available on all tiers.",
        },
        registry_sources: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional filter to specific sources (e.g. ['402index','bazaar']). " +
            "Default: all known sources.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_cohort_survival",
    description:
      "v0.6.0+: cohort tracking. Given a date range, returns the cohort of " +
      "endpoints whose first_seen falls in that range, then reports their " +
      "status at the snapshot_date: how many still return 402 vs. 404 vs. " +
      "zombie vs. spec-valid. Optional group_by (provider / registry_source / " +
      "chain) breaks the cohort into sub-cohorts. Use this to answer 'how " +
      "many endpoints registered in April are still alive in June', or 'is " +
      "the cohort registered via Bazaar surviving better than the 402index " +
      "cohort'. Free tier: cohorts must be >= 30 days old. Pro tier: any " +
      "cohort age + group_by filter.",
    inputSchema: {
      type: "object",
      properties: {
        cohort_start: {
          type: "string",
          format: "date",
          description: "ISO 8601 date — first_seen >= cohort_start.",
        },
        cohort_end: {
          type: "string",
          format: "date",
          description: "ISO 8601 date — first_seen <= cohort_end.",
        },
        snapshot_date: {
          type: "string",
          format: "date",
          description:
            "ISO 8601 date — point-in-time to evaluate cohort status. Default: today.",
        },
        group_by: {
          type: "string",
          enum: ["provider", "registry_source", "chain"],
          description:
            "Optional sub-cohort grouping (Pro tier only). Without group_by, " +
            "returns a single aggregate status_at_snapshot block.",
        },
      },
      required: ["cohort_start", "cohort_end"],
      additionalProperties: false,
    },
  },
] as const;

const server = new Server(
  {
    name: "@tomsmart-ai/mapper-mcp",
    version: "0.6.0",
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
      "User-Agent": "@tomsmart-ai/mapper-mcp/0.6.0",
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
    if (res.status === 403) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `mapper-api tier-gated: ${detail}. This feature requires Pro or Pro+ ` +
          "tier. Upgrade at https://smartflowproai.com/catalog#tiers."
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
    case "get_chain_breakdown": {
      const data = await callMapperApi("/v1/breakdown/chain");
      return {
        content: [
          { type: "text", text: JSON.stringify(data, null, 2) },
        ],
      };
    }
    case "get_facilitator_breakdown": {
      const data = await callMapperApi("/v1/breakdown/facilitator");
      return {
        content: [
          { type: "text", text: JSON.stringify(data, null, 2) },
        ],
      };
    }
    case "get_facilitator_source_breakdown": {
      const data = await callMapperApi("/v1/breakdown/facilitator-source");
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
    case "risk_check": {
      const url = args?.url as string | undefined;
      if (!url) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "risk_check requires a 'url' string."
        );
      }
      const data = await callMapperApi(
        `/v1/risk-check?url=${encodeURIComponent(url)}`
      );
      return {
        content: [
          { type: "text", text: JSON.stringify(data, null, 2) },
        ],
      };
    }
    case "get_endpoint_lifecycle": {
      const url = args?.url as string | undefined;
      const resolution = (args?.resolution as string | undefined) ?? "daily";
      const maxEvents = (args?.max_events as number | undefined) ?? 100;
      if (!url) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "get_endpoint_lifecycle requires a 'url' string."
        );
      }
      if (resolution !== "hourly" && resolution !== "daily") {
        throw new McpError(
          ErrorCode.InvalidParams,
          "get_endpoint_lifecycle: resolution must be 'hourly' or 'daily'."
        );
      }
      if (maxEvents < 1 || maxEvents > 500) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "get_endpoint_lifecycle: max_events must be between 1 and 500."
        );
      }
      const qs = new URLSearchParams();
      qs.set("url", url);
      qs.set("resolution", resolution);
      qs.set("max_events", String(maxEvents));
      const data = await callMapperApi(`/v1/endpoints/lifecycle?${qs.toString()}`);
      return {
        content: [
          { type: "text", text: JSON.stringify(data, null, 2) },
        ],
      };
    }
    case "get_facilitator_evolution": {
      const startDate = args?.start_date as string | undefined;
      const endDate = args?.end_date as string | undefined;
      const resolution = (args?.resolution as string | undefined) ?? "weekly";
      const registrySources = args?.registry_sources as string[] | undefined;
      if (resolution !== "daily" && resolution !== "weekly") {
        throw new McpError(
          ErrorCode.InvalidParams,
          "get_facilitator_evolution: resolution must be 'daily' or 'weekly'."
        );
      }
      const qs = new URLSearchParams();
      if (startDate) qs.set("start_date", startDate);
      if (endDate) qs.set("end_date", endDate);
      qs.set("resolution", resolution);
      if (registrySources && registrySources.length > 0) {
        qs.set("registry_sources", registrySources.join(","));
      }
      const data = await callMapperApi(
        `/v1/breakdown/facilitator-evolution?${qs.toString()}`
      );
      return {
        content: [
          { type: "text", text: JSON.stringify(data, null, 2) },
        ],
      };
    }
    case "get_cohort_survival": {
      const cohortStart = args?.cohort_start as string | undefined;
      const cohortEnd = args?.cohort_end as string | undefined;
      const snapshotDate = args?.snapshot_date as string | undefined;
      const groupBy = args?.group_by as string | undefined;
      if (!cohortStart || !cohortEnd) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "get_cohort_survival requires 'cohort_start' and 'cohort_end' ISO dates."
        );
      }
      if (
        groupBy !== undefined &&
        groupBy !== "provider" &&
        groupBy !== "registry_source" &&
        groupBy !== "chain"
      ) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "get_cohort_survival: group_by must be 'provider', 'registry_source', or 'chain'."
        );
      }
      const qs = new URLSearchParams();
      qs.set("cohort_start", cohortStart);
      qs.set("cohort_end", cohortEnd);
      if (snapshotDate) qs.set("snapshot_date", snapshotDate);
      if (groupBy) qs.set("group_by", groupBy);
      const data = await callMapperApi(`/v1/cohort-survival?${qs.toString()}`);
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

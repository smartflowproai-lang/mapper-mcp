# @tomsmart-ai/mapper-mcp

> MCP server exposing the **SmartFlow x402 endpoint catalogue** to LLM agents — 58,800+ endpoints across Base, Solana, Lightning, Tempo, and other chains, sourced from Coinbase Bazaar, 402index, x402scan, apiosk, ERC-8004 registry, and direct crawl.

Drop this server into your Claude Code / Cursor / MCP-aware agent and it gains four tools for discovering and inspecting paid x402 endpoints on the public internet.

---

## Install

```bash
npm install -g @tomsmart-ai/mapper-mcp
```

Get a free API key (100 requests/day) at **https://smartflowproai.com/catalog#access**.

Set the key in your environment:

```bash
export SMARTFLOW_MAPPER_API_KEY="sk_live_..."
```

---

## Use with Claude Code

Add to `~/.claude.json` (or per-project `.mcp.json`):

```json
{
  "mcpServers": {
    "mapper": {
      "command": "mapper-mcp",
      "env": {
        "SMARTFLOW_MAPPER_API_KEY": "sk_live_..."
      }
    }
  }
}
```

## Use with Cursor / Continue / other MCP clients

Most MCP-aware clients accept a `command` + `env` configuration. The binary `mapper-mcp` runs an MCP server over stdio.

---

## Tools

### `get_catalog_stats`

Returns aggregate counts over the full catalogue: total endpoints, the spec-valid subset (endpoints whose `/.well-known/x402` body parses against the strict v2 schema), and breakdowns by registry source and declared chain.

No arguments. Single call returns the catalogue snapshot as JSON.

### `list_endpoints`

Paginated browse over the catalogue in registry order. Returns endpoint records with URL, registry source, declared chain/network, last HTTP probe status, first/last seen timestamps, and on-chain payment metadata where available.

| Arg | Type | Default | Notes |
|---|---|---|---|
| `page` | integer | 1 | 1-indexed |
| `limit` | integer | 25 | 1–100 |

Use this when you want to scroll the catalogue. Use `search_endpoints` when you have a text query.

### `search_endpoints`

Text search across URL, declared chain, and registry source. Case-insensitive substring match.

| Arg | Type | Required | Notes |
|---|---|---|---|
| `q` | string | yes | Search string (e.g. `cdp`, `lightning`, `asterpay`). |
| `limit` | integer | no (default 25) | 1–100. |

Useful for "show me everything that mentions Lightning" or "find endpoints from the Coinbase CDP discord seed".

### `get_endpoint_details`

Fetch the full record for a single endpoint by URL: registry source, declared chain/network, HTTP probe history, response shape, asset address, payment-required amount/token, on-chain payment counts and wallet, TLS issuer, and discovery provenance.

| Arg | Type | Required | Notes |
|---|---|---|---|
| `url` | string | yes | Full endpoint URL exactly as catalogued. |

---

## Example agent prompt

```
Use the mapper MCP server to find the five most recently catalogued x402 endpoints on Base mainnet, then for each one tell me whether it returns a spec-valid 402 body. Order by first_seen descending.
```

The agent will typically chain `list_endpoints` (or `search_endpoints` with `q="base"`) → filter on `network` → call `get_endpoint_details` on the top five. All calls go through your free-tier daily quota; check `used_today` and `daily_limit` in any response to monitor headroom.

---

## What's the catalogue?

The SmartFlow Mapper catalogue is a passive crawl of the public x402 surface — it lists every endpoint observed across Coinbase Bazaar, 402index, x402scan, apiosk, ERC-8004 registries, `/.well-known/x402` manifests on hosts seeded from those registries, and direct on-chain payment-receiver wallet expansion. The catalogue does **not** itself execute or pay against endpoints; it is a discovery index for agents and tooling.

Methodology, daily refresh schedule (04:00 UTC), and known gaps are documented at **https://smartflowproai.com/methodology/mycelia-widget**. Numbers in this README track the published catalogue snapshot and may drift between releases.

---

## Tiers

- **Free** — 100 requests/day, no wallet required. Register at the catalogue page.
- **Pro / Enterprise** — higher quotas + priority probe refresh + optional pre-publish drift alerts. Tier mechanics gated by a Hypersub subscription on Base; details on the catalogue page.

---

## Source + license

- Source: https://github.com/smartflowproai-lang/mapper-mcp
- License: MIT
- Operator: Tom Smart (@TomSmart_ai)
- Catalogue: https://smartflowproai.com/catalog

Issues, feature requests, and pull requests welcome. If you spot a bug or a missing tool, open an issue on the GitHub repo.

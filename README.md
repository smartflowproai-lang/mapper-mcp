# @tomsmart-ai/mapper-mcp

> MCP server exposing the **SmartFlow x402 endpoint catalogue** to LLM agents — 58,800+ endpoints across Base, Solana, Lightning, Tempo, and other chains, sourced from Coinbase Bazaar, 402index, x402scan, apiosk, ERC-8004 registry, and direct crawl.

Drop this server into your Claude Code / Cursor / MCP-aware agent and it gains nine tools for discovering, inspecting, and risk-assessing paid x402 endpoints on the public internet.

## What's new in v0.5.0

- **`get_facilitator_breakdown` now returns actual on-chain facilitator addresses.** The v0.4.0 implementation segmented the catalogue by `registry_source` (discovery channel proxy — 402index, Bazaar, etc.); v0.5.0 joins payments.db on `to_wallet = on_chain_wallet` and aggregates by `tx_sender → facilitators.address`. Each row exposes `facilitator_address`, `facilitator_label`, `tx_count`, `distinct_recipients`, and `total_volume_usdc`.
- **New tool: `get_facilitator_source_breakdown`** — preserves the v0.4.0 registry_source proxy behaviour as a backwards-compatible alias. Use it when you want the discovery-channel segmentation; use `get_facilitator_breakdown` when you want actual facilitator wallets.
- **Backend alias `/v1/breakdown/facilitator-source`** — same legacy proxy, exposed at a dedicated path so existing v0.4.0 integrations keep working.

## What's new in v0.4.0

- **New tool: `get_chain_breakdown`** — one row per declared chain/network with total count, count of endpoints currently returning HTTP 402, and total observed on-chain USDC volume. Lets a buyer agent size each chain's slice of the x402 economy in a single call.
- **New tool: `get_facilitator_breakdown`** — segmentation by registry/facilitator source (402index, well-known-discovery, Coinbase Bazaar, x402scan, apiosk-catalog, CDP Discord, direct crawl, …) with count + on-chain USDC volume per source. The catalogue tracks discovery source rather than live payment facilitator URL — this is the closest available proxy.

## What's new in v0.3.0

- **`list_endpoints` gains a `volume_gt` filter** — surface high-traffic endpoints by minimum observed on-chain USDC payment volume.
- **New tool: `get_active_endpoints`** — return the cohort of endpoints seen within the last N days (1–90, default 7), ordered by `last_seen` descending. Use it to track which endpoints are currently alive vs. stale without scrolling the full catalogue.

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
| `chain` | string | — | Filter by declared chain or network (e.g. `eip155:8453`, `Base`, `solana`). |
| `source` | string | — | Substring match against registry source (e.g. `bazaar`, `x402scan`). |
| `status` | integer | — | Last HTTP probe status (e.g. `402`, `200`, `404`). |
| `spec_valid` | integer (0/1) | — | Strict x402 v2 schema validity flag. |
| `volume_gt` | number | — | Endpoints with `on_chain_volume_usdc` strictly above the threshold (USDC float). |

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

### `get_active_endpoints`

Return the cohort of endpoints seen within the last N days, ordered by `last_seen` descending. Useful for tracking which endpoints in the catalogue are currently alive vs. stale.

| Arg | Type | Default | Notes |
|---|---|---|---|
| `window_days` | integer | 7 | 1–90. Endpoints with `last_seen >= now - window_days` are returned. |
| `limit` | integer | 100 | 1–500. |

Example: `get_active_endpoints({ window_days: 7 })` returns the most-recently-probed endpoints (cohort cap 100 per call).

### `get_chain_breakdown`

Aggregate segmentation of the catalogue by declared chain/network. One row per chain with total count, count of endpoints currently returning HTTP 402 (paid + alive), and total observed on-chain USDC volume. Sorted by count descending.

No arguments. Use to size each chain's slice of the x402 economy in a single call.

### `get_facilitator_breakdown`

Segmentation by registry/facilitator source — where each endpoint was discovered (402index, well-known-discovery, Coinbase Bazaar, x402scan, apiosk-catalog, CDP Discord, direct crawl, …). Returns count + total on-chain USDC volume per source, sorted by count descending, capped at the top 100.

No arguments. The catalogue tracks discovery source rather than live payment facilitator URL — this is the closest available proxy.

### `risk_check`

Compute a risk score (0–100) for a single endpoint. Evaluates five weighted factors:

| Factor | Weight | What it measures |
|---|---|---|
| Response shape consistency | 25% | Does the endpoint have a known, commonly-shared response shape hash? |
| Facilitator legitimacy | 25% | Is the endpoint paid through a labelled facilitator (e.g. Coinbase CDP)? |
| Endpoint age | 15% | How long has it been in the catalogue? |
| Payment volume | 20% | Does it have meaningful on-chain payment history? |
| Spec validity | 15% | Does it pass strict x402 v2 schema validation? |

Lower score = lower risk. Returns per-factor breakdown with detail strings and an overall confidence level (`high`/`medium`/`low`).

| Arg | Type | Required | Notes |
|---|---|---|---|
| `url` | string | yes | Full endpoint URL to assess. |

Example: `risk_check({ url: "https://x402.aubr.ai/api/chat" })` → `{ risk_score: 45, confidence: "high", risk_factors: [...] }`.

Use before routing payments to an unfamiliar endpoint.

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

# Changelog

All notable changes to `@tomsmart-ai/mapper-mcp` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] — 2026-06-14

### Added

- **`get_endpoint_lifecycle` tool** — timeline for a single endpoint: first_seen, last_seen, status_transitions[] (every HTTP status code change), zombie_state flag (status=402 + ≥25 consecutive_fails), performance percentiles (p50/p99 response time), registry attribution history. Free tier returns history ≥14 days old; Pro tier real-time.
- **`get_facilitator_evolution` tool** — registry-source growth + spec-validity trends over time. Time-bucketed series segmented by registry_source with per-period counts, validity rates, dead/zombie counts. Free tier: 30 days weekly. Pro tier: 1 year daily.
- **`get_cohort_survival` tool** — cohort tracking. Date-range cohort + snapshot date returns status breakdown (answers_402, dead_404, strict_v2_valid, zombie, other). Optional group_by (provider/registry_source/chain) on Pro tier.
- **Pro / Pro+ tier gating** via HTTP 403 with upgrade prompt when free-tier API key requests Pro-only features (real-time lifecycle, recent cohorts, group_by, daily evolution resolution).
- **Tier-aware error messages** point to https://hypersub.xyz/s/smartflow-mapper-pro for upgrade flow.

### Changed

- `package.json` version bump 0.5.0 → 0.6.0.
- `User-Agent` header now `@tomsmart-ai/mapper-mcp/0.6.0`.

### Backend dependencies

- `scan_log` table (mapper.db) introduced for status_transitions history. Crawler appends one row per probe. History begins at v0.6 deploy date (no pre-v0.6 backfill possible).
- Three new HTTP endpoints on `api.smartflowproai.com`:
  - `GET /v1/endpoints/lifecycle`
  - `GET /v1/breakdown/facilitator-evolution`
  - `GET /v1/cohort-survival`

### Notes

- v0.5 tools remain unchanged. Existing integrations continue to work without modification.
- Free tier rate limit remains 100 requests/day. Pro tier 10,000/day. Pro+ tier 100,000/day.
- Pro tier launches simultaneously with v0.6 release. Subscribe at https://hypersub.xyz/s/smartflow-mapper-pro

## [0.5.0] — 2026-05-19

### Added

- **`get_facilitator_breakdown` now returns actual on-chain facilitator addresses.** Joins payments.db on `to_wallet = on_chain_wallet` and aggregates by `tx_sender → facilitators.address`. Each row exposes facilitator_address, facilitator_label, tx_count, distinct_recipients, total_volume_usdc.
- **`get_facilitator_source_breakdown` tool** — preserves v0.4.0 registry_source proxy behaviour as backwards-compatible alias.
- **`risk_check` tool** — 0-100 risk score for a single x402 endpoint based on five weighted factors: response shape consistency (25%), facilitator legitimacy (25%), endpoint age (15%), payment volume pattern (20%), strict x402 v2 spec validity (15%). Returns per-factor breakdown with detail strings and overall confidence level (high/medium/low).

### Changed

- Backend route `/v1/breakdown/facilitator` returns new on-chain facilitator aggregation.
- Backend route `/v1/breakdown/facilitator-source` preserves v0.4.0 behaviour as legacy proxy.

## [0.4.0] — 2026-04-26

### Added

- **`get_chain_breakdown` tool** — segmentation by declared chain/network. One row per chain with total count, HTTP-402 count, total observed on-chain USDC volume.
- **`get_facilitator_breakdown` tool (initial)** — segmentation by registry/facilitator source. Count + on-chain USDC volume per source.

## [0.3.0] — 2026-04-18

### Added

- **`list_endpoints` gains `volume_gt` filter** — surface high-traffic endpoints by minimum observed on-chain USDC payment volume.
- **`get_active_endpoints` tool** — cohort of endpoints seen within last N days (1–90, default 7), ordered by last_seen descending.

## [0.2.0] — 2026-04-12

### Added

- **`search_endpoints` tool** — text search across URL, declared chain, and registry source. Substring-matched (case-insensitive).
- **`get_endpoint_details` tool** — fetch full record for a single endpoint by URL.

## [0.1.0] — 2026-04-08

### Initial release

- **`get_catalog_stats` tool** — aggregate counts over full catalogue: total endpoints, spec-valid subset, breakdowns by registry source and declared chain.
- **`list_endpoints` tool** — paginated browse with optional filters (chain, source, status, spec_valid).
- Free tier API key gating via `SMARTFLOW_MAPPER_API_KEY` env var.
- 100 requests/day rate limit for free tier.

[0.6.0]: https://github.com/smartflowproai-lang/mapper-mcp/releases/tag/v0.6.0
[0.5.0]: https://github.com/smartflowproai-lang/mapper-mcp/releases/tag/v0.5.0
[0.4.0]: https://github.com/smartflowproai-lang/mapper-mcp/releases/tag/v0.4.0
[0.3.0]: https://github.com/smartflowproai-lang/mapper-mcp/releases/tag/v0.3.0
[0.2.0]: https://github.com/smartflowproai-lang/mapper-mcp/releases/tag/v0.2.0
[0.1.0]: https://github.com/smartflowproai-lang/mapper-mcp/releases/tag/v0.1.0

# Changelog

## [0.2.0] — 2026-07-13

### Added
- **`/tools` endpoint**: List all active tools with pricing tiers and prices.
- **`/usage` endpoint**: Per-tool call counts and total calls for spending transparency.
- **`/pricing` endpoint**: Full pricing breakdown by tier with tool lists.
- **`/` root endpoint**: API info and endpoint directory.
- **5xx retry**: `fetchWithTimeout` now retries on HTTP 5xx server errors (not just 429).
- **Cost examples** in README: concrete pricing scenarios (100 web searches = $1.00, etc.).
- **Use cases section** in README: 7 workflow examples showing tool chains.
- **FAQ section** in README: 7 questions covering vs SerpAPI, free tier, error handling, etc.
- **`cached` field** in dataset schema: matches actual tool response format.
- **Pricing tier coverage tests**: verify every tool has a valid pricing tier.

### Changed
- **README rewritten** as conversion-optimized landing page: value proposition, hero stats table, "Why This Exists" section, API endpoints table.
- **actor.json description** optimized: 230-char compelling value proposition (was 517-char keyword list).
- **openapi.json requestBody**: now documents the `preset` parameter (was empty `properties: {}`).
- **Version bumped** to 0.2.0 across package.json, actor.json, main.ts, openapi.json.
- **Dockerfile**: added `NODE_ENV=production` for V8 optimizations in runtime stage.

### Fixed
- **Flaky `resurrectDeadLink` test**: switched to `httpstat.us/404` (guaranteed 404), accepts API-failure as valid outcome.
- **Removed inline comment** in main.ts catch block (violated no-comments rule).
- **MCP error responses** now include `requestId` for debugging.

## [0.1.1] — 2026-07-13 04:55 UTC

### Fixed
- **Pay-per-event billing**: `Actor.charge` now only fires on successful tool calls (no charge when tool returns `error` field). Aligns code with README/actor.json promise "pay only for successful calls".
- **SSRF protection hardened**: `validateUrl` now blocks decimal/octal/hex IP notations (e.g., `2130706433`, `0177.0.0.1`, `0x7f.0.0.1`) and IPv4-mapped IPv6 (`::ffff:127.0.0.1`). Previously only dotted-decimal and standard IPv6 forms were blocked.

### Added
- Pricing test suite (`tests/pricing.test.ts`): verifies no charge on error, charge on success with correct tier.
- Extended `validateUrl` tests covering all new bypass vectors.

## [0.1.0] — 2025-01

### Added
- 23 research tools across 4 categories (web, social, academic, specialized data)
- Tiered pricing: $0.01/$0.02/$0.03 per call
- Tool presets: web (6), social (9), academic (6), data (2), all (23)
- Usage analytics with per-tool call counting
- MCP protocol support (Claude Desktop, Cursor, ChatGPT, LangChain, LlamaIndex)
- Input schema for Apify Console preset selection
- 64 tests (33 core + 23 new tools + 8 integration)

### Security
- SSRF protection, input validation, rate limiting (60 req/min)
- User-Agent headers on all external API calls

# Changelog

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

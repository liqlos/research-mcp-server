# AGENTS.md — research-mcp-server

## Project

MCP server on Apify. 23 research tools for AI agents. TypeScript, Vitest, Zod schemas.

## State

- 23 tools, 64 tests, 0 TS errors
- Tiered pricing: $0.01 (simple), $0.02 (standard), $0.03 (premium)
- 5 presets: all, web, social, academic, data
- Converged after 8 improvement cycles (4 code + 4 CEO)

## Architecture

```
src/
  main.ts          — MCP server, tool registration, presets, pricing, analytics, Express
  tools/
    research.ts    — shared utils: withCache, fetchWithTimeout, CACHE_TTL_MS, ErrorCodes, validateUrl
    sec.ts         — SEC EDGAR filings
    citations.ts   — Crossref citation formatting
    verify.ts      — citation verification (Crossref + OpenAlex)
    batch_verify.ts— bibliography validation
    counterargs.ts — counter-argument finder (Semantic Scholar + OpenAlex)
    substack.ts    — Substack RSS
    bluesky.ts     — Bluesky AT Protocol
    telegram.ts    — Telegram t.me/s/ preview
    mastodon.ts    — Mastodon Fediverse
    vk.ts          — VKontakte API
    osm.ts         — OpenStreetMap Overpass
    trends.ts      — trend detection across platforms
    wayback.ts     — Wayback Machine
    reliability.ts — source reliability scoring
tests/
  research.test.ts   — 33 tests (core tools)
  new-tools.test.ts  — 23 tests (newer tools)
  integration.test.ts— 8 tests (MCP end-to-end)
```

## Commands

```bash
npm run build     # tsc
npm test          # vitest run
npx tsc --noEmit  # type check only
npm run start:dev # local dev
```

## Key Patterns

- All tools use `withCache(toolName, CACHE_TTL_MS.toolName, args, fn)` from research.ts
- All tools return `ToolResponse<T>` = `{ query, count, results, error? }`
- `fetchWithTimeout(url, opts, retries, useProxy)` — retry on 429, SSRF protection
- `registerResearchTool(name, config, handler)` — wrapper handles presets, analytics, pricing
- `toolPricingTier` map in main.ts routes each tool to charge event
- Cache TTLs centralized in `CACHE_TTL_MS` in research.ts — don't add local copies

## Constraints

- No comments in code (project rule)
- No new tools (23 is sufficient, converged)
- No external dependencies for analytics/caching — use built-in Map
- Free APIs only (no paid services unless user-provided keys)
- $0.05/call max budget per tool

## Converged Areas

Do NOT re-litigate these (rejected in cycles 1-8):
- Error handling standardization (ErrorCodes everywhere) — rejected, plain strings OK
- Per-tool rate limiting — global 60/min sufficient
- Split main.ts — 900 lines manageable, tools already modular
- Placeholder email replacement — fine for User-Agent
- New niche tools (clinical trials, patents, biodiversity, etc.)
- Regex→HTML parser migration — acceptable tradeoff
- API response schema validation — TS casts sufficient

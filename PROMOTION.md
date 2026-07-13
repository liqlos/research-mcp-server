# Promotion Materials

## Social Media Posts

### X/Twitter (280 chars)

Just shipped 23 research tools for AI agents in one MCP server 🔬

Web search, Reddit, YouTube, academic papers, SEC filings, citation verification, social media scanning — all from one endpoint.

Works with Claude, Cursor, ChatGPT.
From $0.01/call.

https://github.com/liqlos/research-mcp-server

### LinkedIn

Built an MCP server that gives AI agents 23 research tools through a single endpoint.

The problem: AI agents need real-time data from dozens of sources — web search, social media, academic papers, financial filings. Each source needs its own API integration, error handling, and rate limiting.

The solution: one MCP server, 23 tools, pay-per-call pricing starting at $0.01.

Tools include:
- Web search (DuckDuckGo + Google)
- Content extraction from any URL
- Reddit, YouTube, Hacker News, news
- arXiv preprints, datasets (Zenodo/Figshare/OSF)
- SEC EDGAR filings
- Citation verification (Crossref + OpenAlex)
- Source reliability scoring
- Bluesky, Telegram, Mastodon, VK, Substack
- OpenStreetMap POIs
- Trend detection across platforms
- Wayback Machine for dead links

Works with Claude Desktop, Cursor, ChatGPT, LangChain, and any MCP client.

Deployed on Apify with standby mode for instant responses.

GitHub: https://github.com/liqlos/research-mcp-server
Apify: https://apify.com/benefic_cube/research-mcp-server

#AI #MCP #AIAgents #Research #LLM #Claude #Cursor

### Reddit r/ClaudeAI

**Title**: 23 research tools for Claude in one MCP server (web search, Reddit, academic papers, SEC filings, citations)

**Body**:

I built an MCP server that gives Claude 23 research tools through a single endpoint. No need to juggle multiple API keys and integrations.

**What's included:**

| Category | Tools |
|----------|-------|
| Web & Content | web_search, extract_content, search_news, get_wikipedia, resurrect_dead_link, score_reliability |
| Social & Discussion | search_reddit, search_hackernews, search_youtube, search_substack, search_bluesky, search_telegram, search_mastodon, search_vk, detect_trends |
| Academic & Research | search_preprints, search_datasets, find_counter_arguments, verify_citations, validate_bibliography, format_citations |
| Specialized Data | search_osm, search_sec_filings |

**Pricing:** $0.01/call for simple lookups, $0.02 for standard, $0.03 for premium. You only pay for successful calls — errors are free.

**Setup (Claude Desktop):**

Add to `claude_desktop_config.json`:
```json
{
    "mcpServers": {
        "research": {
            "url": "https://benefic-cube--research-mcp-server.apify.actor/mcp",
            "headers": {
                "Authorization": "Bearer YOUR_APIFY_TOKEN"
            }
        }
    }
}
```

Get a free Apify token at apify.com (includes $5 free credit = 150-500 calls).

GitHub: https://github.com/liqlos/research-mcp-server

### Reddit r/mcp

**Title**: Research MCP Server — 23 tools for AI agents (web, social, academic, financial, geographic)

**Body**: Same as above but emphasize the MCP protocol compliance and technical details.

### Reddit r/cursor

**Title**: Give Cursor 23 research tools via MCP (web search, Reddit, YouTube, papers, SEC filings)

**Body**: Focus on how Cursor users can benefit — research while coding, find documentation, verify citations.

## Demo Script

```bash
# 1. Initialize MCP session
curl -X POST "https://benefic-cube--research-mcp-server.apify.actor/mcp" \
  -H "Authorization: Bearer $APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"demo","version":"1.0"}},"id":1}'

# 2. List all 23 tools
curl -X POST "https://benefic-cube--research-mcp-server.apify.actor/mcp" \
  -H "Authorization: Bearer $APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":2}'

# 3. Search the web
curl -X POST "https://benefic-cube--research-mcp-server.apify.actor/mcp" \
  -H "Authorization: Bearer $APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"web_search","arguments":{"query":"rust async runtime comparison","maxResults":3}},"id":3}'

# 4. Score source reliability
curl -X POST "https://benefic-cube--research-mcp-server.apify.actor/mcp" \
  -H "Authorization: Bearer $APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"score_reliability","arguments":{"urls":["https://en.wikipedia.org/wiki/Rust_(programming_language)"]}},"id":4}'

# 5. Search SEC filings
curl -X POST "https://benefic-cube--research-mcp-server.apify.actor/mcp" \
  -H "Authorization: Bearer $APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"search_sec_filings","arguments":{"query":"AAPL","filingType":"10-K"}},"id":5}'
```

## Directory Submission Status

| Directory | Status | Notes |
|-----------|--------|-------|
| awesome-mcp-servers | PR submitted (#10024) | https://github.com/punkpeye/awesome-mcp-servers/pull/10024 |
| Glama | Auto-indexing | glama.json added, GitHub topics set |
| Official MCP Registry | server.json ready | Requires `mcp-publisher login github` (browser auth) |
| mcp.so | Manual submission needed | https://mcp.so/submit — requires GitHub login |
| Smithery | Manual submission needed | https://smithery.ai/new — requires API key |
| PulseMCP | Auto-ingests from Registry | Will appear after Registry publication |
| Apify Store | Terms acceptance needed | https://console.apify.com/actors/x7fpLaQZU76AO8Vde/publication |

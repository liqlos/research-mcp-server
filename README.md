# Research MCP Server — 23 Tools for AI Agents

One MCP endpoint, 23 research tools, one token, consistent JSON schema. Web, social, academic, and specialized data sources for Claude, Cursor, ChatGPT, LangChain, LlamaIndex, and any MCP client.

## Quick Start

```bash
# List all tools
curl -X POST https://mcp.apify.com/mcp?tools=research-mcp-server \
  -H "Authorization: Bearer $APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# Call web_search
curl -X POST https://mcp.apify.com/mcp?tools=research-mcp-server \
  -H "Authorization: Bearer $APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"web_search","arguments":{"query":"AI agents 2025"}},"id":2}'
```

If you see a JSON response with 23 tool definitions, your token works. Then configure your MCP client (see [MCP Setup](#mcp-setup)).

## Tools

### Web & Content — $0.01/call

| Tool | Description | Example |
|------|-------------|---------|
| `web_search` | Google (with API key) or DuckDuckGo fallback | `web_search({ query: "rust async runtime" })` |
| `extract_content` | Clean text from any URL | `extract_content({ url: "https://example.com/article" })` |
| `search_news` | Google News RSS | `search_news({ query: "AI regulation EU" })` |
| `get_wikipedia` | Wikipedia article summary | `get_wikipedia({ query: "quantum entanglement" })` |
| `resurrect_dead_link` | Find archived version via Wayback Machine | `resurrect_dead_link({ url: "https://example.com/old-article" })` |
| `score_reliability` | Rule-based source reliability scoring | `score_reliability({ urls: ["https://en.wikipedia.org/wiki/Rust"] })` |

### Social & Discussion — $0.02/call

| Tool | Description | Example |
|------|-------------|---------|
| `search_reddit` | Reddit posts + comments | `search_reddit({ query: "best keyboard", subreddit: "MechanicalKeyboards" })` |
| `search_hackernews` | Hacker News via Algolia API | `search_hackernews({ query: "vector database" })` |
| `search_youtube` | YouTube videos + transcripts | `search_youtube({ query: "rust ownership", includeTranscript: true })` |
| `search_substack` | Substack newsletters via RSS | `search_substack({ publications: ["stratechery"], maxPosts: 20 })` |
| `search_bluesky` | Bluesky (AT Protocol) public posts | `search_bluesky({ query: "AI agents", sort: "top" })` |
| `search_telegram` | Public Telegram channels via t.me/s/ preview | `search_telegram({ channel: "durov", maxMessages: 50 })` |
| `search_mastodon` | Mastodon Fediverse public posts | `search_mastodon({ query: "rust programming" })` |
| `search_vk` | VKontakte public posts via official API | `search_vk({ query: "искусственный интеллект" })` |
| `detect_trends` | Trending topics across Reddit, HN, YouTube, News | `detect_trends({ platforms: ["reddit", "hackernews"] })` |

### Academic & Research — $0.03/call

| Tool | Description | Example |
|------|-------------|---------|
| `search_preprints` | arXiv, bioRxiv, medRxiv preprints | `search_preprints({ query: "CRISPR gene editing" })` |
| `search_datasets` | Zenodo, Figshare, OSF data repositories | `search_datasets({ query: "climate change data" })` |
| `find_counter_arguments` | Academic papers supporting/contrasting a claim | `find_counter_arguments({ query: "transformers are better than RNNs" })` |
| `verify_citations` | Verify citations against Crossref and OpenAlex | `verify_citations({ references: ["Vaswani et al. (2017). Attention Is All You Need."] })` |
| `validate_bibliography` | Validate entire bibliography with auto-format detection | `validate_bibliography({ bibliography: "Vaswani et al. (2017)..." })` |
| `format_citations` | Generate BibTeX, APA, MLA, Chicago, RIS from DOIs | `format_citations({ doi: "10.1038/nature12373", format: "bibtex" })` |

### Specialized Data — $0.02/call

| Tool | Description | Example |
|------|-------------|---------|
| `search_osm` | OpenStreetMap POIs and amenities via Overpass API | `search_osm({ query: "restaurant", location: "Berlin" })` |
| `search_sec_filings` | SEC EDGAR filings by ticker or company name | `search_sec_filings({ query: "AAPL", filingType: "10-K" })` |

### Response Format

All tools return `{ query, count, results }`. Errors return `{ query, count: 0, results: [], error: "message" }`.

### Presets

Reduce token overhead by loading only needed tools. Configure via Actor input JSON `{"preset": "web"}` in Apify Console.

| Preset | Tools | Count |
|--------|-------|-------|
| `all` (default) | All tools | 23 |
| `web` | web_search, extract_content, search_news, get_wikipedia, resurrect_dead_link, score_reliability | 6 |
| `social` | search_reddit, search_hackernews, search_youtube, search_substack, search_bluesky, search_telegram, search_mastodon, search_vk, detect_trends | 9 |
| `academic` | search_preprints, search_datasets, find_counter_arguments, verify_citations, validate_bibliography, format_citations | 6 |
| `data` | search_osm, search_sec_filings | 2 |

## MCP Setup

### Claude Desktop

```json
{
    "mcpServers": {
        "apify": {
            "command": "npx",
            "args": [
                "mcp-remote",
                "https://mcp.apify.com/?tools=research-mcp-server",
                "--header",
                "Authorization: Bearer <YOUR_APIFY_TOKEN>"
            ]
        }
    }
}
```

### Cursor

```json
{
    "mcpServers": {
        "research": {
            "url": "https://mcp.apify.com/?tools=research-mcp-server",
            "headers": {
                "Authorization": "Bearer <YOUR_APIFY_TOKEN>"
            }
        }
    }
}
```

### LangChain

```python
from langchain_mcp import MCPClient

client = MCPClient("https://mcp.apify.com/?tools=research-mcp-server",
                   headers={"Authorization": "Bearer <YOUR_APIFY_TOKEN>"})
tools = await client.get_tools()
```

### LlamaIndex

```python
from llama_index.tools.mcp import McpToolSpec

tool_spec = McpToolSpec(
    server_url="https://mcp.apify.com/?tools=research-mcp-server",
    headers={"Authorization": "Bearer <YOUR_APIFY_TOKEN>"},
)
tools = await tool_spec.to_tool_list()
```

## Pricing

| Tier | Price | Tools |
|------|-------|-------|
| Simple lookup | $0.01/call | web_search, extract_content, get_wikipedia, search_news, search_hackernews, score_reliability, resurrect_dead_link |
| Standard search | $0.02/call | search_reddit, search_youtube, search_substack, search_bluesky, search_telegram, search_mastodon, search_vk, search_osm, detect_trends, search_preprints, search_datasets, search_sec_filings |
| Premium workflow | $0.03/call | find_counter_arguments, verify_citations, validate_bibliography, format_citations |

Pay only for successful calls. No subscription, no minimum.

**Cost tips:** Use presets to reduce token overhead. Lower `maxResults` for faster calls. Use `score_reliability` before expensive citation tools. Simple lookups ($0.01) are cheapest — start there.

## Rate Limits

- 60 requests/minute per IP (global)
- HTTP 429 with `Retry-After` header when exceeded
- External API limits (Crossref, SEC, Wikipedia) handled with automatic retries

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `Invalid or blocked URL` | SSRF protection | Use public HTTP/HTTPS URLs, not localhost/private IPs |
| `VK_ACCESS_TOKEN not set` | Missing env var | Add `VK_ACCESS_TOKEN` to Apify Actor secrets |
| HTTP 429 | Rate limit exceeded | Wait for `Retry-After` header |
| Empty `web_search` results | No Google API key | Falls back to DuckDuckGo (fewer results). Add `GOOGLE_API_KEY` + `GOOGLE_CX` |
| `Could not resolve ticker` | Non-US company | `search_sec_filings` covers SEC filings only (US companies) |
| `Bibliography must be max 50000 chars` | Input too large | Split bibliography into smaller batches |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `APIFY_TOKEN` | Yes | Apify API token |
| `GOOGLE_API_KEY` | No | Google Custom Search API key (enables Google search) |
| `GOOGLE_CX` | No | Google Custom Search Engine ID |
| `VK_ACCESS_TOKEN` | No | VKontakte API token (required for `search_vk`) |

Copy `.env.example` to `.env` and fill in values. Without Google API keys, web search falls back to DuckDuckGo.

## Legal & Ethical Use

This actor respects robots.txt, rate limits, and platform terms of service. Users are responsible for compliance with applicable laws and the terms of service of platforms accessed (Reddit, YouTube, SEC, Crossref, etc.).

## Development

```bash
npm install
npm run build
npm test
npm run start:dev
```

# Research MCP Server — 23 Research Tools for AI Agents

**One endpoint. 23 tools. Web, social, academic, and financial data — for any MCP client.**

Give your AI agent the ability to search the web, extract content, find academic papers, verify citations, scan social media, pull SEC filings, and more — all through a single MCP server. Works with Claude, Cursor, ChatGPT, LangChain, LlamaIndex, and any MCP-compatible client.

| | |
|---|---|
| **Tools** | 23 (web, social, academic, financial, geographic) |
| **Pricing** | $0.01–$0.03 per successful call. No charge on errors. |
| **Setup** | 2 minutes. One URL, one token. |
| **Rate limit** | 60 requests/minute |
| **Presets** | Load only the tools you need (saves tokens) |

## Why This Exists

AI agents are only as good as their data. Without research tools, they hallucinate. With this MCP server, your agent can:

- **Search the web** and extract clean content from any URL
- **Find academic papers** on arXiv, bioRxiv, medRxiv and verify citations against Crossref/OpenAlex
- **Scan social platforms** — Reddit, Hacker News, YouTube, Bluesky, Telegram, Mastodon, VK, Substack
- **Pull financial data** — SEC EDGAR filings by ticker
- **Find geographic data** — OpenStreetMap POIs and amenities
- **Detect trends** across multiple platforms simultaneously
- **Resurrect dead links** via the Wayback Machine
- **Score source reliability** with rule-based tier scoring

## Quick Start

```bash
# 1. List all 23 tools
curl -X POST https://mcp.apify.com/mcp?tools=research-mcp-server \
  -H "Authorization: Bearer $APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# 2. Call web_search
curl -X POST https://mcp.apify.com/mcp?tools=research-mcp-server \
  -H "Authorization: Bearer $APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"web_search","arguments":{"query":"AI agents 2025"}},"id":2}'
```

If you see a JSON response with 23 tool definitions, your token works. Then configure your MCP client below.

## Use Cases

- **Research assistant**: `web_search` → `extract_content` → `score_reliability` → `find_counter_arguments` → `verify_citations` → `format_citations`
- **Market intelligence**: `detect_trends` → `search_reddit` → `search_hackernews` → `search_news`
- **Academic workflow**: `search_preprints` → `search_datasets` → `find_counter_arguments` → `validate_bibliography`
- **Financial research**: `search_sec_filings` → `extract_content` → `score_reliability`
- **Social listening**: `search_bluesky` → `search_telegram` → `search_mastodon` → `search_vk`
- **Link rescue**: `resurrect_dead_link` → `extract_content` (read archived content)
- **Location research**: `search_osm` → `extract_content` (pull details from POI websites)

## Tools

### Web & Content — $0.01/call

| Tool | Description | Example |
|------|-------------|---------|
| `web_search` | Google (with API key) or DuckDuckGo fallback | `web_search({ query: "rust async runtime" })` |
| `extract_content` | Clean text from any URL | `extract_content({ url: "https://example.com/article" })` |
| `search_news` | Google News RSS | `search_news({ query: "AI regulation EU" })` |
| `get_wikipedia` | Wikipedia article summary | `get_wikipedia({ query: "quantum entanglement" })` |
| `resurrect_dead_link` | Find archived version via Wayback Machine | `resurrect_dead_link({ url: "https://example.com/old" })` |
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
| `verify_citations` | Verify citations against Crossref and OpenAlex | `verify_citations({ references: ["Vaswani et al. (2017)..."] })` |
| `validate_bibliography` | Validate entire bibliography with auto-format detection | `validate_bibliography({ bibliography: "Vaswani et al. (2017)..." })` |
| `format_citations` | Generate BibTeX, APA, MLA, Chicago, RIS from DOIs | `format_citations({ doi: "10.1038/nature12373", format: "bibtex" })` |

### Specialized Data — $0.02/call

| Tool | Description | Example |
|------|-------------|---------|
| `search_osm` | OpenStreetMap POIs and amenities via Overpass API | `search_osm({ query: "restaurant", location: "Berlin" })` |
| `search_sec_filings` | SEC EDGAR filings by ticker or company name | `search_sec_filings({ query: "AAPL", filingType: "10-K" })` |

### Response Format

All tools return `{ query, count, results }`. Errors return `{ query, count: 0, results: [], error: "message" }`. You only pay for successful calls — errors are free.

### Presets

Reduce token overhead by loading only needed tools. Configure via Actor input JSON `{"preset": "web"}` in Apify Console.

| Preset | Tools | Count |
|--------|-------|-------|
| `all` (default) | All tools | 23 |
| `web` | web_search, extract_content, search_news, get_wikipedia, resurrect_dead_link, score_reliability | 6 |
| `social` | search_reddit, search_hackernews, search_youtube, search_substack, search_bluesky, search_telegram, search_mastodon, search_vk, detect_trends | 9 |
| `academic` | search_preprints, search_datasets, find_counter_arguments, verify_citations, validate_bibliography, format_citations | 6 |
| `data` | search_osm, search_sec_filings | 2 |

## MCP Client Setup

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

**Pay only for successful calls.** No subscription, no minimum. If a tool returns an error, you are not charged.

**Cost examples:**
- 100 web searches = $1.00
- 50 Reddit searches + 25 YouTube searches = $1.50
- 20 citation verifications + 10 bibliography validations = $0.90
- Full research workflow (search → extract → score → verify → format) = ~$0.08

**Cost tips:** Use presets to reduce token overhead. Lower `maxResults` for faster, cheaper calls. Use `score_reliability` before expensive citation tools. Simple lookups ($0.01) are cheapest — start there.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | API info and endpoint directory |
| `/mcp` | POST | MCP protocol endpoint (tools/list, tools/call) |
| `/mcp` | GET | Returns 405 (use POST) |
| `/health` | GET | Server health check (status, tool count, preset, uptime) |
| `/tools` | GET | List all active tools with pricing tiers |
| `/usage` | GET | Usage stats (total calls, per-tool call counts) |
| `/pricing` | GET | Full pricing breakdown by tier with tool lists |

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

## FAQ

**How is this different from using SerpAPI or Serper?**
SerpAPI and Serper only do web search. This server covers 23 tools across web, social, academic, financial, and geographic data — all through one MCP endpoint. No need to manage multiple API keys, billing accounts, and integrations.

**How is this different from building my own tools?**
Building 23 research tools from scratch takes weeks: API integrations, error handling, caching, rate limiting, testing, deployment. This server is production-ready, tested (70 tests), and deployed on Apify's infrastructure with standby mode for instant responses.

**Do I pay for failed calls?**
No. You only pay for successful tool calls. If a tool returns an error (API down, invalid input, rate limited), you are not charged.

**What MCP clients are supported?**
Any MCP-compatible client: Claude Desktop, Cursor, ChatGPT, LangChain, LlamaIndex, Windsurf, and more. The server follows the MCP protocol specification.

**Can I use only a subset of tools?**
Yes. Use presets (`web`, `social`, `academic`, `data`) to load only the tools you need. This reduces token overhead in your AI agent's context window.

**Is there a free tier?**
Apify provides a free tier with $5 monthly credit. At $0.01–$0.03/call, that's 150–500 free calls per month.

**What happens if an external API is down?**
The server retries on 429 and 5xx errors with exponential backoff. If the API remains unavailable, the tool returns a clear error message (no charge). Cached results may still be served.

## Development

```bash
npm install
npm run build
npm test
npm run start:dev
```

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod';
import { log, Actor } from 'apify';
import {
    webSearch,
    extractContent,
    searchReddit,
    searchYouTube,
    searchNews,
    searchHackerNews,
    getWikipedia,
    searchPreprints,
    searchDatasets,
    ProgressCallback,
} from './tools/research.js';
import { scoreReliability } from './tools/reliability.js';
import { searchSubstack } from './tools/substack.js';
import { resurrectDeadLink } from './tools/wayback.js';
import { searchBluesky } from './tools/bluesky.js';
import { searchTelegram } from './tools/telegram.js';
import { searchOsm } from './tools/osm.js';
import { detectTrends } from './tools/trends.js';
import { searchMastodon } from './tools/mastodon.js';
import { searchVk } from './tools/vk.js';
import { findCounterArguments } from './tools/counterargs.js';
import { searchSecFilings } from './tools/sec.js';
import { formatCitations } from './tools/citations.js';
import { verifyCitations } from './tools/verify.js';
import { validateBibliography } from './tools/batch_verify.js';
import { resolveOpenAccess } from './tools/unpaywall.js';
import { searchPubmed } from './tools/pubmed.js';

export const server = new McpServer({
    name: 'research-mcp-server',
    version: '0.3.0',
});

function getServer(): McpServer {
    return new McpServer({
        name: 'research-mcp-server',
        version: '0.3.0',
    });
}

const requestIdStorage = new AsyncLocalStorage<string>();

function getRequestId(): string {
    return requestIdStorage.getStore() ?? '';
}

function makeResult(text: string, structured: object) {
    return {
        content: [{ type: 'text' as const, text }],
        structuredContent: structured as Record<string, unknown>,
    };
}

function makeProgressCallback(extra: { _meta?: { progressToken?: unknown }; sendNotification: (n: never) => Promise<void> }): ProgressCallback | undefined {
    if (extra._meta?.progressToken === undefined) return undefined;
    const progressToken = extra._meta.progressToken;
    return async (progress, total, message) => {
        await extra.sendNotification({
            method: 'notifications/progress',
            params: { progressToken, progress, total, message },
        } as never);
    };
}

const toolAnnotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
};

const SearchResultSchema = z.object({
    title: z.string(),
    url: z.string(),
    snippet: z.string(),
    source: z.string(),
});

const ContentResultSchema = z.object({
    url: z.string(),
    title: z.string(),
    content: z.string(),
    format: z.string(),
    wordCount: z.number(),
});

const RedditResultSchema = z.object({
    title: z.string(),
    url: z.string(),
    subreddit: z.string(),
    author: z.string(),
    score: z.number(),
    numComments: z.number(),
    createdUtc: z.number(),
    selftext: z.string(),
    permalink: z.string(),
});

const YouTubeResultSchema = z.object({
    videoId: z.string(),
    title: z.string(),
    channel: z.string(),
    description: z.string(),
    transcript: z.string(),
    duration: z.string(),
    viewCount: z.number(),
    publishedAt: z.string(),
});

const NewsResultSchema = z.object({
    title: z.string(),
    url: z.string(),
    source: z.string(),
    publishedAt: z.string(),
    snippet: z.string(),
});

const HackerNewsResultSchema = z.object({
    id: z.number(),
    title: z.string(),
    url: z.string(),
    score: z.number(),
    author: z.string(),
    descendants: z.number(),
    time: z.number(),
    type: z.string(),
    text: z.string().optional(),
});

const WikipediaResultSchema = z.object({
    title: z.string(),
    url: z.string(),
    extract: z.string(),
    categories: z.array(z.string()),
});

const PreprintResultSchema = z.object({
    title: z.string(),
    authors: z.array(z.string()),
    abstract: z.string(),
    url: z.string(),
    source: z.enum(['arxiv', 'biorxiv', 'medrxiv']),
    publishedDate: z.string(),
    doi: z.string().optional(),
});

const DatasetResultSchema = z.object({
    title: z.string(),
    description: z.string(),
    url: z.string(),
    source: z.enum(['zenodo', 'figshare', 'osf']),
    authors: z.array(z.string()),
    publishedDate: z.string(),
    doi: z.string().optional(),
    downloadUrl: z.string().optional(),
});

const ReliabilityResultSchema = z.object({
    url: z.string(),
    domain: z.string(),
    reliabilityScore: z.number(),
    reliabilityTier: z.enum(['HIGH', 'MEDIUM-HIGH', 'MEDIUM', 'LOW', 'VERY_LOW']),
    method: z.literal('rule-based'),
    reason: z.string(),
});

const SubstackResultSchema = z.object({
    title: z.string(),
    url: z.string(),
    author: z.string(),
    publishedAt: z.string(),
    summary: z.string(),
    bodyHtml: z.string(),
    wordCount: z.number(),
    categories: z.array(z.string()),
    publication: z.string(),
    paywalled: z.boolean(),
});

const WaybackResultSchema = z.object({
    originalUrl: z.string(),
    isDead: z.boolean(),
    statusCode: z.number(),
    archivedUrl: z.string(),
    timestamp: z.string(),
    captureDate: z.string(),
    mimeType: z.string(),
    error: z.string().optional(),
});

const BlueskyResultSchema = z.object({
    uri: z.string(),
    cid: z.string(),
    text: z.string(),
    author: z.object({
        did: z.string(),
        handle: z.string(),
        displayName: z.string(),
    }),
    createdAt: z.string(),
    likeCount: z.number(),
    repostCount: z.number(),
    replyCount: z.number(),
    url: z.string(),
});

const TelegramResultSchema = z.object({
    messageId: z.number(),
    channel: z.string(),
    text: z.string(),
    date: z.string(),
    views: z.number(),
    author: z.string(),
    permalink: z.string(),
    forwardedFrom: z.string(),
});

const OsmResultSchema = z.object({
    id: z.number(),
    name: z.string(),
    type: z.string(),
    amenity: z.string(),
    lat: z.number(),
    lon: z.number(),
    tags: z.record(z.string(), z.string()),
});

const TrendItemSchema = z.object({
    title: z.string(),
    url: z.string(),
    platform: z.enum(['reddit', 'hackernews', 'youtube', 'news']),
    rawEngagement: z.number(),
    normalizedScore: z.number(),
    timestamp: z.number(),
    crossPlatformMentions: z.number(),
});

const TrendClusterSchema = z.object({
    topic: z.string(),
    items: z.array(TrendItemSchema),
    platforms: z.array(z.string()),
});

const MastodonResultSchema = z.object({
    id: z.string(),
    content: z.string(),
    account: z.object({
        id: z.string(),
        username: z.string(),
        displayName: z.string(),
        url: z.string(),
    }),
    createdAt: z.string(),
    favouritesCount: z.number(),
    reblogsCount: z.number(),
    repliesCount: z.number(),
    url: z.string(),
    instance: z.string(),
});

const VkResultSchema = z.object({
    id: z.number(),
    text: z.string(),
    author: z.string(),
    authorId: z.number(),
    likes: z.number(),
    reposts: z.number(),
    comments: z.number(),
    date: z.number(),
    url: z.string(),
});

const CounterArgumentPaperSchema = z.object({
    paperId: z.string(),
    title: z.string(),
    authors: z.array(z.string()),
    year: z.number(),
    url: z.string(),
    abstract: z.string(),
    confidence: z.number(),
});

const CounterArgumentResultSchema = z.object({
    claim: z.string(),
    supportingPapers: z.array(CounterArgumentPaperSchema),
    contrastingPapers: z.array(CounterArgumentPaperSchema),
    mentioningPapers: z.array(CounterArgumentPaperSchema),
    totalFound: z.number(),
});

const CitationVerificationSchema = z.object({
    input: z.string(),
    status: z.enum(['VERIFIED', 'MISMATCH', 'NOT_FOUND']),
    doi: z.string().optional(),
    title: z.string().optional(),
    authors: z.array(z.string()).optional(),
    year: z.number().optional(),
    matchedTitle: z.string().optional(),
    similarity: z.number().optional(),
    source: z.string().optional(),
    issues: z.array(z.string()).optional(),
});

const BatchVerificationResultSchema = z.object({
    total: z.number(),
    verified: z.number(),
    mismatched: z.number(),
    notFound: z.number(),
    results: z.array(CitationVerificationSchema),
    detectedFormat: z.string(),
});

const SecFilingResultSchema = z.object({
    form: z.string(),
    filingDate: z.string(),
    accessionNumber: z.string(),
    primaryDocument: z.string(),
    primaryDocDescription: z.string(),
    url: z.string(),
});

const CitationResultSchema = z.object({
    format: z.string(),
    citation: z.string(),
    title: z.string(),
    authors: z.array(z.string()),
    year: z.number(),
    doi: z.string(),
    publisher: z.string(),
    url: z.string(),
});

const OpenAccessResultSchema = z.object({
    doi: z.string(),
    title: z.string(),
    authors: z.array(z.string()),
    publishedYear: z.number(),
    isOpenAccess: z.boolean(),
    oaStatus: z.string(),
    bestOaLocation: z.object({
        url: z.string(),
        hostType: z.string(),
        version: z.string(),
        license: z.string(),
        pdfUrl: z.string(),
    }).nullable(),
    oaLocations: z.array(z.object({
        url: z.string(),
        hostType: z.string(),
        version: z.string(),
        pdfUrl: z.string(),
    })),
});

const PubmedResultSchema = z.object({
    pmid: z.string(),
    title: z.string(),
    authors: z.array(z.string()),
    journal: z.string(),
    publishedDate: z.string(),
    abstract: z.string(),
    doi: z.string(),
    url: z.string(),
    source: z.string(),
});

function toolResponseSchema<T extends z.ZodType>(item: T) {
    return z.object({
        query: z.string(),
        count: z.number(),
        results: z.array(item),
        error: z.union([z.string(), z.object({ code: z.string(), message: z.string() })]).optional(),
        cached: z.boolean().optional(),
    });
}

const toolPresets: Record<string, string[]> = {
    all: ['web_search', 'extract_content', 'search_reddit', 'search_youtube', 'search_news', 'search_hackernews', 'get_wikipedia', 'search_preprints', 'search_datasets', 'score_reliability', 'search_substack', 'resurrect_dead_link', 'search_bluesky', 'search_telegram', 'search_osm', 'detect_trends', 'search_mastodon', 'search_vk', 'find_counter_arguments', 'verify_citations', 'validate_bibliography', 'search_sec_filings', 'format_citations', 'resolve_open_access', 'search_pubmed'],
    web: ['web_search', 'extract_content', 'search_news', 'get_wikipedia', 'resurrect_dead_link', 'score_reliability'],
    social: ['search_reddit', 'search_hackernews', 'search_youtube', 'search_substack', 'search_bluesky', 'search_telegram', 'search_mastodon', 'search_vk', 'detect_trends'],
    academic: ['search_preprints', 'search_datasets', 'find_counter_arguments', 'verify_citations', 'validate_bibliography', 'format_citations', 'resolve_open_access', 'search_pubmed'],
    data: ['search_osm', 'search_sec_filings'],
};

function getActivePreset(): string {
    try {
        const input = process.env.APIFY_ACTOR_INPUT;
        if (input) {
            const parsed = JSON.parse(input);
            if (typeof parsed.preset === 'string' && toolPresets[parsed.preset]) return parsed.preset;
        }
    } catch {
    }
    return 'all';
}

const activePreset = getActivePreset();
const activeTools = new Set(toolPresets[activePreset] ?? toolPresets.all);
log.info(`Active tool preset: ${activePreset} (${activeTools.size} tools)`);

const toolCallCounts = new Map<string, number>();
let totalToolCalls = 0;

export const toolPricingTier: Record<string, string> = {
    web_search: 'tool-call-simple',
    extract_content: 'tool-call-simple',
    get_wikipedia: 'tool-call-simple',
    search_news: 'tool-call-simple',
    search_hackernews: 'tool-call-simple',
    score_reliability: 'tool-call-simple',
    resurrect_dead_link: 'tool-call-simple',
    search_reddit: 'tool-call-standard',
    search_youtube: 'tool-call-standard',
    search_substack: 'tool-call-standard',
    search_bluesky: 'tool-call-standard',
    search_telegram: 'tool-call-standard',
    search_mastodon: 'tool-call-standard',
    search_vk: 'tool-call-standard',
    search_osm: 'tool-call-standard',
    detect_trends: 'tool-call-standard',
    search_preprints: 'tool-call-standard',
    search_datasets: 'tool-call-standard',
    search_sec_filings: 'tool-call-standard',
    find_counter_arguments: 'tool-call-premium',
    verify_citations: 'tool-call-premium',
    validate_bibliography: 'tool-call-premium',
    format_citations: 'tool-call-premium',
    resolve_open_access: 'tool-call-standard',
    search_pubmed: 'tool-call-standard',
};

function registerResearchTool(
    name: string,
    config: { description?: string; inputSchema?: unknown; outputSchema?: unknown; annotations?: unknown },
    handler: (args: any, extra: any) => Promise<unknown>,
): void {
    if (!activeTools.has(name)) return;
    currentTarget.registerTool(name, config as never, (async (args: unknown, extra: unknown) => {
        toolCallCounts.set(name, (toolCallCounts.get(name) ?? 0) + 1);
        totalToolCalls++;
        if (totalToolCalls % 100 === 0) {
            log.info('Tool usage stats', { stats: Object.fromEntries(toolCallCounts) });
        }
        const result = await handler(args, extra) as { structuredContent?: { error?: unknown } };
        if (!result?.structuredContent?.error) {
            const tier = toolPricingTier[name] ?? 'tool-call-standard';
            try { await Actor.charge({ eventName: tier }); } catch { }
        }
        return result;
    }) as never);
}

let currentTarget: McpServer = server;

function registerAllTools(target: McpServer = server): void {
    currentTarget = target;
    registerResearchTool(
    'web_search',
    {
        description: 'Search the web via Google (with API key) or DuckDuckGo fallback. Returns titles, URLs, and snippets. Use for finding pages, answering factual questions, and discovering sources. Example: web_search({ query: "rust async runtime comparison", maxResults: 10 }) Do NOT use for academic papers — use search_preprints instead.',
        inputSchema: {
            query: z.string().describe('Search query'),
            maxResults: z.number().int().min(1).max(50).optional().describe('Max results (default: 10)'),
        },
        outputSchema: toolResponseSchema(SearchResultSchema),
        annotations: toolAnnotations,
    },
    async (args) => {
        log.info(`web_search: ${args.query} requestId=${getRequestId()}`);
        const result = await webSearch(args.query, args.maxResults ?? 10);
        return makeResult(JSON.stringify(result, null, 2), result);
    },
);

registerResearchTool(
    'extract_content',
    {
        description: 'Extract clean text content from any URL. Strips scripts, styles, nav, footer. Returns title, text, word count. Use for reading articles, docs, or any web page. Example: extract_content({ url: "https://example.com/article" }) Do NOT use for social media posts — use search_reddit or search_youtube instead.',
        inputSchema: {
            url: z.string().url().describe('URL to extract content from'),
        },
        outputSchema: toolResponseSchema(ContentResultSchema),
        annotations: toolAnnotations,
    },
    async (args) => {
        log.info(`extract_content: ${args.url} requestId=${getRequestId()}`);
        const result = await extractContent(args.url);
        return makeResult(JSON.stringify(result, null, 2), result);
    },
);

registerResearchTool(
    'search_reddit',
    {
        description: 'Search Reddit posts and comments. Returns title, subreddit, author, score, comment count, selftext. Optional subreddit filter. Use for finding discussions, opinions, and community sentiment. Example: search_reddit({ query: "best mechanical keyboard 2025", subreddit: "MechanicalKeyboards", maxResults: 10 }) Do NOT use for authoritative sources — use get_wikipedia or search_preprints.',
        inputSchema: {
            query: z.string().describe('Search query'),
            subreddit: z.string().optional().describe('Restrict to subreddit (optional)'),
            maxResults: z.number().int().min(1).max(50).optional().describe('Max results (default: 10)'),
        },
        outputSchema: toolResponseSchema(RedditResultSchema),
        annotations: toolAnnotations,
    },
    async (args) => {
        log.info(`search_reddit: ${args.query} r/${args.subreddit ?? 'all'} requestId=${getRequestId()}`);
        const result = await searchReddit(args.query, args.maxResults ?? 10, args.subreddit);
        return makeResult(JSON.stringify(result, null, 2), result);
    },
);

registerResearchTool(
    'search_youtube',
    {
        description: 'Search YouTube videos and extract transcripts. Returns videoId, title, channel, description, transcript text, duration, views. Use for finding video content and making it searchable by AI. Example: search_youtube({ query: "rust ownership explained", maxResults: 5, includeTranscript: true }) Do NOT use for text articles — use web_search or extract_content.',
        inputSchema: {
            query: z.string().describe('Search query'),
            maxResults: z.number().int().min(1).max(50).optional().describe('Max results (default: 10)'),
            includeTranscript: z.boolean().optional().describe('Include transcript text (default: true)'),
        },
        outputSchema: toolResponseSchema(YouTubeResultSchema),
        annotations: toolAnnotations,
    },
    async (args, extra) => {
        log.info(`search_youtube: ${args.query} requestId=${getRequestId()}`);
        const onProgress = makeProgressCallback(extra);
        const result = await searchYouTube(args.query, args.maxResults ?? 10, args.includeTranscript ?? true, onProgress);
        return makeResult(JSON.stringify(result, null, 2), result);
    },
);

registerResearchTool(
    'search_news',
    {
        description: 'Search Google News RSS. Returns title, URL, source, publish date, snippet. Use for finding recent news articles and tracking current events. Example: search_news({ query: "AI regulation EU 2025", maxResults: 10 }) Do NOT use for historical events — use get_wikipedia instead.',
        inputSchema: {
            query: z.string().describe('Search query'),
            maxResults: z.number().int().min(1).max(50).optional().describe('Max results (default: 10)'),
        },
        outputSchema: toolResponseSchema(NewsResultSchema),
        annotations: toolAnnotations,
    },
    async (args) => {
        log.info(`search_news: ${args.query} requestId=${getRequestId()}`);
        const result = await searchNews(args.query, args.maxResults ?? 10);
        return makeResult(JSON.stringify(result, null, 2), result);
    },
);

registerResearchTool(
    'search_hackernews',
    {
        description: 'Search Hacker News via Algolia API. Returns story ID, title, URL, score, author, comment count, text. Use for finding tech discussions, startup news, and developer community opinions. Example: search_hackernews({ query: "vector database comparison", maxResults: 10 })',
        inputSchema: {
            query: z.string().describe('Search query'),
            maxResults: z.number().int().min(1).max(50).optional().describe('Max results (default: 10)'),
        },
        outputSchema: toolResponseSchema(HackerNewsResultSchema),
        annotations: toolAnnotations,
    },
    async (args) => {
        log.info(`search_hackernews: ${args.query} requestId=${getRequestId()}`);
        const result = await searchHackerNews(args.query, args.maxResults ?? 10);
        return makeResult(JSON.stringify(result, null, 2), result);
    },
);

registerResearchTool(
    'get_wikipedia',
    {
        description: 'Get Wikipedia article summary. Returns title, URL, extract, categories. Uses REST API first, falls back to MediaWiki API. Use for encyclopedic knowledge, definitions, and factual background. Example: get_wikipedia({ query: "quantum entanglement", sentences: 5 }) Do NOT use for very recent events — use search_news instead.',
        inputSchema: {
            query: z.string().describe('Topic to look up'),
            sentences: z.number().int().min(1).max(10).optional().describe('Summary length in sentences (default: 5)'),
        },
        outputSchema: toolResponseSchema(WikipediaResultSchema),
        annotations: toolAnnotations,
    },
    async (args) => {
        log.info(`get_wikipedia: ${args.query} requestId=${getRequestId()}`);
        const result = await getWikipedia(args.query, args.sentences ?? 5);
        return makeResult(JSON.stringify(result, null, 2), result);
    },
);

registerResearchTool(
    'search_preprints',
    {
        description: 'Search preprint servers (arXiv, bioRxiv, medRxiv). Returns title, authors, abstract, URL, source, published date, DOI. Use for finding research papers before peer review. Example: search_preprints({ query: "CRISPR gene editing", maxResults: 10 })',
        inputSchema: {
            query: z.string().describe('Search query'),
            maxResults: z.number().int().min(1).max(50).optional().describe('Max results (default: 10)'),
        },
        outputSchema: toolResponseSchema(PreprintResultSchema),
        annotations: toolAnnotations,
    },
    async (args) => {
        log.info(`search_preprints: ${args.query} requestId=${getRequestId()}`);
        const result = await searchPreprints(args.query, args.maxResults ?? 10);
        return makeResult(JSON.stringify(result, null, 2), result);
    },
);

registerResearchTool(
    'search_datasets',
    {
        description: 'Search research data repositories (Zenodo, Figshare, OSF). Returns title, description, URL, source, authors, published date, DOI, download URL. Use for finding research datasets and data collections. Example: search_datasets({ query: "climate change temperature data", maxResults: 10 })',
        inputSchema: {
            query: z.string().describe('Search query'),
            maxResults: z.number().int().min(1).max(50).optional().describe('Max results (default: 10)'),
        },
        outputSchema: toolResponseSchema(DatasetResultSchema),
        annotations: toolAnnotations,
    },
    async (args) => {
        log.info(`search_datasets: ${args.query} requestId=${getRequestId()}`);
        const result = await searchDatasets(args.query, args.maxResults ?? 10);
        return makeResult(JSON.stringify(result, null, 2), result);
    },
);

registerResearchTool(
    'score_reliability',
    {
        description: 'Score source reliability for URLs. Rule-based tier scoring: Wikipedia (1.0) > arXiv (0.9) > Nature/Science (0.85) > NYT/Reuters (0.75) > Reddit (0.5) > Unknown (0.3). Use to assess credibility of search results. Example: score_reliability({ urls: ["https://en.wikipedia.org/wiki/Rust", "https://reddit.com/r/rust"] })',
        inputSchema: {
            urls: z.array(z.string().url()).min(1).max(100).describe('URLs to score'),
        },
        outputSchema: toolResponseSchema(ReliabilityResultSchema),
        annotations: toolAnnotations,
    },
    async (args) => {
        log.info(`score_reliability: ${args.urls.length} URLs requestId=${getRequestId()}`);
        const result = await scoreReliability(args.urls);
        return makeResult(JSON.stringify(result, null, 2), result);
    },
);

registerResearchTool(
    'search_substack',
    {
        description: 'Search Substack newsletters via RSS feeds. Returns title, URL, author, publish date, summary, full HTML body, word count, categories, paywall status. Use for finding newsletter content and tracking publications. Example: search_substack({ publications: ["stratechery", "lennysnewsletter"], maxPosts: 20 })',
        inputSchema: {
            publications: z.array(z.string()).min(1).max(20).describe('Substack publication names or URLs (e.g. "stratechery" or "https://example.substack.com")'),
            maxPosts: z.number().int().min(1).max(50).optional().describe('Max posts per publication (default: 50)'),
        },
        outputSchema: toolResponseSchema(SubstackResultSchema),
        annotations: toolAnnotations,
    },
    async (args) => {
        log.info(`search_substack: ${args.publications.join(', ')} requestId=${getRequestId()}`);
        const result = await searchSubstack(args.publications, args.maxPosts ?? 50);
        return makeResult(JSON.stringify(result, null, 2), result);
    },
);

registerResearchTool(
    'resurrect_dead_link',
    {
        description: 'Find archived version of dead/broken URLs via Wayback Machine. Checks if URL is alive (HEAD request), if dead (404/410/5xx) queries archive.org for closest archived snapshot. Use to rescue broken citations and research links. Example: resurrect_dead_link({ url: "https://example.com/old-article", targetDate: "20230101" })',
        inputSchema: {
            url: z.string().url().describe('URL to check and resurrect if dead'),
            targetDate: z.string().optional().describe('Target archive date (YYYYMMDD format, optional)'),
        },
        outputSchema: toolResponseSchema(WaybackResultSchema),
        annotations: toolAnnotations,
    },
    async (args) => {
        log.info(`resurrect_dead_link: ${args.url} requestId=${getRequestId()}`);
        const result = await resurrectDeadLink(args.url, args.targetDate);
        return makeResult(JSON.stringify(result, null, 2), result);
    },
);

registerResearchTool(
    'search_bluesky',
    {
        description: 'Search Bluesky (AT Protocol) public posts. No authentication required. Returns post text, author (DID/handle/displayName), createdAt, like/repost/reply counts, URL. Use for finding discussions on the decentralized Twitter alternative. Example: search_bluesky({ query: "AI agents", maxResults: 10, sort: "top" })',
        inputSchema: {
            query: z.string().describe('Search query'),
            maxResults: z.number().int().min(1).max(100).optional().describe('Max results (default: 10)'),
            sort: z.enum(['top', 'latest']).optional().describe('Sort order (default: top)'),
            until: z.string().optional().describe('ISO date for time-based pagination'),
        },
        outputSchema: toolResponseSchema(BlueskyResultSchema),
        annotations: toolAnnotations,
    },
    async (args) => {
        log.info(`search_bluesky: ${args.query} requestId=${getRequestId()}`);
        const result = await searchBluesky(args.query, args.maxResults ?? 10, args.sort ?? 'top', args.until);
        return makeResult(JSON.stringify(result, null, 2), result);
    },
);

registerResearchTool(
    'search_telegram',
    {
        description: 'Search public Telegram channels via t.me/s/ preview pages. No authentication required. Returns message text, date, views, author, permalink, forwarded-from. Use for crypto/OSINT signal monitoring and public channel research. Example: search_telegram({ channel: "durov", maxMessages: 50 })',
        inputSchema: {
            channel: z.string().describe('Telegram channel username (without @, e.g. "durov")'),
            maxMessages: z.number().int().min(1).max(500).optional().describe('Max messages to fetch (default: 50)'),
        },
        outputSchema: toolResponseSchema(TelegramResultSchema),
        annotations: toolAnnotations,
    },
    async (args, extra) => {
        log.info(`search_telegram: ${args.channel} requestId=${getRequestId()}`);
        const onProgress = makeProgressCallback(extra);
        const result = await searchTelegram(args.channel, args.maxMessages ?? 50, onProgress);
        return makeResult(JSON.stringify(result, null, 2), result);
    },
);

registerResearchTool(
    'search_osm',
    {
        description: 'Search OpenStreetMap via Overpass API. Find POIs, amenities, and map features by name or amenity type. Optional location+radius or bounding box filter. No authentication required. Use for location-based research, finding nearby amenities, geographic data. Example: search_osm({ query: "restaurant", location: "Berlin", radius: 1000 })',
        inputSchema: {
            query: z.string().describe('Search query (name or amenity type, e.g. "restaurant", "hospital")'),
            location: z.string().optional().describe('Address or place name for nearby search (e.g. "Berlin")'),
            radius: z.number().int().min(100).max(50000).optional().describe('Search radius in meters (default: 1000, requires location)'),
            bbox: z.object({
                latBottom: z.number(),
                latTop: z.number(),
                lonLeft: z.number(),
                lonRight: z.number(),
            }).optional().describe('Bounding box for area search'),
            maxResults: z.number().int().min(1).max(200).optional().describe('Max results (default: 50)'),
        },
        outputSchema: toolResponseSchema(OsmResultSchema),
        annotations: toolAnnotations,
    },
    async (args) => {
        log.info(`search_osm: ${args.query} @ ${args.location ?? args.bbox ?? 'global'} requestId=${getRequestId()}`);
        const result = await searchOsm(args.query, args.location, args.radius, args.bbox, args.maxResults ?? 50);
        return makeResult(JSON.stringify(result, null, 2), result);
    },
);

registerResearchTool(
    'detect_trends',
    {
        description: 'Detect trending topics across Reddit, Hacker News, YouTube, and Google News simultaneously. Normalizes engagement metrics across platforms, detects cross-platform mentions, and clusters related items. Use for market research, content ideation, and trend monitoring. Example: detect_trends({ platforms: ["reddit", "hackernews", "news"], maxResults: 50 })',
        inputSchema: {
            platforms: z.array(z.enum(['reddit', 'hackernews', 'youtube', 'news'])).optional().describe('Platforms to scan (default: all)'),
            maxResults: z.number().int().min(1).max(100).optional().describe('Max results (default: 50)'),
            query: z.string().max(500).optional().describe('Search query for YouTube RSS feed (required for YouTube results). Required for YouTube trend detection'),
        },
        outputSchema: z.object({
            query: z.string(),
            count: z.number(),
            results: z.array(TrendItemSchema),
            clusters: z.array(TrendClusterSchema).optional(),
            timeRange: z.string().optional(),
            error: z.string().optional(),
            cached: z.boolean().optional(),
        }),
        annotations: toolAnnotations,
    },
    async (args, extra) => {
        log.info(`detect_trends: ${args.platforms?.join(', ') ?? 'all'} requestId=${getRequestId()}`);
        const onProgress = makeProgressCallback(extra);
        const result = await detectTrends(args.platforms as ('reddit' | 'hackernews' | 'youtube' | 'news')[] | undefined, args.maxResults ?? 50, args.query ?? '', onProgress);
        return makeResult(JSON.stringify(result, null, 2), result);
    },
);

registerResearchTool(
    'search_mastodon',
    {
        description: 'Search Mastodon Fediverse public posts across multiple instances. Searches mastodon.social, fosstodon.org, hachyderm.io and others. Returns post content, author, engagement counts, instance. Use for finding discussions on decentralized social network. Example: search_mastodon({ query: "rust programming", maxResults: 10 })',
        inputSchema: {
            query: z.string().describe('Search query (empty for trending statuses)'),
            maxResults: z.number().int().min(1).max(40).optional().describe('Max results (default: 10)'),
            instances: z.array(z.string()).optional().describe('Custom instances to search (default: 5 popular instances)'),
        },
        outputSchema: toolResponseSchema(MastodonResultSchema),
        annotations: toolAnnotations,
    },
    async (args) => {
        log.info(`search_mastodon: ${args.query} requestId=${getRequestId()}`);
        const result = await searchMastodon(args.query, args.maxResults ?? 10, args.instances);
        return makeResult(JSON.stringify(result, null, 2), result);
    },
);

registerResearchTool(
    'search_vk',
    {
        description: 'Search VKontakte (VK) public posts via official API. Requires VK_ACCESS_TOKEN env var. Returns post text, author, likes, reposts, comments, date, URL. Use for Russian/CIS market research and social listening. Example: search_vk({ query: "искусственный интеллект", maxResults: 10 })',
        inputSchema: {
            query: z.string().describe('Search query'),
            maxResults: z.number().int().min(1).max(200).optional().describe('Max results (default: 10)'),
        },
        outputSchema: toolResponseSchema(VkResultSchema),
        annotations: toolAnnotations,
    },
    async (args) => {
        log.info(`search_vk: ${args.query} requestId=${getRequestId()}`);
        const result = await searchVk(args.query, args.maxResults ?? 10);
        return makeResult(JSON.stringify(result, null, 2), result);
    },
);

registerResearchTool(
    'find_counter_arguments',
    {
        description: 'Find academic papers supporting, contrasting, or mentioning a claim. Searches Semantic Scholar and OpenAlex. Classifies papers by stance keywords (support/contrast/mention). Use for finding counter-evidence, debate preparation, and balanced research. Example: find_counter_arguments({ query: "transformers are better than RNNs", maxResults: 10 })',
        inputSchema: {
            query: z.string().describe('Claim or topic to find counter-arguments for'),
            maxResults: z.number().int().min(1).max(50).optional().describe('Max papers per category (default: 10)'),
        },
        outputSchema: toolResponseSchema(CounterArgumentResultSchema),
        annotations: toolAnnotations,
    },
    async (args, extra) => {
        log.info(`find_counter_arguments: ${args.query} requestId=${getRequestId()}`);
        const onProgress = makeProgressCallback(extra);
        const result = await findCounterArguments(args.query, args.maxResults ?? 10, onProgress);
        return makeResult(JSON.stringify(result, null, 2), result);
    },
);

registerResearchTool(
    'verify_citations',
    {
        description: 'Verify if citations/references are real by checking against Crossref and OpenAlex. Extracts DOI if present, fetches metadata directly, or searches by title. Classifies each as VERIFIED, MISMATCH, or NOT_FOUND. For individual citations. Use validate_bibliography for entire reference lists with auto-format detection. Example: verify_citations({ references: ["Vaswani et al. (2017). Attention Is All You Need. https://doi.org/10.5555/3295222.3295349"], limit: 20 }) Do NOT use for bulk bibliography — use validate_bibliography instead.',
        inputSchema: {
            references: z.array(z.string()).min(1).max(50).describe('Array of citation strings or DOIs to verify (each max 1000 chars)'),
            limit: z.number().int().min(1).max(50).optional().describe('Max references to verify (default: 20)'),
        },
        outputSchema: toolResponseSchema(CitationVerificationSchema),
        annotations: toolAnnotations,
    },
    async (args) => {
        log.info(`verify_citations: ${args.references.length} references requestId=${getRequestId()}`);
        const result = await verifyCitations(args.references, args.limit ?? 20);
        return makeResult(JSON.stringify(result, null, 2), result);
    },
);

registerResearchTool(
    'validate_bibliography',
    {
        description: 'Validate an entire bibliography at once. Auto-detects format (APA, MLA, BibTeX, plain text), splits into individual references, and verifies each against Crossref and OpenAlex in parallel. Returns summary counts and per-reference details. For bulk bibliography processing. Use verify_citations for individual citation checks. Example: validate_bibliography({ bibliography: "Vaswani et al. (2017). Attention Is All You Need.\\nDevlin et al. (2019). BERT.", format: "auto", limit: 50 }) Do NOT use for single citations — use verify_citations instead.',
        inputSchema: {
            bibliography: z.string().min(1).max(50000).describe('Entire bibliography text to validate (max 50000 chars)'),
            format: z.enum(['auto', 'apa', 'mla', 'bibtex', 'plain']).optional().describe('Reference format (default: auto-detect)'),
            limit: z.number().int().min(1).max(100).optional().describe('Max references to validate (default: 50)'),
        },
        outputSchema: toolResponseSchema(BatchVerificationResultSchema),
        annotations: toolAnnotations,
    },
    async (args) => {
        log.info(`validate_bibliography: ${args.bibliography.length} chars, format=${args.format ?? 'auto'} requestId=${getRequestId()}`);
        const result = await validateBibliography(args.bibliography, args.format ?? 'auto', args.limit ?? 50);
        return makeResult(JSON.stringify(result, null, 2), result);
    },
);

registerResearchTool(
    'search_sec_filings',
    {
        description: 'Search SEC EDGAR filings by company ticker (e.g. "AAPL") or company name. Returns form type, filing date, accession number, primary document, and URL. Optional filing type filter (10-K, 10-Q, 8-K, or ALL). Use for financial research and regulatory filing discovery. Example: search_sec_filings({ query: "AAPL", filingType: "10-K", limit: 10 }) Do NOT use for non-US companies — SEC covers US filings only.',
        inputSchema: {
            query: z.string().max(100).describe('Company ticker (e.g. "AAPL") or company name'),
            filingType: z.enum(['10-K', '10-Q', '8-K', 'ALL']).optional().describe('Filing type filter (default: ALL)'),
            limit: z.number().int().min(1).max(50).optional().describe('Max results (default: 10)'),
        },
        outputSchema: toolResponseSchema(SecFilingResultSchema),
        annotations: toolAnnotations,
    },
    async (args) => {
        log.info(`search_sec_filings: ${args.query} type=${args.filingType ?? 'ALL'} requestId=${getRequestId()}`);
        const result = await searchSecFilings(args.query, args.filingType ?? 'ALL', args.limit ?? 10);
        return makeResult(JSON.stringify(result, null, 2), result);
    },
);

registerResearchTool(
    'format_citations',
    {
        description: 'Generate formatted citations (BibTeX, APA, MLA, Chicago, RIS) from DOIs or paper metadata. Fetches metadata from Crossref by DOI or title search. Returns formatted citation string plus raw metadata (title, authors, year, DOI, publisher, URL). Use for building bibliographies and formatting references. Example: format_citations({ doi: "10.1038/nature12373", format: "bibtex" }) Do NOT use for citation verification — use verify_citations instead.',
        inputSchema: {
            doi: z.string().max(200).optional().describe('DOI to fetch metadata for (e.g. "10.1038/nature12373")'),
            title: z.string().max(500).optional().describe('Paper title to search Crossref (used if no DOI provided)'),
            format: z.enum(['bibtex', 'apa', 'mla', 'chicago', 'ris']).optional().describe('Citation format (default: apa)'),
            limit: z.number().int().min(1).max(50).optional().describe('Max results for title search (default: 1)'),
        },
        outputSchema: toolResponseSchema(CitationResultSchema),
        annotations: toolAnnotations,
    },
    async (args) => {
        log.info(`format_citations: doi=${args.doi ?? 'none'} title=${args.title ?? 'none'} format=${args.format ?? 'apa'} requestId=${getRequestId()}`);
        const result = await formatCitations(args.format ?? 'apa', args.doi, args.title, args.limit ?? 1);
        return makeResult(JSON.stringify(result, null, 2), result);
    },
);

registerResearchTool(
    'resolve_open_access',
    {
        description: 'Find free legal PDF versions for academic papers via Unpaywall. Given a DOI, returns open-access status, PDF URLs, host types, and OA status (gold/green/hybrid/bronze). Use after search_preprints or format_citations to get actual PDFs. Example: resolve_open_access({ doi: "10.1038/nature12373" })',
        inputSchema: {
            doi: z.string().describe('DOI of the paper (e.g. 10.1038/nature12373)'),
        },
        outputSchema: toolResponseSchema(OpenAccessResultSchema),
        annotations: toolAnnotations,
    },
    async (args) => {
        log.info(`resolve_open_access: doi=${args.doi} requestId=${getRequestId()}`);
        const result = await resolveOpenAccess(args.doi);
        return makeResult(JSON.stringify(result, null, 2), result);
    },
);

registerResearchTool(
    'search_pubmed',
    {
        description: 'Search biomedical literature via PubMed (35M+ papers) and Europe PMC (40M+). Returns titles, authors, journals, dates, DOIs, and URLs. Use for medical/biological research. Example: search_pubmed({ query: "CRISPR gene editing", maxResults: 10 })',
        inputSchema: {
            query: z.string().describe('Search query for biomedical literature'),
            maxResults: z.number().int().min(1).max(50).optional().describe('Max results (default: 10)'),
        },
        outputSchema: toolResponseSchema(PubmedResultSchema),
        annotations: toolAnnotations,
    },
    async (args) => {
        log.info(`search_pubmed: ${args.query} requestId=${getRequestId()}`);
        const result = await searchPubmed(args.query, args.maxResults ?? 10);
        return makeResult(JSON.stringify(result, null, 2), result);
    },
);
}

registerAllTools();

function registerResourcesAndPrompts(target: McpServer): void {
target.registerResource(
    'tool-guide',
    'research://tool-guide',
    { title: 'Research Tool Guide', description: 'Complete guide to all 25 research tools with examples and pricing', mimeType: 'text/markdown' },
    async () => ({
        contents: [{
            uri: 'research://tool-guide',
            mimeType: 'text/markdown',
            text: [
                '# Research MCP Server — Tool Guide',
                '',
                '## Web & Content ($0.01/call)',
                '- **web_search** — Google/DuckDuckGo web search. `web_search({ query: "rust async" })`',
                '- **extract_content** — Clean text from any URL. `extract_content({ url: "https://..." })`',
                '- **search_news** — Google News RSS. `search_news({ query: "AI regulation" })`',
                '- **get_wikipedia** — Wikipedia summaries. `get_wikipedia({ query: "quantum" })`',
                '- **resurrect_dead_link** — Wayback Machine for dead URLs. `resurrect_dead_link({ url: "..." })`',
                '- **score_reliability** — Source reliability scoring. `score_reliability({ urls: ["..."] })`',
                '',
                '## Social & Discussion ($0.02/call)',
                '- **search_reddit** — Reddit posts + comments. `search_reddit({ query: "best keyboard" })`',
                '- **search_hackernews** — Hacker News via Algolia. `search_hackernews({ query: "vectors" })`',
                '- **search_youtube** — YouTube videos + transcripts. `search_youtube({ query: "rust" })`',
                '- **search_substack** — Substack newsletters via RSS. `search_substack({ publications: ["stratechery"] })`',
                '- **search_bluesky** — Bluesky AT Protocol posts. `search_bluesky({ query: "AI" })`',
                '- **search_telegram** — Public Telegram channels. `search_telegram({ channel: "durov" })`',
                '- **search_mastodon** — Mastodon Fediverse posts. `search_mastodon({ query: "rust" })`',
                '- **search_vk** — VKontakte posts. `search_vk({ query: "ИИ" })`',
                '- **detect_trends** — Trending across platforms. `detect_trends({ platforms: ["reddit"] })`',
                '',
                '## Academic & Research ($0.02-$0.03/call)',
                '- **search_preprints** — arXiv/bioRxiv/medRxiv. `search_preprints({ query: "CRISPR" })`',
                '- **search_pubmed** — PubMed/Europe PMC biomedical literature. `search_pubmed({ query: "CRISPR" })`',
                '- **search_datasets** — Zenodo/Figshare/OSF. `search_datasets({ query: "climate" })`',
                '- **resolve_open_access** — Free PDF via Unpaywall. `resolve_open_access({ doi: "10.1038/..." })`',
                '- **find_counter_arguments** — Papers for/against a claim. `find_counter_arguments({ query: "..." })`',
                '- **verify_citations** — Verify against Crossref/OpenAlex. `verify_citations({ references: ["..."] })`',
                '- **validate_bibliography** — Validate entire bibliography. `validate_bibliography({ bibliography: "..." })`',
                '- **format_citations** — BibTeX/APA/MLA/Chicago/RIS. `format_citations({ doi: "10....", format: "bibtex" })`',
                '',
                '## Specialized Data ($0.02/call)',
                '- **search_osm** — OpenStreetMap POIs. `search_osm({ query: "restaurant", location: "Berlin" })`',
                '- **search_sec_filings** — SEC EDGAR filings. `search_sec_filings({ query: "AAPL", filingType: "10-K" })`',
                '',
                '## Presets',
                '- `all` (default) — 25 tools',
                '- `web` — 6 web/content tools',
                '- `social` — 9 social/discussion tools',
                '- `academic` — 8 academic/research tools',
                '- `data` — 2 specialized data tools',
            ].join('\n'),
        }],
    }),
);

target.registerResource(
    'faq',
    'research://faq',
    { title: 'FAQ', description: 'Frequently asked questions about the Research MCP Server', mimeType: 'text/markdown' },
    async () => ({
        contents: [{
            uri: 'research://faq',
            mimeType: 'text/markdown',
            text: [
                '# Research MCP Server — FAQ',
                '',
                '## How do I get an Apify token?',
                'Sign up at apify.com (free $5 credit = 150-500 tool calls). Copy your API token from the dashboard.',
                '',
                '## How much does it cost?',
                '- $0.01/call for simple lookups (web search, Wikipedia, Wayback)',
                '- $0.02/call for standard tools (Reddit, YouTube, PubMed, Open Access)',
                '- $0.03/call for premium tools (citation verification, counter-arguments)',
                '- You only pay for successful calls — errors are free.',
                '',
                '## What MCP clients are supported?',
                'Claude Desktop, Cursor, ChatGPT, LangChain, LlamaIndex, and any MCP-compatible client.',
                '',
                '## How do I use presets?',
                'Set Actor input JSON `{"preset": "web"}` in Apify Console to load only web tools (saves tokens).',
                '',
                '## Is there a rate limit?',
                'Yes: 60 requests/minute. All tools use caching to reduce redundant calls.',
                '',
                '## How many tools are available?',
                '25 tools across 5 categories: web/content, social/discussion, academic/research, specialized data.',
            ].join('\n'),
        }],
    }),
);

target.registerPrompt(
    'research-topic',
    {
        title: 'Research a Topic',
        description: 'Comprehensive research workflow: search web, find academic papers, verify citations, score reliability',
        argsSchema: {
            topic: z.string().describe('Topic to research'),
            depth: z.string().optional().describe('Research depth: quick, standard, or deep'),
        },
    },
    async (args) => ({
        messages: [{
            role: 'user',
            content: { type: 'text', text: `Research the topic "${args.topic}" with ${args.depth || 'standard'} depth.\n\nWorkflow:\n1. Use web_search to find overview articles\n2. Use search_preprints and search_pubmed for academic sources\n3. Use extract_content on the most relevant results\n4. Use score_reliability on the sources found\n5. Use resolve_open_access to find free PDFs for key papers\n6. Use verify_citations on any claims made\n7. Synthesize findings into a structured report with citations` },
        }],
    }),
);

target.registerPrompt(
    'verify-claim',
    {
        title: 'Verify a Claim',
        description: 'Fact-check a claim: search for evidence, find counter-arguments, verify citations',
        argsSchema: {
            claim: z.string().describe('The claim to verify'),
        },
    },
    async (args) => ({
        messages: [{
            role: 'user',
            content: { type: 'text', text: `Verify this claim: "${args.claim}"\n\nWorkflow:\n1. Use web_search to find sources supporting and contradicting the claim\n2. Use search_reddit and search_hackernews for community discussion\n3. Use find_counter_arguments to find academic papers against the claim\n4. Use score_reliability on all sources found\n5. Use verify_citations on any cited references\n6. Provide a verdict: supported, partially supported, refuted, or inconclusive` },
        }],
    }),
);

target.registerPrompt(
    'find-counter-arguments',
    {
        title: 'Find Counter-Arguments',
        description: 'Find academic counter-arguments and opposing viewpoints for a position',
        argsSchema: {
            position: z.string().describe('The position to find counter-arguments for'),
        },
    },
    async (args) => ({
        messages: [{
            role: 'user',
            content: { type: 'text', text: `Find counter-arguments for this position: "${args.position}"\n\nWorkflow:\n1. Use find_counter_arguments to find academic papers\n2. Use search_preprints for recent preprints on the topic\n3. Use search_pubmed for biomedical literature if relevant\n4. Use search_reddit and search_hackernews for community debates\n5. Use extract_content on key opposing sources\n6. Synthesize the strongest counter-arguments with citations` },
        }],
    }),
);
}

registerResourcesAndPrompts(server);

if (!process.env.VITEST) {
const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const mcpLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { jsonrpc: '2.0', error: { code: -32000, message: 'Rate limit exceeded' } },
});
app.use('/mcp', mcpLimiter);

app.post('/mcp', async (req, res) => {
    const requestId = crypto.randomUUID();
    try {
        log.info(`MCP request started: requestId=${requestId}`);
        const requestServer = getServer();
        registerAllTools(requestServer);
        registerResourcesAndPrompts(requestServer);
        const transport = new StreamableHTTPServerTransport({} as { sessionIdGenerator?: () => string });
        await requestServer.connect(transport as never);
        await requestIdStorage.run(requestId, () => transport.handleRequest(req, res, req.body));
        res.on('close', () => {
            transport.close();
            requestServer.close();
        });
        log.info(`MCP request completed: requestId=${requestId}`);
    } catch (err) {
        log.error(`MCP request failed: requestId=${requestId} error=${(err as Error).message}`);
        if (!res.headersSent) {
            res.status(500).json({ error: 'MCP server error', requestId });
        }
    }
});

app.get('/mcp', (_req, res) => {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
});

app.get('/', (_req, res) => {
    res.json({
        name: 'Research MCP Server',
        version: '0.3.0',
        description: '25 research tools for AI agents',
        endpoints: {
            '/mcp': 'POST — MCP protocol endpoint',
            '/health': 'GET — health check',
            '/tools': 'GET — list active tools with pricing',
            '/usage': 'GET — usage stats',
            '/pricing': 'GET — pricing breakdown by tier',
        },
        preset: activePreset,
        toolCount: activeTools.size,
    });
});

app.get('/health', (_req, res) => {
    res.json({ status: 'ok', tools: activeTools.size, preset: activePreset, version: '0.3.0', uptime: Math.floor(process.uptime()) });
});

app.get('/tools', (_req, res) => {
    const tools = [...activeTools].map(name => ({
        name,
        pricingTier: toolPricingTier[name] ?? 'tool-call-standard',
        priceUsd: toolPricingTier[name] === 'tool-call-simple' ? 0.01
            : toolPricingTier[name] === 'tool-call-premium' ? 0.03 : 0.02,
    }));
    res.json({ preset: activePreset, count: tools.length, tools });
});

app.get('/usage', (_req, res) => {
    res.json({
        totalCalls: totalToolCalls,
        perTool: Object.fromEntries(
            [...toolCallCounts.entries()].sort((a, b) => b[1] - a[1]),
        ),
    });
});

app.get('/pricing', (_req, res) => {
    res.json({
        model: 'PAY_PER_EVENT',
        minimalMaxTotalChargeUsd: 1.0,
        tiers: [
            {
                tier: 'tool-call-simple',
                priceUsd: 0.01,
                tools: Object.entries(toolPricingTier).filter(([, t]) => t === 'tool-call-simple').map(([n]) => n),
            },
            {
                tier: 'tool-call-standard',
                priceUsd: 0.02,
                tools: Object.entries(toolPricingTier).filter(([, t]) => t === 'tool-call-standard').map(([n]) => n),
            },
            {
                tier: 'tool-call-premium',
                priceUsd: 0.03,
                tools: Object.entries(toolPricingTier).filter(([, t]) => t === 'tool-call-premium').map(([n]) => n),
            },
        ],
    });
});

const port = process.env.ACTOR_STANDBY_PORT || 3000;
const httpServer = app.listen(Number(port), () => {
    log.info(`Research MCP server listening on port ${port}`);
    log.info(`Active preset: ${activePreset}, tools: ${[...activeTools].join(', ')}`);
});

let isShuttingDown = false;

function shutdown(signal: string): void {
    if (isShuttingDown) {
        log.info(`Received ${signal} during shutdown, already in progress`);
        return;
    }
    isShuttingDown = true;
    log.info(`Received ${signal}, shutting down gracefully`);
    httpServer.close(() => {
        log.info('All connections closed, exiting');
        process.exit(0);
    });
    setTimeout(() => {
        log.error('Graceful shutdown timed out after 10s, forcing exit');
        process.exit(1);
    }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
}

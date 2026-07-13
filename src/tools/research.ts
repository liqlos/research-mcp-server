import { Actor } from 'apify';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { Agent } from 'undici';

export const poolAgent = new Agent({
    keepAliveTimeout: 60000,
    keepAliveMaxTimeout: 300000,
    connections: 50,
});

export interface SearchResult {
    title: string;
    url: string;
    snippet: string;
    source: string;
}

export interface ContentResult {
    url: string;
    title: string;
    content: string;
    format: string;
    wordCount: number;
}

export interface RedditResult {
    title: string;
    url: string;
    subreddit: string;
    author: string;
    score: number;
    numComments: number;
    createdUtc: number;
    selftext: string;
    permalink: string;
}

export interface YouTubeResult {
    videoId: string;
    title: string;
    channel: string;
    description: string;
    transcript: string;
    duration: string;
    viewCount: number;
    publishedAt: string;
}

export interface NewsResult {
    title: string;
    url: string;
    source: string;
    publishedAt: string;
    snippet: string;
}

export interface HackerNewsResult {
    id: number;
    title: string;
    url: string;
    score: number;
    author: string;
    descendants: number;
    time: number;
    type: string;
    text?: string;
}

export interface WikipediaResult {
    title: string;
    url: string;
    extract: string;
    categories: string[];
}

export interface PreprintResult {
    title: string;
    authors: string[];
    abstract: string;
    url: string;
    source: 'arxiv' | 'biorxiv' | 'medrxiv';
    publishedDate: string;
    doi?: string;
}

export interface DatasetResult {
    title: string;
    description: string;
    url: string;
    source: 'zenodo' | 'figshare' | 'osf';
    authors: string[];
    publishedDate: string;
    doi?: string;
    downloadUrl?: string;
}

export interface ToolResponse<T> {
    query: string;
    count: number;
    results: T[];
    error?: string | { code: string; message: string };
    cached?: boolean;
}

export type ProgressCallback = (progress: number, total: number, message: string) => Promise<void>;

export const ErrorCodes = {
    RATE_LIMITED: 'RATE_LIMITED',
    INVALID_URL: 'INVALID_URL',
    TIMEOUT: 'TIMEOUT',
    API_ERROR: 'API_ERROR',
    INVALID_INPUT: 'INVALID_INPUT',
    NOT_FOUND: 'NOT_FOUND',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

export const MAX_RESULTS = 50;
export const MAX_CONTENT_LENGTH = 50000;
export const REQUEST_TIMEOUT_MS = 15000;
const CACHE_MAX_ENTRIES = 1000;

const BLOCKED_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '169.254.169.254', 'metadata.google.internal', '[::1]'];

export const CACHE_TTL_MS = {
    web_search: 300_000,
    extract_content: 3_600_000,
    search_reddit: 300_000,
    search_youtube: 3_600_000,
    search_news: 60_000,
    search_hackernews: 300_000,
    get_wikipedia: 86_400_000,
    search_preprints: 3_600_000,
    search_datasets: 3_600_000,
    search_osm: 3_600_000,
    search_substack: 3_600_000,
    resurrect_dead_link: 86_400_000,
    search_bluesky: 300_000,
    search_telegram: 300_000,
    search_mastodon: 300_000,
    search_vk: 300_000,
    find_counter_arguments: 3_600_000,
    detect_trends: 60_000,
    search_sec_filings: 3_600_000,
    format_citations: 86_400_000,
    verify_citations: 86_400_000,
    validate_bibliography: 86_400_000,
    score_reliability: 86_400_000,
} as const;

interface CacheEntry {
    value: unknown;
    expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<unknown>>();

function cacheGet(key: string): unknown | undefined {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
        cache.delete(key);
        return undefined;
    }
    cache.delete(key);
    cache.set(key, entry);
    return entry.value;
}

function cacheSet(key: string, value: unknown, ttlMs: number): void {
    if (cache.size >= CACHE_MAX_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function makeCacheKey(toolName: string, ...parts: unknown[]): string {
    return `${toolName}:${parts.map(p => JSON.stringify(p)).join(':')}`;
}

export function withCache<T extends ToolResponse<unknown>>(
    toolName: string,
    ttlMs: number,
    params: unknown[],
    fn: () => Promise<T>,
): Promise<T> {
    const key = makeCacheKey(toolName, ...params);
    const hit = cacheGet(key);
    if (hit !== undefined) {
        const cached = hit as T;
        return Promise.resolve({ ...cached, cached: true });
    }
    const existing = pending.get(key);
    if (existing) return existing as Promise<T>;
    const promise = fn().then(result => {
        pending.delete(key);
        if (!result.error) cacheSet(key, result, ttlMs);
        return result;
    }).catch(err => {
        pending.delete(key);
        throw err;
    });
    pending.set(key, promise);
    return promise;
}

export function validateUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
        if (parsed.username || parsed.password) return false;
        const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
        if (BLOCKED_HOSTS.includes(host)) return false;
        if (host.endsWith('.internal') || host.endsWith('.local') || host.endsWith('.arpa')) return false;

        if (/^\d+$/.test(host)) return false;
        if (/^0\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
        if (/^0x[0-9a-f]+\.\d+\.\d+\.\d+$/i.test(host)) return false;

        const ipMatch = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
        if (ipMatch) {
            const a = Number(ipMatch[1]);
            const b = Number(ipMatch[2]);
            if (a === 0 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 127) return false;
        }
        if (host.includes(':')) {
            if (host === '::' || host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('2001:db8:')) return false;
            const mappedMatch = host.match(/^\[?::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})\]?$/i);
            if (mappedMatch) {
                const hi = parseInt(mappedMatch[1]!, 16);
                const lo = parseInt(mappedMatch[2]!, 16);
                const ipNum = (hi << 16) | lo;
                if (ipNum === 0x7f000001 || ipNum === 0x0a000000 || (ipNum & 0xfff00000) === 0xac100000 || (ipNum & 0xffff0000) === 0xc0a80000 || (ipNum & 0xffff0000) === 0xa9fe0000) return false;
            }
        }
        return true;
    } catch {
        return false;
    }
}

export async function fetchWithTimeout(url: string, options: RequestInit = {}, retries: number = 2, useProxy: boolean = false): Promise<Response> {
    const dispatcher = useProxy ? await getProxyDispatcher() : poolAgent;
    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const fetchOptions: Record<string, unknown> = { ...options, signal: controller.signal };
            if (dispatcher) fetchOptions.dispatcher = dispatcher;
            const resp = await fetch(url, fetchOptions as RequestInit);
            if ((resp.status === 429 || resp.status >= 500) && attempt < retries) {
                clearTimeout(timeout);
                const retryAfter = resp.headers.get('retry-after');
                const parsed = parseInt(retryAfter || '', 10);
                const delay = !isNaN(parsed) && parsed > 0 ? Math.min(parsed * 1000, 60000) : 1000 * (attempt + 1);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            const contentLength = parseInt(resp.headers.get('content-length') || '', 10);
            if (!isNaN(contentLength) && contentLength > 10 * 1024 * 1024) {
                clearTimeout(timeout);
                controller.abort();
                throw new Error('Response too large');
            }
            return resp;
        } catch (err) {
            clearTimeout(timeout);
            if (attempt === retries) throw err;
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        } finally {
            clearTimeout(timeout);
        }
    }
    throw new Error('Max retries exceeded');
}

let proxyDispatcher: unknown | undefined;
let proxyInitFailed = false;

async function getProxyDispatcher(): Promise<unknown | undefined> {
    if (proxyDispatcher || proxyInitFailed) return proxyDispatcher;
    try {
        const proxyConfig = await Actor.createProxyConfiguration();
        if (!proxyConfig) {
            proxyInitFailed = true;
            return undefined;
        }
        const proxyUrl = await proxyConfig.newUrl();
        if (!proxyUrl) {
            proxyInitFailed = true;
            return undefined;
        }
        // @ts-ignore
        const { ProxyAgent } = await import('undici');
        proxyDispatcher = new ProxyAgent(proxyUrl);
        return proxyDispatcher;
    } catch {
        proxyInitFailed = true;
        return undefined;
    }
}

export async function webSearch(query: string, maxResults: number = 10): Promise<ToolResponse<SearchResult>> {
    return withCache('web_search', CACHE_TTL_MS.web_search, [query, maxResults], async () => {
    const limit = Math.min(maxResults, MAX_RESULTS);
    try {
        const url = `https://www.googleapis.com/customsearch/v1?key=${process.env.GOOGLE_API_KEY || ''}&cx=${process.env.GOOGLE_CX || ''}&q=${encodeURIComponent(query)}&num=${limit}`;
        const fallbackUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

        let results: SearchResult[] = [];

        if (process.env.GOOGLE_API_KEY && process.env.GOOGLE_CX) {
            const resp = await fetchWithTimeout(url);
            if (resp.ok) {
                const data = await resp.json() as { items?: Array<{ title: string; link: string; snippet: string }> };
                results = (data.items || []).slice(0, limit).map(item => ({
                    title: item.title,
                    url: item.link,
                    snippet: item.snippet || '',
                    source: 'google',
                }));
            }
        }

        if (results.length === 0) {
            const resp = await fetchWithTimeout(fallbackUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResearchMCPServer/1.0)' },
            }, 2, true);
            if (resp.ok) {
                const html = await resp.text();
                const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs;
                const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gs;
                const links: Array<{ url: string; title: string }> = [];
                let match: RegExpExecArray | null;
                while ((match = linkRegex.exec(html)) !== null && links.length < limit) {
                    const rawUrl = match[1] ?? '';
                    const title = (match[2] ?? '').replace(/<[^>]+>/g, '').trim();
                    const actualUrl = rawUrl.includes('uddg=') ? decodeURIComponent((rawUrl.split('uddg=')[1] ?? '').split('&')[0] ?? '') : rawUrl;
                    if (actualUrl && !actualUrl.startsWith('http://duckduckgo.com')) {
                        links.push({ url: actualUrl, title });
                    }
                }
                const snippets: string[] = [];
                while ((match = snippetRegex.exec(html)) !== null) {
                    snippets.push((match[1] ?? '').replace(/<[^>]+>/g, '').trim());
                }
                results = links.map((link, i) => ({
                    title: link.title,
                    url: link.url,
                    snippet: snippets[i] || '',
                    source: 'duckduckgo',
                }));
            }
        }

        return { query, count: results.length, results };
    } catch (err) {
        const e = err as Error;
        if (e.name === 'AbortError' || e.message.includes('abort')) {
            return { query, count: 0, results: [], error: { code: ErrorCodes.TIMEOUT, message: `Web search timed out: ${e.message}` } };
        }
        return { query, count: 0, results: [], error: { code: ErrorCodes.API_ERROR, message: `Web search failed: ${e.message}` } };
    }
    });
}

export function stripHtmlWithRegex(html: string): string {
    const bodyMatch = html.match(/<body[^>]*>(.*?)<\/body>/is);
    const bodyHtml = bodyMatch ? bodyMatch[1] ?? '' : html;
    return bodyHtml
        .replace(/<script[^>]*>.*?<\/script>/gis, '')
        .replace(/<style[^>]*>.*?<\/style>/gis, '')
        .replace(/<nav[^>]*>.*?<\/nav>/gis, '')
        .replace(/<footer[^>]*>.*?<\/footer>/gis, '')
        .replace(/<header[^>]*>.*?<\/header>/gis, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

export async function extractContent(url: string): Promise<ToolResponse<ContentResult>> {
    return withCache('extract_content', CACHE_TTL_MS.extract_content, [url], async () => {
    if (!validateUrl(url)) {
        return { query: url, count: 0, results: [], error: { code: ErrorCodes.INVALID_URL, message: 'Invalid or blocked URL' } };
    }
    try {
        const resp = await fetchWithTimeout(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResearchMCPServer/1.0)' },
        }, 2, true);
        if (!resp.ok) {
            if (resp.status === 429) {
                return { query: url, count: 0, results: [], error: { code: ErrorCodes.RATE_LIMITED, message: `HTTP ${resp.status}` } };
            }
            return { query: url, count: 0, results: [], error: { code: ErrorCodes.API_ERROR, message: `HTTP ${resp.status}` } };
        }
        const html = await resp.text();
        let title: string;
        let text: string;

        let dom: JSDOM | undefined;
        try {
            dom = new JSDOM(html, { url });
            const reader = new Readability(dom.window.document);
            const article = reader.parse();
            if (article) {
                title = article.title || url;
                text = article.textContent || '';
            } else {
                title = html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]?.trim() || url;
                text = stripHtmlWithRegex(html);
            }
        } catch {
            title = html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]?.trim() || url;
            text = stripHtmlWithRegex(html);
        } finally {
            if (dom) dom.window.close();
        }

        const truncated = text.slice(0, MAX_CONTENT_LENGTH);
        const wordCount = truncated.split(/\s+/).filter(Boolean).length;

        return {
            query: url,
            count: 1,
            results: [{
                url,
                title,
                content: truncated,
                format: 'text',
                wordCount,
            }],
        };
    } catch (err) {
        const e = err as Error;
        if (e.name === 'AbortError' || e.message.includes('abort')) {
            return { query: url, count: 0, results: [], error: { code: ErrorCodes.TIMEOUT, message: `Content extraction timed out: ${e.message}` } };
        }
        return { query: url, count: 0, results: [], error: { code: ErrorCodes.API_ERROR, message: `Content extraction failed: ${e.message}` } };
    }
    });
}

export async function searchReddit(query: string, maxResults: number = 10, subreddit?: string): Promise<ToolResponse<RedditResult>> {
    return withCache('search_reddit', CACHE_TTL_MS.search_reddit, [query, maxResults, subreddit], async () => {
    const limit = Math.min(maxResults, MAX_RESULTS);
    try {
        const rssUrl = subreddit
            ? `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/search.rss?q=${encodeURIComponent(query)}&restrict_sr=1&limit=${limit}&sort=relevance`
            : `https://www.reddit.com/search.rss?q=${encodeURIComponent(query)}&limit=${limit}&sort=relevance`;

        const resp = await fetchWithTimeout(rssUrl, {
            headers: { 'User-Agent': 'research-mcp-server/1.0 (compatible; RSS reader)' },
        }, 2, true);

        if (resp.ok) {
            const xml = await resp.text();
            const entryRegex = /<entry>[\s\S]*?<\/entry>/gs;
            const entries: string[] = [];
            let entryMatch: RegExpExecArray | null;
            while ((entryMatch = entryRegex.exec(xml)) !== null && entries.length < limit) {
                entries.push(entryMatch[0]);
            }

            const results: RedditResult[] = entries.map(entry => {
                const title = entry.match(/<title>(.*?)<\/title>/s)?.[1]?.replace(/<!\[CDATA\[(.*?)\]\]>/s, '$1').trim() || '';
                const link = entry.match(/<link[^>]*href="([^"]+)"/s)?.[1] || '';
                const author = entry.match(/<author>[\s\S]*?<name>(.*?)<\/name>/s)?.[1]?.trim() || '';
                const published = entry.match(/<published>(.*?)<\/published>/s)?.[1] || '';
                const content = entry.match(/<content[^>]*>(.*?)<\/content>/s)?.[1]?.replace(/<[^>]+>/g, '').trim() || '';
                const subredditMatch = link.match(/\/r\/([^/]+)/);

                return {
                    title,
                    url: link,
                    subreddit: subredditMatch ? subredditMatch[1] ?? '' : '',
                    author,
                    score: 0,
                    numComments: 0,
                    createdUtc: published ? new Date(published).getTime() / 1000 : 0,
                    selftext: content.slice(0, 5000),
                    permalink: link,
                };
            });

            if (results.length > 0) {
                return { query, count: results.length, results };
            }
        }

        const ddgQuery = subreddit
            ? `site:reddit.com/r/${subreddit} ${query}`
            : `site:reddit.com ${query}`;
        const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(ddgQuery)}`;
        const ddgResp = await fetchWithTimeout(ddgUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResearchMCPServer/1.0)' },
        }, 2, true);

        if (!ddgResp.ok) {
            const code = resp.status === 429 || ddgResp.status === 429 ? ErrorCodes.RATE_LIMITED : ErrorCodes.API_ERROR;
            return { query, count: 0, results: [], error: { code, message: `Reddit search failed: Reddit API ${resp.status}, DuckDuckGo ${ddgResp.status}` } };
        }

        const html = await ddgResp.text();
        const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs;
        const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gs;
        const links: Array<{ url: string; title: string }> = [];
        let match: RegExpExecArray | null;
        while ((match = linkRegex.exec(html)) !== null && links.length < limit) {
            const rawUrl = match[1] ?? '';
            const title = (match[2] ?? '').replace(/<[^>]+>/g, '').trim();
            const actualUrl = rawUrl.includes('uddg=') ? decodeURIComponent((rawUrl.split('uddg=')[1] ?? '').split('&')[0] ?? '') : rawUrl;
            if (actualUrl && actualUrl.includes('reddit.com')) {
                links.push({ url: actualUrl, title });
            }
        }

        const snippets: string[] = [];
        while ((match = snippetRegex.exec(html)) !== null) {
            snippets.push((match[1] ?? '').replace(/<[^>]+>/g, '').trim());
        }

        const results: RedditResult[] = links.map((link, i) => {
            const subredditMatch = link.url.match(/\/r\/([^/]+)/);
            return {
                title: link.title,
                url: link.url,
                subreddit: subredditMatch ? subredditMatch[1] ?? '' : '',
                author: '',
                score: 0,
                numComments: 0,
                createdUtc: 0,
                selftext: snippets[i] || '',
                permalink: link.url,
            };
        });

        return { query, count: results.length, results };
    } catch (err) {
        const e = err as Error;
        if (e.name === 'AbortError' || e.message.includes('abort')) {
            return { query, count: 0, results: [], error: { code: ErrorCodes.TIMEOUT, message: `Reddit search timed out: ${e.message}` } };
        }
        return { query, count: 0, results: [], error: { code: ErrorCodes.API_ERROR, message: `Reddit search failed: ${e.message}` } };
    }
    });
}

function extractYtInitialData(html: string): unknown | undefined {
    const marker = 'ytInitialData';
    const idx = html.indexOf(marker);
    if (idx === -1) return undefined;
    const eqIdx = html.indexOf('=', idx);
    if (eqIdx === -1) return undefined;
    const startIdx = html.indexOf('{', eqIdx);
    if (startIdx === -1) return undefined;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = startIdx; i < html.length; i++) {
        const ch = html[i];
        if (inString) {
            if (escape) { escape = false; continue; }
            if (ch === '\\') { escape = true; continue; }
            if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) {
                try {
                    return JSON.parse(html.slice(startIdx, i + 1));
                } catch {
                    return undefined;
                }
            }
        }
    }
    return undefined;
}

function findVideoRenderers(obj: unknown, results: Array<Record<string, unknown>>, depth: number = 0): void {
    if (!obj || typeof obj !== 'object' || results.length >= 500 || depth > 15) return;
    if (Array.isArray(obj)) {
        for (const item of obj) findVideoRenderers(item, results, depth + 1);
        return;
    }
    const record = obj as Record<string, unknown>;
    if ('videoRenderer' in record && typeof record.videoRenderer === 'object' && record.videoRenderer !== null) {
        results.push(record.videoRenderer as Record<string, unknown>);
    }
    for (const key of Object.keys(record)) {
        findVideoRenderers(record[key], results, depth + 1);
    }
}

function extractRunsText(field: unknown): string {
    if (!field || typeof field !== 'object') return '';
    const runs = (field as Record<string, unknown>).runs;
    if (!Array.isArray(runs)) return '';
    let text = '';
    for (const run of runs) {
        if (run && typeof run === 'object' && typeof (run as Record<string, unknown>).text === 'string') {
            text += (run as Record<string, unknown>).text as string;
        }
    }
    return text.replace(/\\u0026/g, '&');
}

function extractSimpleText(field: unknown): string {
    if (!field || typeof field !== 'object') return '';
    const simpleText = (field as Record<string, unknown>).simpleText;
    return typeof simpleText === 'string' ? simpleText : '';
}

export async function searchYouTube(query: string, maxResults: number = 10, includeTranscript: boolean = true, onProgress?: ProgressCallback): Promise<ToolResponse<YouTubeResult>> {
    return withCache('search_youtube', CACHE_TTL_MS.search_youtube, [query, maxResults, includeTranscript], async () => {
    const limit = Math.min(maxResults, MAX_RESULTS);
    try {
        const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
        const resp = await fetchWithTimeout(searchUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9' },
        }, 2, true);
        if (!resp.ok) {
            const code = resp.status === 429 ? ErrorCodes.RATE_LIMITED : ErrorCodes.API_ERROR;
            return { query, count: 0, results: [], error: { code, message: `YouTube returned ${resp.status}` } };
        }
        const html = await resp.text();

        const ytData = extractYtInitialData(html);
        const renderers: Array<Record<string, unknown>> = [];
        if (ytData) findVideoRenderers(ytData, renderers);

        const seenIds = new Set<string>();
        const videos: Array<{
            videoId: string;
            title: string;
            channel: string;
            description: string;
            duration: string;
            viewCount: number;
            publishedAt: string;
        }> = [];
        for (const renderer of renderers) {
            if (videos.length >= limit) break;
            const videoId = typeof renderer.videoId === 'string' ? renderer.videoId : '';
            if (!videoId || seenIds.has(videoId)) continue;
            seenIds.add(videoId);
            videos.push({
                videoId,
                title: extractRunsText(renderer.title),
                channel: extractRunsText(renderer.longBylineText),
                description: extractRunsText(renderer.descriptionSnippet),
                duration: extractSimpleText(renderer.lengthText),
                viewCount: parseInt(extractSimpleText(renderer.viewCountText).replace(/[^\d]/g, '')) || 0,
                publishedAt: extractSimpleText(renderer.publishedTimeText),
            });
        }

        const results: YouTubeResult[] = [];
        if (includeTranscript) {
            const totalBatches = Math.ceil(videos.length / 5);
            for (let i = 0; i < videos.length; i += 5) {
                const batch = videos.slice(i, i + 5);
                const settled = await Promise.allSettled(batch.map(v => getYouTubeTranscript(v.videoId)));
                for (let j = 0; j < batch.length; j++) {
                    const v = batch[j];
                    if (!v) continue;
                    const s = settled[j];
                    const transcript = s && s.status === 'fulfilled' ? s.value : '';
                    results.push({ videoId: v.videoId, title: v.title, channel: v.channel, description: v.description, transcript, duration: v.duration, viewCount: v.viewCount, publishedAt: v.publishedAt });
                }
                const batchNum = Math.floor(i / 5) + 1;
                await onProgress?.(batchNum, totalBatches, `Fetched transcripts: batch ${batchNum}/${totalBatches}`);
            }
        } else {
            for (const v of videos) {
                results.push({ videoId: v.videoId, title: v.title, channel: v.channel, description: v.description, transcript: '', duration: v.duration, viewCount: v.viewCount, publishedAt: v.publishedAt });
            }
        }
        return { query, count: results.length, results };
    } catch (err) {
        const e = err as Error;
        if (e.name === 'AbortError' || e.message.includes('abort')) {
            return { query, count: 0, results: [], error: { code: ErrorCodes.TIMEOUT, message: `YouTube search timed out: ${e.message}` } };
        }
        return { query, count: 0, results: [], error: { code: ErrorCodes.API_ERROR, message: `YouTube search failed: ${e.message}` } };
    }
    });
}

async function getYouTubeTranscript(videoId: string): Promise<string> {
    try {
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const resp = await fetchWithTimeout(videoUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResearchMCPServer/1.0)', 'Accept-Language': 'en-US,en;q=0.9' },
        }, 2, true);
        if (!resp.ok) return '';
        const html = await resp.text();
        const startMarker = '"captionTracks":[';
        const startIdx = html.indexOf(startMarker);
        if (startIdx === -1) return '';
        const arrayStart = startIdx + startMarker.length - 1;
        let depth = 0;
        let inString = false;
        let escape = false;
        let arrayEnd = -1;
        for (let i = arrayStart; i < html.length; i++) {
            const ch = html[i];
            if (inString) {
                if (escape) { escape = false; continue; }
                if (ch === '\\') { escape = true; continue; }
                if (ch === '"') inString = false;
                continue;
            }
            if (ch === '"') inString = true;
            else if (ch === '[') depth++;
            else if (ch === ']') {
                depth--;
                if (depth === 0) { arrayEnd = i; break; }
            }
        }
        if (arrayEnd === -1) return '';
        let tracks: Array<{ baseUrl?: string }> = [];
        try {
            tracks = JSON.parse(html.slice(arrayStart, arrayEnd + 1).replace(/\\u0026/g, '&'));
        } catch {
            return '';
        }
        if (!tracks.length || !tracks[0]?.baseUrl) return '';
        const transcriptResp = await fetchWithTimeout(tracks[0].baseUrl, {}, 2, true);
        if (!transcriptResp.ok) return '';
        const xml = await transcriptResp.text();
        const segments = xml.match(/<text[^>]*>(.*?)<\/text>/gs) || [];
        return segments
            .map(seg => seg.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
            .join(' ')
            .slice(0, 10000);
    } catch {
        return '';
    }
}

export async function searchNews(query: string, maxResults: number = 10): Promise<ToolResponse<NewsResult>> {
    return withCache('search_news', CACHE_TTL_MS.search_news, [query, maxResults], async () => {
    const limit = Math.min(maxResults, MAX_RESULTS);
    try {
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
        const resp = await fetchWithTimeout(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResearchMCPServer/1.0)' },
        }, 2, true);
        if (!resp.ok) {
            return { query, count: 0, results: [], error: `Google News returned ${resp.status}` };
        }
        const xml = await resp.text();
        const itemRegex = /<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<link>(.*?)<\/link>[\s\S]*?<pubDate>(.*?)<\/pubDate>[\s\S]*?<source[^>]*>(.*?)<\/source>[\s\S]*?<description>(.*?)<\/description>[\s\S]*?<\/item>/gs;
        const results: NewsResult[] = [];
        let match: RegExpExecArray | null;
        while ((match = itemRegex.exec(xml)) !== null && results.length < limit) {
            const title = match[1] ?? '';
            const link = match[2] ?? '';
            const pubDate = match[3] ?? '';
            const source = match[4] ?? '';
            const description = match[5] ?? '';
            const cleanTitle = title.replace(/<!\[CDATA\[(.*?)\]\]>/, '$1').trim();
            const cleanSnippet = description.replace(/<!\[CDATA\[(.*?)\]\]>/, '$1').replace(/<[^>]+>/g, '').trim();
            results.push({
                title: cleanTitle,
                url: link.trim(),
                source: source.trim(),
                publishedAt: pubDate.trim(),
                snippet: cleanSnippet,
            });
        }
        return { query, count: results.length, results };
    } catch (err) {
        return { query, count: 0, results: [], error: `News search failed: ${(err as Error).message}` };
    }
    });
}

export async function searchHackerNews(query: string, maxResults: number = 10): Promise<ToolResponse<HackerNewsResult>> {
    return withCache('search_hackernews', CACHE_TTL_MS.search_hackernews, [query, maxResults], async () => {
    const limit = Math.min(maxResults, MAX_RESULTS);
    try {
        const searchUrl = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${limit}`;
        const resp = await fetchWithTimeout(searchUrl);
        if (!resp.ok) {
            return { query, count: 0, results: [], error: `Hacker News API returned ${resp.status}` };
        }
        const data = await resp.json() as { hits: Array<{ objectID: string; title: string; url: string; points: number; author: string; num_comments: number; created_at_i: number; _tags: string[]; story_text?: string }> };
        const results: HackerNewsResult[] = data.hits.map(hit => {
            const result: HackerNewsResult = {
                id: parseInt(hit.objectID, 10) || 0,
                title: hit.title || '',
                url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
                score: hit.points || 0,
                author: hit.author || '',
                descendants: hit.num_comments || 0,
                time: hit.created_at_i,
                type: 'story',
            };
            const text = hit.story_text?.replace(/<[^>]+>/g, '').slice(0, 5000);
            if (text) result.text = text;
            return result;
        });
        return { query, count: results.length, results };
    } catch (err) {
        return { query, count: 0, results: [], error: `Hacker News search failed: ${(err as Error).message}` };
    }
    });
}

export async function getWikipedia(query: string, sentences: number = 5): Promise<ToolResponse<WikipediaResult>> {
    return withCache('get_wikipedia', CACHE_TTL_MS.get_wikipedia, [query, sentences], async () => {
    try {
        const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=1`;
        const searchResp = await fetchWithTimeout(searchUrl, {
            headers: { 'User-Agent': 'research-mcp-server/1.0 (https://example.com; research@example.com)' },
        });
        if (!searchResp.ok) {
            return { query, count: 0, results: [], error: 'Wikipedia search API returned error' };
        }
        const searchData = await searchResp.json() as { query: { search: Array<{ title: string }> } };
        if (!searchData.query?.search?.length) {
            return { query, count: 0, results: [], error: 'No Wikipedia article found' };
        }
        const pageTitle = searchData.query.search[0]?.title ?? '';

        const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle.replace(/\s+/g, '_'))}`;
        const summaryResp = await fetchWithTimeout(summaryUrl, {
            headers: { 'User-Agent': 'research-mcp-server/1.0 (https://example.com; research@example.com)' },
        });
        if (summaryResp.ok) {
            const data = await summaryResp.json() as { title: string; content_urls: { desktop: { page: string } }; extract: string; type: string };
            if (data.type !== 'disambiguation' && data.extract) {
                return {
                    query,
                    count: 1,
                    results: [{
                        title: data.title,
                        url: data.content_urls.desktop.page,
                        extract: data.extract,
                        categories: [],
                    }],
                };
            }
        }

        const extractUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exsentences=${Math.min(sentences, 10)}&explaintext=1&titles=${encodeURIComponent(pageTitle)}&format=json`;
        const extractResp = await fetchWithTimeout(extractUrl, {
            headers: { 'User-Agent': 'research-mcp-server/1.0 (https://example.com; research@example.com)' },
        });
        if (!extractResp.ok) {
            return { query, count: 0, results: [], error: 'Wikipedia extract failed' };
        }
        const extractData = await extractResp.json() as { query: { pages: Record<string, { title: string; extract: string }> } };
        const pages = Object.values(extractData.query.pages);
        const firstPage = pages[0];
        if (!pages.length || !firstPage?.extract) {
            return { query, count: 0, results: [], error: 'No extract available' };
        }
        return {
            query,
            count: 1,
            results: [{
                title: firstPage.title,
                url: `https://en.wikipedia.org/wiki/${encodeURIComponent(firstPage.title.replace(/\s+/g, '_'))}`,
                extract: firstPage.extract,
                categories: [],
            }],
        };
    } catch (err) {
        return { query, count: 0, results: [], error: `Wikipedia lookup failed: ${(err as Error).message}` };
    }
    });
}

export async function searchPreprints(query: string, maxResults: number = 10): Promise<ToolResponse<PreprintResult>> {
    return withCache('search_preprints', CACHE_TTL_MS.search_preprints, [query, maxResults], async () => {
    const limit = Math.min(maxResults, MAX_RESULTS);
    if (!query || !query.trim()) {
        return { query, count: 0, results: [], error: 'Empty query' };
    }
    try {
        const [arxivResults, bioResults, medResults] = await Promise.all([
            searchArxiv(query, limit),
            searchBioRxiv(query, limit, 'biorxiv'),
            searchBioRxiv(query, limit, 'medrxiv'),
        ]);
        const results = [...arxivResults, ...bioResults, ...medResults].slice(0, limit);
        return { query, count: results.length, results };
    } catch (err) {
        return { query, count: 0, results: [], error: `Preprint search failed: ${(err as Error).message}` };
    }
    });
}

async function searchArxiv(query: string, limit: number): Promise<PreprintResult[]> {
    try {
        const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=${limit}`;
        const resp = await fetchWithTimeout(url, {
            headers: { 'User-Agent': 'research-mcp-server/1.0' },
        }, 2, true);
        if (!resp.ok) return [];
        const xml = await resp.text();
        const entryRegex = /<entry>[\s\S]*?<\/entry>/gs;
        const entries: string[] = [];
        let match: RegExpExecArray | null;
        while ((match = entryRegex.exec(xml)) !== null && entries.length < limit) {
            entries.push(match[0]);
        }
        return entries.map(entry => {
            const title = entry.match(/<title>(.*?)<\/title>/s)?.[1]?.replace(/\s+/g, ' ').trim() || '';
            const summary = entry.match(/<summary>(.*?)<\/summary>/s)?.[1]?.replace(/\s+/g, ' ').trim() || '';
            const link = entry.match(/<id>(.*?)<\/id>/s)?.[1]?.trim() || '';
            const published = entry.match(/<published>(.*?)<\/published>/s)?.[1]?.trim() || '';
            const authorRegex = /<author>[\s\S]*?<name>(.*?)<\/name>/gs;
            const authors: string[] = [];
            let authorMatch: RegExpExecArray | null;
            while ((authorMatch = authorRegex.exec(entry)) !== null) {
                authors.push((authorMatch[1] ?? '').trim());
            }
            const doiMatch = entry.match(/<arxiv:doi[^>]*>(.*?)<\/arxiv:doi>/s);
            const doi = doiMatch ? doiMatch[1]?.trim() : undefined;
            const result: PreprintResult = {
                title,
                authors,
                abstract: summary,
                url: link,
                source: 'arxiv',
                publishedDate: published,
            };
            if (doi) result.doi = doi;
            return result;
        });
    } catch {
        return [];
    }
}

async function searchBioRxiv(query: string, limit: number, server: 'biorxiv' | 'medrxiv'): Promise<PreprintResult[]> {
    try {
        const searchUrl = `https://www.${server}.org/search/${encodeURIComponent(query)}?numresults=${limit}`;
        const resp = await fetchWithTimeout(searchUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResearchMCPServer/1.0)' },
        }, 2, true);
        if (!resp.ok) return [];
        const html = await resp.text();
        const liRegex = /<li[^>]*class="search-result[^"]*"[^>]*>([\s\S]*?)<\/li>/gs;
        const items: string[] = [];
        let match: RegExpExecArray | null;
        while ((match = liRegex.exec(html)) !== null && items.length < limit) {
            items.push(match[1] ?? '');
        }
        if (items.length === 0) {
            const cardRegex = /<div[^>]*class="highwire-article-citation[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gs;
            while ((match = cardRegex.exec(html)) !== null && items.length < limit) {
                items.push(match[1] ?? '');
            }
        }
        return items.map(item => {
            const title = item.match(/<a[^>]*class="highwire-cite-linked-title"[^>]*>(.*?)<\/a>/s)?.[1]?.replace(/<[^>]+>/g, '').trim()
                || item.match(/<a[^>]*>(.*?)<\/a>/s)?.[1]?.replace(/<[^>]+>/g, '').trim() || '';
            const link = item.match(/<a[^>]*href="([^"]+)"[^>]*>/s)?.[1] || '';
            const absMatch = item.match(/<div[^>]*class="highwire-article-citation"[^>]*>([\s\S]*?)<\/div>/s);
            const abstract = absMatch ? (absMatch[1] ?? '').replace(/<[^>]+>/g, '').trim() : '';
            const authorRegex = /<span[^>]*class="highwire-citation-author"[^>]*>(.*?)<\/span>/gs;
            const authors: string[] = [];
            let authorMatch: RegExpExecArray | null;
            while ((authorMatch = authorRegex.exec(item)) !== null) {
                authors.push((authorMatch[1] ?? '').replace(/<[^>]+>/g, '').trim());
            }
            const doiMatch = item.match(/<span[^>]*class="highwire-cite-metadata-doi"[^>]*>(.*?)<\/span>/s);
            const doi = doiMatch ? (doiMatch[1] ?? '').replace(/<[^>]+>/g, '').trim() : undefined;
            const publishedDate = item.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || '';
            const fullUrl = link.startsWith('http') ? link : `https://www.${server}.org${link}`;
            const result: PreprintResult = {
                title,
                authors,
                abstract,
                url: fullUrl,
                source: server,
                publishedDate,
            };
            if (doi) result.doi = doi;
            return result;
        }).filter(r => r.title);
    } catch {
        return [];
    }
}

export async function searchDatasets(query: string, maxResults: number = 10): Promise<ToolResponse<DatasetResult>> {
    return withCache('search_datasets', CACHE_TTL_MS.search_datasets, [query, maxResults], async () => {
    const limit = Math.min(maxResults, MAX_RESULTS);
    if (!query || !query.trim()) {
        return { query, count: 0, results: [], error: 'Empty query' };
    }
    try {
        const [zenodoResults, figshareResults, osfResults] = await Promise.all([
            searchZenodo(query, limit),
            searchFigshare(query, limit),
            searchOSF(query, limit),
        ]);
        const results = [...zenodoResults, ...figshareResults, ...osfResults].slice(0, limit);
        return { query, count: results.length, results };
    } catch (err) {
        return { query, count: 0, results: [], error: `Dataset search failed: ${(err as Error).message}` };
    }
    });
}

async function searchZenodo(query: string, limit: number): Promise<DatasetResult[]> {
    try {
        const url = `https://zenodo.org/api/records?q=${encodeURIComponent(query)}&size=${limit}`;
        const resp = await fetchWithTimeout(url, {
            headers: { 'User-Agent': 'research-mcp-server/1.0', 'Accept': 'application/json' },
        });
        if (!resp.ok) return [];
        const data = await resp.json() as { hits?: { hits?: Array<{
            metadata?: { title?: string; description?: string; creators?: Array<{ name?: string }>; publication_date?: string; doi?: string };
            links?: { self?: string; latest_html?: string; download?: string };
        }> } };
        const hits = data.hits?.hits || [];
        return hits.slice(0, limit).map(hit => {
            const result: DatasetResult = {
                title: hit.metadata?.title || '',
                description: (hit.metadata?.description || '').replace(/<[^>]+>/g, '').slice(0, 5000),
                url: hit.links?.latest_html || hit.links?.self || '',
                source: 'zenodo',
                authors: (hit.metadata?.creators || []).map(c => c.name || '').filter(Boolean),
                publishedDate: hit.metadata?.publication_date || '',
            };
            if (hit.metadata?.doi) result.doi = hit.metadata.doi;
            if (hit.links?.download) result.downloadUrl = hit.links.download;
            return result;
        }).filter(r => r.title);
    } catch {
        return [];
    }
}

async function searchFigshare(query: string, limit: number): Promise<DatasetResult[]> {
    try {
        const url = 'https://api.figshare.com/v2/articles/search';
        const resp = await fetchWithTimeout(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'research-mcp-server/1.0' },
            body: JSON.stringify({ search_text: query, page_size: limit }),
        });
        if (!resp.ok) return [];
        const data = await resp.json() as Array<{
            title?: string; description?: string; url?: string; doi?: string;
            authors?: Array<{ name?: string }>; published_date?: string; timeline?: { posted?: string };
        }>;
        return data.slice(0, limit).map(item => {
            const result: DatasetResult = {
                title: item.title || '',
                description: (item.description || '').replace(/<[^>]+>/g, '').slice(0, 5000),
                url: item.url || (item.doi ? `https://doi.org/${item.doi}` : ''),
                source: 'figshare',
                authors: (item.authors || []).map(a => a.name || '').filter(Boolean),
                publishedDate: item.published_date || item.timeline?.posted || '',
            };
            if (item.doi) result.doi = item.doi;
            return result;
        }).filter(r => r.title);
    } catch {
        return [];
    }
}

async function searchOSF(query: string, limit: number): Promise<DatasetResult[]> {
    try {
        const url = `https://api.osf.io/v2/search/?q=${encodeURIComponent(query)}&page[size]=${limit}`;
        const resp = await fetchWithTimeout(url, {
            headers: { 'User-Agent': 'research-mcp-server/1.0', 'Accept': 'application/json' },
        });
        if (!resp.ok) return [];
        const data = await resp.json() as { data?: Array<{
            attributes?: { title?: string; description?: string; resource?: string; date_created?: string; date_published?: string; doi?: string };
            links?: { self?: string; download?: string };
            relationships?: { contributors?: { links?: { related?: string } } };
        }> };
        const items = data.data || [];
        return items.slice(0, limit).map(item => {
            const result: DatasetResult = {
                title: item.attributes?.title || '',
                description: (item.attributes?.description || '').replace(/<[^>]+>/g, '').slice(0, 5000),
                url: item.links?.self || '',
                source: 'osf',
                authors: [],
                publishedDate: item.attributes?.date_published || item.attributes?.date_created || '',
            };
            if (item.attributes?.doi) result.doi = item.attributes.doi;
            if (item.links?.download) result.downloadUrl = item.links.download;
            return result;
        }).filter(r => r.title);
    } catch {
        return [];
    }
}

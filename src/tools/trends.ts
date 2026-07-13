import { ToolResponse, withCache, CACHE_TTL_MS, fetchWithTimeout, ProgressCallback } from './research.js';

export interface TrendItem {
    title: string;
    url: string;
    platform: 'reddit' | 'hackernews' | 'youtube' | 'news';
    rawEngagement: number;
    normalizedScore: number;
    timestamp: number;
    crossPlatformMentions: number;
}

export interface TrendCluster {
    topic: string;
    items: TrendItem[];
    platforms: string[];
}

const STOP_WORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
    'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
    'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can',
    'this', 'that', 'these', 'those', 'into', 'through', 'during', 'before', 'after',
    'above', 'below', 'about', 'between', 'among', 'against', 'until', 'while', 'because',
    'not', 'no', 'nor', 'than', 'too', 'very', 'just', 'also', 'only', 'other', 'such',
    'more', 'most', 'some', 'any', 'all', 'each', 'every', 'both', 'few', 'many', 'much',
    'your', 'their', 'its', 'our', 'his', 'her', 'them', 'they', 'them', 'over', 'under',
    'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how',
    'what', 'which', 'who', 'whom', 'whose', 'will', 'shall', 'may', 'might', 'must',
    'says', 'said', 'say', 'make', 'made', 'get', 'got', 'go', 'going', 'like', 'even',
    'still', 'back', 'well', 'way', 'thing', 'one', 'two', 'three', 'new', 'now', 'out',
    'off', 'up', 'down', 'been', 'being', 'having', 'doing', 'these', 'those',
]);

const MAX_QUERY_LENGTH = 500;
const MAX_PER_PLATFORM = 100;

function decodeXmlEntities(text: string): string {
    return text
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(parseInt(n, 10)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCharCode(parseInt(n, 16)));
}

function extractXmlTag(content: string, tag: string): string {
    const match = content.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 's'));
    return match?.[1] ? decodeXmlEntities(match[1]).trim() : '';
}

function extractXmlLink(content: string): string {
    const selfClosing = content.match(/<link[^>]*href="([^"]+)"/s);
    if (selfClosing?.[1]) return selfClosing[1];
    const match = content.match(new RegExp(`<link>([\\s\\S]*?)<\\/link>`, 's'));
    return match?.[1] ? decodeXmlEntities(match[1]).trim() : '';
}

function extractSignificantTerms(title: string): string[] {
    return title.toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(w => w.length > 3 && !STOP_WORDS.has(w));
}

async function fetchRedditTrends(): Promise<TrendItem[]> {
    try {
        const resp = await fetchWithTimeout('https://www.reddit.com/r/all/rising/.rss?limit=25', {
            headers: { 'User-Agent': 'research-mcp-server/1.0 (compatible; RSS reader)' },
        }, 2, true);
        if (!resp.ok) return [];
        const xml = await resp.text();
        const entryRegex = /<entry>[\s\S]*?<\/entry>/gs;
        const items: TrendItem[] = [];
        let match: RegExpExecArray | null;
        while ((match = entryRegex.exec(xml)) !== null && items.length < MAX_PER_PLATFORM) {
            const entry = match[0];
            const title = extractXmlTag(entry, 'title');
            const link = extractXmlLink(entry);
            const published = extractXmlTag(entry, 'published');
            items.push({
                title,
                url: link,
                platform: 'reddit',
                rawEngagement: 1,
                normalizedScore: 0,
                timestamp: published ? new Date(published).getTime() : Date.now(),
                crossPlatformMentions: 0,
            });
        }
        return items;
    } catch {
        return [];
    }
}

async function fetchHnTrends(): Promise<TrendItem[]> {
    try {
        const oneHourAgo = Math.floor((Date.now() - 3600000) / 1000);
        const url = `https://hn.algolia.com/api/v1/search?tags=front_page&numericFilters=created_at_i>${oneHourAgo}&hitsPerPage=25`;
        const resp = await fetchWithTimeout(url, {
            headers: { 'User-Agent': 'research-mcp-server/1.0' },
        }, 2, true);
        if (!resp.ok) return [];
        const data = await resp.json() as { hits?: Array<{ title: string; url?: string; points?: number; created_at_i?: number; objectID?: string }> };
        return (data.hits || []).map(hit => ({
            title: hit.title || '',
            url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
            platform: 'hackernews' as const,
            rawEngagement: hit.points || 0,
            normalizedScore: 0,
            timestamp: hit.created_at_i ? hit.created_at_i * 1000 : Date.now(),
            crossPlatformMentions: 0,
        }));
    } catch {
        return [];
    }
}

async function fetchNewsTrends(): Promise<TrendItem[]> {
    try {
        const resp = await fetchWithTimeout('https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en', {
            headers: { 'User-Agent': 'research-mcp-server/1.0' },
        }, 2, true);
        if (!resp.ok) return [];
        const xml = await resp.text();
        const itemRegex = /<item>([\s\S]*?)<\/item>/gs;
        const items: TrendItem[] = [];
        let match: RegExpExecArray | null;
        while ((match = itemRegex.exec(xml)) !== null && items.length < MAX_PER_PLATFORM) {
            const item = match[1] || '';
            const title = extractXmlTag(item, 'title');
            const link = extractXmlLink(item);
            const pubDate = extractXmlTag(item, 'pubDate');
            items.push({
                title,
                url: link,
                platform: 'news',
                rawEngagement: 1,
                normalizedScore: 0,
                timestamp: pubDate ? new Date(pubDate).getTime() : Date.now(),
                crossPlatformMentions: 0,
            });
        }
        return items;
    } catch {
        return [];
    }
}

async function fetchYouTubeTrends(query: string): Promise<TrendItem[]> {
    if (!query) {
        return [{
            title: 'YouTube search requires a non-empty query parameter',
            url: '',
            platform: 'youtube',
            rawEngagement: 0,
            normalizedScore: 0,
            timestamp: Date.now(),
            crossPlatformMentions: 0,
        }];
    }
    try {
        const resp = await fetchWithTimeout(`https://www.youtube.com/feeds/videos.xml?search_query=${encodeURIComponent(query)}`, {
            headers: { 'User-Agent': 'research-mcp-server/1.0 (compatible; RSS reader)' },
        }, 2, true);
        if (!resp.ok) return [];
        const xml = await resp.text();
        const entryRegex = /<entry>[\s\S]*?<\/entry>/gs;
        const items: TrendItem[] = [];
        let match: RegExpExecArray | null;
        while ((match = entryRegex.exec(xml)) !== null && items.length < MAX_PER_PLATFORM) {
            const entry = match[0];
            const title = extractXmlTag(entry, 'title');
            const link = extractXmlLink(entry);
            const published = extractXmlTag(entry, 'published');
            items.push({
                title,
                url: link,
                platform: 'youtube',
                rawEngagement: 1,
                normalizedScore: 0,
                timestamp: published ? new Date(published).getTime() : Date.now(),
                crossPlatformMentions: 0,
            });
        }
        return items;
    } catch {
        return [];
    }
}

function normalizeEngagement(items: TrendItem[]): TrendItem[] {
    const maxByPlatform = new Map<string, number>();
    for (const item of items) {
        const current = maxByPlatform.get(item.platform) ?? 0;
        if (item.rawEngagement > current) {
            maxByPlatform.set(item.platform, item.rawEngagement);
        }
    }
    return items.map(item => ({
        ...item,
        normalizedScore: item.rawEngagement / (maxByPlatform.get(item.platform) || 1),
    }));
}

function detectCrossPlatform(items: TrendItem[]): TrendItem[] {
    const itemTerms = items.map(item => extractSignificantTerms(item.title));
    const termIndex = new Map<string, number[]>();
    itemTerms.forEach((terms, idx) => {
        for (const term of new Set(terms)) {
            const arr = termIndex.get(term) || [];
            arr.push(idx);
            termIndex.set(term, arr);
        }
    });
    return items.map((item, idx) => {
        const myTerms = new Set(itemTerms[idx]);
        const candidates = new Set<number>();
        for (const term of myTerms) {
            for (const otherIdx of termIndex.get(term) || []) {
                if (otherIdx !== idx) candidates.add(otherIdx);
            }
        }
        const platforms = new Set<string>();
        for (const otherIdx of candidates) {
            const otherTerms = new Set(itemTerms[otherIdx]);
            let overlap = 0;
            for (const t of myTerms) if (otherTerms.has(t)) overlap++;
            if (overlap >= 2) platforms.add(items[otherIdx]!.platform);
        }
        return { ...item, crossPlatformMentions: platforms.size };
    });
}

function clusterTopics(items: TrendItem[]): TrendCluster[] {
    const clusters = new Map<string, TrendItem[]>();
    for (const item of items) {
        const terms = extractSignificantTerms(item.title);
        const key = terms[0] ?? item.title.toLowerCase().slice(0, 40);
        const arr = clusters.get(key) || [];
        arr.push(item);
        clusters.set(key, arr);
    }
    return [...clusters.values()]
        .filter(cluster => cluster.length > 0)
        .map(cluster => ({
            topic: cluster[0]!.title.slice(0, 80),
            items: cluster.sort((a, b) => b.normalizedScore - a.normalizedScore),
            platforms: [...new Set(cluster.map(c => c.platform))],
        }))
        .sort((a, b) => b.items.length - a.items.length)
        .slice(0, 10);
}

function computeTimeRange(items: TrendItem[]): string {
    const timestamps = items.map(t => t.timestamp).filter(Boolean);
    if (timestamps.length === 0) return 'unknown';
    const now = Date.now();
    const oldest = Math.min(...timestamps);
    const newest = Math.max(...timestamps);
    const oldestHoursAgo = Math.max(0, Math.round((now - oldest) / 3600000));
    const newestHoursAgo = Math.max(0, Math.round((now - newest) / 3600000));
    return `last ${newestHoursAgo}-${oldestHoursAgo}h based on RSS feed recency`;
}

export async function detectTrends(
    platforms: ('reddit' | 'hackernews' | 'youtube' | 'news')[] = ['reddit', 'hackernews', 'youtube', 'news'],
    maxResults: number = 50,
    query: string = '',
    onProgress?: ProgressCallback,
): Promise<ToolResponse<TrendItem> & { clusters?: TrendCluster[]; timeRange?: string }> {
    const sanitizedQuery = query.slice(0, MAX_QUERY_LENGTH);
    const sanitizedLimit = Math.min(maxResults, MAX_PER_PLATFORM);
    return withCache('detect_trends', CACHE_TTL_MS.detect_trends, [platforms, sanitizedLimit, sanitizedQuery], async () => {
        try {
            const fetchers: Promise<TrendItem[]>[] = [];
            const platformNames: string[] = [];
            if (platforms.includes('reddit')) { fetchers.push(fetchRedditTrends()); platformNames.push('reddit'); }
            if (platforms.includes('hackernews')) { fetchers.push(fetchHnTrends()); platformNames.push('hackernews'); }
            if (platforms.includes('youtube')) { fetchers.push(fetchYouTubeTrends(sanitizedQuery)); platformNames.push('youtube'); }
            if (platforms.includes('news')) { fetchers.push(fetchNewsTrends()); platformNames.push('news'); }
            const totalPlatforms = fetchers.length;
            const fetchersWithProgress = fetchers.map(async (fetcher, idx) => {
                const items = await fetcher;
                await onProgress?.(idx + 1, totalPlatforms, `Fetched ${platformNames[idx]} trends (${items.length} items)`);
                return items;
            });
            const settled = await Promise.allSettled(fetchersWithProgress);
            const allItems = settled.flatMap(s => s.status === 'fulfilled' ? s.value : []);
            const normalized = normalizeEngagement(allItems);
            const withCross = detectCrossPlatform(normalized);
            const sorted = withCross.sort((a, b) => b.normalizedScore * (1 + b.crossPlatformMentions * 0.2) - a.normalizedScore * (1 + a.crossPlatformMentions * 0.2));
            const top = sorted.slice(0, sanitizedLimit);
            const clusters = clusterTopics(top);
            const timeRange = computeTimeRange(top);
            return { query: platforms.join(', '), count: top.length, results: top, clusters, timeRange };
        } catch (err) {
            return { query: platforms.join(', '), count: 0, results: [], error: `Trend detection failed: ${(err as Error).message}` };
        }
    });
}

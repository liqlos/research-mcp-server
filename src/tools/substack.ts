import { ToolResponse, withCache, CACHE_TTL_MS, fetchWithTimeout, stripHtmlWithRegex } from './research.js';

export interface SubstackResult {
    title: string;
    url: string;
    author: string;
    publishedAt: string;
    summary: string;
    bodyHtml: string;
    wordCount: number;
    categories: string[];
    publication: string;
    paywalled: boolean;
}

function normalizePubUrl(input: string): string | null {
    let name = '';
    const match = input.match(/^https?:\/\/([a-z0-9-]+)\.substack\.com/i);
    if (match) {
        name = match[1] ?? '';
    } else {
        name = input.replace(/\.substack\.com.*$/, '');
    }
    name = name.toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!name) return null;
    return `https://${name}.substack.com/feed`;
}

function parseRssXml(xml: string, publication: string): SubstackResult[] {
    const itemRegex = /<item>([\s\S]*?)<\/item>/gs;
    const items: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = itemRegex.exec(xml)) !== null && items.length < 50) {
        items.push(match[1] ?? '');
    }
    return items.map(item => {
        const title = item.match(/<title>(?:<!\[CDATA\[(.*?)\]\]>|(.*?))<\/title>/s)?.[1]?.trim() || '';
        const link = item.match(/<link>(.*?)<\/link>/s)?.[1]?.trim() || '';
        const author = item.match(/<dc:creator>(?:<!\[CDATA\[(.*?)\]\]>|(.*?))<\/dc:creator>/s)?.[1]?.trim() || '';
        const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/s)?.[1]?.trim() || '';
        const description = item.match(/<description>(?:<!\[CDATA\[(.*?)\]\]>|(.*?))<\/description>/s)?.[1] || '';
        const contentEncoded = item.match(/<content:encoded>(?:<!\[CDATA\[(.*?)\]\]>|(.*?))<\/content:encoded>/s)?.[1] || '';
        const categories: string[] = [];
        const catRegex = /<category>(?:<!\[CDATA\[(.*?)\]\]>|(.*?))<\/category>/gs;
        let catMatch: RegExpExecArray | null;
        while ((catMatch = catRegex.exec(item)) !== null) {
            categories.push((catMatch[1] ?? '').trim());
        }
        const summary = stripHtmlWithRegex(description).slice(0, 500);
        const bodyHtml = contentEncoded || description;
        const wordCount = stripHtmlWithRegex(bodyHtml).split(/\s+/).filter(Boolean).length;
        const paywallPatterns = /\bupgrade to read\b|\bsubscribe to continue\b|\bthis post is for paid subscribers\b/i;
        const combinedText = `${description} ${contentEncoded}`;
        const paywalled = (contentEncoded.length < 200 && description.length < 200) || paywallPatterns.test(combinedText);
        return {
            title,
            url: link,
            author,
            publishedAt: pubDate,
            summary,
            bodyHtml: bodyHtml.slice(0, 50000),
            wordCount,
            categories,
            publication,
            paywalled,
        };
    }).filter(r => r.title);
}

export async function searchSubstack(publications: string[], maxPosts: number = 50): Promise<ToolResponse<SubstackResult>> {
    return withCache('search_substack', CACHE_TTL_MS.search_substack, [publications, maxPosts], async () => {
        try {
            if (publications.length > 20) {
                return { query: publications.join(', '), count: 0, results: [], error: 'Too many publications (max 20)' };
            }
            if (publications.some(p => p.length > 100)) {
                return { query: publications.join(', '), count: 0, results: [], error: 'Publication name too long (max 100 chars)' };
            }
            const allResults: SubstackResult[] = [];
            for (const pub of publications) {
                const feedUrl = normalizePubUrl(pub);
                if (!feedUrl) continue;
                const resp = await fetchWithTimeout(feedUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResearchMCPServer/1.0)', 'Accept': 'application/rss+xml, application/xml, text/xml' },
                }, 2, true);
                if (!resp.ok) continue;
                const xml = await resp.text();
                if (xml.includes('Just a moment') || !xml.includes('<item>')) continue;
                const pubName = pub.replace(/^https?:\/\//, '').replace(/\.substack\.com.*$/, '').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'unknown';
                const results = parseRssXml(xml, pubName).slice(0, maxPosts);
                allResults.push(...results);
                if (allResults.length >= maxPosts) break;
            }
            return { query: publications.join(', '), count: allResults.length, results: allResults.slice(0, maxPosts) };
        } catch (err) {
            return { query: publications.join(', '), count: 0, results: [], error: `Substack search failed: ${(err as Error).message}` };
        }
    });
}

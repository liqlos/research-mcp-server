import { ToolResponse, withCache, CACHE_TTL_MS, fetchWithTimeout } from './research.js';

export interface BlueskyResult {
    uri: string;
    cid: string;
    text: string;
    author: { did: string; handle: string; displayName: string };
    createdAt: string;
    likeCount: number;
    repostCount: number;
    replyCount: number;
    url: string;
}

const BLUESKY_API = 'https://api.bsky.app/xrpc/app.bsky.feed.searchPosts';

interface BlueskyPost {
    post: {
        uri: string;
        cid: string;
        record: { text: string; createdAt: string };
        author: { did: string; handle: string; displayName?: string };
        likeCount?: number;
        repostCount?: number;
        replyCount?: number;
    };
}

export async function searchBluesky(query: string, maxResults: number = 10, sort: 'top' | 'latest' = 'top', until?: string): Promise<ToolResponse<BlueskyResult>> {
    return withCache('search_bluesky', CACHE_TTL_MS.search_bluesky, [query, maxResults, sort, until], async () => {
        try {
            if (query.length > 500) {
                return { query, count: 0, results: [], error: 'Query too long: maximum 500 characters allowed' };
            }
            const limit = Math.min(maxResults, 100);
            const params = new URLSearchParams({
                q: query,
                sort,
                limit: String(limit),
            });
            if (until) {
                if (until.length <= 30 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(until)) {
                    params.set('until', until);
                }
            }
            const url = `${BLUESKY_API}?${params}`;
            const resp = await fetchWithTimeout(url, {
                headers: { 'User-Agent': 'research-mcp-server/1.0' },
            }, 2, true);
            if (!resp.ok) {
                return { query, count: 0, results: [], error: `Bluesky API returned ${resp.status}` };
            }
            const data = await resp.json() as { posts?: BlueskyPost[] };
            const posts = data.posts || [];
            const results: BlueskyResult[] = posts.map(p => {
                const handle = p.post.author.handle;
                const rkey = p.post.uri.split('/').pop() || '';
                return {
                    uri: p.post.uri,
                    cid: p.post.cid,
                    text: p.post.record.text,
                    author: {
                        did: p.post.author.did,
                        handle,
                        displayName: p.post.author.displayName || handle,
                    },
                    createdAt: p.post.record.createdAt,
                    likeCount: p.post.likeCount || 0,
                    repostCount: p.post.repostCount || 0,
                    replyCount: p.post.replyCount || 0,
                    url: `https://bsky.app/profile/${handle}/post/${rkey}`,
                };
            });
            return { query, count: results.length, results: results.slice(0, limit) };
        } catch (err) {
            return { query, count: 0, results: [], error: `Bluesky search failed: ${(err as Error).message}` };
        }
    });
}

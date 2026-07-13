import { ToolResponse, withCache, CACHE_TTL_MS, fetchWithTimeout } from './research.js';

export interface VkResult {
    id: number;
    text: string;
    author: string;
    authorId: number;
    likes: number;
    reposts: number;
    comments: number;
    date: number;
    url: string;
}

const VK_API = 'https://api.vk.ru/method/';
const VK_VERSION = '5.131';

interface VkPost {
    id: number;
    text: string;
    from_id: number;
    date: number;
    likes: { count: number };
    reposts: { count: number };
    comments: { count: number };
}

interface VkUser {
    id: number;
    first_name: string;
    last_name: string;
    name: string;
}

export async function searchVk(query: string, maxResults: number = 10): Promise<ToolResponse<VkResult>> {
    if (!query || query.trim().length === 0 || query.length > 500) {
        return { query, count: 0, results: [], error: 'Invalid query (max 500 chars)' };
    }
    const limit = Math.max(1, Math.min(maxResults, 200));
    return withCache('search_vk', CACHE_TTL_MS.search_vk, [query, limit], async () => {
        try {
            const token = process.env.VK_ACCESS_TOKEN;
            if (!token) {
                return { query, count: 0, results: [], error: 'VK_ACCESS_TOKEN environment variable not set' };
            }
            const searchUrl = `${VK_API}newsfeed.search?q=${encodeURIComponent(query)}&count=${limit}&extended=1&v=${VK_VERSION}`;
            const resp = await fetchWithTimeout(searchUrl, {
                headers: { 'User-Agent': 'research-mcp-server/1.0', 'Authorization': `Bearer ${token}` },
            }, 2, true);
            if (!resp.ok) {
                return { query, count: 0, results: [], error: `VK API returned ${resp.status}` };
            }
            const data = await resp.json() as {
                response?: { items?: VkPost[]; profiles?: VkUser[]; groups?: VkUser[] };
                error?: { error_msg?: string };
            };
            if (data.error) {
                return { query, count: 0, results: [], error: data.error.error_msg || 'VK API error' };
            }
            const posts = data.response?.items || [];
            const profiles = new Map<number, string>();
            for (const p of data.response?.profiles || []) {
                profiles.set(p.id, p.name || `${p.first_name} ${p.last_name}`);
            }
            for (const g of data.response?.groups || []) {
                profiles.set(-g.id, g.name);
            }
            const results: VkResult[] = posts.map(post => ({
                id: post.id,
                text: post.text,
                author: profiles.get(post.from_id) || `id${post.from_id}`,
                authorId: post.from_id,
                likes: post.likes?.count || 0,
                reposts: post.reposts?.count || 0,
                comments: post.comments?.count || 0,
                date: post.date,
                url: `https://vk.com/wall${post.from_id}_${post.id}`,
            }));
            return { query, count: results.length, results: results.slice(0, maxResults) };
        } catch (err) {
            const msg = (err as Error).message || '';
            return { query, count: 0, results: [], error: `VK search failed: ${msg}` };
        }
    });
}

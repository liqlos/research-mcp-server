import { ToolResponse, withCache, CACHE_TTL_MS, fetchWithTimeout, validateUrl } from './research.js';

export interface MastodonResult {
    id: string;
    content: string;
    account: { id: string; username: string; displayName: string; url: string };
    createdAt: string;
    favouritesCount: number;
    reblogsCount: number;
    repliesCount: number;
    url: string;
    instance: string;
}

const DEFAULT_INSTANCES = [
    'mastodon.social',
    'fosstodon.org',
    'hachyderm.io',
    'mastodon.world',
    'techhub.social',
];

interface MastodonStatus {
    id: string;
    content: string;
    account: { id: string; username: string; display_name: string; url: string };
    created_at: string;
    favourites_count: number;
    reblogs_count: number;
    replies_count: number;
    url: string;
}

function sanitizeInstance(instance: string): string | null {
    const sanitized = instance.toLowerCase().replace(/[^a-z0-9.-]/g, '').replace(/^\.+|\.+$/g, '');
    if (!sanitized || sanitized.includes('..')) return null;
    return sanitized;
}

async function searchInstance(instance: string, query: string, limit: number): Promise<{ results: MastodonResult[]; error?: string }> {
    try {
        const url = `https://${instance}/api/v2/search?q=${encodeURIComponent(query)}&type=statuses&limit=${limit}`;
        const resp = await fetchWithTimeout(url, {
            headers: { 'User-Agent': 'research-mcp-server/1.0' },
        }, 1, true);
        if (!resp.ok) return { results: [], error: `Instance ${instance} returned HTTP ${resp.status}` };
        const data = await resp.json() as { statuses?: MastodonStatus[] };
        return { results: (data.statuses || []).map(s => ({
            id: s.id,
            content: s.content.replace(/<[^>]+>/g, '').trim(),
            account: {
                id: s.account.id,
                username: s.account.username,
                displayName: s.account.display_name || s.account.username,
                url: s.account.url,
            },
            createdAt: s.created_at,
            favouritesCount: s.favourites_count,
            reblogsCount: s.reblogs_count,
            repliesCount: s.replies_count,
            url: s.url,
            instance,
        })) };
    } catch (err) {
        return { results: [], error: `Instance ${instance} error: ${(err as Error).message}` };
    }
}

async function fetchTrendingStatuses(instance: string, limit: number): Promise<{ results: MastodonResult[]; error?: string }> {
    try {
        const url = `https://${instance}/api/v1/trends/statuses?limit=${limit}`;
        const resp = await fetchWithTimeout(url, {
            headers: { 'User-Agent': 'research-mcp-server/1.0' },
        }, 1, true);
        if (!resp.ok) return { results: [], error: `Instance ${instance} returned HTTP ${resp.status}` };
        const data = await resp.json() as MastodonStatus[];
        return { results: data.map(s => ({
            id: s.id,
            content: s.content.replace(/<[^>]+>/g, '').trim(),
            account: {
                id: s.account.id,
                username: s.account.username,
                displayName: s.account.display_name || s.account.username,
                url: s.account.url,
            },
            createdAt: s.created_at,
            favouritesCount: s.favourites_count,
            reblogsCount: s.reblogs_count,
            repliesCount: s.replies_count,
            url: s.url,
            instance,
        })) };
    } catch (err) {
        return { results: [], error: `Instance ${instance} error: ${(err as Error).message}` };
    }
}

export async function searchMastodon(
    query: string,
    maxResults: number = 10,
    instances?: string[],
): Promise<ToolResponse<MastodonResult>> {
    return withCache('search_mastodon', CACHE_TTL_MS.search_mastodon, [query, maxResults, instances], async () => {
        try {
            if (query.length > 500) {
                return { query, count: 0, results: [], error: 'Query too long (max 500 chars)' };
            }
            if (maxResults > 40) {
                return { query, count: 0, results: [], error: 'Limit too high (max 40)' };
            }
            if (instances && instances.length > 10) {
                return { query, count: 0, results: [], error: 'Too many instances (max 10)' };
            }
            const rawInstances = instances && instances.length > 0 ? instances : DEFAULT_INSTANCES;
            const targetInstances: string[] = [];
            const errors: string[] = [];
            for (const inst of rawInstances) {
                const sanitized = sanitizeInstance(inst);
                if (!sanitized) {
                    errors.push(`Invalid instance name: ${inst}`);
                    continue;
                }
                if (!validateUrl(`https://${sanitized}`)) {
                    errors.push(`Blocked instance: ${sanitized}`);
                    continue;
                }
                targetInstances.push(sanitized);
            }
            const limit = Math.min(maxResults, 40);
            if (query.trim()) {
                const instanceResults = await Promise.all(
                    targetInstances.map(inst => searchInstance(inst, query, limit)),
                );
                for (const r of instanceResults) {
                    if (r.error) errors.push(r.error);
                }
                const allResults = instanceResults.flatMap(r => r.results).sort((a, b) => b.favouritesCount - a.favouritesCount);
                const result: ToolResponse<MastodonResult> = { query, count: allResults.length, results: allResults.slice(0, maxResults) };
                if (errors.length > 0) {
                    result.error = errors.join('; ');
                }
                return result;
            }
            const trending = await Promise.all(
                targetInstances.slice(0, 3).map(inst => fetchTrendingStatuses(inst, limit)),
            );
            for (const r of trending) {
                if (r.error) errors.push(r.error);
            }
            const allResults = trending.flatMap(r => r.results).sort((a, b) => b.favouritesCount - a.favouritesCount);
            const result: ToolResponse<MastodonResult> = { query, count: allResults.length, results: allResults.slice(0, maxResults) };
            if (errors.length > 0) {
                result.error = errors.join('; ');
            }
            return result;
        } catch (err) {
            return { query, count: 0, results: [], error: `Mastodon search failed: ${(err as Error).message}` };
        }
    });
}

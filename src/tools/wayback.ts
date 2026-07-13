import { ToolResponse, withCache, CACHE_TTL_MS, fetchWithTimeout, validateUrl } from './research.js';

export interface WaybackResult {
    originalUrl: string;
    isDead: boolean;
    statusCode: number;
    archivedUrl: string;
    timestamp: string;
    captureDate: string;
    mimeType: string;
    error?: string;
}

export async function resurrectDeadLink(url: string, targetDate?: string): Promise<ToolResponse<WaybackResult>> {
    return withCache('resurrect_dead_link', CACHE_TTL_MS.resurrect_dead_link, [url, targetDate], async () => {
        if (!validateUrl(url)) {
            return { query: url, count: 0, results: [], error: 'Invalid or blocked URL' };
        }
        try {
            if (url.length > 2000) {
                return { query: url, count: 0, results: [], error: 'URL too long (max 2000 chars)' };
            }
            if (targetDate) {
                if (!/^\d{8}$/.test(targetDate)) {
                    return { query: url, count: 0, results: [], error: 'targetDate must be 8 digits' };
                }
                const year = parseInt(targetDate.slice(0, 4), 10);
                const month = parseInt(targetDate.slice(4, 6), 10);
                const day = parseInt(targetDate.slice(6, 8), 10);
                if (isNaN(year) || isNaN(month) || isNaN(day) || year < 1990 || year > 2030 || month < 1 || month > 12 || day < 1 || day > 31) {
                    return { query: url, count: 0, results: [], error: 'targetDate has invalid year/month/day' };
                }
            }
            let isDead = false;
            let statusCode = 200;
            let mimeType = '';
            try {
                const checkResp = await fetchWithTimeout(url, {
                    method: 'HEAD',
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResearchMCPServer/1.0)' },
                }, 1, true);
                statusCode = checkResp.status;
                mimeType = checkResp.headers.get('content-type') || '';
                if (checkResp.status === 404 || checkResp.status === 410 || checkResp.status >= 500) {
                    isDead = true;
                }
            } catch {
                isDead = true;
                statusCode = 0;
            }

            if (!isDead && statusCode === 200) {
                try {
                    const getResp = await fetchWithTimeout(url, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResearchMCPServer/1.0)' },
                    }, 1, true);
                    if (getResp.ok) {
                        const body = (await getResp.text()).slice(0, 2000).toLowerCase();
                        if (body.includes('404') || body.includes('not found') || body.includes('page not found')) {
                            isDead = true;
                        }
                    }
                } catch {
                    isDead = true;
                }
            }

            if (!isDead) {
                return {
                    query: url,
                    count: 1,
                    results: [{
                        originalUrl: url,
                        isDead: false,
                        statusCode,
                        archivedUrl: url,
                        timestamp: '',
                        captureDate: '',
                        mimeType,
                    }],
                };
            }

            const availabilityUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}${targetDate ? `&timestamp=${targetDate}` : ''}`;
            const resp = await fetchWithTimeout(availabilityUrl, {
                headers: { 'User-Agent': 'research-mcp-server/1.0' },
            }, 2, false);
            if (!resp.ok) {
                return { query: url, count: 0, results: [], error: `Wayback API returned ${resp.status}` };
            }
            const data = await resp.json() as {
                archived_snapshots?: {
                    closest?: {
                        available: boolean;
                        url: string;
                        timestamp: string;
                        status: string;
                    };
                };
            };
            const closest = data.archived_snapshots?.closest;
            if (!closest || !closest.available) {
                return {
                    query: url,
                    count: 1,
                    results: [{
                        originalUrl: url,
                        isDead: true,
                        statusCode,
                        archivedUrl: '',
                        timestamp: '',
                        captureDate: '',
                        mimeType: '',
                        error: 'No archived version found',
                    }],
                };
            }
            const captureDate = closest.timestamp
                ? `${closest.timestamp.slice(0, 4)}-${closest.timestamp.slice(4, 6)}-${closest.timestamp.slice(6, 8)}`
                : '';
            let archivedMimeType = '';
            try {
                const archResp = await fetchWithTimeout(closest.url, {
                    method: 'HEAD',
                    headers: { 'User-Agent': 'research-mcp-server/1.0' },
                }, 1, false);
                archivedMimeType = archResp.headers.get('content-type') || '';
            } catch {
                archivedMimeType = '';
            }
            return {
                query: url,
                count: 1,
                results: [{
                    originalUrl: url,
                    isDead: true,
                    statusCode,
                    archivedUrl: closest.url,
                    timestamp: closest.timestamp,
                    captureDate,
                    mimeType: archivedMimeType,
                }],
            };
        } catch (err) {
            return { query: url, count: 0, results: [], error: `Dead link resurrection failed: ${(err as Error).message}` };
        }
    });
}

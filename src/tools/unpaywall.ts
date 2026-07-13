import { ToolResponse, withCache, fetchWithTimeout, CACHE_TTL_MS } from './research.js';

export interface OpenAccessResult {
    doi: string;
    title: string;
    authors: string[];
    publishedYear: number;
    isOpenAccess: boolean;
    oaStatus: string;
    bestOaLocation: {
        url: string;
        hostType: string;
        version: string;
        license: string;
        pdfUrl: string;
    } | null;
    oaLocations: Array<{
        url: string;
        hostType: string;
        version: string;
        pdfUrl: string;
    }>;
}

const UNPAYWALL_EMAIL = 'research-mcp-server@apify.com';

interface UnpaywallAuthor {
    family?: string;
    given?: string;
}

interface UnpaywallLocation {
    url: string | null;
    host_type: string | null;
    version: string | null;
    license: string | null;
    pdf_url: string | null;
}

interface UnpaywallResponse {
    doi: string | null;
    title: string | null;
    authors: UnpaywallAuthor[] | null;
    year: number | null;
    is_oa: boolean | null;
    oa_status: string | null;
    best_oa_location: UnpaywallLocation | null;
    oa_locations: UnpaywallLocation[] | null;
}

function mapBestOaLocation(loc: UnpaywallLocation | null) {
    if (!loc) return null;
    return {
        url: loc.url || '',
        hostType: loc.host_type || '',
        version: loc.version || '',
        license: loc.license || '',
        pdfUrl: loc.pdf_url || '',
    };
}

function mapOaLocation(loc: UnpaywallLocation) {
    return {
        url: loc.url || '',
        hostType: loc.host_type || '',
        version: loc.version || '',
        pdfUrl: loc.pdf_url || '',
    };
}

export async function resolveOpenAccess(doi: string): Promise<ToolResponse<OpenAccessResult>> {
    return withCache('resolve_open_access', CACHE_TTL_MS.resolve_open_access, [doi], async () => {
        try {
            const normalizedDoi = doi.replace(/^doi:/i, '').trim();
            const url = `https://api.unpaywall.org/v2/${encodeURIComponent(normalizedDoi)}?email=${encodeURIComponent(UNPAYWALL_EMAIL)}`;
            const resp = await fetchWithTimeout(url);
            if (!resp.ok) {
                return { query: doi, count: 0, results: [], error: `Unpaywall API returned HTTP ${resp.status}` };
            }
            const data = await resp.json() as UnpaywallResponse;
            const authors = (data.authors || []).map(a => {
                if (a.given && a.family) return `${a.given} ${a.family}`;
                return a.family || a.given || '';
            }).filter(Boolean);
            const result: OpenAccessResult = {
                doi: data.doi || normalizedDoi,
                title: data.title || '',
                authors,
                publishedYear: data.year || 0,
                isOpenAccess: data.is_oa || false,
                oaStatus: data.oa_status || 'unknown',
                bestOaLocation: mapBestOaLocation(data.best_oa_location),
                oaLocations: (data.oa_locations || []).map(mapOaLocation),
            };
            return { query: doi, count: 1, results: [result] };
        } catch (err) {
            return { query: doi, count: 0, results: [], error: `Resolve open access failed: ${(err as Error).message}` };
        }
    });
}

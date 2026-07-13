import { ToolResponse, withCache, CACHE_TTL_MS, fetchWithTimeout } from './research.js';

export interface OsmResult {
    id: number;
    name: string;
    type: string;
    amenity: string;
    lat: number;
    lon: number;
    tags: Record<string, string>;
}

const OVERPASS_ENDPOINTS = [
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass-api.de/api/interpreter',
];

const NOMINATIM_UA = 'research-mcp-server/1.0 (contact@example.com)';

function sanitizeOverpassQuery(input: string): string {
    const stripped = input.replace(/[\r\n]/g, '').slice(0, 100);
    return stripped.replace(/[.*+?^${}()|[\]\\"]/g, '\\$&');
}

async function geocode(address: string): Promise<{ lat: number; lon: number } | null> {
    try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
        const resp = await fetchWithTimeout(url, {
            headers: { 'User-Agent': NOMINATIM_UA },
        }, 1, false);
        if (!resp.ok) return null;
        const data = await resp.json() as Array<{ lat: string; lon: string }>;
        if (data.length === 0) return null;
        const first = data[0]!;
        const lat = parseFloat(first.lat);
        const lon = parseFloat(first.lon);
        if (isNaN(lat) || isNaN(lon)) return null;
        return { lat, lon };
    } catch {
        return null;
    }
}

async function callOverpass(query: string): Promise<{ elements: Array<{ type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }> }> {
    let lastError: Error | null = null;
    for (const endpoint of OVERPASS_ENDPOINTS) {
        try {
            const resp = await fetchWithTimeout(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain', 'User-Agent': NOMINATIM_UA },
                body: query,
            }, 2, true);
            if (!resp.ok) {
                lastError = new Error(`Overpass returned ${resp.status}`);
                continue;
            }
            return await resp.json();
        } catch (err) {
            lastError = err as Error;
        }
    }
    throw lastError || new Error('All Overpass endpoints failed');
}

export async function searchOsm(
    query: string,
    location?: string,
    radius?: number,
    bbox?: { latBottom: number; latTop: number; lonLeft: number; lonRight: number },
    maxResults: number = 50,
): Promise<ToolResponse<OsmResult>> {
    if (!query || query.length > 200) {
        return { query, count: 0, results: [], error: 'Invalid query (max 200 chars)' };
    }
    if (location && location.length > 200) {
        return { query, count: 0, results: [], error: 'Invalid location (max 200 chars)' };
    }
    if (radius !== undefined && (radius < 0 || radius > 50000)) {
        return { query, count: 0, results: [], error: 'Invalid radius (must be 0-50000)' };
    }
    if (bbox && (bbox.latBottom >= bbox.latTop || bbox.lonLeft >= bbox.lonRight)) {
        return { query, count: 0, results: [], error: 'Invalid bbox: latBottom must be < latTop and lonLeft must be < lonRight' };
    }
    return withCache('search_osm', CACHE_TTL_MS.search_osm, [query, location, radius, bbox, maxResults], async () => {
        try {
            const safeQuery = sanitizeOverpassQuery(query);
            let overpassQl: string;
            if (location) {
                const coords = await geocode(location);
                if (!coords) {
                    return { query, count: 0, results: [], error: `Geocoding failed for location: ${location}` };
                }
                const r = radius || 1000;
                overpassQl = `[out:json][timeout:25];(nwr["name"~"${safeQuery}",i](around:${r},${coords.lat},${coords.lon});nwr["amenity"~"${safeQuery}",i](around:${r},${coords.lat},${coords.lon}););out center;`;
            } else if (bbox) {
                const { latBottom, latTop, lonLeft, lonRight } = bbox;
                overpassQl = `[out:json][timeout:25];(nwr["name"~"${safeQuery}",i](${latBottom},${lonLeft},${latTop},${lonRight});nwr["amenity"~"${safeQuery}",i](${latBottom},${lonLeft},${latTop},${lonRight}););out center;`;
            } else {
                overpassQl = `[out:json][timeout:25];(nwr["name"~"${safeQuery}",i];nwr["amenity"~"${safeQuery}",i];);out center;`;
            }
            const data = await callOverpass(overpassQl);
            const results: OsmResult[] = data.elements.slice(0, maxResults).map(el => ({
                id: el.id,
                name: el.tags?.name || '',
                type: el.type,
                amenity: el.tags?.amenity || '',
                lat: el.lat ?? el.center?.lat ?? 0,
                lon: el.lon ?? el.center?.lon ?? 0,
                tags: el.tags || {},
            }));
            return { query, count: results.length, results };
        } catch (err) {
            return { query, count: 0, results: [], error: `OSM search failed: ${(err as Error).message}` };
        }
    });
}

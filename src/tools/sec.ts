import { ToolResponse, withCache, fetchWithTimeout, CACHE_TTL_MS } from './research.js';

export interface SecFilingResult {
    form: string;
    filingDate: string;
    accessionNumber: string;
    primaryDocument: string;
    primaryDocDescription: string;
    url: string;
}

const SEC_USER_AGENT = 'research-mcp-server/1.0 (contact@example.com)';

interface TickerEntry {
    cik_str: number;
    ticker: string;
    title: string;
}

const TICKER_CACHE_TTL_MS = 86_400_000;

let tickerCache: TickerEntry[] | undefined;
let tickerCacheTimestamp: number | undefined;

async function loadTickerMap(): Promise<TickerEntry[]> {
    if (tickerCache && tickerCacheTimestamp && Date.now() - tickerCacheTimestamp < TICKER_CACHE_TTL_MS) return tickerCache;
    try {
        const resp = await fetchWithTimeout('https://www.sec.gov/files/company_tickers.json', {
            headers: { 'User-Agent': SEC_USER_AGENT },
        }, 2, true);
        if (!resp.ok) return [];
        const data = await resp.json() as Record<string, TickerEntry>;
        tickerCache = Object.values(data);
        tickerCacheTimestamp = Date.now();
        return tickerCache;
    } catch {
        return [];
    }
}

async function resolveCik(query: string): Promise<{ cik: number; name: string } | undefined> {
    const tickers = await loadTickerMap();
    if (tickers.length === 0) return undefined;
    const upperQuery = query.toUpperCase().trim();
    const byTicker = tickers.find(t => t.ticker === upperQuery);
    if (byTicker) return { cik: byTicker.cik_str, name: byTicker.title };
    const byName = tickers.find(t => t.title.toUpperCase().includes(upperQuery));
    if (byName) return { cik: byName.cik_str, name: byName.title };
    return undefined;
}

function padCik(cik: number): string {
    return String(cik).padStart(10, '0');
}

interface SecSubmission {
    form: string;
    filingDate: string;
    accessionNumber: string;
    primaryDocument: string;
    primaryDocDescription: string;
}

export async function searchSecFilings(
    query: string,
    filingType: string = 'ALL',
    maxResults: number = 10,
): Promise<ToolResponse<SecFilingResult>> {
    if (!query || query.length > 100) {
        return { query, count: 0, results: [], error: 'Invalid query (max 100 chars)' };
    }
    const limit = Math.min(maxResults, 50);
    return withCache('search_sec_filings', CACHE_TTL_MS.search_sec_filings, [query, filingType, limit], async () => {
        try {
            const resolved = await resolveCik(query);
            if (!resolved) {
                return { query, count: 0, results: [], error: `Could not resolve ticker or company name: ${query}` };
            }
            const paddedCik = padCik(resolved.cik);
            const url = `https://data.sec.gov/submissions/CIK${paddedCik}.json`;
            const resp = await fetchWithTimeout(url, {
                headers: { 'User-Agent': SEC_USER_AGENT },
            }, 2, true);
            if (!resp.ok) {
                return { query, count: 0, results: [], error: `SEC submissions request failed: HTTP ${resp.status}` };
            }
            const data = await resp.json() as {
                filings?: {
                    recent?: {
                        form: string[];
                        filingDate: string[];
                        accessionNumber: string[];
                        primaryDocument: string[];
                        primaryDocDescription: string[];
                    };
                };
            };
            const recent = data.filings?.recent;
            if (!recent) {
                return { query, count: 0, results: [], error: 'No recent filings found' };
            }
            const filings: SecSubmission[] = [];
            const maxLen = Math.min(
                recent.form.length,
                recent.filingDate.length,
                recent.accessionNumber.length,
                recent.primaryDocument.length,
                recent.primaryDocDescription.length,
            );
            for (let i = 0; i < maxLen; i++) {
                filings.push({
                    form: recent.form[i] ?? '',
                    filingDate: recent.filingDate[i] ?? '',
                    accessionNumber: recent.accessionNumber[i] ?? '',
                    primaryDocument: recent.primaryDocument[i] ?? '',
                    primaryDocDescription: recent.primaryDocDescription[i] ?? '',
                });
            }
            const filterType = filingType.toUpperCase();
            const filtered = filterType === 'ALL'
                ? filings
                : filings.filter(f => f.form === filterType);
            const results: SecFilingResult[] = filtered.slice(0, limit).map(f => {
                const accessionNoDashes = f.accessionNumber.replace(/-/g, '');
                const filingUrl = `https://www.sec.gov/Archives/edgar/data/${resolved.cik}/${accessionNoDashes}/${f.primaryDocument}`;
                return {
                    form: f.form,
                    filingDate: f.filingDate,
                    accessionNumber: f.accessionNumber,
                    primaryDocument: f.primaryDocument,
                    primaryDocDescription: f.primaryDocDescription,
                    url: filingUrl,
                };
            });
            return { query, count: results.length, results };
        } catch (err) {
            return { query, count: 0, results: [], error: `SEC filing search failed: ${(err as Error).message}` };
        }
    });
}

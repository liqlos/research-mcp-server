import { ToolResponse, withCache, CACHE_TTL_MS, fetchWithTimeout } from './research.js';

export interface PubmedResult {
    pmid: string;
    title: string;
    authors: string[];
    journal: string;
    publishedDate: string;
    abstract: string;
    doi: string;
    url: string;
    source: string;
}

export async function searchPubmed(query: string, maxResults: number = 10): Promise<ToolResponse<PubmedResult>> {
    return withCache('search_pubmed', CACHE_TTL_MS.search_pubmed, [query, maxResults], async () => {
        try {
            if (!query || query.trim().length < 2) {
                return { query, count: 0, results: [], error: 'Query too short (min 2 chars)' };
            }
            if (maxResults < 1 || maxResults > 50) {
                maxResults = Math.min(Math.max(maxResults, 1), 50);
            }
            const results = await searchPubMedEutils(query, maxResults);
            if (results.length > 0) return { query, count: results.length, results };
            const fallback = await searchEuropePmc(query, maxResults);
            return { query, count: fallback.length, results: fallback };
        } catch (err) {
            return { query, count: 0, results: [], error: `PubMed search failed: ${(err as Error).message}` };
        }
    });
}

async function searchPubMedEutils(query: string, maxResults: number): Promise<PubmedResult[]> {
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${maxResults}&retmode=json`;
    const searchResp = await fetchWithTimeout(searchUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResearchMCPServer/1.0)' },
    }, 2, true);
    if (!searchResp.ok) return [];
    const searchData = await searchResp.json() as { esearchresult?: { idlist?: string[] } };
    const ids = searchData.esearchresult?.idlist ?? [];
    if (ids.length === 0) return [];

    const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`;
    const summaryResp = await fetchWithTimeout(summaryUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResearchMCPServer/1.0)' },
    }, 2, true);
    if (!summaryResp.ok) return [];
    const summaryData = await summaryResp.json() as { result?: { uids?: string[], [key: string]: any } };
    const uids = summaryData.result?.uids ?? [];
    return uids.map(uid => {
        const article = summaryData.result?.[uid] ?? {};
        const authors = Array.isArray(article.authors)
            ? article.authors.map((a: any) => a.name).filter(Boolean)
            : [];
        const pubDate = article.pubdate ?? '';
        const doi = Array.isArray(article.articleids)
            ? (article.articleids.find((id: any) => id.idtype === 'doi')?.value ?? '')
            : '';
        return {
            pmid: uid,
            title: article.title ?? '',
            authors,
            journal: article.fulljournalname ?? article.source ?? '',
            publishedDate: pubDate,
            abstract: '',
            doi,
            url: `https://pubmed.ncbi.nlm.nih.gov/${uid}/`,
            source: 'pubmed',
        };
    }).filter((r: PubmedResult) => r.title);
}

async function searchEuropePmc(query: string, maxResults: number): Promise<PubmedResult[]> {
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&pageSize=${maxResults}`;
    const resp = await fetchWithTimeout(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResearchMCPServer/1.0)' },
    }, 2, true);
    if (!resp.ok) return [];
    const data = await resp.json() as { resultList?: { result?: any[] } };
    const results = data.resultList?.result ?? [];
    return results.map((article: any) => ({
        pmid: article.pmid ?? article.id ?? '',
        title: article.title ?? '',
        authors: (article.authorString ?? '').split(', ').filter(Boolean),
        journal: article.journalTitle ?? '',
        publishedDate: article.firstPublicationDate ?? '',
        abstract: article.abstractText ?? '',
        doi: article.doi ?? '',
        url: article.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${article.pmid}/` : `https://europepmc.org/article/${article.source}/${article.id}`,
        source: 'europepmc',
    })).filter((r: PubmedResult) => r.title);
}

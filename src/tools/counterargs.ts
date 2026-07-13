import { ToolResponse, withCache, CACHE_TTL_MS, fetchWithTimeout, ProgressCallback } from './research.js';

export interface CounterArgumentResult {
    claim: string;
    supportingPapers: Array<{ paperId: string; title: string; authors: string[]; year: number; url: string; abstract: string; confidence: number }>;
    contrastingPapers: Array<{ paperId: string; title: string; authors: string[]; year: number; url: string; abstract: string; confidence: number }>;
    mentioningPapers: Array<{ paperId: string; title: string; authors: string[]; year: number; url: string; abstract: string; confidence: number }>;
    totalFound: number;
}

interface SemanticScholarPaper {
    paperId: string;
    title: string;
    authors: Array<{ name: string }>;
    year: number;
    url: string;
    abstract: string;
    citationCount: number;
    influentialCitationCount: number;
}

async function searchSemanticScholar(query: string, limit: number): Promise<SemanticScholarPaper[]> {
    try {
        const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&fields=paperId,title,authors,year,url,abstract,citationCount,influentialCitationCount&limit=${limit}`;
        const resp = await fetchWithTimeout(url, {
            headers: { 'User-Agent': 'research-mcp-server/1.0' },
        }, 2, true);
        if (!resp.ok) return [];
        const data = await resp.json() as { data?: SemanticScholarPaper[] };
        return data.data || [];
    } catch {
        return [];
    }
}

async function searchOpenAlex(query: string, limit: number): Promise<SemanticScholarPaper[]> {
    try {
        const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per_page=${limit}&select=id,title,publication_year,doi,abstract_inverted_index,authorships`;
        const resp = await fetchWithTimeout(url, {
            headers: { 'User-Agent': 'research-mcp-server/1.0' },
        }, 2, true);
        if (!resp.ok) return [];
        const data = await resp.json() as { results?: Array<{
            id: string;
            title: string;
            publication_year: number;
            doi: string;
            abstract_inverted_index: Record<string, number[]>;
            authorships: Array<{ author: { display_name: string } }>;
        }> };
        return (data.results || []).map(work => {
            const abstract = work.abstract_inverted_index
                ? Object.entries(work.abstract_inverted_index)
                    .sort((a, b) => (a[1][0] || 0) - (b[1][0] || 0))
                    .map(([word]) => word)
                    .join(' ')
                : '';
            return {
                paperId: work.id,
                title: work.title || '',
                authors: work.authorships.map(a => ({ name: a.author.display_name })),
                year: work.publication_year || 0,
                url: work.doi ? `https://doi.org/${work.doi}` : work.id,
                abstract,
                citationCount: 0,
                influentialCitationCount: 0,
            };
        });
    } catch {
        return [];
    }
}

function classifyPapers(papers: SemanticScholarPaper[]): {
    supporting: Array<SemanticScholarPaper & { confidence: number }>;
    contrasting: Array<SemanticScholarPaper & { confidence: number }>;
    mentioning: Array<SemanticScholarPaper & { confidence: number }>;
} {
    const contrastKeywords = ['however', 'but', 'contrary', 'dispute', 'refute', 'challenge', 'criticize', 'fail', 'incorrect', 'wrong', 'debunk', 'question', 'doubt', 'limitation', 'flaw'];
    const supportKeywords = ['confirm', 'support', 'agree', 'demonstrate', 'prove', 'show', 'consistent', 'validate', 'corroborate', 'evidence'];

    const supporting: Array<SemanticScholarPaper & { confidence: number }> = [];
    const contrasting: Array<SemanticScholarPaper & { confidence: number }> = [];
    const mentioning: Array<SemanticScholarPaper & { confidence: number }> = [];

    for (const paper of papers) {
        const text = `${paper.title} ${paper.abstract}`.toLowerCase();
        const contrastHits = contrastKeywords.filter(kw => text.includes(kw));
        const supportHits = supportKeywords.filter(kw => text.includes(kw));
        const contrastConfidence = contrastHits.length / contrastKeywords.length;
        const supportConfidence = supportHits.length / supportKeywords.length;
        if (contrastConfidence > supportConfidence && contrastHits.length > 0) {
            contrasting.push({ ...paper, confidence: contrastConfidence });
        } else if (supportConfidence > contrastConfidence && supportHits.length > 0) {
            supporting.push({ ...paper, confidence: supportConfidence });
        } else {
            mentioning.push({ ...paper, confidence: Math.max(contrastConfidence, supportConfidence) });
        }
    }
    return { supporting, contrasting, mentioning };
}

function mapPaper(p: SemanticScholarPaper & { confidence: number }) {
    return {
        paperId: p.paperId,
        title: p.title,
        authors: p.authors.map(a => a.name),
        year: p.year,
        url: p.url,
        abstract: p.abstract || '',
        confidence: p.confidence,
    };
}

export async function findCounterArguments(query: string, maxResults: number = 10, onProgress?: ProgressCallback): Promise<ToolResponse<CounterArgumentResult>> {
    if (!query || query.length > 500) {
        return { query, count: 0, results: [], error: 'Invalid claim (max 500 chars)' };
    }
    const limit = Math.min(maxResults, 50);
    return withCache('find_counter_arguments', CACHE_TTL_MS.find_counter_arguments, [query, limit], async () => {
        try {
            const searchLimit = Math.min(limit * 3, 50);
            const [ssPapers, oaPapers] = await Promise.all([
                searchSemanticScholar(query, searchLimit).then(async (papers) => {
                    await onProgress?.(1, 2, `Fetched Semantic Scholar (${papers.length} papers)`);
                    return papers;
                }),
                searchOpenAlex(query, searchLimit).then(async (papers) => {
                    await onProgress?.(2, 2, `Fetched OpenAlex (${papers.length} papers)`);
                    return papers;
                }),
            ]);
            const seen = new Set<string>();
            const allPapers: SemanticScholarPaper[] = [];
            for (const p of [...ssPapers, ...oaPapers]) {
                if (!p.title) continue;
                const key = p.paperId || `${p.title.toLowerCase()}|${p.year || ''}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    allPapers.push(p);
                }
            }
            const { supporting, contrasting, mentioning } = classifyPapers(allPapers);
            const result: CounterArgumentResult = {
                claim: query,
                supportingPapers: supporting.slice(0, limit).map(mapPaper),
                contrastingPapers: contrasting.slice(0, limit).map(mapPaper),
                mentioningPapers: mentioning.slice(0, limit).map(mapPaper),
                totalFound: allPapers.length,
            };
            return { query, count: 1, results: [result] };
        } catch (err) {
            return { query, count: 0, results: [], error: `Counter-argument search failed: ${(err as Error).message}` };
        }
    });
}

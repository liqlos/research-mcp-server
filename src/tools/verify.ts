import { ToolResponse, withCache, fetchWithTimeout, CACHE_TTL_MS } from './research.js';

export interface CitationVerification {
    input: string;
    status: 'VERIFIED' | 'MISMATCH' | 'NOT_FOUND';
    doi?: string;
    title?: string;
    authors?: string[];
    year?: number;
    matchedTitle?: string;
    similarity?: number;
    source?: string;
    issues?: string[];
}

const DOI_REGEX = /10\.\d{4,}\/[^\s]+/;

interface CrossrefWork {
    DOI: string;
    title: string[];
    author: Array<{ given: string; family: string }>;
    'published-print'?: { 'date-parts': number[][] };
    'published-online'?: { 'date-parts': number[][] };
    'created'?: { 'date-parts': number[][] };
}

interface OpenAlexWork {
    id: string;
    title: string;
    doi: string;
    publication_year: number;
    authorships: Array<{ author: { display_name: string } }>;
}

function extractDoi(reference: string): string | undefined {
    const match = reference.match(DOI_REGEX);
    return match ? match[0].replace(/[.,;)]+$/, '') : undefined;
}

function extractTitleGuess(reference: string): string {
    const cleaned = reference.replace(DOI_REGEX, '').trim();
    const bibtexTitle = cleaned.match(/title\s*=\s*["{](.*?)["}]/i);
    if (bibtexTitle) return bibtexTitle[1] ?? '';
    const parts = cleaned.split(/[,.\s]+/).filter(Boolean);
    return parts.slice(0, 10).join(' ');
}

function normalizeTitle(title: string): string {
    return title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function titleSimilarity(a: string, b: string): number {
    const na = normalizeTitle(a);
    const nb = normalizeTitle(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    const wordsA = new Set(na.split(' '));
    const wordsB = new Set(nb.split(' '));
    let common = 0;
    for (const w of wordsA) {
        if (wordsB.has(w)) common++;
    }
    const union = wordsA.size + wordsB.size - common;
    return union > 0 ? common / union : 0;
}

function extractYear(reference: string): number | undefined {
    const match = reference.match(/\b(19|20)\d{2}\b/);
    if (!match) return undefined;
    const year = parseInt(match[0], 10);
    return isNaN(year) ? undefined : year;
}

async function fetchCrossrefByDoi(doi: string): Promise<{ title: string; authors: string[]; year: number; source: string } | undefined> {
    try {
        const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
        const resp = await fetchWithTimeout(url, {
            headers: { 'User-Agent': 'research-mcp-server/1.0 (mailto:research@example.com)' },
        }, 2, true);
        if (!resp.ok) return undefined;
        const data = await resp.json() as { message?: CrossrefWork };
        const work = data.message;
        if (!work) return undefined;
        const title = work.title?.[0] ?? '';
        const authors = (work.author || []).map(a => [a.given, a.family].filter(Boolean).join(' '));
        const yearParts = work['published-print']?.['date-parts']?.[0] || work['published-online']?.['date-parts']?.[0] || work['created']?.['date-parts']?.[0];
        const year = yearParts?.[0] ?? 0;
        return { title, authors, year, source: 'crossref' };
    } catch {
        return undefined;
    }
}

async function searchCrossrefByTitle(title: string): Promise<{ title: string; authors: string[]; year: number; doi: string; source: string } | undefined> {
    try {
        const url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(title)}&rows=1`;
        const resp = await fetchWithTimeout(url, {
            headers: { 'User-Agent': 'research-mcp-server/1.0 (mailto:research@example.com)' },
        }, 2, true);
        if (!resp.ok) return undefined;
        const data = await resp.json() as { message?: { items?: CrossrefWork[] } };
        const work = data.message?.items?.[0];
        if (!work) return undefined;
        const matchedTitle = work.title?.[0] ?? '';
        if (titleSimilarity(title, matchedTitle) < 0.3) return undefined;
        const authors = (work.author || []).map(a => [a.given, a.family].filter(Boolean).join(' '));
        const yearParts = work['published-print']?.['date-parts']?.[0] || work['published-online']?.['date-parts']?.[0] || work['created']?.['date-parts']?.[0];
        const year = yearParts?.[0] ?? 0;
        return { title: matchedTitle, authors, year, doi: work.DOI, source: 'crossref' };
    } catch {
        return undefined;
    }
}

async function searchOpenAlexByTitle(title: string): Promise<{ title: string; authors: string[]; year: number; doi: string; source: string } | undefined> {
    try {
        const url = `https://api.openalex.org/works?search=${encodeURIComponent(title)}&per_page=1`;
        const resp = await fetchWithTimeout(url, {
            headers: { 'User-Agent': 'research-mcp-server/1.0 (mailto:contact@example.com)' },
        }, 2, true);
        if (!resp.ok) return undefined;
        const data = await resp.json() as { results?: OpenAlexWork[] };
        const work = data.results?.[0];
        if (!work || !work.title) return undefined;
        if (titleSimilarity(title, work.title) < 0.3) return undefined;
        const authors = (work.authorships || []).map(a => a.author.display_name);
        return { title: work.title, authors, year: work.publication_year || 0, doi: work.doi || '', source: 'openalex' };
    } catch {
        return undefined;
    }
}

export async function verifySingleReference(reference: string): Promise<CitationVerification> {
    const doi = extractDoi(reference);
    const guessTitle = extractTitleGuess(reference);
    const guessYear = extractYear(reference);
    const issues: string[] = [];

    let matched: { title: string; authors: string[]; year: number; doi?: string; source: string } | undefined;

    if (doi) {
        const direct = await fetchCrossrefByDoi(doi);
        if (direct) {
            matched = { ...direct, doi };
        }
    }

    if (!matched && guessTitle) {
        const [crossref, openalex] = await Promise.all([
            searchCrossrefByTitle(guessTitle),
            searchOpenAlexByTitle(guessTitle),
        ]);
        const candidates = [crossref, openalex].filter(Boolean) as Array<{ title: string; authors: string[]; year: number; doi: string; source: string }>;
        if (candidates.length > 0) {
            candidates.sort((a, b) => titleSimilarity(guessTitle, b.title) - titleSimilarity(guessTitle, a.title));
            matched = candidates[0];
        }
    }

    if (!matched) {
        const notFound: CitationVerification = {
            input: reference,
            status: 'NOT_FOUND',
        };
        if (doi) notFound.doi = doi;
        if (guessTitle) notFound.title = guessTitle;
        if (guessYear) notFound.year = guessYear;
        return notFound;
    }

    const sim = titleSimilarity(guessTitle, matched.title);
    let status: 'VERIFIED' | 'MISMATCH' = 'VERIFIED';

    if (sim < 0.5) {
        status = 'MISMATCH';
        issues.push(`Title mismatch: expected "${guessTitle}", found "${matched.title}"`);
    }

    if (guessYear && matched.year && Math.abs(guessYear - matched.year) > 1) {
        status = 'MISMATCH';
        issues.push(`Year mismatch: expected ${guessYear}, found ${matched.year}`);
    }

    const result: CitationVerification = {
        input: reference,
        status,
        authors: matched.authors,
        matchedTitle: matched.title,
        similarity: Math.round(sim * 100) / 100,
        source: matched.source,
    };
    const resolvedDoi = matched.doi || doi;
    if (resolvedDoi) result.doi = resolvedDoi;
    if (guessTitle) result.title = guessTitle;
    if (matched.year) result.year = matched.year;
    if (issues.length > 0) result.issues = issues;
    return result;
}

export async function verifyCitations(references: string[], limit: number = 20): Promise<ToolResponse<CitationVerification>> {
    if (!references || references.length === 0) {
        return { query: 'verify_citations', count: 0, results: [], error: 'No references provided' };
    }
    if (references.length > 50) {
        return { query: 'verify_citations', count: 0, results: [], error: 'Max 50 references allowed' };
    }
    for (const ref of references) {
        if (ref.length > 1000) {
            return { query: 'verify_citations', count: 0, results: [], error: 'Each reference must be max 1000 chars' };
        }
    }
    const effectiveLimit = Math.min(limit, 50);
    const refsToProcess = references.slice(0, effectiveLimit);
    return withCache('verify_citations', CACHE_TTL_MS.verify_citations, [refsToProcess], async () => {
        try {
            const results = await Promise.allSettled(refsToProcess.map(ref => verifySingleReference(ref)));
            const verifications: CitationVerification[] = results.map((r, i) => {
                if (r.status === 'fulfilled') return r.value;
                return { input: refsToProcess[i] ?? '', status: 'NOT_FOUND' as const };
            });
            return { query: 'verify_citations', count: verifications.length, results: verifications };
        } catch (err) {
            return { query: 'verify_citations', count: 0, results: [], error: `Citation verification failed: ${(err as Error).message}` };
        }
    });
}

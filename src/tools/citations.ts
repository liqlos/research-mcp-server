import { ToolResponse, withCache, fetchWithTimeout, CACHE_TTL_MS } from './research.js';

export interface CitationResult {
    format: string;
    citation: string;
    title: string;
    authors: string[];
    year: number;
    doi: string;
    publisher: string;
    url: string;
}

const CROSSREF_USER_AGENT = 'research-mcp-server/1.0 (mailto:contact@example.com)';

interface CrossrefAuthor {
    given?: string;
    family?: string;
}

interface CrossrefWork {
    DOI?: string;
    title?: string[];
    author?: CrossrefAuthor[];
    published?: { 'date-parts'?: number[][] };
    'published-print'?: { 'date-parts'?: number[][] };
    'published-online'?: { 'date-parts'?: number[][] };
    containerTitle?: string[];
    publisher?: string;
    type?: string;
    URL?: string;
    volume?: string;
    issue?: string;
    page?: string;
    ISSN?: string[];
}

function extractYear(work: CrossrefWork): number {
    const sources = [work.published, work['published-print'], work['published-online']];
    for (const src of sources) {
        if (src?.['date-parts']?.[0]?.[0]) return src['date-parts'][0][0];
    }
    return 0;
}

function extractAuthors(work: CrossrefWork): string[] {
    if (!work.author) return [];
    return work.author.map(a => [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean);
}

function formatAuthorsBibtex(authors: string[]): string {
    return authors.join(' and ');
}

function formatAuthorsApa(authors: string[]): string {
    if (authors.length === 0) return '';
    return authors.map(a => {
        const parts = a.split(' ');
        if (parts.length < 2) return a;
        const family = parts[parts.length - 1];
        const given = parts.slice(0, -1).map(g => g.charAt(0)).join('. ');
        return `${family}, ${given}.`;
    }).join(', ');
}

function formatAuthorsMla(authors: string[]): string {
    if (authors.length === 0) return '';
    if (authors.length === 1) return authors[0] ?? '';
    if (authors.length === 2) return `${authors[0]} and ${authors[1]}`;
    return `${authors[0]} et al.`;
}

function formatAuthorsChicago(authors: string[]): string {
    if (authors.length === 0) return '';
    return authors.map(a => {
        const parts = a.split(' ');
        if (parts.length < 2) return a;
        const family = parts[parts.length - 1];
        const given = parts.slice(0, -1).join(' ');
        return `${family}, ${given}`;
    }).join(', ');
}

function escapeBibtex(str: string): string {
    return str.replace(/[&%$#_{}~^\\]/g, '\\$&');
}

function makeBibtexKey(title: string, year: number, authors: string[]): string {
    const firstAuthor = authors[0]?.split(' ').pop() ?? 'unknown';
    const firstWord = title.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '') ?? 'ref';
    return `${firstAuthor}${year}${firstWord}`;
}

function formatBibtex(work: CrossrefWork, title: string, authors: string[], year: number, doi: string, publisher: string, url: string): string {
    const key = makeBibtexKey(title, year, authors);
    const lines: string[] = [];
    const type = work.type === 'journal-article' ? 'article' : 'misc';
    lines.push(`@${type}{${key},`);
    lines.push(`  title = {${escapeBibtex(title)}},`);
    if (authors.length > 0) lines.push(`  author = {${escapeBibtex(formatAuthorsBibtex(authors))}},`);
    if (year) lines.push(`  year = {${year}},`);
    if (publisher) lines.push(`  publisher = {${escapeBibtex(publisher)}},`);
    if (work.containerTitle?.[0]) lines.push(`  journal = {${escapeBibtex(work.containerTitle[0])}},`);
    if (work.volume) lines.push(`  volume = {${work.volume}},`);
    if (work.issue) lines.push(`  number = {${work.issue}},`);
    if (work.page) lines.push(`  pages = {${work.page}},`);
    if (doi) lines.push(`  doi = {${doi}},`);
    if (url) lines.push(`  url = {${url}},`);
    lines.push('}');
    return lines.join('\n');
}

function formatApa(title: string, authors: string[], year: number, doi: string, publisher: string, url: string, work: CrossrefWork): string {
    const parts: string[] = [];
    if (authors.length > 0) parts.push(formatAuthorsApa(authors));
    parts.push(year ? `(${year})` : '(n.d.)');
    parts.push(`${title}.`);
    if (work.containerTitle?.[0]) parts.push(`*${work.containerTitle[0]}*`);
    if (work.volume) parts.push(work.volume);
    if (work.issue) parts.push(`(${work.issue})`);
    if (work.page) parts.push(work.page);
    if (publisher) parts.push(publisher);
    if (doi) parts.push(`https://doi.org/${doi}`);
    else if (url) parts.push(url);
    return parts.join(' ');
}

function formatMla(title: string, authors: string[], year: number, doi: string, publisher: string, url: string, work: CrossrefWork): string {
    const parts: string[] = [];
    if (authors.length > 0) parts.push(formatAuthorsMla(authors) + '.');
    parts.push(`"${title}."`);
    if (work.containerTitle?.[0]) parts.push(`*${work.containerTitle[0]}*,`);
    if (publisher) parts.push(publisher + ',');
    if (year) parts.push(String(year) + '.');
    if (doi) parts.push(`https://doi.org/${doi}.`);
    else if (url) parts.push(url + '.');
    return parts.join(' ');
}

function formatChicago(title: string, authors: string[], year: number, doi: string, publisher: string, url: string, work: CrossrefWork): string {
    const parts: string[] = [];
    if (authors.length > 0) parts.push(formatAuthorsChicago(authors) + '.');
    parts.push(`"${title}."`);
    if (work.containerTitle?.[0]) parts.push(work.containerTitle[0] + '.');
    if (work.volume) parts.push(work.volume + ':');
    if (work.issue) parts.push(work.issue + ',');
    if (work.page) parts.push(work.page + '.');
    if (publisher) parts.push(publisher + ',');
    if (year) parts.push(String(year) + '.');
    if (doi) parts.push(`https://doi.org/${doi}.`);
    else if (url) parts.push(url + '.');
    return parts.join(' ');
}

function formatRis(title: string, authors: string[], year: number, doi: string, publisher: string, url: string, work: CrossrefWork): string {
    const lines: string[] = [];
    lines.push('TY  - JOUR');
    for (const a of authors) {
        lines.push(`AU  - ${a}`);
    }
    lines.push(`TI  - ${title}`);
    if (work.containerTitle?.[0]) lines.push(`JO  - ${work.containerTitle[0]}`);
    if (year) lines.push(`PY  - ${year}`);
    if (work.volume) lines.push(`VL  - ${work.volume}`);
    if (work.issue) lines.push(`IS  - ${work.issue}`);
    if (work.page) lines.push(`SP  - ${work.page}`);
    if (publisher) lines.push(`PB  - ${publisher}`);
    if (doi) lines.push(`DO  - ${doi}`);
    if (url) lines.push(`UR  - ${url}`);
    lines.push('ER  - ');
    return lines.join('\n');
}

function buildCitation(work: CrossrefWork, format: string): CitationResult {
    const title = work.title?.[0] ?? '';
    const authors = extractAuthors(work);
    const year = extractYear(work);
    const doi = work.DOI ?? '';
    const publisher = work.publisher ?? '';
    const url = work.URL ?? (doi ? `https://doi.org/${doi}` : '');
    let citation: string;
    switch (format) {
        case 'bibtex': citation = formatBibtex(work, title, authors, year, doi, publisher, url); break;
        case 'apa': citation = formatApa(title, authors, year, doi, publisher, url, work); break;
        case 'mla': citation = formatMla(title, authors, year, doi, publisher, url, work); break;
        case 'chicago': citation = formatChicago(title, authors, year, doi, publisher, url, work); break;
        case 'ris': citation = formatRis(title, authors, year, doi, publisher, url, work); break;
        default: citation = formatApa(title, authors, year, doi, publisher, url, work);
    }
    return {
        format,
        citation,
        title,
        authors,
        year,
        doi,
        publisher,
        url,
    };
}

async function fetchByDoi(doi: string): Promise<CrossrefWork | undefined> {
    try {
        const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
        const resp = await fetchWithTimeout(url, {
            headers: { 'User-Agent': CROSSREF_USER_AGENT },
        }, 2, true);
        if (!resp.ok) return undefined;
        const data = await resp.json() as { message?: CrossrefWork };
        return data.message;
    } catch {
        return undefined;
    }
}

async function searchByTitle(title: string, limit: number): Promise<CrossrefWork[]> {
    try {
        const url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(title)}&rows=${limit}`;
        const resp = await fetchWithTimeout(url, {
            headers: { 'User-Agent': CROSSREF_USER_AGENT },
        }, 2, true);
        if (!resp.ok) return [];
        const data = await resp.json() as { message?: { items?: CrossrefWork[] } };
        return data.message?.items ?? [];
    } catch {
        return [];
    }
}

export async function formatCitations(
    format: string,
    doi?: string,
    title?: string,
    maxResults: number = 1,
): Promise<ToolResponse<CitationResult>> {
    if (doi && doi.length > 200) {
        return { query: doi, count: 0, results: [], error: 'DOI too long (max 200 chars)' };
    }
    if (title && title.length > 500) {
        return { query: title, count: 0, results: [], error: 'Title too long (max 500 chars)' };
    }
    if (!doi && !title) {
        return { query: '', count: 0, results: [], error: 'Either doi or title must be provided' };
    }
    const limit = Math.min(maxResults, 50);
    const cacheKey = doi ?? title ?? '';
    return withCache('format_citations', CACHE_TTL_MS.format_citations, [format, cacheKey, limit], async () => {
        try {
            let works: CrossrefWork[] = [];
            if (doi) {
                const work = await fetchByDoi(doi);
                if (work) works = [work];
            } else if (title) {
                works = await searchByTitle(title, limit);
            }
            if (works.length === 0) {
                return { query: cacheKey, count: 0, results: [], error: 'No works found' };
            }
            const results = works.slice(0, limit).map(w => buildCitation(w, format));
            return { query: cacheKey, count: results.length, results };
        } catch (err) {
            return { query: cacheKey, count: 0, results: [], error: `Citation formatting failed: ${(err as Error).message}` };
        }
    });
}

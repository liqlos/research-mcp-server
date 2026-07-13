import { ToolResponse, withCache, CACHE_TTL_MS } from './research.js';

export interface ReliabilityResult {
    url: string;
    domain: string;
    reliabilityScore: number;
    reliabilityTier: 'HIGH' | 'MEDIUM-HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW';
    method: 'rule-based';
    reason: string;
}

const SOURCE_TIERS: Array<{ domains: string[]; score: number; reason: string }> = [
    { domains: ['wikipedia.org', 'wikidata.org'], score: 1.0, reason: 'Collaborative knowledge base with editorial oversight' },
    { domains: ['arxiv.org', 'biorxiv.org', 'medrxiv.org', 'ssrn.com', 'osf.io'], score: 0.9, reason: 'Preprint server for academic research' },
    { domains: ['nature.com', 'science.org', 'cell.com', 'nejm.org', 'thelancet.com', 'bmj.com', 'pnas.org', 'ieee.org', 'acm.org'], score: 0.85, reason: 'Peer-reviewed academic publisher' },
    { domains: ['pubmed.ncbi.nlm.nih.gov', 'ncbi.nlm.nih.gov', 'doi.org', 'crossref.org'], score: 0.85, reason: 'Academic database or reference infrastructure' },
    { domains: ['nytimes.com', 'wsj.com', 'bbc.com', 'bbc.co.uk', 'theguardian.com', 'ft.com', 'reuters.com', 'apnews.com', 'bloomberg.com', 'economist.com'], score: 0.75, reason: 'Established news organization with editorial standards' },
    { domains: ['cnn.com', 'foxnews.com', 'msnbc.com', 'nbcnews.com', 'abcnews.go.com', 'cbsnews.com', 'aljazeera.com', 'dw.com', 'france24.com'], score: 0.65, reason: 'Mainstream news broadcaster' },
    { domains: ['reddit.com', 'twitter.com', 'x.com', 'linkedin.com', 'facebook.com', 'threads.net', 'bsky.app', 'mastodon.social'], score: 0.5, reason: 'User-generated content platform' },
    { domains: ['youtube.com', 'youtu.be', 'tiktok.com', 'instagram.com'], score: 0.4, reason: 'User-generated media platform' },
];

const TLD_SCORES: Record<string, number> = {
    '.edu': 0.8,
    '.gov': 0.85,
    '.mil': 0.8,
    '.org': 0.6,
    '.net': 0.5,
    '.io': 0.45,
    '.com': 0.4,
    '.co': 0.4,
};

const MULTI_PART_TLDS = new Set(['co.uk', 'co.jp', 'co.kr', 'co.nz', 'co.in', 'co.za', 'com.au', 'com.br', 'com.mx', 'com.cn', 'com.hk', 'com.sg', 'com.tw', 'com.my', 'com.ph', 'com.vn', 'com.ar', 'com.co', 'com.pe', 'com.ve', 'com.ec', 'com.uy', 'com.py', 'com.bo', 'com.gt', 'com.sv', 'com.hn', 'com.ni', 'com.cr', 'com.do', 'com.pa', 'ac.uk', 'ac.jp', 'ac.kr', 'ac.nz', 'ac.in', 'ac.za', 'ac.at', 'ac.be', 'ac.dk', 'ac.fi', 'ac.fr', 'ac.de', 'ac.gr', 'ac.hu', 'ac.is', 'ac.ie', 'ac.it', 'ac.no', 'ac.pl', 'ac.pt', 'ac.es', 'ac.se', 'ac.ch', 'ac.tr', 'edu.au', 'edu.br', 'edu.cn', 'edu.hk', 'edu.sg', 'edu.tw', 'edu.my', 'gov.uk', 'gov.au', 'gov.cn', 'gov.br', 'gov.in', 'gov.za', 'org.uk', 'org.au', 'org.cn', 'net.au', 'net.cn', 'ne.jp', 'or.jp', 'or.kr', 'go.jp', 'go.id', 'go.th', 'go.vn', 'go.ph', 'go.my', 'go.sg', 'go.in', 'go.br', 'go.mx', 'go.ar', 'go.cl', 'go.co', 'go.pe', 'go.ve', 'go.ec', 'go.uy', 'go.py', 'go.bo', 'go.gt', 'go.sv', 'go.hn', 'go.ni', 'go.cr', 'go.do', 'go.pa']);

function extractRootDomain(url: string): string {
    try {
        const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
        const hostname = parsed.hostname.toLowerCase();
        const parts = hostname.split('.');
        if (parts.length <= 2) return hostname;
        const lastTwo = parts.slice(-2).join('.');
        if (MULTI_PART_TLDS.has(lastTwo) && parts.length >= 3) {
            return parts.slice(-3).join('.');
        }
        return parts.slice(-2).join('.');
    } catch {
        return url;
    }
}

export function scoreDomain(url: string): { score: number; tier: ReliabilityResult['reliabilityTier']; reason: string } {
    const domain = extractRootDomain(url).toLowerCase();
    for (const tier of SOURCE_TIERS) {
        if (tier.domains.some(d => domain === d || domain.endsWith('.' + d))) {
            return { score: tier.score, tier: scoreToTier(tier.score), reason: tier.reason };
        }
    }
    const parts = domain.split('.');
    const tld = parts.length > 1 ? `.${parts.pop()}` : 'unknown';
    if (tld === 'unknown') {
        return { score: 0.3, tier: 'VERY_LOW', reason: 'Unknown domain with no reliability signals' };
    }
    const tldScore = TLD_SCORES[tld];
    if (tldScore !== undefined) {
        return { score: tldScore, tier: scoreToTier(tldScore), reason: `Top-level domain ${tld} associated with institutional use` };
    }
    return { score: 0.3, tier: 'VERY_LOW', reason: 'Unknown domain with no reliability signals' };
}

function scoreToTier(score: number): ReliabilityResult['reliabilityTier'] {
    if (score >= 0.9) return 'HIGH';
    if (score >= 0.7) return 'MEDIUM-HIGH';
    if (score >= 0.5) return 'MEDIUM';
    if (score >= 0.3) return 'LOW';
    return 'VERY_LOW';
}

export async function scoreReliability(urls: string[]): Promise<ToolResponse<ReliabilityResult>> {
    return withCache('score_reliability', CACHE_TTL_MS.score_reliability, [urls], async () => {
        try {
            if (urls.length > 100) {
                return { query: urls.join(', '), count: 0, results: [], error: 'Too many URLs: maximum 100 allowed' };
            }
            if (urls.some(u => u.length > 2000)) {
                return { query: urls.join(', '), count: 0, results: [], error: 'URL too long: maximum 2000 characters allowed' };
            }
            const results: ReliabilityResult[] = urls.map(url => {
                const domain = extractRootDomain(url);
                const { score, tier, reason } = scoreDomain(url);
                return { url, domain, reliabilityScore: score, reliabilityTier: tier, method: 'rule-based' as const, reason };
            });
            return { query: urls.join(', '), count: results.length, results };
        } catch (err) {
            return { query: urls.join(', '), count: 0, results: [], error: `Reliability scoring failed: ${(err as Error).message}` };
        }
    });
}

export function enrichWithReliability<T extends { url?: string }>(items: T[]): Array<T & { reliabilityScore?: number; reliabilityTier?: string }> {
    return items.map(item => {
        if (item.url) {
            const { score, tier } = scoreDomain(item.url);
            return { ...item, reliabilityScore: score, reliabilityTier: tier };
        }
        return item;
    });
}

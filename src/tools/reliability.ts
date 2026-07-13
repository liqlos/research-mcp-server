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

function extractRootDomain(url: string): string {
    try {
        const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
        const parts = parsed.hostname.split('.');
        if (parts.length <= 2) return parsed.hostname;
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

import { describe, it, expect } from 'vitest';
import { scoreReliability, scoreDomain, enrichWithReliability } from '../src/tools/reliability.js';
import { searchSubstack } from '../src/tools/substack.js';
import { resurrectDeadLink } from '../src/tools/wayback.js';
import { searchBluesky } from '../src/tools/bluesky.js';
import { searchTelegram } from '../src/tools/telegram.js';
import { searchOsm } from '../src/tools/osm.js';
import { detectTrends } from '../src/tools/trends.js';
import { searchMastodon } from '../src/tools/mastodon.js';
import { searchVk } from '../src/tools/vk.js';
import { findCounterArguments } from '../src/tools/counterargs.js';
import { searchSecFilings } from '../src/tools/sec.js';
import { formatCitations } from '../src/tools/citations.js';
import { verifyCitations } from '../src/tools/verify.js';
import { validateBibliography } from '../src/tools/batch_verify.js';

describe('scoreDomain', () => {
    it('scores Wikipedia as HIGH (1.0)', () => {
        const { score, tier } = scoreDomain('https://en.wikipedia.org/wiki/Rust');
        expect(score).toBe(1.0);
        expect(tier).toBe('HIGH');
    });

    it('scores arXiv as HIGH (0.9)', () => {
        const { score, tier } = scoreDomain('https://arxiv.org/abs/2401.00001');
        expect(score).toBe(0.9);
        expect(tier).toBe('HIGH');
    });

    it('scores Reddit as MEDIUM (0.5)', () => {
        const { score, tier } = scoreDomain('https://reddit.com/r/rust');
        expect(score).toBe(0.5);
        expect(tier).toBe('MEDIUM');
    });

    it('scores .gov as MEDIUM-HIGH (0.85)', () => {
        const { score, tier } = scoreDomain('https://data.gov/dataset');
        expect(score).toBe(0.85);
        expect(tier).toBe('MEDIUM-HIGH');
    });

    it('scores unknown domains as VERY_LOW (0.3)', () => {
        const { score, tier } = scoreDomain('https://random-blog.example');
        expect(score).toBe(0.3);
        expect(tier).toBe('VERY_LOW');
    });
});

describe('scoreReliability', () => {
    it('scores multiple URLs', async () => {
        const result = await scoreReliability([
            'https://en.wikipedia.org/wiki/Rust',
            'https://reddit.com/r/rust',
            'https://arxiv.org/abs/2401.00001',
        ]);
        expect(result.count).toBe(3);
        expect(result.results[0].reliabilityScore).toBe(1.0);
        expect(result.results[1].reliabilityScore).toBe(0.5);
        expect(result.results[2].reliabilityScore).toBe(0.9);
    });
});

describe('enrichWithReliability', () => {
    it('enriches items with reliability scores', () => {
        const items = [
            { url: 'https://en.wikipedia.org/wiki/Rust', title: 'Rust' },
            { url: 'https://reddit.com/r/rust', title: 'Reddit Rust' },
        ];
        const enriched = enrichWithReliability(items);
        expect(enriched[0].reliabilityScore).toBe(1.0);
        expect(enriched[1].reliabilityScore).toBe(0.5);
    });

    it('handles items without URLs', () => {
        const items = [{ title: 'No URL' }];
        const enriched = enrichWithReliability(items);
        expect(enriched[0].reliabilityScore).toBeUndefined();
    });
});

describe('searchSubstack', () => {
    it('returns posts from a publication', async () => {
        const result = await searchSubstack(['stratechery'], 5);
        expect(result.query).toBe('stratechery');
        expect(result).toHaveProperty('count');
        expect(result).toHaveProperty('results');
    }, 30000);
});

describe('resurrectDeadLink', () => {
    it('returns live URL as not dead', async () => {
        const result = await resurrectDeadLink('https://example.com');
        expect(result.count).toBe(1);
        expect(result.results[0].isDead).toBe(false);
    }, 30000);

    it('finds archived version for dead URL', async () => {
        const result = await resurrectDeadLink('https://httpstat.us/404');
        if (result.count === 0) {
            expect(result.error).toBeDefined();
            return;
        }
        expect(result.count).toBe(1);
        expect(result.results[0]).toHaveProperty('archivedUrl');
        expect(result.results[0].isDead).toBe(true);
    }, 30000);

    it('rejects blocked URLs', async () => {
        const result = await resurrectDeadLink('http://localhost:3000');
        expect(result.count).toBe(0);
        expect(result.error).toContain('blocked');
    });
});

describe('searchBluesky', () => {
    it('returns posts for a query', async () => {
        const result = await searchBluesky('technology', 3);
        expect(result.query).toBe('technology');
        expect(result).toHaveProperty('count');
        expect(result).toHaveProperty('results');
    }, 30000);
});

describe('searchTelegram', () => {
    it('returns messages from a public channel', async () => {
        const result = await searchTelegram('durov', 5);
        expect(result.query).toBe('durov');
        expect(result).toHaveProperty('count');
        expect(result).toHaveProperty('results');
    }, 30000);
});

describe('searchOsm', () => {
    it('finds amenities near a location', async () => {
        const result = await searchOsm('restaurant', 'Berlin', 1000, undefined, 5);
        expect(result.query).toBe('restaurant');
        expect(result).toHaveProperty('count');
        expect(result).toHaveProperty('results');
    }, 60000);
});

describe('detectTrends', () => {
    it('detects trends across platforms', async () => {
        const result = await detectTrends(['hackernews', 'news'], 10);
        expect(result).toHaveProperty('count');
        expect(result).toHaveProperty('results');
        expect(result).toHaveProperty('clusters');
    }, 30000);
});

describe('searchMastodon', () => {
    it('returns statuses for a query', async () => {
        const result = await searchMastodon('rust', 3, ['mastodon.social']);
        expect(result.query).toBe('rust');
        expect(result).toHaveProperty('count');
        expect(result).toHaveProperty('results');
    }, 30000);
});

describe('searchVk', () => {
    it('returns error without token', async () => {
        const result = await searchVk('test', 5);
        if (!process.env.VK_ACCESS_TOKEN) {
            expect(result.count).toBe(0);
            expect(result.error).toContain('VK_ACCESS_TOKEN');
        }
    });
});

describe('findCounterArguments', () => {
    it('returns papers for a claim', async () => {
        const result = await findCounterArguments('transformers outperform RNNs', 5);
        expect(result.query).toBe('transformers outperform RNNs');
        expect(result.count).toBe(1);
        expect(result.results[0]).toHaveProperty('supportingPapers');
        expect(result.results[0]).toHaveProperty('contrastingPapers');
        expect(result.results[0]).toHaveProperty('mentioningPapers');
    }, 30000);
});

describe('searchSecFilings', () => {
    it('returns filings for a known ticker', async () => {
        const result = await searchSecFilings('AAPL', 'ALL', 5);
        expect(result.query).toBe('AAPL');
        expect(result).toHaveProperty('count');
        expect(result).toHaveProperty('results');
        expect(result.count).toBeGreaterThan(0);
        expect(result.results[0]).toHaveProperty('form');
        expect(result.results[0]).toHaveProperty('filingDate');
        expect(result.results[0]).toHaveProperty('accessionNumber');
        expect(result.results[0]).toHaveProperty('url');
    }, 60000);
});

describe('formatCitations', () => {
    it('formats a citation from a known DOI as bibtex', async () => {
        const result = await formatCitations('bibtex', '10.1038/nature12373');
        expect(result).toHaveProperty('count');
        expect(result).toHaveProperty('results');
        expect(result.count).toBeGreaterThan(0);
        expect(result.results[0]).toHaveProperty('citation');
        expect(result.results[0]).toHaveProperty('title');
        expect(result.results[0]).toHaveProperty('authors');
        expect(result.results[0]).toHaveProperty('year');
        expect(result.results[0]).toHaveProperty('doi');
    }, 60000);
});

describe('verifyCitations', () => {
    it('verifies a real citation string', async () => {
        const result = await verifyCitations(['Vaswani et al. (2017). Attention Is All You Need.']);
        expect(result).toHaveProperty('count');
        expect(result).toHaveProperty('results');
        expect(result.count).toBeGreaterThan(0);
        expect(['VERIFIED', 'MISMATCH']).toContain(result.results[0].status);
        expect(result.results[0]).toHaveProperty('title');
        expect(result.results[0]).toHaveProperty('authors');
    }, 60000);
});

describe('validateBibliography', () => {
    it('validates a small bibliography', async () => {
        const bibliography = [
            'Vaswani et al. (2017). Attention Is All You Need.',
            'Devlin et al. (2019). BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding.',
            'Brown et al. (2020). Language Models are Few-Shot Learners.',
        ].join('\n');
        const result = await validateBibliography(bibliography, 'auto', 10);
        expect(result).toHaveProperty('count');
        expect(result).toHaveProperty('results');
        expect(result.count).toBe(1);
        expect(result.results[0]).toHaveProperty('total');
        expect(result.results[0]).toHaveProperty('verified');
        expect(result.results[0]).toHaveProperty('mismatched');
        expect(result.results[0]).toHaveProperty('notFound');
        expect(result.results[0]).toHaveProperty('results');
        expect(result.results[0].total).toBe(3);
    }, 60000);
});

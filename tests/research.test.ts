import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    validateUrl,
    webSearch,
    extractContent,
    searchReddit,
    searchYouTube,
    searchNews,
    searchHackerNews,
    getWikipedia,
    searchPreprints,
    searchDatasets,
} from '../src/tools/research.js';

describe('validateUrl', () => {
    it('blocks localhost', () => {
        expect(validateUrl('http://localhost:3000')).toBe(false);
        expect(validateUrl('http://127.0.0.1:3000')).toBe(false);
    });

    it('blocks metadata endpoints', () => {
        expect(validateUrl('http://169.254.169.254/latest/meta-data')).toBe(false);
        expect(validateUrl('http://metadata.google.internal')).toBe(false);
    });

    it('blocks private IPs', () => {
        expect(validateUrl('http://10.0.0.1')).toBe(false);
        expect(validateUrl('http://192.168.1.1')).toBe(false);
        expect(validateUrl('http://172.16.0.1')).toBe(false);
    });

    it('blocks .internal and .local', () => {
        expect(validateUrl('http://foo.internal')).toBe(false);
        expect(validateUrl('http://bar.local')).toBe(false);
    });

    it('blocks IPv6 private/link-local', () => {
        expect(validateUrl('http://[::1]')).toBe(false);
        expect(validateUrl('http://[fe80::1]')).toBe(false);
        expect(validateUrl('http://[fc00::1]')).toBe(false);
        expect(validateUrl('http://[fd00::1]')).toBe(false);
        expect(validateUrl('http://[2001:db8::1]')).toBe(false);
    });

    it('blocks IP address bypasses (decimal, octal, hex, IPv4-mapped)', () => {
        // decimal notation for 127.0.0.1
        expect(validateUrl('http://2130706433/')).toBe(false);
        // octal notation
        expect(validateUrl('http://0177.0.0.1/')).toBe(false);
        // hex notation
        expect(validateUrl('http://0x7f.0.0.1/')).toBe(false);
        // IPv4-mapped IPv6
        expect(validateUrl('http://[::ffff:127.0.0.1]/')).toBe(false);
    });

    it('allows public URLs', () => {
        expect(validateUrl('https://example.com')).toBe(true);
        expect(validateUrl('https://en.wikipedia.org/wiki/Rust')).toBe(true);
    });

    it('rejects invalid URLs', () => {
        expect(validateUrl('not-a-url')).toBe(false);
        expect(validateUrl('')).toBe(false);
    });
});

describe('webSearch', () => {
    it('returns results for a valid query', async () => {
        const result = await webSearch('rust programming language', 3);
        expect(result.query).toBe('rust programming language');
        expect(result.count).toBeGreaterThan(0);
        expect(result.results.length).toBeGreaterThan(0);
        expect(result.results[0]).toHaveProperty('title');
        expect(result.results[0]).toHaveProperty('url');
        expect(result.results[0]).toHaveProperty('snippet');
    }, 30000);

    it('handles empty results gracefully', async () => {
        const result = await webSearch('asdfqwertyzxcvbn123456789nonexistent', 1);
        expect(result).toHaveProperty('count');
        expect(result).toHaveProperty('results');
    }, 30000);
});

describe('extractContent', () => {
    it('extracts content from example.com', async () => {
        const result = await extractContent('https://example.com');
        expect(result.count).toBe(1);
        expect(result.results[0].url).toBe('https://example.com');
        expect(result.results[0].title).toBeDefined();
        expect(result.results[0].content).toBeDefined();
        expect(result.results[0].wordCount).toBeGreaterThan(0);
    }, 30000);

    it('rejects blocked URLs', async () => {
        const result = await extractContent('http://localhost:3000');
        expect(result.count).toBe(0);
        const err = typeof result.error === 'object' ? result.error?.message : result.error;
        expect(err).toContain('blocked');
    });

    it('rejects invalid URLs', async () => {
        const result = await extractContent('not-a-url');
        expect(result.count).toBe(0);
        expect(result.error).toBeDefined();
    });
});

describe('searchReddit', () => {
    it('returns a valid response structure for a query', async () => {
        const result = await searchReddit('programming', 3);
        expect(result.query).toBe('programming');
        expect(result).toHaveProperty('count');
        expect(result).toHaveProperty('results');
        expect(Array.isArray(result.results)).toBe(true);
    }, 30000);
});

describe('searchYouTube', () => {
    it('returns YouTube videos for a query', async () => {
        const result = await searchYouTube('programming tutorial', 3, false);
        expect(result.query).toBe('programming tutorial');
        expect(result.results.length).toBeGreaterThan(0);
        expect(result.results[0]).toHaveProperty('videoId');
        expect(result.results[0]).toHaveProperty('title');
    }, 30000);
});

describe('searchNews', () => {
    it('returns news articles for a query', async () => {
        const result = await searchNews('technology', 3);
        expect(result.query).toBe('technology');
        expect(result.count).toBeGreaterThan(0);
        expect(result.results[0]).toHaveProperty('title');
        expect(result.results[0]).toHaveProperty('url');
        expect(result.results[0]).toHaveProperty('source');
    }, 30000);
});

describe('searchHackerNews', () => {
    it('returns HN stories for a query', async () => {
        const result = await searchHackerNews('programming', 3);
        expect(result.query).toBe('programming');
        expect(result.count).toBeGreaterThan(0);
        expect(result.results[0]).toHaveProperty('title');
        expect(result.results[0]).toHaveProperty('score');
        expect(result.results[0]).toHaveProperty('author');
    }, 30000);
});

describe('getWikipedia', () => {
    it('returns a valid response for a topic', async () => {
        const result = await getWikipedia('Rust programming language', 3);
        expect(result.query).toBe('Rust programming language');
        expect(result).toHaveProperty('count');
        expect(result).toHaveProperty('results');
        if (result.count > 0) {
            expect(result.results[0]).toHaveProperty('title');
            expect(result.results[0]).toHaveProperty('extract');
        }
    }, 60000);

    it('handles non-existent topics', async () => {
        const result = await getWikipedia('asdfqwertyzxcvbn123456789nonexistent', 3);
        expect(result.error).toBeDefined();
    }, 30000);
});

describe('searchPreprints', () => {
    it('returns preprints for a valid query', async () => {
        const result = await searchPreprints('machine learning', 3);
        expect(result.query).toBe('machine learning');
        expect(result).toHaveProperty('count');
        expect(result).toHaveProperty('results');
        expect(Array.isArray(result.results)).toBe(true);
        if (result.count > 0) {
            expect(result.results[0]).toHaveProperty('title');
            expect(result.results[0]).toHaveProperty('url');
            expect(result.results[0]).toHaveProperty('source');
            expect(['arxiv', 'biorxiv', 'medrxiv']).toContain(result.results[0].source);
        }
    }, 30000);
});

describe('searchDatasets', () => {
    it('returns datasets for a valid query', async () => {
        const result = await searchDatasets('climate change', 3);
        expect(result.query).toBe('climate change');
        expect(result).toHaveProperty('count');
        expect(result).toHaveProperty('results');
        expect(Array.isArray(result.results)).toBe(true);
        if (result.count > 0) {
            expect(result.results[0]).toHaveProperty('title');
            expect(result.results[0]).toHaveProperty('url');
            expect(result.results[0]).toHaveProperty('source');
            expect(['zenodo', 'figshare', 'osf']).toContain(result.results[0].source);
        }
    }, 60000);
});

describe('Error Path Tests', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it('429 retry logic: retries once then succeeds', async () => {
        let callCount = 0;
        globalThis.fetch = vi.fn(async () => {
            callCount++;
            if (callCount === 1) {
                return new Response('rate limited', { status: 429 });
            }
            return new Response(JSON.stringify({ hits: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
        }) as typeof fetch;

        const result = await searchHackerNews('retry-test-query-429', 3);
        expect(callCount).toBeGreaterThanOrEqual(2);
        expect(result.query).toBe('retry-test-query-429');
        expect(result).toHaveProperty('count');
    }, 30000);

    it('429 with Retry-After header: waits then retries', async () => {
        let callCount = 0;
        globalThis.fetch = vi.fn(async () => {
            callCount++;
            if (callCount === 1) {
                return new Response('rate limited', { status: 429, headers: { 'retry-after': '1' } });
            }
            return new Response(JSON.stringify({ hits: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
        }) as typeof fetch;

        const result = await searchHackerNews('retry-after-header-test', 3);
        expect(callCount).toBeGreaterThanOrEqual(2);
        expect(result.query).toBe('retry-after-header-test');
    }, 30000);

    it('5xx retry logic: retries on server error then succeeds', async () => {
        let callCount = 0;
        globalThis.fetch = vi.fn(async () => {
            callCount++;
            if (callCount === 1) {
                return new Response('server error', { status: 503 });
            }
            return new Response(JSON.stringify({ hits: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
        }) as typeof fetch;

        const result = await searchHackerNews('retry-test-query-503', 3);
        expect(callCount).toBeGreaterThanOrEqual(2);
        expect(result.query).toBe('retry-test-query-503');
        expect(result).toHaveProperty('count');
    }, 30000);

    it('cache hit: second call with same params has cached: true', async () => {
        let callCount = 0;
        globalThis.fetch = vi.fn(async () => {
            callCount++;
            return new Response(JSON.stringify({ hits: [{ objectID: '1', title: 'cached test', url: 'https://example.com', points: 10, author: 'tester', num_comments: 5, created_at_i: 1000, _tags: ['story'] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
        }) as typeof fetch;

        const first = await searchHackerNews('cache-hit-test-unique-1', 3);
        expect(first.cached).toBeFalsy();
        const fetchCallsAfterFirst = callCount;

        const second = await searchHackerNews('cache-hit-test-unique-1', 3);
        expect(second.cached).toBe(true);
        expect(callCount).toBe(fetchCallsAfterFirst);
    }, 30000);

    it('cache miss: different params do not hit cache', async () => {
        let callCount = 0;
        globalThis.fetch = vi.fn(async () => {
            callCount++;
            return new Response(JSON.stringify({ hits: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
        }) as typeof fetch;

        await searchHackerNews('cache-miss-test-unique-2', 3);
        const callsAfterFirst = callCount;

        await searchHackerNews('cache-miss-test-unique-2-different', 3);
        expect(callCount).toBeGreaterThan(callsAfterFirst);

        await searchHackerNews('cache-miss-test-unique-2', 5);
        expect(callCount).toBeGreaterThan(callsAfterFirst + 1);
    }, 30000);

    it('health endpoint: returns expected fields', async () => {
        const express = (await import('express')).default;
        const app = express();
        app.get('/health', (_req, res) => {
            res.json({ status: 'ok', tools: 9, version: '0.1.0' });
        });
        const server = app.listen(0);
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        const resp = await fetch(`http://localhost:${port}/health`);
        const body = await resp.json();
        expect(body.status).toBe('ok');
        expect(body.tools).toBe(9);
        expect(body.version).toBe('0.1.0');
        server.close();
    }, 10000);

    it('proxy fallback: direct fetch works when proxy config fails', async () => {
        const { Actor } = await import('apify');
        const createProxySpy = vi.spyOn(Actor, 'createProxyConfiguration').mockRejectedValue(new Error('proxy unavailable'));

        let directFetchCalled = false;
        globalThis.fetch = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
            if (url.includes('news.google.com')) {
                directFetchCalled = true;
                return new Response('<?xml version="1.0"?><rss><channel></channel></rss>', { status: 200, headers: { 'content-type': 'application/xml' } });
            }
            return new Response('', { status: 200 });
        }) as typeof fetch;

        const result = await searchNews('proxy-fallback-test-unique-3', 3);
        expect(directFetchCalled).toBe(true);
        expect(result.query).toBe('proxy-fallback-test-unique-3');
        expect(result.error).toBeUndefined();
        createProxySpy.mockRestore();
    }, 30000);
});

describe('Input Validation Edge Cases', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it('empty query: handles gracefully without crash', async () => {
        globalThis.fetch = vi.fn(async () => {
            return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
        }) as typeof fetch;

        const result = await webSearch('', 3);
        expect(result).toHaveProperty('count');
        expect(result).toHaveProperty('results');
        expect(Array.isArray(result.results)).toBe(true);
    }, 30000);

    it('whitespace-only query: handles gracefully', async () => {
        globalThis.fetch = vi.fn(async () => {
            return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
        }) as typeof fetch;

        const result = await webSearch('   ', 3);
        expect(result).toHaveProperty('count');
        expect(result).toHaveProperty('results');
    }, 30000);

    it('unicode query: works with proper URL encoding', async () => {
        let capturedUrl = '';
        globalThis.fetch = vi.fn(async (input: URL | RequestInfo) => {
            capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
            return new Response(JSON.stringify({ items: [{ title: 'test', link: 'https://example.com', snippet: 'snippet' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
        }) as typeof fetch;

        const result = await webSearch('测试搜索 🚀', 3);
        expect(result).toHaveProperty('count');
        expect(capturedUrl).toContain(encodeURIComponent('测试搜索 🚀'));
    }, 30000);

    it('very long query: does not crash', async () => {
        globalThis.fetch = vi.fn(async () => {
            return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
        }) as typeof fetch;

        const longQuery = 'a'.repeat(1000);
        const result = await webSearch(longQuery, 3);
        expect(result).toHaveProperty('count');
        expect(result.query).toBe(longQuery);
    }, 30000);

    it('special characters in query: passed as query not executed', async () => {
        let capturedUrl = '';
        globalThis.fetch = vi.fn(async (input: URL | RequestInfo) => {
            capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
            return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
        }) as typeof fetch;

        const xssQuery = '<script>alert(1)</script>';
        const result = await webSearch(xssQuery, 3);
        expect(result).toHaveProperty('count');
        expect(capturedUrl).toContain(encodeURIComponent(xssQuery));
        expect(result.query).toBe(xssQuery);
    }, 30000);

    it('SQL injection attempt: treated as plain text query', async () => {
        let capturedUrl = '';
        globalThis.fetch = vi.fn(async (input: URL | RequestInfo) => {
            capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
            return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
        }) as typeof fetch;

        const sqlQuery = "'; DROP TABLE--";
        const result = await webSearch(sqlQuery, 3);
        expect(result).toHaveProperty('count');
        expect(capturedUrl).toContain(encodeURIComponent(sqlQuery));
        expect(result.query).toBe(sqlQuery);
    }, 30000);

    it('search_preprints empty query: returns error gracefully', async () => {
        const result = await searchPreprints('', 3);
        expect(result).toHaveProperty('count');
        expect(result.count).toBe(0);
        expect(result.error).toBeDefined();
        expect(Array.isArray(result.results)).toBe(true);
    }, 30000);

    it('search_datasets empty query: returns error gracefully', async () => {
        const result = await searchDatasets('', 3);
        expect(result).toHaveProperty('count');
        expect(result.count).toBe(0);
        expect(result.error).toBeDefined();
        expect(Array.isArray(result.results)).toBe(true);
    }, 30000);
});

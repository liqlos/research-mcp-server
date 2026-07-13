import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { server } from '../src/main.js';

const EXPECTED_TOOLS = [
    'web_search',
    'extract_content',
    'search_reddit',
    'search_youtube',
    'search_news',
    'search_hackernews',
    'get_wikipedia',
    'search_preprints',
    'search_datasets',
    'score_reliability',
    'search_substack',
    'resurrect_dead_link',
    'search_bluesky',
    'search_telegram',
    'search_osm',
    'detect_trends',
    'search_mastodon',
    'search_vk',
    'find_counter_arguments',
    'verify_citations',
    'validate_bibliography',
    'search_sec_filings',
    'format_citations',
];

let client: Client;

beforeAll(async () => {
    client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
});

afterAll(async () => {
    await client.close();
});

describe('MCP server tool registration', () => {
    it('registers all expected tools', async () => {
        const result = await client.listTools();
        const toolNames = result.tools.map(t => t.name);
        expect(toolNames.length).toBe(EXPECTED_TOOLS.length);
        for (const name of EXPECTED_TOOLS) {
            expect(toolNames).toContain(name);
        }
    });

    it('every tool has a description', async () => {
        const result = await client.listTools();
        for (const tool of result.tools) {
            expect(tool.description).toBeDefined();
            expect(tool.description!.length).toBeGreaterThan(20);
        }
    });

    it('every tool has a valid input schema', async () => {
        const result = await client.listTools();
        for (const tool of result.tools) {
            expect(tool.inputSchema).toBeDefined();
            expect(tool.inputSchema.type).toBe('object');
            expect(tool.inputSchema.properties).toBeDefined();
        }
    });

    it('every tool has output schema', async () => {
        const result = await client.listTools();
        for (const tool of result.tools) {
            expect(tool.outputSchema).toBeDefined();
            expect(tool.outputSchema!.type).toBe('object');
        }
    });
});

describe('MCP server end-to-end tool calls', () => {
    it('calls score_reliability and gets structured result', async () => {
        const result = await client.callTool({
            name: 'score_reliability',
            arguments: { urls: ['https://en.wikipedia.org/wiki/Rust'] },
        });
        expect(result.content).toBeDefined();
        expect(result.content.length).toBeGreaterThan(0);
        expect(result.content[0]!.type).toBe('text');
        const structured = result.structuredContent as Record<string, unknown>;
        expect(structured).toBeDefined();
        expect(structured.count).toBe(1);
        const results = structured.results as Array<Record<string, unknown>>;
        expect(results[0]!.reliabilityScore).toBe(1.0);
        expect(results[0]!.reliabilityTier).toBe('HIGH');
    }, 30000);

    it('score_reliability handles multiple URLs', async () => {
        const result = await client.callTool({
            name: 'score_reliability',
            arguments: {
                urls: [
                    'https://en.wikipedia.org/wiki/Rust',
                    'https://reddit.com/r/rust',
                    'https://arxiv.org/abs/2401.00001',
                ],
            },
        });
        const structured = result.structuredContent as Record<string, unknown>;
        expect(structured.count).toBe(3);
        const results = structured.results as Array<Record<string, unknown>>;
        expect(results[0]!.reliabilityTier).toBe('HIGH');
        expect(results[1]!.reliabilityTier).toBe('MEDIUM');
        expect(results[2]!.reliabilityTier).toBe('HIGH');
    }, 30000);

    it('rejects invalid tool name', async () => {
        const result = await client.callTool({ name: 'nonexistent_tool', arguments: {} });
        expect(result.isError).toBe(true);
    });

    it('score_reliability validates input schema (requires urls array)', async () => {
        const result = await client.callTool({ name: 'score_reliability', arguments: {} });
        expect(result.isError).toBe(true);
    });
});

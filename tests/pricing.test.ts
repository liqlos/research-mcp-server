import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const chargeMock = vi.fn().mockResolvedValue({ chargedCount: 1 });

vi.mock('apify', async (importOriginal) => {
    const actual = await importOriginal<typeof import('apify')>();
    const MockedActor = Object.create(actual.Actor);
    MockedActor.charge = chargeMock;
    return { ...actual, Actor: MockedActor };
});

const { server } = await import('../src/main.js');

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

describe('pay-per-event pricing', () => {
    it('does NOT charge when a tool returns an error', async () => {
        chargeMock.mockClear();
        const result = await client.callTool({
            name: 'extract_content',
            arguments: { url: 'http://10.0.0.1/secret' },
        });
        const structured = result.structuredContent as Record<string, unknown>;
        expect(structured.error).toBeDefined();
        expect(structured.count).toBe(0);
        expect(chargeMock).not.toHaveBeenCalled();
    });

    it('charges when a tool succeeds', async () => {
        chargeMock.mockClear();
        await client.callTool({
            name: 'score_reliability',
            arguments: { urls: ['https://en.wikipedia.org/wiki/Rust'] },
        });
        expect(chargeMock).toHaveBeenCalledTimes(1);
        expect(chargeMock).toHaveBeenCalledWith({ eventName: 'tool-call-simple' });
    });
});

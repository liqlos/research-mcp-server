import { ToolResponse, withCache, CACHE_TTL_MS } from './research.js';
import { verifySingleReference, CitationVerification } from './verify.js';

export interface BatchVerificationResult {
    total: number;
    verified: number;
    mismatched: number;
    notFound: number;
    results: CitationVerification[];
    detectedFormat: string;
}

const BIBTEX_ENTRY_REGEX = /@(?:article|inproceedings|book|incollection|phdthesis|mastersthesis|techreport|unpublished|misc|conference|booklet|manual)\s*\{/i;

function detectFormat(bibliography: string): 'bibtex' | 'apa' | 'mla' | 'plain' {
    if (BIBTEX_ENTRY_REGEX.test(bibliography)) return 'bibtex';
    const lines = bibliography.split('\n').map(l => l.trim()).filter(Boolean);
    const apaCount = lines.filter(l => /\(\d{4}\)/.test(l) && l.includes(',')).length;
    const mlaCount = lines.filter(l => /\d{4}\.$/.test(l) && l.includes('"')).length;
    if (apaCount > mlaCount && apaCount > 0) return 'apa';
    if (mlaCount > 0) return 'mla';
    return 'plain';
}

function parseBibliography(bibliography: string, format: 'auto' | 'apa' | 'mla' | 'bibtex' | 'plain'): { references: string[]; detectedFormat: string } {
    const detected = format === 'auto' ? detectFormat(bibliography) : format;
    if (detected === 'bibtex') {
        const entries: string[] = [];
        const regex = /@(?:article|inproceedings|book|incollection|phdthesis|mastersthesis|techreport|unpublished|misc|conference|booklet|manual)\s*\{[^@]*/gi;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(bibliography)) !== null) {
            entries.push(match[0].trim());
        }
        return { references: entries, detectedFormat: 'bibtex' };
    }
    const lines = bibliography.split('\n').map(l => l.trim()).filter(Boolean);
    return { references: lines, detectedFormat: detected };
}

export async function validateBibliography(
    bibliography: string,
    format: 'auto' | 'apa' | 'mla' | 'bibtex' | 'plain' = 'auto',
    limit: number = 50,
): Promise<ToolResponse<BatchVerificationResult>> {
    if (!bibliography || bibliography.length === 0) {
        return { query: 'validate_bibliography', count: 0, results: [], error: 'No bibliography provided' };
    }
    if (bibliography.length > 50000) {
        return { query: 'validate_bibliography', count: 0, results: [], error: 'Bibliography must be max 50000 chars' };
    }
    const effectiveLimit = Math.min(limit, 100);
    return withCache('validate_bibliography', CACHE_TTL_MS.validate_bibliography, [bibliography, format, effectiveLimit], async () => {
        try {
            const { references, detectedFormat } = parseBibliography(bibliography, format);
            const refsToProcess = references.slice(0, effectiveLimit);
            const batchSize = 10;
            const allResults: CitationVerification[] = [];
            for (let i = 0; i < refsToProcess.length; i += batchSize) {
                const batch = refsToProcess.slice(i, i + batchSize);
                const settled = await Promise.allSettled(batch.map(ref => verifySingleReference(ref)));
                for (let j = 0; j < settled.length; j++) {
                    const r = settled[j];
                    if (r && r.status === 'fulfilled') {
                        allResults.push(r.value);
                    } else {
                        allResults.push({ input: batch[j] ?? '', status: 'NOT_FOUND' as const });
                    }
                }
            }
            const result: BatchVerificationResult = {
                total: allResults.length,
                verified: allResults.filter(r => r.status === 'VERIFIED').length,
                mismatched: allResults.filter(r => r.status === 'MISMATCH').length,
                notFound: allResults.filter(r => r.status === 'NOT_FOUND').length,
                results: allResults,
                detectedFormat,
            };
            return { query: 'validate_bibliography', count: 1, results: [result] };
        } catch (err) {
            return { query: 'validate_bibliography', count: 0, results: [], error: `Batch validation failed: ${(err as Error).message}` };
        }
    });
}

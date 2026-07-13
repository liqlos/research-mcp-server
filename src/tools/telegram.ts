import { ToolResponse, withCache, CACHE_TTL_MS, fetchWithTimeout, ProgressCallback } from './research.js';

export interface TelegramResult {
    messageId: number;
    channel: string;
    text: string;
    date: string;
    views: number;
    author: string;
    permalink: string;
    forwardedFrom: string;
}

function parseViews(viewsText: string): number {
    const cleaned = viewsText.replace(/[^\d.KM]/g, '').trim();
    if (!cleaned) return 0;
    const multiplier = cleaned.endsWith('K') ? 1000 : cleaned.endsWith('M') ? 1000000 : 1;
    const numStr = cleaned.replace(/[KM]/g, '');
    const num = parseFloat(numStr);
    if (isNaN(num)) return 0;
    return Math.round(num * multiplier);
}

function parseTelegramHtml(html: string, channel: string): TelegramResult[] {
    const messageRegex = /<div[^>]*class="tgme_widget_message[^"]*"[^>]*data-post="([^"]+)"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gs;
    const messages: TelegramResult[] = [];
    let match: RegExpExecArray | null;
    while ((match = messageRegex.exec(html)) !== null && messages.length < 50) {
        const dataPost = match[1] || '';
        const block = match[2] || '';
        const messageId = parseInt(dataPost.split('/')[1] || '0', 10) || 0;
        const textMatch = block.match(/<div[^>]*class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/s);
        const text = textMatch ? (textMatch[1] || '').replace(/<[^>]+>/g, '').trim() : '';
        const dateMatch = block.match(/<time[^>]*datetime="([^"]+)"/s);
        const date = dateMatch ? dateMatch[1] || '' : '';
        const viewsMatch = block.match(/<span[^>]*class="tgme_widget_message_views"[^>]*>([\s\S]*?)<\/span>/s);
        const views = viewsMatch ? parseViews((viewsMatch[1] || '').replace(/<[^>]+>/g, '').trim()) : 0;
        const authorMatch = block.match(/<div[^>]*class="tgme_widget_message_footer"[^>]*>[\s\S]*?<a[^>]*>(.*?)<\/a>/s);
        const author = authorMatch ? (authorMatch[1] || '').replace(/<[^>]+>/g, '').trim() : '';
        const forwardedMatch = block.match(/<span[^>]*class="tgme_widget_message_forwarded_from_name"[^>]*>(.*?)<\/span>/s);
        const forwardedFrom = forwardedMatch ? (forwardedMatch[1] || '').replace(/<[^>]+>/g, '').trim() : '';
        messages.push({
            messageId,
            channel,
            text,
            date,
            views,
            author,
            permalink: `https://t.me/${dataPost}`,
            forwardedFrom,
        });
    }
    return messages;
}

export async function searchTelegram(channel: string, maxMessages: number = 50, onProgress?: ProgressCallback): Promise<ToolResponse<TelegramResult>> {
    return withCache('search_telegram', CACHE_TTL_MS.search_telegram, [channel, maxMessages], async () => {
        try {
            const rawChannel = channel.replace(/^@/, '').replace(/^https?:\/\/t\.me\//, '');
            const cleanChannel = rawChannel.toLowerCase().replace(/[^a-z0-9_-]/g, '');
            if (!cleanChannel) {
                return { query: channel, count: 0, results: [], error: 'Invalid channel name: must contain at least one alphanumeric character' };
            }
            if (cleanChannel.length > 100) {
                return { query: channel, count: 0, results: [], error: 'Channel name too long: maximum 100 characters allowed' };
            }
            const cappedMaxMessages = Math.min(maxMessages, 500);
            const allMessages: TelegramResult[] = [];
            let before: number | null = null;
            const startTime = Date.now();
            const MAX_DURATION_MS = 30000;
            for (let page = 0; page < 10 && allMessages.length < cappedMaxMessages; page++) {
                if (Date.now() - startTime > MAX_DURATION_MS) break;
                const url = before
                    ? `https://t.me/s/${cleanChannel}?before=${before}`
                    : `https://t.me/s/${cleanChannel}`;
                const resp = await fetchWithTimeout(url, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResearchMCPServer/1.0)' },
                }, 2, true);
                if (!resp.ok) {
                    if (page === 0) {
                        return { query: channel, count: 0, results: [], error: `Telegram returned ${resp.status}` };
                    }
                    break;
                }
                const html = await resp.text();
                if (html.includes('You can view and join') && !html.includes('tgme_widget_message')) {
                    return { query: channel, count: 0, results: [], error: 'Channel is private or has no public preview' };
                }
                const pageMessages = parseTelegramHtml(html, cleanChannel);
                if (pageMessages.length === 0) break;
                const oldestId = Math.min(...pageMessages.map(m => m.messageId));
                if (oldestId === before || oldestId <= 0) break;
                const prevBefore: number | null = before;
                before = oldestId;
                if (before === 0 || before === prevBefore) break;
                allMessages.push(...pageMessages);
                await onProgress?.(allMessages.length, cappedMaxMessages, `Fetched ${allMessages.length}/${cappedMaxMessages} messages (page ${page + 1})`);
                await new Promise(r => setTimeout(r, 1500));
            }
            return { query: channel, count: allMessages.length, results: allMessages.slice(0, cappedMaxMessages) };
        } catch (err) {
            return { query: channel, count: 0, results: [], error: `Telegram search failed: ${(err as Error).message}` };
        }
    });
}

import { describe, expect, it } from 'vitest';
import { createHttpAdvisorProviders, type HttpClient } from '../packages/adapters/src/index.js';

describe('Advisor HTTP adapters', () => {
  it('keeps provider transport and parsing behind one port', async () => {
    const captured: { url: string; body: unknown; headers: HeadersInit | undefined }[] = [];
    const http: HttpClient = { getJson: async () => ({ ok: false, status: 500, reason: 'http', retried: 0 }),
      getText: async () => ({ ok: false, status: 500, reason: 'http', retried: 0 }), destroy() {},
      postJson: async <T>(url: string, body: unknown, init?: RequestInit) => {
        captured.push({ url, body, headers: init?.headers });
        const data = url.includes('openai') ? { output_text: 'OpenAI text' } : url.includes('anthropic')
          ? { content: [{ type: 'text', text: 'Anthropic text' }] }
          : { candidates: [{ content: { parts: [{ text: 'Gemini text' }] } }] };
        return { ok: true, status: 200, data: data as T };
      } };
    const adapters = createHttpAdvisorProviders(http), request = { apiKey: 'secret-header-only',
      system: 'Only rephrase evidence.', evidenceJson: '{"fact":1}', question: 'Why?' };
    expect(await adapters.openai.generate(request)).toBe('OpenAI text');
    expect(await adapters.anthropic.generate(request)).toBe('Anthropic text');
    expect(await adapters.gemini.generate(request)).toBe('Gemini text');
    expect(JSON.stringify(captured.map((item) => item.body))).not.toContain('secret-header-only');
    expect(captured[0]?.body).toMatchObject({ store: false, tools: [] });
    expect(captured.every((item) => JSON.stringify(item.headers).includes('secret-header-only'))).toBe(true);
  });
});

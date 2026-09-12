import type { HttpClient } from '../http/index.js';

export type AdvisorProviderName = 'gemini' | 'openai' | 'anthropic';
export interface AdvisorProviderRequest {
  readonly apiKey: string;
  readonly system: string;
  readonly evidenceJson: string;
  readonly question: string;
}
export interface AdvisorProvider {
  readonly name: AdvisorProviderName;
  readonly model: string;
  verify?(apiKey: string): Promise<'verified' | 'unauthorized' | 'billing_required' | 'rate_limited' | 'provider_unavailable' | 'verification_inconclusive'>;
  generate(request: AdvisorProviderRequest): Promise<string>;
}

const MAX_ANSWER_CHARS = 20_000;
function answer(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('provider_response_invalid');
  const text = value.trim();
  if (text.length === 0 || text.length > MAX_ANSWER_CHARS) throw new TypeError('provider_response_invalid');
  return text;
}

class HttpAdvisorProvider implements AdvisorProvider {
  constructor(readonly name: AdvisorProviderName, readonly model: string,
    private readonly http: HttpClient) {}
  async verify(apiKey: string): Promise<'verified' | 'unauthorized' | 'billing_required' | 'rate_limited' | 'provider_unavailable' | 'verification_inconclusive'> {
    const result = this.name === 'openai'
      ? await this.http.getJson('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${apiKey}` } })
      : this.name === 'anthropic'
        ? await this.http.getJson('https://api.anthropic.com/v1/models', { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } })
        : await this.http.getJson('https://generativelanguage.googleapis.com/v1beta/models', { headers: { 'x-goog-api-key': apiKey } });
    if (result.ok) return 'verified';
    if (result.status === 401 || result.status === 403) return 'unauthorized';
    if (result.status === 402) return 'billing_required';
    if (result.status === 429) return 'rate_limited';
    if (result.reason === 'network' || result.reason === 'timeout' || result.status >= 500) return 'provider_unavailable';
    return 'verification_inconclusive';
  }
  async generate(request: AdvisorProviderRequest): Promise<string> {
    if (this.name === 'openai') {
      const result = await this.http.postJson<{ output_text?: string }>('https://api.openai.com/v1/responses', {
        model: this.model, instructions: request.system,
        input: `Evidence: ${request.evidenceJson}\nQuestion: ${request.question}`,
        max_output_tokens: 1200, store: false, tools: [],
      }, { headers: { authorization: `Bearer ${request.apiKey}` } });
      if (!result.ok) throw new TypeError('provider_failed');
      return answer(result.data.output_text);
    }
    if (this.name === 'anthropic') {
      const result = await this.http.postJson<{ content?: readonly { type?: string; text?: string }[] }>(
        'https://api.anthropic.com/v1/messages', { model: this.model, max_tokens: 1200,
          system: request.system, messages: [{ role: 'user',
            content: `Evidence: ${request.evidenceJson}\nQuestion: ${request.question}` }] },
        { headers: { 'x-api-key': request.apiKey, 'anthropic-version': '2023-06-01' } });
      const text = result.ok ? result.data.content?.find((item) => item.type === 'text')?.text : undefined;
      if (text === undefined) throw new TypeError('provider_failed');
      return answer(text);
    }
    const result = await this.http.postJson<{ candidates?: readonly { content?: { parts?: readonly { text?: string }[] } }[] }>(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`, {
        system_instruction: { parts: [{ text: request.system }] }, contents: [{ role: 'user', parts: [{
          text: `Evidence: ${request.evidenceJson}\nQuestion: ${request.question}` }] }],
      }, { headers: { 'x-goog-api-key': request.apiKey } });
    const text = result.ok ? result.data.candidates?.[0]?.content?.parts?.[0]?.text : undefined;
    if (text === undefined) throw new TypeError('provider_failed');
    return answer(text);
  }
}

export function createHttpAdvisorProviders(http: HttpClient): Readonly<Record<AdvisorProviderName, AdvisorProvider>> {
  return Object.freeze({
    gemini: new HttpAdvisorProvider('gemini', 'gemini-2.5-flash', http),
    openai: new HttpAdvisorProvider('openai', 'gpt-5-mini', http),
    anthropic: new HttpAdvisorProvider('anthropic', 'claude-sonnet-4-5', http),
  });
}

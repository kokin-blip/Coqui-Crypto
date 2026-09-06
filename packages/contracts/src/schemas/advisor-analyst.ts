import * as z from 'zod';

const provider = z.enum(['gemini', 'openai', 'anthropic']);
const scope = z.strictObject({ chartData: z.boolean(), visibleEvidence: z.boolean(), sanitizedPortfolio: z.boolean() }).readonly();
const fact = z.strictObject({ label: z.string().min(1).max(80), value: z.string().max(240), tone: z.enum(['neutral', 'positive', 'negative', 'warning']) }).readonly();
const contextBar = z.strictObject({ timeMs: z.number().int().nonnegative(), open: z.string(), high: z.string(), low: z.string(), close: z.string(), volume: z.string().nullable(), complete: z.boolean() }).readonly();
const answer = z.strictObject({ text: z.string().min(1).max(20_000), provider: z.enum(['local', 'gemini', 'openai', 'anthropic']), model: z.string().max(120), mode: z.enum(['analysis', 'scenario_ideas']), contextHash: z.string().length(64), generatedAtMs: z.number().int().nonnegative(), dataTimestampMs: z.number().int().nonnegative(), scope, provenance: z.array(z.string().max(160)).max(20).readonly(), advisoryOnly: z.literal(true), executionAuthority: z.literal(false) }).readonly();
const decisionId = z.string().regex(/^[a-f0-9]{64}$/u);
const navigationTarget = z.enum(['activity', 'paper', 'research', 'risk', 'market', 'advisor']);

export const advisorAnalystChannelSchemas = {
  'advisor.providers': {
    request: z.strictObject({}).readonly(),
    response: z.strictObject({ providers: z.array(z.strictObject({ provider, credentialState: z.enum(['connected', 'disconnected', 'unavailable']), model: z.string().max(120) }).readonly()).length(3).readonly() }).readonly(),
  },
  'advisor.provider.connect': {
    request: z.strictObject({ commandId: z.string().uuid(), provider,
      apiKey: z.string().min(20).max(512), confirmed: z.literal(true) }).readonly(),
    response: z.strictObject({ provider, credentialState: z.literal('connected') }).readonly(),
  },
  'advisor.provider.disconnect': {
    request: z.strictObject({ commandId: z.string().uuid(), provider, confirmed: z.literal(true) }).readonly(),
    response: z.strictObject({ provider, credentialState: z.literal('disconnected') }).readonly(),
  },
  'advisor.context.prepare': {
    request: z.strictObject({ productId: z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,63}$/u), bars: z.array(contextBar).max(500).readonly(), evidence: z.array(fact).max(40).readonly(), portfolio: z.array(fact).max(40).readonly(), scope }).readonly(),
    response: z.strictObject({ contextHash: z.string().length(64), dataTimestampMs: z.number().int().nonnegative(), scope, localFacts: z.array(fact).max(30).readonly(), payloadBytes: z.number().int().nonnegative().max(65_536) }).readonly(),
  },
  'advisor.facts.generate': {
    request: z.strictObject({ commandId: z.string().uuid(), contextHash: z.string().length(64), provider: provider.nullable() }).readonly(),
    response: answer,
  },
  'advisor.chat.send': {
    request: z.strictObject({ commandId: z.string().uuid(), contextHash: z.string().length(64), provider,
      mode: z.enum(['analysis', 'scenario_ideas']), message: z.string().min(1).max(4_000),
      conversationId: z.string().uuid().nullable(), retention: z.enum(['session', 'encrypted']) }).readonly(),
    response: z.strictObject({ conversationId: z.string().uuid(), answer }).readonly(),
  },
  'advisor.chat.history': {
    request: z.strictObject({ conversationId: z.string().uuid().nullable() }).readonly(),
    response: z.strictObject({ conversations: z.array(z.strictObject({ id: z.string().uuid(), title: z.string().max(120), retention: z.enum(['session', 'encrypted']), updatedAtMs: z.number().int().nonnegative(), messages: z.array(z.strictObject({ id: z.string().uuid(), role: z.enum(['user', 'assistant']), text: z.string().max(20_000), createdAtMs: z.number().int().nonnegative() }).readonly()).max(200).readonly() }).readonly()).max(50).readonly() }).readonly(),
  },
  'advisor.chat.history.delete': {
    request: z.strictObject({ commandId: z.string().uuid(), conversationId: z.string().uuid(), confirmed: z.literal(true) }).readonly(),
    response: z.strictObject({ outcome: z.literal('deleted') }).readonly(),
  },
  'advisor.chat.history.export': {
    request: z.strictObject({ commandId: z.string().uuid(), conversationId: z.string().uuid() }).readonly(),
    response: z.strictObject({ outcome: z.enum(['saved', 'cancelled']) }).readonly(),
  },
  'advisor.decision.explain': {
    request: z.strictObject({ commandId: z.string().uuid(), decisionId,
      provider: provider.nullable() }).readonly(),
    response: z.strictObject({ decisionId, evidencePackId: decisionId, evidenceHash: decisionId,
      freshness: z.enum(['fresh', 'stale', 'unavailable']), dataTimestampMs: z.number().int().nonnegative(),
      text: z.string().min(1).max(20_000), provider: z.enum(['local','gemini','openai','anthropic']),
      model: z.string().max(120), fallbackReason: z.literal('provider_failed').nullable(),
      provenance: z.array(z.string().max(160)).max(20).readonly(), advisoryOnly: z.literal(true),
      executionAuthority: z.literal(false) }).readonly(),
  },
  'advisor.navigation': {
    request: z.strictObject({ commandId: z.string().uuid(), target: navigationTarget,
      decisionId: decisionId.nullable() }).readonly(),
    response: z.strictObject({ target: navigationTarget, decisionId: decisionId.nullable(),
      auditId: decisionId, advisoryOnly: z.literal(true), executionAuthority: z.literal(false) }).readonly(),
  },
} as const;

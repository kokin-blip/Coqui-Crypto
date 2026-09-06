import { createHttpAdvisorProviders, createMemorySecretStore, type HttpClient, type SecretStore } from '@coqui/adapters';
import { sha256Hex, type Clock } from '@coqui/core';
import { AdvisorAnalystService, AdvisorDecisionEvidenceService } from '@coqui/services';
import { readChartWorkspaceCommand, saveChartWorkspaceCommand, type Db } from '@coqui/storage';

import type { ChannelHandlers } from './dispatch.js';

interface Command { readonly commandId: string }
export function createAdvisorHandlers(input: { readonly profileId: string; readonly database: Db;
  readonly clock: Clock; readonly http: HttpClient; readonly secrets?: SecretStore;
  readonly saveHistory?: (data: string) => Promise<'saved' | 'cancelled'> }): ChannelHandlers {
  const secrets = input.secrets ?? createMemorySecretStore(), providers = createHttpAdvisorProviders(input.http);
  const service = new AdvisorAnalystService({ ...input, providers, secrets });
  const decisions = new AdvisorDecisionEvidenceService({ ...input, providers, secrets });
  const command = async <T>(payload: Command, action: unknown, run: () => Promise<T> | T) => {
    const requestHash = sha256Hex(`${input.profileId}:advisor:${JSON.stringify(action)}`), prior = readChartWorkspaceCommand(payload.commandId, input.database);
    if (prior !== null) return prior.profileId === input.profileId && prior.requestHash === requestHash
      ? JSON.parse(prior.outcomeJson) as { readonly ok: true; readonly value: T }
      : { ok: false as const, issues: [{ code: 'command_conflict' }] };
    try {
      const outcome = { ok: true as const, value: await run() };
      saveChartWorkspaceCommand({ commandId: payload.commandId, profileId: input.profileId,
        requestHash, outcomeJson: JSON.stringify(outcome), recordedAtMs: input.clock.nowMs() }, input.database);
      return outcome;
    } catch { return { ok: false as const, issues: [{ code: 'advisor_request_failed' }] }; }
  };
  return {
    'advisor.providers': async () => ({ ok: true, value: await service.providers() }),
    'advisor.provider.connect': (payload: Command & { readonly provider: 'gemini' | 'openai' | 'anthropic'; readonly apiKey: string }) => command(payload, { ...payload, apiKey: sha256Hex(payload.apiKey) }, () => service.connectProvider(payload.provider, payload.apiKey)),
    'advisor.provider.disconnect': (payload: Command & { readonly provider: 'gemini' | 'openai' | 'anthropic' }) => command(payload, payload, () => service.disconnectProvider(payload.provider)),
    'advisor.context.prepare': (payload: Parameters<typeof service.prepare>[0]) => {
      const prepared = service.prepare(payload);
      return { ok: true, value: { contextHash: prepared.contextHash,
        dataTimestampMs: prepared.dataTimestampMs, scope: prepared.scope,
        localFacts: prepared.localFacts, payloadBytes: prepared.payloadBytes } };
    },
    'advisor.facts.generate': (payload: Command & { readonly contextHash: string; readonly provider: 'gemini' | 'openai' | 'anthropic' | null }) => command(payload, payload, () => service.generate(payload.contextHash, payload.provider)),
    'advisor.chat.send': (payload: Command & Parameters<typeof service.send>[0]) => command(payload, payload, () => service.send(payload)),
    'advisor.chat.history': async (payload: { readonly conversationId: string | null }) => ({ ok: true, value: await service.history(payload.conversationId) }),
    'advisor.chat.history.delete': (payload: Command & { readonly conversationId: string }) => command(payload, payload, () => service.delete(payload.conversationId)),
    'advisor.chat.history.export': (payload: Command & { readonly conversationId: string }) => command(payload, payload, async () => {
      try {
        const data = await service.exportData(payload.conversationId);
        const outcome = input.saveHistory === undefined ? 'cancelled' as const : await input.saveHistory(data);
        service.auditExport(outcome === 'saved' ? 'succeeded' : 'cancelled');
        return { outcome };
      } catch (error) { service.auditExport('failed'); throw error; }
    }),
    'advisor.decision.explain': (payload: Command & { readonly decisionId: string;
      readonly provider: 'gemini' | 'openai' | 'anthropic' | null }) =>
      command(payload, payload, () => decisions.explain(payload.decisionId, payload.provider)),
    'advisor.navigation': (payload: Command & { readonly target: 'activity' | 'paper' | 'research' |
      'risk' | 'market' | 'advisor'; readonly decisionId: string | null }) =>
      command(payload, payload, () => decisions.navigate(payload.target, payload.decisionId)),
  } as ChannelHandlers;
}

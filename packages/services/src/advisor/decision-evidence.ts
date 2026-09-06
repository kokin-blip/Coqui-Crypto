import type { AdvisorProvider, AdvisorProviderName, SecretKey, SecretStore } from '@coqui/adapters';
import { canonicalJson, sha256Hex, type CanonicalJsonValue, type Clock, type DecisionEvidenceEventV1 } from '@coqui/core';
import { appendAdvisorAuditEvent, appendAdvisorNavigationAudit, getStrategyDecision, listDecisionEvidenceEvents,
  saveAdvisorEvidencePack, type AdvisorNavigationTarget, type Db,
  type StoredAdvisorEvidencePack } from '@coqui/storage';

const KEYS: Readonly<Record<AdvisorProviderName, SecretKey>> = {
  gemini: 'gemini-api-key', openai: 'openai-api-key', anthropic: 'anthropic-api-key',
};
const TARGETS = new Set<AdvisorNavigationTarget>(['activity','paper','research','risk','market','advisor']);
const DAY_MS = 86_400_000;

function eventFact(event: DecisionEvidenceEventV1): CanonicalJsonValue {
  const reasonCode = event.kind === 'stand_down' || event.kind === 'no_trade' || event.kind === 'execution_refused'
    ? event.detail.reasonCode : null;
  let detail: CanonicalJsonValue;
  switch (event.kind) {
    case 'strategy_evaluated': detail = { decisionHash: event.detail.decisionHash }; break;
    case 'risk_evaluated': detail = { approved: event.detail.approved,
      reasonCodes: event.detail.reasonCodes, assessmentHash: event.detail.assessmentHash }; break;
    case 'execution_planned': detail = { planId: event.detail.planId, planHash: event.detail.planHash,
      intentCount: event.detail.intentCount }; break;
    case 'no_trade': detail = { reasonCode: event.detail.reasonCode,
      estimatedTradeUsd: event.detail.estimatedTradeUsd,
      minimumUsefulTradeUsd: event.detail.minimumUsefulTradeUsd }; break;
    case 'stand_down': detail = { reasonCode: event.detail.reasonCode }; break;
    case 'execution_submitted': detail = { proposalId: event.detail.proposalId,
      proposalHash: event.detail.proposalHash, orderIds: event.detail.orderIds }; break;
    case 'execution_filled': detail = { proposalId: event.detail.proposalId,
      filledCount: event.detail.filledCount, refusedCount: event.detail.refusedCount }; break;
    case 'execution_refused': detail = { proposalId: event.detail.proposalId,
      reasonCode: event.detail.reasonCode, refusedCount: event.detail.refusedCount }; break;
    case 'recovery': detail = { orderId: event.detail.orderId,
      disposition: event.detail.disposition }; break;
  }
  return { sequence: event.sequence, kind: event.kind, atMs: event.atMs, reasonCode, detail };
}
function explanationFor(reason: string): string {
  const known: Readonly<Record<string, string>> = {
    stale_dataset: 'The completed market dataset was stale.',
    incomplete_dataset: 'The required completed-bar history was incomplete.',
    stale_rules: 'The product-rule snapshot was stale.',
    insufficient_history: 'The strategy did not have enough aligned completed history.',
    no_policy: 'No saved allocation policy was available.',
    below_minimum_trade: 'The planned change was below the minimum useful trade size.',
    no_rebalance_needed: 'The paper portfolio was already close enough to its targets.',
    evidence_not_verified: 'Required decision evidence could not be verified.',
    profitability_gate_failed: 'The registered profitability evidence did not clear the execution gate.',
    execution_lease_unavailable: 'Another local host held execution authority.',
    assumption_changed: 'A bound planning assumption changed before placement.',
    execution_lease_invalid: 'The execution fencing token was no longer current.',
    stale_result: 'A newer research attempt superseded this result.',
    trial_budget_exhausted: 'The registered research trial budget was exhausted.',
  };
  return known[reason] ?? `The runtime recorded the reason code “${reason}”.`;
}

export function deterministicDecisionExplanation(pack: StoredAdvisorEvidencePack): string {
  const evidence = JSON.parse(pack.evidenceJson) as { readonly strategy: { readonly id: string; readonly version: string };
    readonly targets: readonly { readonly assetId: string; readonly weight: number }[];
    readonly events: readonly { readonly kind: string; readonly reasonCode: string | null }[] };
  const last = [...evidence.events].reverse().find((event) => event.reasonCode !== null);
  const outcome = last?.reasonCode === undefined || last.reasonCode === null
    ? 'No refusal or stand-down reason was recorded.' : explanationFor(last.reasonCode);
  const targets = evidence.targets.length === 0 ? 'No targets were produced.' :
    `Targets: ${evidence.targets.map((target) => `${target.assetId} ${(target.weight * 100).toFixed(2)}%`).join(', ')}.`;
  return `${evidence.strategy.id} ${evidence.strategy.version}. ${outcome} ${targets} Evidence is ${pack.freshness}.`;
}

export class AdvisorDecisionEvidenceService {
  constructor(private readonly input: { readonly profileId: string; readonly database: Db;
    readonly clock: Clock; readonly secrets: SecretStore;
    readonly providers: Readonly<Record<AdvisorProviderName, AdvisorProvider>>;
    readonly maxAgeMs?: number }) {}

  prepare(decisionId: string): StoredAdvisorEvidencePack {
    const stored = getStrategyDecision(decisionId, this.input.database);
    if (stored === null || stored.decision.profileId !== this.input.profileId) throw new TypeError('decision_unavailable');
    const decision = stored.decision, events = listDecisionEvidenceEvents(decisionId, this.input.profileId, this.input.database);
    const dataAsOf = decision.market.asOfMs ?? decision.createdAtMs, now = this.input.clock.nowMs();
    const freshness = decision.market.freshness === 'unavailable' ? 'unavailable' :
      decision.market.freshness !== 'fresh' || !decision.market.rulesFresh || now < dataAsOf ||
        now - dataAsOf > (this.input.maxAgeMs ?? 2 * DAY_MS)
        ? 'stale' : 'fresh';
    const evidence = { schemaVersion: 1, decisionId, profileId: this.input.profileId,
      strategy: { id: decision.strategy.id, version: decision.strategy.version,
        configHash: decision.strategy.configHash }, market: { snapshotHash: decision.market.snapshotHash,
        asOfMs: decision.market.asOfMs, freshness: decision.market.freshness,
        refreshResult: decision.market.refreshResult, rulesFresh: decision.market.rulesFresh,
        ruleSnapshotHash: decision.market.ruleSnapshotHash }, portfolio: decision.portfolio,
      targets: decision.targets, cashWeight: decision.cashWeight, exposure: decision.exposure,
      historyStatus: decision.historyStatus, facts: decision.facts,
      events: events.map(eventFact), evidenceCompleteness: 'allowlisted' };
    const evidenceJson = canonicalJson(evidence as unknown as CanonicalJsonValue), evidenceHash = sha256Hex(evidenceJson);
    const latestEventSequence = events.at(-1)?.sequence ?? -1;
    const id = sha256Hex(`advisor-decision-evidence-v1:${this.input.profileId}:${decisionId}:${latestEventSequence}:${evidenceHash}:${freshness}:${now}`);
    const pack: StoredAdvisorEvidencePack = { id, profileId: this.input.profileId, decisionId,
      schemaVersion: 1, decisionHash: stored.contentHash, latestEventSequence, evidenceJson,
      evidenceHash, dataAsOf, freshness, createdAt: now };
    saveAdvisorEvidencePack(pack, this.input.database);
    return Object.freeze(pack);
  }

  async explain(decisionId: string, providerName: AdvisorProviderName | null) {
    const pack = this.prepare(decisionId), local = deterministicDecisionExplanation(pack);
    if (providerName === null) {
      appendAdvisorAuditEvent(this.input.profileId, 'local', 'facts', 'succeeded',
        pack.evidenceHash, this.input.clock.nowMs(), this.input.database);
      return this.#answer(pack, 'local', 'deterministic-decision-v1', local, null);
    }
    try {
      const secret = await this.input.secrets.read(KEYS[providerName], this.input.profileId);
      if (!secret.ok || secret.value === null) throw new TypeError('provider_unavailable');
      const provider = this.input.providers[providerName];
      const text = await provider.generate({ apiKey: secret.value,
        system: 'Rephrase only the supplied decision evidence. Do not add facts, advice, tools, actions, configuration, orders, or predictions. State uncertainty. Advisory only.',
        evidenceJson: pack.evidenceJson, question: 'Explain why this decision occurred.' });
      appendAdvisorAuditEvent(this.input.profileId, providerName, 'facts', 'succeeded',
        pack.evidenceHash, this.input.clock.nowMs(), this.input.database);
      return this.#answer(pack, provider.name, provider.model, text, null);
    } catch {
      appendAdvisorAuditEvent(this.input.profileId, providerName, 'facts', 'failed',
        pack.evidenceHash, this.input.clock.nowMs(), this.input.database);
      return this.#answer(pack, 'local', 'deterministic-decision-v1', local, 'provider_failed');
    }
  }

  navigate(target: AdvisorNavigationTarget, decisionId: string | null) {
    const at = this.input.clock.nowMs();
    if (!TARGETS.has(target)) {
      appendAdvisorNavigationAudit({ profileId: this.input.profileId, decisionId, target: 'advisor',
        outcome: 'rejected', reasonCode: 'unsupported_navigation', at }, this.input.database);
      throw new TypeError('unsupported_navigation');
    }
    if (decisionId !== null) {
      const decision = getStrategyDecision(decisionId, this.input.database);
      if (decision === null || decision.decision.profileId !== this.input.profileId) {
        appendAdvisorNavigationAudit({ profileId: this.input.profileId, decisionId, target,
          outcome: 'rejected', reasonCode: 'decision_unavailable', at }, this.input.database);
        throw new TypeError('decision_unavailable');
      }
    }
    const auditId = appendAdvisorNavigationAudit({ profileId: this.input.profileId, decisionId,
      target, outcome: 'accepted', reasonCode: 'allowlisted_navigation', at }, this.input.database);
    return { target, decisionId, auditId, advisoryOnly: true as const, executionAuthority: false as const };
  }

  #answer(pack: StoredAdvisorEvidencePack, provider: AdvisorProviderName | 'local', model: string,
    text: string, fallbackReason: 'provider_failed' | null) {
    return { decisionId: pack.decisionId, evidencePackId: pack.id, evidenceHash: pack.evidenceHash,
      freshness: pack.freshness, dataTimestampMs: pack.dataAsOf, text, provider, model,
      fallbackReason, provenance: [`decision:${pack.decisionId}`, `evidence:${pack.evidenceHash}`],
      advisoryOnly: true as const, executionAuthority: false as const };
  }
}

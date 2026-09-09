import { describe, expect, it } from 'vitest';
import { createMemorySecretStore, type AdvisorProvider, type AdvisorProviderName } from '../packages/adapters/src/index.js';
import { FixedClock, marketEventId, sha256Hex, strategyDecisionId,
  type DecisionEvidenceEventV1, type StrategyDecisionV1 } from '../packages/core/src/index.js';
import { AdvisorDecisionEvidenceService, MarketEventService } from '../packages/services/src/index.js';
import { appendDecisionEvidenceEvent, openDatabase, saveStrategyDecision } from '../packages/storage/src/index.js';

const T0 = 1_800_000_000_000;
function decision(profileId = 'profile-a'): StrategyDecisionV1 {
  const id = strategyDecisionId(profileId, T0);
  return { schemaVersion: 1, decisionId: id, profileId, runId: sha256Hex(`run:${profileId}`),
    scheduledForMs: T0, strategy: { id: 'trendvol', version: 'trendvol-paper-v1-unvalidated',
      configHash: sha256Hex('config') }, market: { snapshotHash: sha256Hex('market'), asOfMs: T0,
      expectedAsOfMs: T0, freshness: 'fresh', refreshResult: 'succeeded',
      ruleSnapshotHash: sha256Hex('rules'), rulesFresh: true }, portfolio: {
      snapshotHash: sha256Hex('portfolio'), version: 'paper-v1', source: 'paper_ledger' },
    targets: [{ assetId: 'asset:btc', weight: 0.7 }], cashWeight: 0.3, exposure: 0.7,
    historyStatus: 'complete', facts: { momentum: [], realizedVolPct: 12, belowTrend: false },
    createdAtMs: T0 };
}
function providers(generate: AdvisorProvider['generate']): Readonly<Record<AdvisorProviderName, AdvisorProvider>> {
  const provider = (name: AdvisorProviderName): AdvisorProvider => ({ name, model: `${name}-test`, generate });
  return { gemini: provider('gemini'), openai: provider('openai'), anthropic: provider('anthropic') };
}
function seed(database: ReturnType<typeof openDatabase>): StrategyDecisionV1 {
  const value = decision(), stored = saveStrategyDecision(value, database);
  appendDecisionEvidenceEvent({ schemaVersion: 1, decisionId: value.decisionId,
    profileId: value.profileId, sequence: 0, kind: 'strategy_evaluated', atMs: T0,
    detail: { decisionHash: stored.contentHash } }, database);
  const event: DecisionEvidenceEventV1 = { schemaVersion: 1, decisionId: value.decisionId,
    profileId: value.profileId, sequence: 1, kind: 'stand_down', atMs: T0,
    detail: { reasonCode: 'profitability_gate_failed' } };
  appendDecisionEvidenceEvent(event, database); return value;
}

describe('Advisor decision evidence', () => {
  it('builds an immutable allowlisted pack and explains every recorded reason offline', async () => {
    const database = openDatabase(':memory:'), value = seed(database), clock = new FixedClock(T0);
    new MarketEventService({ profileId: value.profileId, database, clock: new FixedClock(T0 + 100) })
      .ingestLocal('fixture', 'events.json', [
        { sourceEventId: 'available', title: 'Protocol upgrade', publishedAtMs: T0 - 20, firstSeenAtMs: T0 - 10 },
        { sourceEventId: 'later', title: 'Exchange outage', publishedAtMs: T0, firstSeenAtMs: T0 + 10 },
      ]);
    const service = new AdvisorDecisionEvidenceService({ profileId: value.profileId, database, clock,
      secrets: createMemorySecretStore(), providers: providers(async () => 'unused') });
    const answer = await service.explain(value.decisionId, null);
    expect(answer).toMatchObject({ provider: 'local', decisionId: value.decisionId,
      freshness: 'fresh', executionAuthority: false, fallbackReason: null });
    expect(answer.text).toContain('registered profitability evidence');
    const row = database.prepare('SELECT evidence_json FROM advisor_decision_evidence_packs_v1').get() as { evidence_json: string };
    expect(row.evidence_json).toContain('profitability_gate_failed');
    expect(row.evidence_json).toContain('Protocol upgrade');
    expect(row.evidence_json).not.toContain('Exchange outage');
    expect(row.evidence_json).not.toMatch(/apiKey|credential|ciphertext|question/iu);
    expect(() => database.prepare('UPDATE advisor_decision_evidence_packs_v1 SET freshness=?').run('stale')).toThrow('immutable');
    database.close();
  });

  it('falls back locally on provider failure and never changes the evidence', async () => {
    const database = openDatabase(':memory:'), value = seed(database), clock = new FixedClock(T0);
    const service = new AdvisorDecisionEvidenceService({ profileId: value.profileId, database, clock,
      secrets: createMemorySecretStore({ 'openai-api-key:profile-a': 'provider-key-that-stays-in-adapter' }),
      providers: providers(async () => { throw new Error('remote details'); }) });
    const answer = await service.explain(value.decisionId, 'openai');
    expect(answer).toMatchObject({ provider: 'local', fallbackReason: 'provider_failed' });
    expect(JSON.stringify(database.prepare('SELECT * FROM advisor_decision_evidence_packs_v1').all()))
      .not.toContain('provider-key-that-stays-in-adapter');
    database.close();
  });

  it('explains profile-scoped market-event evidence offline and accepts its typed destination', async()=>{
    const database=openDatabase(':memory:'),clock=new FixedClock(T0),eventId=marketEventId('profile-a','fixture','one');
    new MarketEventService({profileId:'profile-a',database,clock}).ingestLocal('fixture','events.json',[{
      sourceEventId:'one',title:'Exchange maintenance',summary:'Planned venue maintenance.',
      assetSymbols:['BTC'],publishedAtMs:T0-100,firstSeenAtMs:T0-50}]);
    const service=new AdvisorDecisionEvidenceService({profileId:'profile-a',database,clock,
      secrets:createMemorySecretStore({'openai-api-key:profile-a':'provider-key'}),
      providers:providers(async()=>{throw new Error('provider details');})});
    const answer=await service.explainEvidence({kind:'market_event',id:eventId},null);
    expect(answer).toMatchObject({provider:'local',subject:{kind:'market_event',id:eventId},executionAuthority:false});
    expect(answer.text).toContain('cannot influence targets or execution');
    expect(await service.explainEvidence({kind:'market_event',id:eventId},'openai'))
      .toMatchObject({provider:'local',fallbackReason:'provider_failed',evidenceHash:answer.evidenceHash});
    expect(service.navigate('market',null,{candidateId:null,productId:'BTC-USD',eventId}))
      .toMatchObject({target:'market',productId:'BTC-USD',eventId});
    expect(()=>service.navigate('paper',null,{candidateId:null,productId:null,eventId})).toThrow('unsupported_navigation');
    const audits=database.prepare('SELECT outcome,detail_json FROM advisor_navigation_audit_events_v1 ORDER BY rowid')
      .all() as {outcome:string;detail_json:string}[];
    expect(audits.map((row)=>row.outcome)).toEqual(['accepted','rejected']);
    expect(audits[0]?.detail_json).toContain(eventId);
    database.close();
  });

  it('gives a provider only the persisted evidence and a rephrase-only instruction', async () => {
    const database = openDatabase(':memory:'), value = seed(database), clock = new FixedClock(T0);
    let supplied: Parameters<AdvisorProvider['generate']>[0] | null = null;
    const service = new AdvisorDecisionEvidenceService({ profileId: value.profileId, database, clock,
      secrets: createMemorySecretStore({ 'openai-api-key:profile-a': 'provider-key-that-stays-in-adapter' }),
      providers: providers(async (request) => { supplied = request; return 'Bounded rephrasing.'; }) });
    const answer = await service.explain(value.decisionId, 'openai');
    expect(answer).toMatchObject({ provider: 'openai', fallbackReason: null });
    const sent = supplied as Parameters<AdvisorProvider['generate']>[0] | null;
    expect(sent).toMatchObject({ question: 'Explain why this decision occurred.' });
    if (sent === null) throw new Error('Provider did not receive evidence.');
    expect(sent.system).toContain('Rephrase only');
    expect(sent.evidenceJson).toContain(value.decisionId);
    expect(sent.evidenceJson).not.toContain('provider-key-that-stays-in-adapter');
    database.close();
  });

  it('marks old evidence stale and enforces profile and navigation allowlists', async () => {
    const database = openDatabase(':memory:'), value = seed(database), clock = new FixedClock(T0 + 3 * 86_400_000);
    const service = new AdvisorDecisionEvidenceService({ profileId: value.profileId, database, clock,
      secrets: createMemorySecretStore(), providers: providers(async () => 'unused') });
    expect((await service.explain(value.decisionId, null)).freshness).toBe('stale');
    const navigation = service.navigate('activity', value.decisionId);
    expect(navigation).toMatchObject({ target: 'activity', executionAuthority: false });
    expect(() => service.navigate('execute' as never, value.decisionId)).toThrow('unsupported_navigation');
    const other = new AdvisorDecisionEvidenceService({ profileId: 'profile-b', database, clock,
      secrets: createMemorySecretStore(), providers: providers(async () => 'unused') });
    await expect(other.explain(value.decisionId, null)).rejects.toThrow('decision_unavailable');
    expect((database.prepare('SELECT outcome FROM advisor_navigation_audit_events_v1 ORDER BY at').all() as { outcome: string }[])
      .map((row) => row.outcome)).toEqual(['accepted', 'rejected']);
    database.close();
  });
});

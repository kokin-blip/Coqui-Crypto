import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { createRuntime } from '../apps/desktop/src/main/composition.js';
import { createDispatcher } from '../apps/desktop/src/main/dispatch.js';
import { classifyMarketEvent, marketEventId, type Clock } from '../packages/core/src/index.js';
import { MarketEventService, parseLocalMarketEventFixture, ResearchTriggerCoordinator } from '../packages/services/src/index.js';
import { getMarketEvent, listMarketEventsAsOf, openDatabase } from '../packages/storage/src/index.js';

class MutableClock implements Clock {
  constructor(public now: number) {}
  nowMs(): number { return this.now; }
}

const input = (sourceEventId: string, firstSeenAtMs = 100) => ({ sourceEventId,
  title: 'Regulatory approval for BTC market', summary: 'A court approval was published.',
  assetSymbols: ['BTC', 'BTC'], publishedAtMs: 90, firstSeenAtMs });

describe('immutable market-event dataset', () => {
  it('classifies deterministically without target or execution authority', () => {
    const result = classifyMarketEvent(input('one'), 100);
    expect(result).toMatchObject({ label: 'regulatory', sentiment: 'positive', importance: 'high' });
  });

  it('deduplicates exact local fixtures and rejects changed content', () => {
    const database = openDatabase(':memory:'), clock = new MutableClock(200);
    const service = new MarketEventService({ profileId: 'main', database, clock });
    expect(service.ingestLocal('fixture', 'events.json', [input('one')])[0]).toMatchObject({
      inserted: true, targetInfluence: false, executionAuthority: false,
    });
    expect(service.ingestLocal('fixture', 'events.json', [input('one')])[0]?.inserted).toBe(false);
    expect(() => service.ingestLocal('fixture', 'events.json', [{ ...input('one'), title: 'Changed' }]))
      .toThrow('identity cannot change');
    expect(service.timeline(200, 20)[0]?.event.assetSymbols).toEqual(['BTC']);
    database.close();
  });

  it('preserves temporal replay and profile isolation', () => {
    const database = openDatabase(':memory:'), clock = new MutableClock(300);
    new MarketEventService({ profileId: 'main', database, clock })
      .ingestLocal('fixture', 'events.json', [input('one', 200)]);
    expect(listMarketEventsAsOf('main', 199, 20, database)).toEqual([]);
    expect(listMarketEventsAsOf('other', 300, 20, database)).toEqual([]);
    expect(listMarketEventsAsOf('main', 200, 20, database)[0]?.classification?.classifiedAtMs).toBe(200);
    database.close();
  });

  it('retrieves an exact profile-scoped event outside the bounded timeline window', () => {
    const database=openDatabase(':memory:'),clock=new MutableClock(1_000);
    const service=new MarketEventService({profileId:'main',database,clock});
    const fixtures=Array.from({length:201},(_,index)=>({...input(`event-${index}`,100+index),publishedAtMs:90+index}));
    const oldest=service.ingestLocal('fixture','events.json',fixtures.slice(0,100))[0]!.eventId;
    service.ingestLocal('fixture','events.json',fixtures.slice(100,200));
    service.ingestLocal('fixture','events.json',fixtures.slice(200));
    expect(listMarketEventsAsOf('main',1_000,200,database).some((item)=>item.event.id===oldest)).toBe(false);
    expect(getMarketEvent('main',oldest,database)?.event.sourceEventId).toBe('event-0');
    expect(getMarketEvent('other',oldest,database)).toBeNull();
    database.close();
  });

  it('bounds optional classifier output and makes later labels unavailable to earlier replay', async () => {
    const database = openDatabase(':memory:'), clock = new MutableClock(200);
    const service = new MarketEventService({ profileId: 'main', database, clock });
    const eventId = service.ingestLocal('fixture', 'events.json', [input('one')])[0]!.eventId;
    await expect(service.classifyWithLlm(eventId, { name: 'bounded', version: 'v1',
      classify: async () => ({ label: 'macro', sentiment: 'neutral', importance: 'medium', advice: 'buy' }) }))
      .rejects.toThrow('invalid_classifier_result');
    clock.now = 250;
    await service.classifyWithLlm(eventId, { name: 'bounded', version: 'v1',
      classify: async () => ({ label: 'macro', sentiment: 'neutral', importance: 'medium' }) });
    expect(service.timeline(249, 20)[0]?.classification?.classifier).toBe('deterministic');
    expect(service.timeline(250, 20)[0]?.classification?.classifier).toBe('llm');
    database.close();
  });

  it('connects only new events to debounced research triggers', () => {
    const database = openDatabase(':memory:'), clock = new MutableClock(200);
    new ResearchTriggerCoordinator(database).configure({ id: 'event-alpha', family: 'event-alpha',
      kind: 'event', debounceMs: 100, cooldownMs: 1_000, maxDurationMs: 5_000,
      trialBudget: 3, updatedAt: 0 });
    const service = new MarketEventService({ profileId: 'main', database, clock });
    expect(service.ingestLocal('fixture', 'events.json', [input('one', 100)])[0]?.triggerDecisions[0]?.decision)
      .toMatchObject({ start: false, reasonCode: 'debouncing' });
    expect(service.ingestLocal('fixture', 'events.json', [input('one', 100)])[0]?.triggerDecisions).toEqual([]);
    expect(service.ingestLocal('fixture', 'events.json', [input('two', 200)])[0]?.triggerDecisions[0]?.decision)
      .toEqual({ start: true, reasonCode: 'started', deadlineAt: 5_200 });
    database.close();
  });

  it('validates fixture size, shape, future availability, and stable identity', () => {
    const database = openDatabase(':memory:'), clock = new MutableClock(100);
    const service = new MarketEventService({ profileId: 'main', database, clock });
    expect(parseLocalMarketEventFixture(JSON.stringify([input('one')]))).toHaveLength(1);
    expect(() => parseLocalMarketEventFixture('{}')).toThrow('invalid_event_fixture');
    expect(() => service.ingestLocal('fixture', 'events.json', [input('future', 101)]))
      .toThrow('future_first_seen_time');
    expect(() => service.ingestLocal('fixture', 'events.json', [input('valid'), input('future', 101)]))
      .toThrow('future_first_seen_time');
    expect(service.timeline(100, 20).some((item) => item.event.sourceEventId === 'valid')).toBe(false);
    expect(marketEventId('main', 'fixture', 'one')).toHaveLength(64);
    database.close();
  });

  it('validates local ingestion and temporal reads across the renderer boundary', async () => {
    const runtime = createRuntime({ databasePath: ':memory:', profileId: 'main', disableScheduler: true,
      readSystemTime: () => 200 });
    const dispatch = createDispatcher({ handlers: runtime.handlers });
    const imported = await dispatch('market-events.ingest-local', { commandId: crypto.randomUUID(),
      sourceId: 'fixture', reference: 'events.json', confirmed: true, events: [input('ipc')] });
    expect(imported).toMatchObject({ status: 'ok', value: { results: [{ inserted: true,
      targetInfluence: false, executionAuthority: false }] } });
    const timeline = await dispatch('market-events.timeline', { asOfMs: 200, limit: 20 });
    expect(timeline).toMatchObject({ status: 'ok', value: { targetInfluence: false,
      executionAuthority: false, events: [{ title: input('ipc').title }] } });
    runtime.dispose();
  });

  it('selects and reads a local fixture in main before ingestion', async () => {
    const runtime=createRuntime({databasePath:':memory:',profileId:'main',disableScheduler:true,
      readSystemTime:()=>200,pickMarketEventFile:async()=>({reference:'chosen.json',contents:JSON.stringify([input('file')])})});
    const outcome=await createDispatcher({handlers:runtime.handlers})('market-events.ingest-file',{
      commandId:crypto.randomUUID(),sourceId:'fixture',confirmed:true});
    expect(outcome).toMatchObject({status:'ok',value:{outcome:'imported',results:[{inserted:true,
      targetInfluence:false,executionAuthority:false}]}});
    expect(JSON.stringify(outcome)).not.toContain('contents');
    runtime.dispose();
  });

  it('has no import path into strategies, planning, OMS, or venue adapters', () => {
    const authorityPaths = [
      ...globSync('packages/core/src/strategies/**/*.ts'), ...globSync('packages/core/src/execution/**/*.ts'),
      ...globSync('packages/services/src/paper/**/*.ts'), ...globSync('packages/adapters/src/**/*venue*.ts'),
    ];
    expect(authorityPaths.length).toBeGreaterThan(0);
    for (const path of authorityPaths) expect(readFileSync(path, 'utf8')).not.toMatch(/MarketEvent|market-events/iu);
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FetchLike } from '@coqui/adapters';
import { readNewsHostConfiguration, saveNewsHostConfiguration, saveNewsAnalysisConfiguration, saveNewsAnalysisEnabled } from '@coqui/services';
import { assignAuthoritativeHost, listNewsObservationsAsOf, openDatabase, saveNewsObservation, type Db } from '@coqui/storage';
import { createNewsHostRuntime, type NewsHostRuntime } from '../apps/desktop/src/main/news-host-runtime.js';
import { newsFixture } from './fixtures/news/observations.js';
import { gdeltPayload, NEWS_NOW, newsPassThrough, newsResponse } from './fixtures/news/providers.js';
const hosts: NewsHostRuntime[] = [], databases: Db[] = [], directories: string[] = [];
afterEach(async () => {
  for (const host of hosts) host.dispose();
  await Promise.all(hosts.splice(0).map(host => host.tick()));
  for (const database of databases.splice(0)) database.close();
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'coqui-news-host-')); directories.push(directory);
  const path = join(directory, 'main.db'), database = openDatabase(path); databases.push(database);
  let now = NEWS_NOW;
  const fetch = vi.fn<FetchLike>(async () => newsResponse(gdeltPayload));
  const host = (profileId = 'main', hostId = 'desktop-news-test') => {
    const value = createNewsHostRuntime({ profileId, hostId, clock: { nowMs: () => now }, databasePath: path,
      quotaDatabasePath: path, fetch, rateLimiters: newsPassThrough }); hosts.push(value); return value;
  };
  return { database, path, fetch, host, advance: (ms: number) => { now += ms; }, now: () => now };
}
function observations(database: Db, now = NEWS_NOW) { return listNewsObservationsAsOf(now, 250, database); }

describe('Main news host integration', () => {
  it('defaults disabled, validates strict configuration and never starts during construction', async () => {
    const test = fixture(); expect(readNewsHostConfiguration(test.database)).toEqual({ schemaVersion: 1, gdeltEnabled: false });
    expect(() => createNewsHostRuntime({ profileId: 'main', hostId: 'host-a', databasePath: test.path,
      quotaDatabasePath: test.path, clock: { nowMs: () => NEWS_NOW }, configuration: { schemaVersion: 1, gdeltEnabled: 'yes' } as never })).toThrow('Invalid news host configuration');
    const host = test.host(); expect(test.fetch).not.toHaveBeenCalled();
    await host.tick(); expect(test.fetch).not.toHaveBeenCalled();
    expect(() => saveNewsHostConfiguration({ schemaVersion: 1, gdeltEnabled: true, apiKey: 'synthetic-secret' }, test.database)).toThrow(/^Invalid news host configuration\.$/u);
    test.database.prepare("INSERT INTO app_settings(key,value) VALUES ('news_intelligence_host_v1','invalid')").run();
    expect(() => readNewsHostConfiguration(test.database)).toThrow(/^Invalid news host configuration\.$/u);
  });
  it('collects one initial UTC slot and preserves next slot across restart without another request', async () => {
    const test = fixture(); saveNewsHostConfiguration({ schemaVersion: 1, gdeltEnabled: true }, test.database);
    const first = test.host(); await first.tick(); expect(test.fetch).toHaveBeenCalledTimes(1);
    expect(observations(test.database)).toHaveLength(1);
    const next = test.database.prepare("SELECT next_run_at FROM wallet_schedule_lease WHERE profile_id LIKE 'news.gdelt.%'").get()?.['next_run_at'];
    expect(next).toBe(NEWS_NOW + 30 * 60_000);
    first.dispose(); const restarted = test.host(); await restarted.tick();
    expect(test.fetch).toHaveBeenCalledTimes(1);
    expect(test.database.prepare("SELECT next_run_at FROM wallet_schedule_lease WHERE profile_id LIKE 'news.gdelt.%'").get()?.['next_run_at']).toBe(next);
  });
  it('pauses for non-Main profiles and suspension, then recomputes only the current due slot', async () => {
    const test = fixture(); saveNewsHostConfiguration({ schemaVersion: 1, gdeltEnabled: true }, test.database);
    const other = test.host('other-profile'); await other.tick(); expect(test.fetch).not.toHaveBeenCalled();
    const main = test.host(); main.suspend(); await main.tick(); expect(test.fetch).not.toHaveBeenCalled();
    main.resume(); await main.tick(); expect(test.fetch).toHaveBeenCalledTimes(1);
    main.suspend(); test.advance(10 * 30 * 60_000); await main.tick(); expect(test.fetch).toHaveBeenCalledTimes(1);
    main.resume(); await main.tick(); expect(test.fetch).toHaveBeenCalledTimes(2);
    expect(observations(test.database, test.now())).toHaveLength(1);
  });
  it('fences overlapping hosts and refuses collection when another authoritative host owns Main', async () => {
    const test = fixture(); saveNewsHostConfiguration({ schemaVersion: 1, gdeltEnabled: true }, test.database);
    const first = test.host('main', 'host-a'), second = test.host('main', 'host-b');
    await Promise.all([first.tick(), second.tick()]); expect(test.fetch).toHaveBeenCalledTimes(1);
    assignAuthoritativeHost('main', 'host-b', 'headless', NEWS_NOW, test.database);
    test.advance(30 * 60_000); await first.tick(); expect(test.fetch).toHaveBeenCalledTimes(1);
    await second.tick(); expect(test.fetch).toHaveBeenCalledTimes(2);
  });
  it('rechecks authority after a response before persisting article evidence', async () => {
    const test = fixture(); saveNewsHostConfiguration({ schemaVersion: 1, gdeltEnabled: true }, test.database);
    let finish: (() => void) | undefined;
    test.fetch.mockImplementation(async () => { await new Promise<void>(resolve => { finish = resolve; }); return newsResponse(gdeltPayload); });
    const host = test.host('main', 'host-a'), tick = host.tick();
    await vi.waitFor(() => expect(finish).toBeDefined());
    assignAuthoritativeHost('main', 'host-b', 'headless', NEWS_NOW, test.database);
    finish!(); await tick;
    expect(observations(test.database)).toEqual([]);
    expect(test.database.prepare('SELECT reserved FROM news_api_usage_v1').get()?.['reserved']).toBe(1);
  });
  it('aborts shutdown safely after the application connection closes; reservations remain spent', async () => {
    const test = fixture(); saveNewsHostConfiguration({ schemaVersion: 1, gdeltEnabled: true }, test.database);
    let finish: (() => void) | undefined;
    test.fetch.mockImplementation(async () => { await new Promise<void>(resolve => { finish = resolve; }); return newsResponse(gdeltPayload); });
    const host = test.host(), tick = host.tick();
    await vi.waitFor(() => expect(finish).toBeDefined());
    host.dispose(); test.database.close(); databases.splice(databases.indexOf(test.database), 1);
    finish!(); await tick;
    const reopened = openDatabase(test.path); databases.push(reopened);
    expect(observations(reopened)).toEqual([]);
    expect(reopened.prepare('SELECT reserved FROM news_api_usage_v1').get()?.['reserved']).toBe(1);
    expect(reopened.prepare('SELECT outcome FROM news_request_attempts_v1').get()?.['outcome']).toBe('reserved');
  });
  it('fences opt-in analysis chunks across hosts even when collection is disabled', async () => {
    const test=fixture();test.database.prepare('INSERT INTO canonical_instruments VALUES (?,?,?,?,?,?,?,?,?)').run('coinbase','BTC-USD','spot','BTC','Bitcoin','BTC','USD',100,100);
    saveNewsAnalysisConfiguration({schemaVersion:1,reviewedAtMs:100,instruments:[{asset:'BTC',instrument:{venue:'coinbase',productId:'BTC-USD',productType:'spot'}}],publisherAliases:[]},test.database);
    saveNewsAnalysisEnabled(true,test.database);
    saveNewsObservation(newsFixture({provider:'gdelt',title:'Bitcoin gains'}),300,test.database);
    const first=test.host('main','host-a'),second=test.host('main','host-b');await Promise.all([first.tick(),second.tick()]);
    expect(test.fetch).not.toHaveBeenCalled();
    expect(test.database.prepare('SELECT count(*) AS n FROM news_analysis_chunks_v1').get()?.['n']).toBe(1);
    expect(test.database.prepare("SELECT next_run_at FROM wallet_schedule_lease WHERE profile_id='news.analysis.v2'").get()?.['next_run_at']).toBe(NEWS_NOW+60000);
    first.suspend();test.advance(60000);await first.tick();expect(test.database.prepare('SELECT count(*) AS n FROM news_analysis_runs_v1').get()?.['n']).toBe(0);
  });
  it('rejects a split Main storage/quota database path', () => {
    const test = fixture(); expect(() => createNewsHostRuntime({ profileId: 'main', databasePath: test.path,
      quotaDatabasePath: join(test.path, 'different.db'), hostId: 'host-a', clock: { nowMs: () => NEWS_NOW } })).toThrow('same database');
  });
});

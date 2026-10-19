import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { SystemClock } from '../packages/core/dist/index.js';
import { createOsKeyringSecretStore } from '../packages/adapters/dist/index.js';
import { openDatabase, newsProviderQuotaScope, readNewsQuotaUsage, listNewsObservationsAsOf, getAuthoritativeHost, isAuthoritativeHost } from '../packages/storage/dist/index.js';
import { createNewsIntelligenceRuntime, readNewsHostConfiguration } from '../packages/services/dist/index.js';

const { values } = parseArgs({ options: { database: { type: 'string' }, 'allow-live': { type: 'boolean', default: false } } });
let database, runtime;
const summaries = [];
try {
  if (!values['allow-live']) { console.log('News validation disabled; explicit --allow-live is required.'); }
  else {
    if (!values.database || !existsSync(values.database)) throw new Error();
    database = openDatabase(values.database);
    const configuration = readNewsHostConfiguration(database);
    if (!configuration.gdeltEnabled) throw new Error();
    const clock = new SystemClock(Date.now), authority = getAuthoritativeHost('main', database);
    // Validation participates in existing authority; it never assigns or takes over a host.
    const ownerId = 'news-live-validation';
    const ownsMain = authority === null || authority.status === 'relinquished' || authority.hostId === ownerId;
    const secrets = createOsKeyringSecretStore();
    runtime = await createNewsIntelligenceRuntime({ clock, secrets, quotaDatabase: database, storageDatabase: database,
      enabledProviders: ['gdelt'], gdeltTransport: configuration.gdeltTransport ?? 'https', ownerId, startCurrentSlot: true, maxRetries: 0,
      canCollect: () => isAuthoritativeHost('main', ownerId, database) });
    const tick = ownsMain ? await runtime.tick() : { results: [] };
    const scope = newsProviderQuotaScope('gdelt');
    const scheduleId = `news.gdelt.${scope.slice(0, 32)}`;
    const next = database.prepare('SELECT next_run_at FROM wallet_schedule_lease WHERE profile_id=?').get(scheduleId)?.next_run_at;
    summaries.push({ provider: 'gdelt', hostEligible: ownsMain, scheduledResults: tick.results.map(row => ({ outcome: row.outcome, reason: row.reasonCode })),
      storedObservations: listNewsObservationsAsOf(clock.nowMs(), 250, database).length,
      usage: readNewsQuotaUsage('gdelt', scope, clock.nowMs(), database), nextSlotMs: next });
    const stored = listNewsObservationsAsOf(clock.nowMs(), 250, database).filter(row => row.observation.provider === 'gdelt');
    summaries[0].provenanceValidated = stored.length > 0 && stored.every(row => row.availableAtMs >= row.observation.observedAtMs && row.observation.publishedAtMs === null);
    runtime.destroy(); runtime = undefined; database.close();
    database = openDatabase(values.database);
    runtime = await createNewsIntelligenceRuntime({ clock, secrets, quotaDatabase: database, storageDatabase: database,
      enabledProviders: ['gdelt'], gdeltTransport: configuration.gdeltTransport ?? 'https', ownerId, startCurrentSlot: true, maxRetries: 0,
      canCollect: () => isAuthoritativeHost('main', ownerId, database) });
    // Inspect restart state; do not trigger another fetch or adjust any clock/schedule.
    const after = database.prepare('SELECT next_run_at FROM wallet_schedule_lease WHERE profile_id=?').get(scheduleId)?.next_run_at;
    summaries.push({ restartSchedulePreserved: next === after });
    runtime.destroy(); runtime = undefined;
    for (const provider of ['marketaux', 'currents']) {
      runtime = await createNewsIntelligenceRuntime({ clock, secrets, quotaDatabase: database, storageDatabase: database,
        enabledProviders: [provider], retentionPermissions: { marketaux: false, currents: false, gdelt: false }, maxRetries: 0 });
      summaries.push(await runtime.manualRefresh(provider, { persist: false }));
      runtime.destroy(); runtime = undefined;
    }
    console.log(JSON.stringify({ checks: summaries, attribution: 'GDELT Project — https://www.gdeltproject.org/' }));
    if (!summaries[0].provenanceValidated || !summaries[0].scheduledResults.some(row => row.outcome === 'completed')) process.exitCode = 1;
  }
} catch { console.error('News validation failed. Credential, request and article details are omitted.'); process.exitCode = 1; }
finally { runtime?.destroy(); database?.close(); }

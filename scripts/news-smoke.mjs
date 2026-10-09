import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { SystemClock } from '../packages/core/dist/index.js';
import { createMemorySecretStore, createOsKeyringSecretStore, readNewsApiKeys } from '../packages/adapters/dist/index.js';
import { openDatabase } from '../packages/storage/dist/index.js';
import { createNewsIntelligenceRuntime } from '../packages/services/dist/index.js';

const { values } = parseArgs({ options: { database: { type: 'string' }, provider: { type: 'string' },
  'allow-live': { type: 'boolean', default: false }, 'development-env': { type: 'boolean', default: false } } });
if (!values['allow-live']) {
  console.log('News smoke is disabled. Opt in with --allow-live --database EXISTING_SHARED_DATABASE --provider marketaux|currents|gdelt.');
} else if (!values.database || !existsSync(values.database) || !['marketaux', 'currents', 'gdelt'].includes(values.provider)) {
  console.error('An existing shared quota database and one supported provider are required.'); process.exitCode = 1;
} else {
  let database, runtime;
  try {
    database = openDatabase(values.database);
    const keys = values['development-env'] ? readNewsApiKeys(process.env) : null;
    const secrets = keys ? createMemorySecretStore({ ...(keys.marketaux ? { 'marketaux-api-token': keys.marketaux } : {}),
      ...(keys.currents ? { 'currents-api-key': keys.currents } : {}) }) : createOsKeyringSecretStore();
    runtime = await createNewsIntelligenceRuntime({ clock: new SystemClock(Date.now), secrets,
      quotaDatabase: database, storageDatabase: database, enabledProviders: [values.provider], maxRetries: 0,
      retentionPermissions: { marketaux: false, currents: false, gdelt: false } });
    const result = await runtime.manualRefresh(values.provider, { persist: false });
    // Presence/outcome/counts only. No article URLs, payloads, credential hashes or keys.
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  } catch {
    console.error('News smoke failed. Remote and credential details are omitted.'); process.exitCode = 1;
  } finally { runtime?.destroy(); database?.close(); }
}

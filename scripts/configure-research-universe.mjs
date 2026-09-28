import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonicalJson, universeHash, validateUniversePolicy } from '../packages/core/dist/index.js';
import { openDatabase, setSetting } from '../packages/storage/dist/index.js';

const option = (name) => process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3);
let database;
try {
  if (!option('database') || !option('policy')) throw new Error('arguments_required');
  const policy = JSON.parse(readFileSync(resolve(option('policy')), 'utf8'));
  validateUniversePolicy(policy);
  // Require precisely the public policy fields, never silently accept misspelled thresholds.
  const fields = ['schemaVersion', 'version', 'historyDays', 'freshnessMs', 'maxSpreadBps', 'depthBandBps',
    'depthMultiple', 'minimumTradeUsd', 'maximumNativeMinimumUsd'].sort();
  if (Object.keys(policy).sort().join(',') !== fields.join(',')) throw new Error('unknown_policy_field');
  database = openDatabase(resolve(option('database')));
  setSetting('research.widerUniverse.policy', canonicalJson(policy), database);
  console.log(JSON.stringify({ configured: true, version: policy.version, policyHash: universeHash(policy),
    mode: 'shadow', executionEnabled: false, registration: 'next_authoritative_host_collection' }));
} catch {
  console.error('Universe configuration rejected. Use --database=/path/to/coqui.db --policy=/path/to/policy.json with the documented schema.');
  process.exitCode = 1;
} finally { database?.close(); }

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { URL } from 'node:url';
import { sha256Hex } from '../packages/core/dist/index.js';
import { openDatabase } from '../packages/storage/dist/index.js';
import { restartHourlyStudy } from '../packages/services/dist/paper/restart-hourly-study.js';

const database = process.argv.find((arg) => arg.startsWith('--database='))?.slice(11);
const profileId = process.argv.find((arg) => arg.startsWith('--profile='))?.slice(10) ?? 'main';
if (!database) throw new Error('Use --database=/path/to/coqui.db [--profile=main] after pnpm build');
const db = openDatabase(resolve(database));
try {
  const instance = restartHourlyStudy({ profileId, db, nowMs: Date.now(),
    artifactHash: sha256Hex(readFileSync(new URL('../packages/services/dist/paper/parallel-hourly-shadow.js', import.meta.url), 'utf8')) });
  console.log(JSON.stringify({ studyInstanceId: instance.id, startUtc: new Date(instance.definition.startMs).toISOString(),
    behaviorHash: instance.definition.behaviorHash, mode: 'shadow', history: 'preserved', ordersSubmitted: 0 }));
} finally { db.close(); }

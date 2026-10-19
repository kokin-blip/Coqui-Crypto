import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { openDatabase } from '../packages/storage/dist/index.js';
import { readNewsHostConfiguration, saveNewsHostConfiguration } from '../packages/services/dist/index.js';
const { values } = parseArgs({ options: { database: { type: 'string' }, gdelt: { type: 'string' }, 'gdelt-transport': { type: 'string' } } });
let database;
try {
  if (!values.database || !existsSync(values.database) || !['enabled', 'disabled'].includes(values.gdelt)) throw new Error();
  database = openDatabase(values.database);
  const prior = readNewsHostConfiguration(database);
  const configuration = saveNewsHostConfiguration({ ...prior, gdeltEnabled: values.gdelt === 'enabled',
    ...(values['gdelt-transport'] === undefined ? {} : { gdeltTransport: values['gdelt-transport'] }) }, database);
  console.log(JSON.stringify({ ok: true, configuration, meteredCollection: 'disabled' }));
} catch { console.error('News configuration failed. Supply --database EXISTING_MAIN_DATABASE --gdelt enabled|disabled [--gdelt-transport https|http].'); process.exitCode = 1; }
finally { database?.close(); }

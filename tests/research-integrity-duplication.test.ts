import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, createFileProfileDatabaseDuplicator, appendIntegrityEvent,
  listIntegrityEvents } from '../packages/storage/src/index.js';
const TARGET_ID = '00000000-0000-4000-8000-000000000001';
const temporaryDirectories: string[] = [];
function temporaryRoot(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix)); temporaryDirectories.push(root); return root;
}
afterEach(() => { for (const root of temporaryDirectories.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe('research integrity profile duplication', () => {
  it('removes profile permissions while preserving globally consumed research intervals', async () => {
    const root = temporaryRoot('coqui-integrity-duplicate-');
    const sourcePath = join(root, 'kokintrader.db'), source = openDatabase(sourcePath);
    for (const kind of ['binding', 'health_review', 'health_policy', 'health_requalification', 'shadow_setting', 'shadow_binding', 'shadow_pending', 'shadow_settlement', 'shadow_book', 'shadow_refusal', 'final_claim']) {
      appendIntegrityEvent({ namespace: 'source', kind, key: 'one', atMs: 1, body: { kind } }, source);
    }
    source.close();
    const result = await createFileProfileDatabaseDuplicator(root).duplicate({ sourceProfileId: 'main',
      sourceDbFilename: 'kokintrader.db', targetProfileId: TARGET_ID, targetDbFilename: `wallet-${TARGET_ID}.db` });
    expect(result.ok).toBe(true);
    const target = openDatabase(join(root, `wallet-${TARGET_ID}.db`));
    for (const kind of ['binding', 'health_review', 'health_policy', 'health_requalification', 'shadow_setting', 'shadow_binding', 'shadow_pending', 'shadow_settlement', 'shadow_book', 'shadow_refusal']) {
      expect(listIntegrityEvents(null, kind, target)).toEqual([]);
    }
    expect(listIntegrityEvents(null, 'final_claim', target)).toHaveLength(1);
    expect(() => target.exec('DELETE FROM research_integrity_events')).toThrow('immutable');
    target.close();
    const original = openDatabase(sourcePath);
    expect(listIntegrityEvents(null, 'binding', original)).toHaveLength(1);
    original.close();
  });

});

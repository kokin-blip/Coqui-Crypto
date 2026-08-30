import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRuntime } from '../apps/desktop/src/main/composition.js';
import { createDispatcher } from '../apps/desktop/src/main/dispatch.js';

const directories: string[] = [];
afterEach(() => { while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true }); });

function runtime(saveChartSnapshot: (name: string, bytes: Uint8Array) => Promise<'saved' | 'cancelled'>) {
  const directory = mkdtempSync(join(tmpdir(), 'coqui-chart-save-'));
  directories.push(directory);
  return createRuntime({ databasePath: join(directory, 'coqui.db'), profileId: 'main', disableScheduler: true, readSystemTime: () => 100, saveChartSnapshot });
}

const PNG = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');

describe('validated chart snapshot boundary', () => {
  it('saves a valid PNG once and durably replays a duplicate command', async () => {
    const save = vi.fn(async () => 'saved' as const);
    const app = runtime(save);
    const dispatch = createDispatcher({ handlers: app.handlers });
    const request = { commandId: '10000000-0000-4000-8000-000000000010', filenameStem: 'coqui-overview', pngBase64: PNG };
    expect(await dispatch('app.chart.snapshot.save', request)).toEqual({ status: 'ok', value: { outcome: 'saved' } });
    expect(await dispatch('app.chart.snapshot.save', request)).toEqual({ status: 'ok', value: { outcome: 'saved' } });
    expect(save).toHaveBeenCalledTimes(1);
    expect(app.database.prepare('SELECT count(*) AS count FROM chart_snapshot_commands_v1').get()).toEqual({ count: 1 });
    app.dispose();
  });

  it('rejects invalid PNG content and command reuse with changed input', async () => {
    const app = runtime(async () => 'cancelled');
    const dispatch = createDispatcher({ handlers: app.handlers });
    const commandId = '10000000-0000-4000-8000-000000000011';
    expect(await dispatch('app.chart.snapshot.save', { commandId, filenameStem: 'chart', pngBase64: Buffer.from('not png data').toString('base64') })).toMatchObject({ status: 'failed' });
    expect(await dispatch('app.chart.snapshot.save', { commandId, filenameStem: 'chart', pngBase64: PNG })).toEqual({ status: 'ok', value: { outcome: 'cancelled' } });
    expect(await dispatch('app.chart.snapshot.save', { commandId, filenameStem: 'changed', pngBase64: PNG })).toMatchObject({ status: 'failed' });
    app.dispose();
  });
});

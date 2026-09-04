import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createChartWorkspaceHandlers } from '../apps/desktop/src/main/chart-workspace-handlers.js';
import { createDispatcher } from '../apps/desktop/src/main/dispatch.js';
import { openDatabase } from '../packages/storage/src/index.js';

describe('durable chart workspace channels', () => {
  it('saves exact-coordinate drawings and deduplicates command IDs', async () => {
    const database = openDatabase(':memory:');
    const dispatch = createDispatcher({ handlers: createChartWorkspaceHandlers({
      profileId: 'main', database, clock: { nowMs: () => 50 },
    }) });
    const commandId = randomUUID(); const drawingId = randomUUID();
    const payload = { commandId, action: { kind: 'save_drawing' as const, drawing: {
      id: drawingId, productId: 'BTC-USD', interval: '1h' as const, layoutId: null,
      kind: 'trend' as const, points: [
        { timeMs: 1_000, value: '100.123456789' },
        { timeMs: 2_000, value: '101.987654321' },
      ], label: null,
    } } };
    await expect(dispatch('app.chart.workspace.set', payload)).resolves.toEqual({
      status: 'ok', value: { outcome: 'saved', id: drawingId },
    });
    await expect(dispatch('app.chart.workspace.set', payload)).resolves.toEqual({
      status: 'ok', value: { outcome: 'saved', id: drawingId },
    });
    await expect(dispatch('app.chart.workspace', { productId: 'BTC-USD', interval: '1h' }))
      .resolves.toMatchObject({ status: 'ok', value: { drawings: [{ id: drawingId,
        points: [{ value: '100.123456789' }, { value: '101.987654321' }] }] } });
    await expect(dispatch('app.chart.workspace.set', { commandId: randomUUID(), action: {
      kind: 'save_drawing', drawing: { ...payload.action.drawing, label: 'Resistance',
        points: [{ timeMs: 1_000, value: '99.5' }, { timeMs: 2_000, value: '102.25' }] },
    } })).resolves.toMatchObject({ status: 'ok' });
    await expect(dispatch('app.chart.workspace', { productId: 'BTC-USD', interval: '1h' }))
      .resolves.toMatchObject({ status: 'ok', value: { drawings: [{ id: drawingId,
        label: 'Resistance', points: [{ value: '99.5' }, { value: '102.25' }] }] } });
    await expect(dispatch('app.chart.workspace.set', { commandId: randomUUID(), action: {
      kind: 'delete_drawing', drawingId,
    } })).resolves.toMatchObject({ status: 'ok', value: { outcome: 'deleted', id: drawingId } });
    await expect(dispatch('app.chart.workspace', { productId: 'BTC-USD', interval: '1h' }))
      .resolves.toMatchObject({ status: 'ok', value: { drawings: [] } });
    database.close();
  });

  it('isolates profile state and rejects command reuse with changed input', async () => {
    const database = openDatabase(':memory:'); const commandId = randomUUID();
    const main = createDispatcher({ handlers: createChartWorkspaceHandlers({
      profileId: 'main', database, clock: { nowMs: () => 50 },
    }) });
    const first = { commandId, action: { kind: 'save_watchlist' as const,
      id: randomUUID(), name: 'Primary', productIds: ['BTC-USD'], isDefault: true } };
    expect((await main('app.chart.workspace.set', first)).status).toBe('ok');
    await expect(main('app.chart.workspace.set', { ...first,
      action: { ...first.action, productIds: ['ETH-USD'] } })).resolves.toMatchObject({
      status: 'failed', issues: [{ code: 'command_conflict' }],
    });
    const other = createDispatcher({ handlers: createChartWorkspaceHandlers({
      profileId: '00000000-0000-4000-8000-000000000001', database,
      clock: { nowMs: () => 51 },
    }) });
    await expect(other('app.chart.workspace', { productId: 'BTC-USD', interval: '1d' }))
      .resolves.toMatchObject({ status: 'ok', value: { watchlists: [] } });
    database.close();
  });

  it('round-trips extended saved tiles while accepting legacy tile records', async () => {
    const database = openDatabase(':memory:');
    const dispatch = createDispatcher({ handlers: createChartWorkspaceHandlers({
      profileId: 'main', database, clock: { nowMs: () => 70 },
    }) });
    const id = randomUUID();
    await expect(dispatch('app.chart.workspace.set', { commandId: randomUUID(), action: {
      kind: 'save_layout', id, name: 'Comparison grid', layout: 'horizontal', tiles: [{
        productId: 'BTC-USD', interval: '1h', linkGroup: 'primary', chartStyle: 'area',
        scaleMode: 'percentage', indicatorSet: { sma20: true, sma50: false, ema20: false,
          bollinger20: false, rsi14: true, macd: false }, compareProductIds: ['ETH-USD'],
      }, { productId: 'SOL-USD', interval: '6h', linkGroup: null }],
    } })).resolves.toMatchObject({ status: 'ok', value: { id } });
    await expect(dispatch('app.chart.workspace', { productId: 'BTC-USD', interval: '1h' }))
      .resolves.toMatchObject({ status: 'ok', value: { layouts: [{ id, tiles: [{
        chartStyle: 'area', scaleMode: 'percentage', compareProductIds: ['ETH-USD'],
      }, { productId: 'SOL-USD' }] }] } });
    database.close();
  });
});

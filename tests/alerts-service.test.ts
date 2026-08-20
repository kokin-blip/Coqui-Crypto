import { describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../packages/core/src/index.js';
import {
  AlertsService,
  DEFAULT_ALERT_RULE_CONFIG,
  type AlertIdSource,
  type AlertRuleConfigInput,
} from '../packages/services/src/index.js';
import {
  getAlertRuleConfig,
  openDatabase,
} from '../packages/storage/src/index.js';

function ids(...values: string[]): AlertIdSource {
  return { nextId: vi.fn(() => values.shift() ?? '00000000-0000-4000-8000-ffffffffffff') };
}

const ID_1 = '00000000-0000-4000-8000-000000000001';
const ID_2 = '00000000-0000-4000-8000-000000000002';
const ID_3 = '00000000-0000-4000-8000-000000000003';

describe('alerts service', () => {
  it('returns bounded immutable defaults without persisting them', () => {
    const database = openDatabase(':memory:');
    const service = new AlertsService({
      database, clock: new FixedClock(10), idSource: ids(),
    });
    const view = service.view('family-a');
    expect(view).toEqual({
      asOfMs: 10,
      profileId: 'family-a',
      unreadCount: 0,
      config: { ...DEFAULT_ALERT_RULE_CONFIG, source: 'default', updatedAtMs: null },
      priceTargets: [],
      alerts: [],
    });
    expect(getAlertRuleConfig('family-a', database)).toBeNull();
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.config)).toBe(true);
    expect(Object.isFrozen(view.priceTargets)).toBe(true);
    expect(Object.isFrozen(view.alerts)).toBe(true);
    database.close();
  });

  it('validates the complete rule config before time or storage mutation', () => {
    const database = openDatabase(':memory:');
    const nowMs = vi.fn(() => 20);
    const service = new AlertsService({ database, clock: { nowMs }, idSource: ids() });
    const invalid = {
      ...DEFAULT_ALERT_RULE_CONFIG,
      driftEnabled: 'yes',
      bigMovePct: '0',
      quietStartHour: -1,
      quietEndHour: 24,
      diagnostic: 'secret-bearing rule value',
    } as unknown as AlertRuleConfigInput;
    const result = service.saveConfig('family-a', invalid);
    expect(result).toEqual({
      ok: false,
      issues: [
        { path: [], code: 'unknown_field' },
        { path: ['driftEnabled'], code: 'invalid_boolean' },
        { path: ['bigMovePct'], code: 'invalid_big_move_threshold' },
        { path: ['quietStartHour'], code: 'invalid_quiet_hour' },
        { path: ['quietEndHour'], code: 'invalid_quiet_hour' },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('secret-bearing');
    expect(getAlertRuleConfig('family-a', database)).toBeNull();
    expect(nowMs).not.toHaveBeenCalled();

    const valid = service.saveConfig('family-a', {
      ...DEFAULT_ALERT_RULE_CONFIG,
      bigMovePct: '12.50',
      quietHoursEnabled: true,
    });
    expect(valid).toEqual({
      ok: true,
      value: expect.objectContaining({
        source: 'stored', updatedAtMs: 20, bigMovePct: '12.50', quietHoursEnabled: true,
      }),
    });
    expect(getAlertRuleConfig('family-a', database)).toEqual(expect.objectContaining({
      profileId: 'family-a', bigMovePct: '12.50', updatedAt: 20,
    }));
    expect(getAlertRuleConfig('family-b', database)).toBeNull();
    database.close();
  });

  it('creates canonical decimal targets and removes them with tombstones', () => {
    const database = openDatabase(':memory:');
    const idSource = ids(ID_1);
    const clock = new FixedClock(100);
    const service = new AlertsService({ database, clock, idSource });
    const invalid = service.addPriceTarget('family-a', {
      instrument: { venue: 'binance', productId: 'BTCUSDT', productType: 'spot' },
      direction: 'above',
      priceUsd: '0',
    });
    expect(invalid).toEqual({
      ok: false,
      issues: [
        { path: ['instrument'], code: 'invalid_instrument' },
        { path: ['priceUsd'], code: 'invalid_target_price' },
      ],
    });
    expect(idSource.nextId).not.toHaveBeenCalled();

    const added = service.addPriceTarget('family-a', {
      instrument: { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' },
      direction: 'above',
      priceUsd: '100000.00000001',
    });
    expect(added).toEqual({
      ok: true,
      value: expect.objectContaining({
        id: ID_1, profileId: 'family-a', productId: 'BTC-USD',
        priceUsd: '100000.00000001', enabled: true, createdAt: 100,
      }),
    });
    expect(service.setPriceTargetEnabled('family-a', ID_1, false)).toEqual({
      ok: true, value: { enabled: false },
    });
    expect(service.setPriceTargetEnabled('family-a', ID_1, true)).toEqual({
      ok: true, value: { enabled: true },
    });
    clock.set(200);
    expect(service.removePriceTarget('family-b', ID_1)).toEqual({
      ok: false, issues: [{ path: ['id'], code: 'target_not_found' }],
    });
    expect(service.removePriceTarget('family-a', ID_1)).toEqual({
      ok: true, value: { removed: true },
    });
    expect(service.view('family-a').priceTargets).toEqual([]);
    expect(database.prepare(
      'SELECT removed_at FROM alert_price_targets_v2 WHERE id = ?',
    ).get(ID_1)).toEqual({ removed_at: 200 });
    expect(() => database.prepare(
      'DELETE FROM alert_price_targets_v2 WHERE id = ?',
    ).run(ID_1)).toThrow('tombstones');
    database.close();
  });

  it('records immutable deduplicated facts and archives only presentation state', () => {
    const database = openDatabase(':memory:');
    const service = new AlertsService({
      database,
      clock: new FixedClock(1_000),
      idSource: ids(ID_1, ID_2, ID_3),
    });
    const event = {
      eventKey: 'drift:btc:2026-08-10',
      kind: 'allocation_drift' as const,
      severity: 'warn' as const,
      reasonCode: 'allocation_band_crossed',
      evidenceHash: 'a'.repeat(64),
      instrument: { venue: 'coinbase' as const, productId: 'BTC-USD', productType: 'spot' as const },
      occurredAtMs: 900,
    };
    expect(service.record('family-a', event)).toEqual({
      ok: true, value: { created: true },
    });
    expect(service.record('family-a', event)).toEqual({
      ok: true, value: { created: false },
    });
    expect(service.record('family-a', { ...event, reasonCode: 'changed_reason' })).toEqual({
      ok: false, issues: [{ path: [], code: 'storage_conflict' }],
    });

    let view = service.view('family-a');
    expect(view.unreadCount).toBe(1);
    expect(view.alerts).toEqual([expect.objectContaining({
      eventKey: event.eventKey,
      reasonCode: 'allocation_band_crossed',
      evidenceHash: 'a'.repeat(64),
      readAt: null,
      archivedAt: null,
    })]);
    expect(view.alerts[0]).not.toHaveProperty('title');
    expect(view.alerts[0]).not.toHaveProperty('body');
    expect(service.view('family-b').alerts).toEqual([]);

    expect(service.markRead('family-a')).toEqual({ ok: true, value: { marked: 1 } });
    view = service.view('family-a');
    expect(view.unreadCount).toBe(0);
    expect(view.alerts[0]?.readAt).toBe(1_000);
    expect(service.archiveVisible('family-a')).toEqual({ ok: true, value: { archived: 1 } });
    expect(service.view('family-a').alerts).toEqual([]);
    expect(database.prepare('SELECT COUNT(*) AS count FROM alert_events_v2').get())
      .toEqual({ count: 1 });
    expect(() => database.prepare('UPDATE alert_events_v2 SET severity = ?').run('info'))
      .toThrow('append-only');
    expect(() => database.prepare('DELETE FROM alert_events_v2').run()).toThrow('append-only');
    database.close();
  });

  it('rejects unsafe event metadata and future facts without consuming an id', () => {
    const database = openDatabase(':memory:');
    const idSource = ids(ID_1);
    const nowMs = vi.fn(() => 100);
    const service = new AlertsService({ database, clock: { nowMs }, idSource });
    const invalid = service.record('family-a', {
      eventKey: 'unsafe key with spaces',
      kind: 'big_move',
      severity: 'warn',
      reasonCode: 'raw diagnostic: secret',
      evidenceHash: 'bad',
      instrument: null,
      occurredAtMs: -1,
    });
    expect(invalid).toEqual({
      ok: false,
      issues: [
        { path: ['eventKey'], code: 'invalid_event_key' },
        { path: ['reasonCode'], code: 'invalid_reason_code' },
        { path: ['evidenceHash'], code: 'invalid_evidence_hash' },
        { path: ['occurredAtMs'], code: 'invalid_occurred_at' },
      ],
    });
    expect(nowMs).not.toHaveBeenCalled();
    expect(idSource.nextId).not.toHaveBeenCalled();

    expect(service.record('family-a', {
      eventKey: 'move:btc:future',
      kind: 'big_move',
      severity: 'info',
      reasonCode: 'daily_move_threshold_crossed',
      evidenceHash: 'b'.repeat(64),
      instrument: null,
      occurredAtMs: 101,
    })).toEqual({
      ok: false, issues: [{ path: ['occurredAtMs'], code: 'future_event' }],
    });
    expect(idSource.nextId).not.toHaveBeenCalled();
    database.close();
  });
});

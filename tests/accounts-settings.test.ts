import { describe, expect, it, vi } from 'vitest';

import {
  AccountSettingsService,
  DEFAULT_ACCOUNT_PRESENTATION_PREFERENCES,
} from '../packages/services/src/index.js';
import {
  getSetting,
  openDatabase,
  readAccountPreferences,
  setSetting,
} from '../packages/storage/src/index.js';

const OTHER = '00000000-0000-4000-8000-000000000001';

describe('account settings service', () => {
  it('returns explicit Coqui presentation defaults without persisting them', () => {
    const database = openDatabase(':memory:');
    const service = new AccountSettingsService({ database, clock: { nowMs: () => 10 } });
    const result = service.get('main');
    expect(result).toEqual({ ok: true, value: {
      profileId: 'main', asOfMs: 10, updatedAtMs: null, source: 'default',
      preferences: {
        theme: 'system', density: 'comfortable', motion: 'system', language: 'en',
        workspaceMode: 'advanced', overviewChart: 'equity', portfolioChart: 'holdings',
        marketsChart: 'candles', performanceChart: 'equity', inspectorOpen: false,
        inspectorWidthPx: 320,
        chartRanges: { overview: '1y', portfolio: '1y', markets: '1y', performance: '1y' },
        advancedOverviewPreset: 'research_grid',
        advancedOverviewPanels: { strategyDetail: true, strategyComparison: true, recentActivity: true, proposalPreview: true, healthStrip: true, negativeFindings: true },
        overviewSeriesStyle: 'area', overviewBenchmarkVisible: true, marketVolumeVisible: true,
        marketIndicators: { sma20: false, sma50: false, ema20: false, bollinger20: false, rsi14: false, macd: false },
        marketInterval: '1d', marketScaleMode: 'linear', marketLiveCandle: false,
        marketLayout: 'single',
      },
    } });
    expect(readAccountPreferences('main', database)).toBeNull();
    expect(Object.isFrozen(DEFAULT_ACCOUNT_PRESENTATION_PREFERENCES)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.ok && result.value.preferences)).toBe(true);
    database.close();
  });

  it('atomically merges typed partial patches and isolates profiles', () => {
    const database = openDatabase(':memory:');
    let now = 20;
    const service = new AccountSettingsService({ database, clock: { nowMs: () => now } });
    expect(service.set('main', { theme: 'dark', motion: 'none' })).toEqual({
      ok: true,
      value: {
        profileId: 'main', asOfMs: 20, updatedAtMs: 20, source: 'saved',
        preferences: {
          theme: 'dark', density: 'comfortable', motion: 'none', language: 'en',
          workspaceMode: 'advanced', overviewChart: 'equity', portfolioChart: 'holdings',
          marketsChart: 'candles', performanceChart: 'equity', inspectorOpen: false,
          inspectorWidthPx: 320,
          chartRanges: { overview: '1y', portfolio: '1y', markets: '1y', performance: '1y' },
          advancedOverviewPreset: 'research_grid',
          advancedOverviewPanels: { strategyDetail: true, strategyComparison: true, recentActivity: true, proposalPreview: true, healthStrip: true, negativeFindings: true },
          overviewSeriesStyle: 'area', overviewBenchmarkVisible: true, marketVolumeVisible: true,
          marketIndicators: { sma20: false, sma50: false, ema20: false, bollinger20: false, rsi14: false, macd: false },
          marketInterval: '1d', marketScaleMode: 'linear', marketLiveCandle: false,
          marketLayout: 'single',
        },
      },
    });
    now = 21;
    expect(service.set('main', { density: 'compact', language: 'es' })).toMatchObject({
      ok: true,
      value: {
        updatedAtMs: 21,
        preferences: { theme: 'dark', density: 'compact', motion: 'none', language: 'es' },
      },
    });
    expect(service.get(OTHER)).toMatchObject({
      ok: true, value: { source: 'default', preferences: { theme: 'system' } },
    });
    database.close();
  });

  it('returns every invalid field in deterministic input order without using time or storage', () => {
    const database = openDatabase(':memory:');
    const nowMs = vi.fn();
    const service = new AccountSettingsService({ database, clock: { nowMs } });
    const patch = {
      costBasisMethod: 'hifo',
      hiddenStrategyDefault: true,
      theme: 'neon',
      density: 'dense',
      motion: 'fast',
      language: 'fr',
    };
    const result = service.set('main', patch);
    expect(result).toEqual({ ok: false, issues: [
      { path: ['costBasisMethod'], code: 'cross_domain_field' },
      { path: ['hiddenStrategyDefault'], code: 'unknown_field' },
      { path: ['theme'], code: 'invalid_theme' },
      { path: ['density'], code: 'invalid_density' },
      { path: ['motion'], code: 'invalid_motion' },
      { path: ['language'], code: 'invalid_language' },
    ] });
    expect(nowMs).not.toHaveBeenCalled();
    expect(readAccountPreferences('main', database)).toBeNull();
    expect(JSON.stringify(result)).not.toContain('hifo');
    expect(JSON.stringify(result)).not.toContain('neon');
    database.close();
  });

  it('rejects empty, non-object, oversized, and invalid-profile input before mutation', () => {
    const database = openDatabase(':memory:');
    const nowMs = vi.fn();
    const service = new AccountSettingsService({ database, clock: { nowMs } });
    expect(service.set('main', {})).toEqual({
      ok: false, issues: [{ path: [], code: 'empty_patch' }],
    });
    expect(service.set('main', null)).toEqual({
      ok: false, issues: [{ path: [], code: 'invalid_patch' }],
    });
    const oversized = Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`x${index}`, true]));
    expect(service.set('main', oversized)).toEqual({
      ok: false, issues: [{ path: [], code: 'patch_too_large' }],
    });
    expect(service.set('../escape', { theme: 'dark' })).toEqual({
      ok: false, issues: [{ path: ['profileId'], code: 'invalid_profile_id' }],
    });
    expect(nowMs).not.toHaveBeenCalled();
    database.close();
  });

  it('cannot mutate predecessor financial/provider/advisor settings through this boundary', () => {
    const database = openDatabase(':memory:');
    setSetting('user_settings', '{"costBasisMethod":"fifo","coinbasePrimary":true}', database);
    const service = new AccountSettingsService({ database, clock: { nowMs: () => 10 } });
    expect(service.set('main', {
      rebalanceBandPct: 99,
      coinGeckoFallback: false,
      taxShortTermPct: 0,
      iznobSwearing: false,
    })).toEqual({ ok: false, issues: [
      { path: ['rebalanceBandPct'], code: 'cross_domain_field' },
      { path: ['coinGeckoFallback'], code: 'cross_domain_field' },
      { path: ['taxShortTermPct'], code: 'cross_domain_field' },
      { path: ['iznobSwearing'], code: 'cross_domain_field' },
    ] });
    expect(getSetting('user_settings', database))
      .toBe('{"costBasisMethod":"fifo","coinbasePrimary":true}');
    expect(readAccountPreferences('main', database)).toBeNull();
    database.close();
  });

  it('rolls back a rejected replacement and preserves the prior preferences exactly', () => {
    const database = openDatabase(':memory:');
    let now = 10;
    const service = new AccountSettingsService({ database, clock: { nowMs: () => now } });
    expect(service.set('main', { theme: 'dark' }).ok).toBe(true);
    const before = readAccountPreferences('main', database);
    database.exec(`CREATE TRIGGER reject_account_preference_update
      BEFORE UPDATE ON account_preferences_v1 BEGIN SELECT RAISE(ABORT, 'injected'); END;`);
    now = 20;
    expect(service.set('main', { theme: 'light' })).toEqual({
      ok: false, issues: [{ path: [], code: 'storage_rejected' }],
    });
    expect(readAccountPreferences('main', database)).toEqual(before);
    database.close();
  });

  it('fails closed when injected time moves behind stored evidence', () => {
    const database = openDatabase(':memory:');
    let now = 20;
    const service = new AccountSettingsService({ database, clock: { nowMs: () => now } });
    expect(service.set('main', { theme: 'dark' }).ok).toBe(true);
    now = 19;
    expect(service.get('main')).toEqual({
      ok: false, issues: [{ path: [], code: 'clock_unavailable' }],
    });
    expect(service.set('main', { density: 'compact' })).toEqual({
      ok: false, issues: [{ path: [], code: 'clock_unavailable' }],
    });
    expect(readAccountPreferences('main', database)?.density).toBe('comfortable');
    database.close();
  });

  it('stores workspace preferences per profile and replays duplicate commands exactly once', () => {
    const database = openDatabase(':memory:');
    let now = 30;
    const service = new AccountSettingsService({ database, clock: { nowMs: () => now } });
    const command = {
      commandId: '10000000-0000-4000-8000-000000000001',
      patch: { workspaceMode: 'simple', overviewChart: 'allocation', inspectorWidthPx: 360 },
    } as const;
    const first = service.setCommand('main', command);
    expect(first).toMatchObject({ ok: true, value: { preferences: {
      workspaceMode: 'simple', overviewChart: 'allocation', inspectorWidthPx: 360,
    } } });
    now = 40;
    expect(service.setCommand('main', command)).toEqual(first);
    expect(readAccountPreferences('main', database)?.updatedAtMs).toBe(30);
    expect(service.get(OTHER)).toMatchObject({ ok: true, value: { preferences: {
      workspaceMode: 'advanced', overviewChart: 'equity', inspectorWidthPx: 320,
    } } });
    database.close();
  });

  it('rejects command reuse with changed input and invalid workspace patches', () => {
    const database = openDatabase(':memory:');
    const service = new AccountSettingsService({ database, clock: { nowMs: () => 30 } });
    const commandId = '10000000-0000-4000-8000-000000000002';
    expect(service.setCommand('main', { commandId, patch: { workspaceMode: 'simple' } }).ok).toBe(true);
    expect(service.setCommand('main', { commandId, patch: { workspaceMode: 'advanced' } }))
      .toEqual({ ok: false, issues: [{ path: ['commandId'], code: 'command_conflict' }] });
    expect(service.set('main', { inspectorWidthPx: 900, marketsChart: 'depth' })).toEqual({
      ok: false,
      issues: [
        { path: ['inspectorWidthPx'], code: 'invalid_inspector_state' },
        { path: ['marketsChart'], code: 'invalid_chart_view' },
      ],
    });
    database.close();
  });

  it('stores research-grid composition atomically and rejects incomplete visibility records', () => {
    const database = openDatabase(':memory:');
    const service = new AccountSettingsService({ database, clock: { nowMs: () => 50 } });
    const panels = { strategyDetail: false, strategyComparison: true, recentActivity: false, proposalPreview: true, healthStrip: true, negativeFindings: true };
    expect(service.setCommand('main', {
      commandId: '10000000-0000-4000-8000-000000000020',
      patch: { advancedOverviewPreset: 'chart_focus', advancedOverviewPanels: panels, overviewSeriesStyle: 'baseline', overviewBenchmarkVisible: false },
    })).toMatchObject({ ok: true, value: { preferences: {
      advancedOverviewPreset: 'chart_focus', advancedOverviewPanels: panels,
      overviewSeriesStyle: 'baseline', overviewBenchmarkVisible: false,
    } } });
    expect(service.set('main', { advancedOverviewPanels: { strategyDetail: true } })).toEqual({
      ok: false, issues: [{ path: ['advancedOverviewPanels'], code: 'invalid_panel_visibility' }],
    });
    database.close();
  });
});

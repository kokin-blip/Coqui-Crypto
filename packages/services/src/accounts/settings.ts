import { sha256Hex, type Clock } from '@coqui/core';
import {
  inTransaction,
  readAccountPreferences,
  readAccountSettingsCommand,
  saveAccountPreferences,
  saveAccountSettingsCommand,
  type AccountChartRange,
  type AccountChartRanges,
  type AccountDensity,
  type AccountLanguage,
  type AccountMarketsChart,
  type AccountMotion,
  type AccountOverviewChart,
  type AccountPerformanceChart,
  type AccountPortfolioChart,
  type AccountTheme,
  type AccountWorkspaceMode,
  type Db,
  type StoredAccountPreferences,
} from '@coqui/storage';

const PROFILE_ID = /^(?:main|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;
const ALLOWED = new Set([
  'theme', 'density', 'motion', 'language', 'workspaceMode', 'overviewChart',
  'portfolioChart', 'marketsChart', 'performanceChart', 'inspectorOpen',
  'inspectorWidthPx', 'chartRanges',
]);
const COMMAND_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CHART_RANGES = ['1d', '1w', '1m', '3m', '1y', 'all'] as const;
const CROSS_DOMAIN = new Set([
  'baseCurrency', 'costBasisMethod', 'rebalanceBandPct', 'coinbasePrimary',
  'coinGeckoFallback', 'iznobSwearing', 'cashYieldAprPct', 'taxShortTermPct',
  'taxLongTermPct', 'venueCostProfile',
]);

export interface AccountPresentationPreferences {
  readonly theme: AccountTheme;
  readonly density: AccountDensity;
  readonly motion: AccountMotion;
  readonly language: AccountLanguage;
  readonly workspaceMode: AccountWorkspaceMode;
  readonly overviewChart: AccountOverviewChart;
  readonly portfolioChart: AccountPortfolioChart;
  readonly marketsChart: AccountMarketsChart;
  readonly performanceChart: AccountPerformanceChart;
  readonly inspectorOpen: boolean;
  readonly inspectorWidthPx: number;
  readonly chartRanges: AccountChartRanges;
}

export type AccountWorkspacePreferences = Pick<AccountPresentationPreferences,
  'workspaceMode' | 'overviewChart' | 'portfolioChart' | 'marketsChart' |
  'performanceChart' | 'inspectorOpen' | 'inspectorWidthPx' | 'chartRanges'>;

export const DEFAULT_ACCOUNT_PRESENTATION_PREFERENCES: AccountPresentationPreferences =
  Object.freeze({
    theme: 'system',
    density: 'comfortable',
    motion: 'system',
    language: 'en',
    workspaceMode: 'advanced',
    overviewChart: 'equity',
    portfolioChart: 'holdings',
    marketsChart: 'candles',
    performanceChart: 'equity',
    inspectorOpen: true,
    inspectorWidthPx: 320,
    chartRanges: Object.freeze({
      overview: '1y', portfolio: '1y', markets: '1y', performance: '1y',
    }),
  });

export interface AccountPreferencesView {
  readonly profileId: string;
  readonly asOfMs: number;
  readonly updatedAtMs: number | null;
  readonly source: 'default' | 'saved';
  readonly preferences: AccountPresentationPreferences;
}

export type AccountSettingsIssueCode =
  | 'invalid_profile_id'
  | 'invalid_patch'
  | 'patch_too_large'
  | 'empty_patch'
  | 'unknown_field'
  | 'cross_domain_field'
  | 'invalid_theme'
  | 'invalid_density'
  | 'invalid_motion'
  | 'invalid_language'
  | 'invalid_workspace_mode'
  | 'invalid_chart_view'
  | 'invalid_inspector_state'
  | 'invalid_chart_range'
  | 'invalid_command_id'
  | 'command_conflict'
  | 'clock_unavailable'
  | 'storage_unavailable'
  | 'storage_rejected';

export interface AccountSettingsIssue {
  readonly path: readonly string[];
  readonly code: AccountSettingsIssueCode;
}

export type AccountSettingsResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly AccountSettingsIssue[] };

export interface AccountSettingsDependencies {
  readonly database: Db;
  readonly clock: Clock;
}

function freeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function issue(path: readonly string[], code: AccountSettingsIssueCode): AccountSettingsIssue {
  return freeze({ path: [...path], code });
}

function failure(
  code: AccountSettingsIssueCode,
  path: readonly string[] = [],
): AccountSettingsResult<never> {
  return freeze({ ok: false, issues: [issue(path, code)] });
}

function safeNow(clock: Clock): number | null {
  try {
    const value = clock.nowMs();
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function preferences(value: StoredAccountPreferences | null): AccountPresentationPreferences {
  return value === null
    ? DEFAULT_ACCOUNT_PRESENTATION_PREFERENCES
    : freeze({
      theme: value.theme,
      density: value.density,
      motion: value.motion,
      language: value.language,
      workspaceMode: value.workspaceMode,
      overviewChart: value.overviewChart,
      portfolioChart: value.portfolioChart,
      marketsChart: value.marketsChart,
      performanceChart: value.performanceChart,
      inspectorOpen: value.inspectorOpen,
      inspectorWidthPx: value.inspectorWidthPx,
      chartRanges: value.chartRanges,
    });
}

function view(
  profileId: string,
  asOfMs: number,
  stored: StoredAccountPreferences | null,
): AccountPreferencesView {
  return freeze({
    profileId,
    asOfMs,
    updatedAtMs: stored?.updatedAtMs ?? null,
    source: stored === null ? 'default' : 'saved',
    preferences: preferences(stored),
  });
}

interface ValidatedPatch {
  theme?: AccountTheme;
  density?: AccountDensity;
  motion?: AccountMotion;
  language?: AccountLanguage;
  workspaceMode?: AccountWorkspaceMode;
  overviewChart?: AccountOverviewChart;
  portfolioChart?: AccountPortfolioChart;
  marketsChart?: AccountMarketsChart;
  performanceChart?: AccountPerformanceChart;
  inspectorOpen?: boolean;
  inspectorWidthPx?: number;
  chartRanges?: AccountChartRanges;
}

function chartRanges(value: unknown): AccountChartRanges | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 4 ||
    !['overview', 'portfolio', 'markets', 'performance'].every((key) => Object.hasOwn(row, key))) {
    return null;
  }
  if (!Object.values(row).every(
    (entry) => typeof entry === 'string' && CHART_RANGES.includes(entry as AccountChartRange),
  )) return null;
  return freeze({
    overview: row['overview'] as AccountChartRange,
    portfolio: row['portfolio'] as AccountChartRange,
    markets: row['markets'] as AccountChartRange,
    performance: row['performance'] as AccountChartRange,
  });
}

function validatePatch(value: unknown):
  | { readonly ok: true; readonly patch: ValidatedPatch }
  | { readonly ok: false; readonly issues: readonly AccountSettingsIssue[] } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, issues: [issue([], 'invalid_patch')] };
  }
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row);
  if (keys.length === 0) return { ok: false, issues: [issue([], 'empty_patch')] };
  if (keys.length > 32) return { ok: false, issues: [issue([], 'patch_too_large')] };
  const issues: AccountSettingsIssue[] = [];
  const patch: ValidatedPatch = {};
  for (const key of keys) {
    if (!ALLOWED.has(key)) {
      issues.push(issue([key], CROSS_DOMAIN.has(key) ? 'cross_domain_field' : 'unknown_field'));
      continue;
    }
    const field = row[key];
    if (key === 'theme') {
      if (field === 'system' || field === 'light' || field === 'dark' || field === 'high_contrast') {
        patch.theme = field;
      } else issues.push(issue([key], 'invalid_theme'));
    } else if (key === 'density') {
      if (field === 'comfortable' || field === 'compact') patch.density = field;
      else issues.push(issue([key], 'invalid_density'));
    } else if (key === 'motion') {
      if (field === 'system' || field === 'reduced' || field === 'none') patch.motion = field;
      else issues.push(issue([key], 'invalid_motion'));
    } else if (key === 'language') {
      if (field === 'en' || field === 'es') patch.language = field;
      else issues.push(issue([key], 'invalid_language'));
    } else if (key === 'workspaceMode') {
      if (field === 'advanced' || field === 'simple') patch.workspaceMode = field;
      else issues.push(issue([key], 'invalid_workspace_mode'));
    } else if (key === 'overviewChart') {
      if (field === 'equity' || field === 'allocation') patch.overviewChart = field;
      else issues.push(issue([key], 'invalid_chart_view'));
    } else if (key === 'portfolioChart') {
      if (field === 'holdings' || field === 'allocation') patch.portfolioChart = field;
      else issues.push(issue([key], 'invalid_chart_view'));
    } else if (key === 'marketsChart') {
      if (field === 'candles' || field === 'line') patch.marketsChart = field;
      else issues.push(issue([key], 'invalid_chart_view'));
    } else if (key === 'performanceChart') {
      if (field === 'equity' || field === 'drawdown' || field === 'calendar' || field === 'distribution') {
        patch.performanceChart = field;
      } else issues.push(issue([key], 'invalid_chart_view'));
    } else if (key === 'inspectorOpen') {
      if (typeof field === 'boolean') patch.inspectorOpen = field;
      else issues.push(issue([key], 'invalid_inspector_state'));
    } else if (key === 'inspectorWidthPx') {
      if (Number.isInteger(field) && (field as number) >= 280 && (field as number) <= 420) {
        patch.inspectorWidthPx = field as number;
      } else issues.push(issue([key], 'invalid_inspector_state'));
    } else if (key === 'chartRanges') {
      const ranges = chartRanges(field);
      if (ranges === null) issues.push(issue([key], 'invalid_chart_range'));
      else patch.chartRanges = ranges;
    }
  }
  return issues.length > 0
    ? { ok: false, issues: freeze(issues) }
    : { ok: true, patch };
}

function canonicalPatch(patch: ValidatedPatch): string {
  const ordered = Object.fromEntries(Object.entries(patch).sort(([left], [right]) =>
    left.localeCompare(right)));
  return JSON.stringify(ordered);
}

export interface AccountSettingsCommandInput {
  readonly commandId: string;
  readonly patch: unknown;
}

/** Own only profile presentation preferences; financial and provider policy stays elsewhere. */
export class AccountSettingsService {
  readonly #database: Db;
  readonly #clock: Clock;

  constructor(dependencies: AccountSettingsDependencies) {
    this.#database = dependencies.database;
    this.#clock = dependencies.clock;
  }

  get(profileId: string): AccountSettingsResult<AccountPreferencesView> {
    if (!PROFILE_ID.test(profileId)) return failure('invalid_profile_id', ['profileId']);
    const asOfMs = safeNow(this.#clock);
    if (asOfMs === null) return failure('clock_unavailable');
    try {
      const stored = readAccountPreferences(profileId, this.#database);
      if (stored !== null && stored.updatedAtMs > asOfMs) return failure('clock_unavailable');
      return freeze({ ok: true, value: view(profileId, asOfMs, stored) });
    } catch {
      return failure('storage_unavailable');
    }
  }

  set(profileId: string, patchValue: unknown): AccountSettingsResult<AccountPreferencesView> {
    if (!PROFILE_ID.test(profileId)) return failure('invalid_profile_id', ['profileId']);
    const validated = validatePatch(patchValue);
    if (!validated.ok) return freeze({ ok: false, issues: validated.issues });
    const updatedAtMs = safeNow(this.#clock);
    if (updatedAtMs === null) return failure('clock_unavailable');
    try {
      const stored = inTransaction(this.#database, () => {
        const prior = readAccountPreferences(profileId, this.#database);
        if (prior !== null && prior.updatedAtMs > updatedAtMs) return null;
        const current = preferences(prior);
        return saveAccountPreferences({
          profileId,
          theme: validated.patch.theme ?? current.theme,
          density: validated.patch.density ?? current.density,
          motion: validated.patch.motion ?? current.motion,
          language: validated.patch.language ?? current.language,
          workspaceMode: validated.patch.workspaceMode ?? current.workspaceMode,
          overviewChart: validated.patch.overviewChart ?? current.overviewChart,
          portfolioChart: validated.patch.portfolioChart ?? current.portfolioChart,
          marketsChart: validated.patch.marketsChart ?? current.marketsChart,
          performanceChart: validated.patch.performanceChart ?? current.performanceChart,
          inspectorOpen: validated.patch.inspectorOpen ?? current.inspectorOpen,
          inspectorWidthPx: validated.patch.inspectorWidthPx ?? current.inspectorWidthPx,
          chartRanges: validated.patch.chartRanges ?? current.chartRanges,
          updatedAtMs,
        }, this.#database);
      });
      if (stored === null) return failure('clock_unavailable');
      return freeze({ ok: true, value: view(profileId, updatedAtMs, stored) });
    } catch {
      return failure('storage_rejected');
    }
  }

  /** Durable, idempotent presentation mutation for renderer-issued commands. */
  setCommand(
    profileId: string,
    input: AccountSettingsCommandInput,
  ): AccountSettingsResult<AccountPreferencesView> {
    if (!PROFILE_ID.test(profileId)) return failure('invalid_profile_id', ['profileId']);
    if (!COMMAND_ID.test(input.commandId)) return failure('invalid_command_id', ['commandId']);
    const validated = validatePatch(input.patch);
    if (!validated.ok) return freeze({ ok: false, issues: validated.issues });
    const recordedAtMs = safeNow(this.#clock);
    if (recordedAtMs === null) return failure('clock_unavailable');
    const requestHash = sha256Hex(`${profileId}:${canonicalPatch(validated.patch)}`);
    try {
      return inTransaction(this.#database, () => {
        const priorCommand = readAccountSettingsCommand(input.commandId, this.#database);
        if (priorCommand !== null) {
          if (priorCommand.profileId !== profileId || priorCommand.requestHash !== requestHash) {
            return failure('command_conflict', ['commandId']);
          }
          return freeze(JSON.parse(priorCommand.outcomeJson) as AccountSettingsResult<AccountPreferencesView>);
        }
        const prior = readAccountPreferences(profileId, this.#database);
        if (prior !== null && prior.updatedAtMs > recordedAtMs) return failure('clock_unavailable');
        const current = preferences(prior);
        const stored = saveAccountPreferences({
          profileId,
          theme: validated.patch.theme ?? current.theme,
          density: validated.patch.density ?? current.density,
          motion: validated.patch.motion ?? current.motion,
          language: validated.patch.language ?? current.language,
          workspaceMode: validated.patch.workspaceMode ?? current.workspaceMode,
          overviewChart: validated.patch.overviewChart ?? current.overviewChart,
          portfolioChart: validated.patch.portfolioChart ?? current.portfolioChart,
          marketsChart: validated.patch.marketsChart ?? current.marketsChart,
          performanceChart: validated.patch.performanceChart ?? current.performanceChart,
          inspectorOpen: validated.patch.inspectorOpen ?? current.inspectorOpen,
          inspectorWidthPx: validated.patch.inspectorWidthPx ?? current.inspectorWidthPx,
          chartRanges: validated.patch.chartRanges ?? current.chartRanges,
          updatedAtMs: recordedAtMs,
        }, this.#database);
        const outcome = freeze({ ok: true, value: view(profileId, recordedAtMs, stored) } as const);
        saveAccountSettingsCommand({
          commandId: input.commandId,
          profileId,
          requestHash,
          outcomeJson: JSON.stringify(outcome),
          recordedAtMs,
        }, this.#database);
        return outcome;
      });
    } catch {
      return failure('storage_rejected');
    }
  }
}

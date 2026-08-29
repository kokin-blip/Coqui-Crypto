import type { Db } from '../sqlite/index.js';

const PROFILE_ID = /^(?:main|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;

export type AccountTheme = 'system' | 'light' | 'dark' | 'high_contrast';
export type AccountDensity = 'comfortable' | 'compact';
export type AccountMotion = 'system' | 'reduced' | 'none';
export type AccountLanguage = 'en' | 'es';
export type AccountWorkspaceMode = 'advanced' | 'simple';
export type AccountOverviewChart = 'equity' | 'allocation';
export type AccountPortfolioChart = 'holdings' | 'allocation';
export type AccountMarketsChart = 'candles' | 'line';
export type AccountPerformanceChart = 'equity' | 'drawdown' | 'calendar' | 'distribution';
export type AccountChartRange = '1d' | '1w' | '1m' | '3m' | '1y' | 'all';

export interface AccountChartRanges {
  readonly overview: AccountChartRange;
  readonly portfolio: AccountChartRange;
  readonly markets: AccountChartRange;
  readonly performance: AccountChartRange;
}

export interface StoredAccountPreferences {
  readonly profileId: string;
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
  readonly updatedAtMs: number;
}

interface PreferenceRow {
  profile_id: string;
  theme: AccountTheme;
  density: AccountDensity;
  motion: AccountMotion;
  language: AccountLanguage;
  workspace_mode: AccountWorkspaceMode;
  overview_chart: AccountOverviewChart;
  portfolio_chart: AccountPortfolioChart;
  markets_chart: AccountMarketsChart;
  performance_chart: AccountPerformanceChart;
  inspector_open: number;
  inspector_width_px: number;
  chart_ranges_json: string;
  updated_at_ms: number;
}

export interface StoredAccountSettingsCommand {
  readonly commandId: string;
  readonly profileId: string;
  readonly requestHash: string;
  readonly outcomeJson: string;
  readonly recordedAtMs: number;
}

interface CommandRow {
  command_id: string;
  profile_id: string;
  request_hash: string;
  outcome_json: string;
  recorded_at_ms: number;
}

function validTime(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

const CHART_RANGES = ['1d', '1w', '1m', '3m', '1y', 'all'] as const;

function validRanges(value: AccountChartRanges): boolean {
  return ['overview', 'portfolio', 'markets', 'performance'].every(
    (key) => CHART_RANGES.includes(value[key as keyof AccountChartRanges]),
  );
}

function parseRanges(value: string): AccountChartRanges {
  const parsed = JSON.parse(value) as Record<string, unknown>;
  const ranges: AccountChartRanges = {
    overview: parsed['overview'] as AccountChartRange,
    portfolio: parsed['portfolio'] as AccountChartRange,
    markets: parsed['markets'] as AccountChartRange,
    performance: parsed['performance'] as AccountChartRange,
  };
  if (!validRanges(ranges)) throw new TypeError('Invalid chart ranges.');
  return Object.freeze(ranges);
}

function validate(preferences: StoredAccountPreferences): void {
  if (!PROFILE_ID.test(preferences.profileId) ||
    !['system', 'light', 'dark', 'high_contrast'].includes(preferences.theme) ||
    !['comfortable', 'compact'].includes(preferences.density) ||
    !['system', 'reduced', 'none'].includes(preferences.motion) ||
    !['en', 'es'].includes(preferences.language) ||
    !['advanced', 'simple'].includes(preferences.workspaceMode) ||
    !['equity', 'allocation'].includes(preferences.overviewChart) ||
    !['holdings', 'allocation'].includes(preferences.portfolioChart) ||
    !['candles', 'line'].includes(preferences.marketsChart) ||
    !['equity', 'drawdown', 'calendar', 'distribution'].includes(preferences.performanceChart) ||
    typeof preferences.inspectorOpen !== 'boolean' ||
    !Number.isInteger(preferences.inspectorWidthPx) ||
    preferences.inspectorWidthPx < 280 || preferences.inspectorWidthPx > 420 ||
    !validRanges(preferences.chartRanges) || !validTime(preferences.updatedAtMs)) {
    throw new TypeError('Invalid account preferences.');
  }
}

export function readAccountPreferences(
  profileId: string,
  database: Db,
): StoredAccountPreferences | null {
  if (!PROFILE_ID.test(profileId)) throw new TypeError('Invalid profile identity.');
  const row = database.prepare('SELECT * FROM account_preferences_v1 WHERE profile_id = ?')
    .get(profileId) as unknown as PreferenceRow | undefined;
  if (row === undefined) return null;
  const preferences: StoredAccountPreferences = {
    profileId: row.profile_id,
    theme: row.theme,
    density: row.density,
    motion: row.motion,
    language: row.language,
    workspaceMode: row.workspace_mode,
    overviewChart: row.overview_chart,
    portfolioChart: row.portfolio_chart,
    marketsChart: row.markets_chart,
    performanceChart: row.performance_chart,
    inspectorOpen: row.inspector_open === 1,
    inspectorWidthPx: row.inspector_width_px,
    chartRanges: parseRanges(row.chart_ranges_json),
    updatedAtMs: row.updated_at_ms,
  };
  validate(preferences);
  return Object.freeze(preferences);
}

/** Atomically replace one profile's complete validated presentation preferences. */
export function saveAccountPreferences(
  preferences: StoredAccountPreferences,
  database: Db,
): StoredAccountPreferences {
  validate(preferences);
  database.prepare(`INSERT INTO account_preferences_v1 (
    profile_id, theme, density, motion, language, workspace_mode,
    overview_chart, portfolio_chart, markets_chart, performance_chart,
    inspector_open, inspector_width_px, chart_ranges_json, updated_at_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(profile_id) DO UPDATE SET
    theme = excluded.theme, density = excluded.density, motion = excluded.motion,
    language = excluded.language, workspace_mode = excluded.workspace_mode,
    overview_chart = excluded.overview_chart, portfolio_chart = excluded.portfolio_chart,
    markets_chart = excluded.markets_chart, performance_chart = excluded.performance_chart,
    inspector_open = excluded.inspector_open, inspector_width_px = excluded.inspector_width_px,
    chart_ranges_json = excluded.chart_ranges_json, updated_at_ms = excluded.updated_at_ms`)
    .run(
      preferences.profileId, preferences.theme, preferences.density,
      preferences.motion, preferences.language, preferences.workspaceMode,
      preferences.overviewChart, preferences.portfolioChart, preferences.marketsChart,
      preferences.performanceChart, preferences.inspectorOpen ? 1 : 0,
      preferences.inspectorWidthPx, JSON.stringify(preferences.chartRanges),
      preferences.updatedAtMs,
    );
  return Object.freeze({ ...preferences });
}

export function readAccountSettingsCommand(
  commandId: string,
  database: Db,
): StoredAccountSettingsCommand | null {
  const row = database.prepare(
    'SELECT * FROM account_settings_commands_v1 WHERE command_id = ?',
  ).get(commandId) as unknown as CommandRow | undefined;
  return row === undefined ? null : Object.freeze({
    commandId: row.command_id,
    profileId: row.profile_id,
    requestHash: row.request_hash,
    outcomeJson: row.outcome_json,
    recordedAtMs: row.recorded_at_ms,
  });
}

export function saveAccountSettingsCommand(
  command: StoredAccountSettingsCommand,
  database: Db,
): StoredAccountSettingsCommand {
  if (!PROFILE_ID.test(command.profileId) || !/^[0-9a-f-]{36}$/iu.test(command.commandId) ||
    !/^[0-9a-f]{64}$/u.test(command.requestHash) || !validTime(command.recordedAtMs)) {
    throw new TypeError('Invalid account settings command.');
  }
  JSON.parse(command.outcomeJson);
  database.prepare(`INSERT INTO account_settings_commands_v1 (
    command_id, profile_id, request_hash, outcome_json, recorded_at_ms
  ) VALUES (?, ?, ?, ?, ?)`)
    .run(command.commandId, command.profileId, command.requestHash, command.outcomeJson,
      command.recordedAtMs);
  return Object.freeze({ ...command });
}

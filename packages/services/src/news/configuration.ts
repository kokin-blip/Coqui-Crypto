import { newsHostConfigurationSchema, newsIntelligenceConfigurationSchema } from '@coqui/contracts';
import { getSetting, setSetting, type Db } from '@coqui/storage';
export type NewsHostConfiguration = ReturnType<typeof newsHostConfigurationSchema.parse>;
export const NEWS_HOST_SETTING_KEY = 'news_intelligence_host_v1';
export function validateNewsHostConfiguration(value: unknown): NewsHostConfiguration {
  const parsed = newsHostConfigurationSchema.safeParse(value);
  if (!parsed.success) throw new TypeError('Invalid news host configuration.');
  return parsed.data;
}
export function readNewsHostConfiguration(database: Db): NewsHostConfiguration {
  const text = getSetting(NEWS_HOST_SETTING_KEY, database);
  if (text === null) return Object.freeze({ schemaVersion: 1, gdeltEnabled: false });
  try { return validateNewsHostConfiguration(JSON.parse(text)); }
  catch { throw new TypeError('Invalid news host configuration.'); }
}
export function saveNewsHostConfiguration(value: unknown, database: Db): NewsHostConfiguration {
  const configuration = validateNewsHostConfiguration(value);
  setSetting(NEWS_HOST_SETTING_KEY, JSON.stringify(configuration), database);
  return configuration;
}

export const NEWS_ANALYSIS_CONFIGURATION_KEY = 'news_intelligence_reviewed_mapping_v1';
export const NEWS_ANALYSIS_ENABLED_KEY = 'news_intelligence_analysis_enabled_v1';
export function readNewsAnalysisConfiguration(database: Db): ReturnType<typeof newsIntelligenceConfigurationSchema.parse> | null {
  const text = getSetting(NEWS_ANALYSIS_CONFIGURATION_KEY, database);
  return text === null ? null : newsIntelligenceConfigurationSchema.parse(JSON.parse(text));
}
export function newsAnalysisEnabled(database: Db): boolean {
  const value = getSetting(NEWS_ANALYSIS_ENABLED_KEY, database);
  if (value !== null && value !== 'true' && value !== 'false') throw new TypeError('Invalid news analysis setting.');
  return value === 'true';
}
export function saveNewsAnalysisEnabled(enabled: boolean, database: Db): void {
  if (typeof enabled !== 'boolean' || enabled && readNewsAnalysisConfiguration(database) === null) throw new TypeError('Reviewed mapping is required.');
  setSetting(NEWS_ANALYSIS_ENABLED_KEY, String(enabled), database);
}
export function saveNewsAnalysisConfiguration(value: unknown, database: Db): void {
  const configuration = newsIntelligenceConfigurationSchema.parse(value);
  setSetting(NEWS_ANALYSIS_CONFIGURATION_KEY, JSON.stringify(configuration), database);
}

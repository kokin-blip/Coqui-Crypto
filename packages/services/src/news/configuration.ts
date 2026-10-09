import { newsHostConfigurationSchema } from '@coqui/contracts';
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

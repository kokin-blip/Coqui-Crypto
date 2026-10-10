/** Transport-neutral schemas and the CoquiClient surface. */
export const CONTRACTS_PACKAGE = '@coqui/contracts' as const;

export * from './channels.js';
export * from './client.js';
export * from './lifecycle.js';
export * from './messages.js';
export * from './rpc.js';
export * from './schemas/provenance.js';
export * from './schemas/news.js';
export * from './schemas/news-intelligence.js';

export * from './schemas/news-archive.js';

export { newsStudyReportFileSchema } from './schemas/news-report-file.js';
export * from './schemas/news-export-permission.js';

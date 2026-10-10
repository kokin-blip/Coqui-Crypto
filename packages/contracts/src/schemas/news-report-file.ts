import * as z from 'zod';
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const newsStudyReportFileSchema = z.object({ version: z.literal('news-study-report-v1'), reportHash: hash,
  completedAtMs: z.number().int().nonnegative().safe(), reports: z.array(z.object({
    status: z.enum(['evaluated','insufficient_evidence']), manifestHash: hash,
    manifest: z.object({ codeRevision: z.string().min(1).max(200), datasetHash: hash,
      sourceManifestHashes: z.array(hash), spec: z.object({ cadence: z.enum(['daily','hourly']),
        horizonHours: z.union([z.literal(1),z.literal(4),z.literal(24)]), costHash: hash }).passthrough() }).passthrough(),
    reasons: z.array(z.enum(['no_eligible_prospective_news','btc_prospective_or_market_coverage_insufficient',
      'eth_prospective_or_market_coverage_insufficient','sol_prospective_or_market_coverage_insufficient'])).max(100), prospectiveRowCount: z.number().int().nonnegative(),
  }).passthrough()).length(4) }).passthrough();

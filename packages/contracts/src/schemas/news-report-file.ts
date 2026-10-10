import * as z from 'zod';
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const newsStudyReportFileSchema = z.object({ version: z.literal('news-study-report-v1'), reportHash: hash,
  completedAtMs: z.number().int().nonnegative().safe(), reports: z.array(z.object({
    status: z.enum(['evaluated','insufficient_evidence']), manifestHash: hash,
    manifest: z.object({ codeRevision: z.string().min(1), datasetHash: hash,
      sourceManifestHashes: z.array(hash), spec: z.object({ cadence: z.enum(['daily','hourly']),
        horizonHours: z.union([z.literal(1),z.literal(4),z.literal(24)]), costHash: hash }).passthrough() }).passthrough(),
    reasons: z.array(z.string().max(200)).max(100), prospectiveRowCount: z.number().int().nonnegative(),
  }).passthrough()).length(4) }).passthrough();


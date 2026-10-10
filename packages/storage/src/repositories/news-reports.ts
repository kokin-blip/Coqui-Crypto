import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { newsStudyReportFileSchema } from '@coqui/contracts';
import { newsEvidenceHash } from '@coqui/core';
import type { Db } from '../sqlite/index.js';

/** Content-addressed, bounded, explicitly associated; no newest-file inference. */
export function readVerifiedNewsReport(path: string, expectedHash?: string) {
  if (!isAbsolute(path) || statSync(path).size > 10_000_000) throw new Error('report_unavailable');
  const raw: unknown = JSON.parse(readFileSync(path,'utf8'));
  const report = newsStudyReportFileSchema.parse(raw);
  const { reportHash, ...body } = raw as Record<string, unknown>;
  if (newsEvidenceHash(body) !== reportHash || expectedHash && reportHash !== expectedHash ||
      report.reports.some(r => newsEvidenceHash(r.manifest) !== r.manifestHash)) throw new Error('report_integrity_mismatch');
  const horizons = report.reports.map(r => `${r.manifest.spec.cadence}:${r.manifest.spec.horizonHours}`).sort();
  if (horizons.join(',') !== 'daily:24,hourly:1,hourly:24,hourly:4') throw new Error('report_horizons_invalid');
  return { reportHash: report.reportHash, completedAtMs: report.completedAtMs,
    horizons: report.reports.map(r => ({ status: r.status, reasons: r.reasons, prospectiveRows: r.prospectiveRowCount,
      cadence: r.manifest.spec.cadence, horizonHours: r.manifest.spec.horizonHours,
      codeRevision: /^[a-f0-9]{40}$/u.test(r.manifest.codeRevision) ? r.manifest.codeRevision : 'unverified', datasetHash: r.manifest.datasetHash, costHash: r.manifest.spec.costHash,
      sourceManifestHashes: r.manifest.sourceManifestHashes, manifestHash: r.manifestHash })) };
}
export function associateNewsReport(input: { profileId: string; path: string; atMs: number }, db: Db) {
  if (!/^(?:main|[a-f0-9-]{36})$/u.test(input.profileId) || !Number.isSafeInteger(input.atMs) || input.atMs < 0) throw new Error('invalid_report_association');
  const report = readVerifiedNewsReport(input.path);
  if (report.completedAtMs > input.atMs) throw new Error('future_report');
  db.prepare('INSERT OR IGNORE INTO news_report_associations_v1(report_hash,profile_id,associated_at,report_path) VALUES(?,?,?,?)')
    .run(report.reportHash,input.profileId,input.atMs,input.path);
  return report;
}
export function latestAssociatedNewsReport(profileId: string, asOfMs: number, db: Db) {
  const row = db.prepare('SELECT report_hash,report_path FROM news_report_associations_v1 WHERE profile_id=? AND associated_at<=? ORDER BY associated_at DESC,rowid DESC LIMIT 1')
    .get(profileId,asOfMs) as { report_hash: string; report_path: string } | undefined;
  if (!row) return { association: 'unverified' as const, report: null };
  try { return { association: 'verified' as const, report: readVerifiedNewsReport(row.report_path,row.report_hash) }; }
  catch { return { association: 'unavailable' as const, report: null }; }
}

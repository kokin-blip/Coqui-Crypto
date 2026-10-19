import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { newsStudyReportFileSchema } from '@coqui/contracts';
import { newsEvidenceHash } from '@coqui/core';
import { inTransaction, type Db } from '../sqlite/index.js';

/** Content-addressed, bounded, explicitly associated; no newest-file inference. */
export function readVerifiedNewsReport(path: string, expectedHash?: string) {
  if (!isAbsolute(path) || !statSync(path).isFile() || statSync(path).size > 10_000_000) throw new Error('report_unavailable');
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
  inTransaction(db, () => {
    const prior = db.prepare('SELECT report_path FROM news_report_associations_v1 WHERE report_hash=? AND profile_id=?')
      .get(report.reportHash,input.profileId) as { report_path: string } | undefined;
    if (prior && prior.report_path !== input.path) throw new Error('explicit_report_relocation_required');
    if (!prior) db.prepare('INSERT INTO news_report_associations_v1(report_hash,profile_id,associated_at,report_path) VALUES(?,?,?,?)')
      .run(report.reportHash,input.profileId,input.atMs,input.path);
  });
  return report;
}

export function selectNewsReportLocation(input: { profileId: string; reportHash: string; path: string; atMs: number }, db: Db) {
  if (!/^(?:main|[a-f0-9-]{36})$/u.test(input.profileId) || !/^[a-f0-9]{64}$/u.test(input.reportHash) ||
      !Number.isSafeInteger(input.atMs) || input.atMs < 0) throw new Error('invalid_report_location');
  return inTransaction(db, () => {
    const association = db.prepare('SELECT associated_at,report_path FROM news_report_associations_v1 WHERE report_hash=? AND profile_id=?')
      .get(input.reportHash,input.profileId) as { associated_at: number; report_path: string } | undefined;
    if (!association || association.associated_at > input.atMs) throw new Error('report_profile_association_missing');
    const report = readVerifiedNewsReport(input.path,input.reportHash);
    if (report.completedAtMs > input.atMs) throw new Error('future_report');
    const prior = db.prepare('SELECT selected_at,report_path FROM news_report_locations_v1 WHERE report_hash=? AND profile_id=? ORDER BY sequence DESC LIMIT 1')
      .get(input.reportHash,input.profileId) as { selected_at: number; report_path: string } | undefined;
    if (prior && prior.selected_at > input.atMs) throw new Error('report_location_time_conflict');
    if ((prior?.report_path ?? association.report_path) === input.path) return { status: 'already_selected' as const, reportHash: report.reportHash };
    db.prepare('INSERT INTO news_report_locations_v1(report_hash,profile_id,selected_at,report_path) VALUES(?,?,?,?)')
      .run(input.reportHash,input.profileId,input.atMs,input.path);
    return { status: 'recorded' as const, reportHash: report.reportHash };
  });
}
export function latestAssociatedNewsReport(profileId: string, asOfMs: number, db: Db) {
  const row = db.prepare('SELECT report_hash,report_path FROM news_report_associations_v1 WHERE profile_id=? AND associated_at<=? ORDER BY associated_at DESC,rowid DESC LIMIT 1')
    .get(profileId,asOfMs) as { report_hash: string; report_path: string } | undefined;
  if (!row) return { association: 'unverified' as const, report: null };
  const selected = db.prepare('SELECT report_path FROM news_report_locations_v1 WHERE profile_id=? AND report_hash=? AND selected_at<=? ORDER BY sequence DESC LIMIT 1')
    .get(profileId,row.report_hash,asOfMs) as { report_path: string } | undefined;
  try { return { association: 'verified' as const, report: readVerifiedNewsReport(selected?.report_path ?? row.report_path,row.report_hash) }; }
  catch { return { association: 'unavailable' as const, report: null }; }
}

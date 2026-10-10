import * as z from 'zod';
import { epochMillisecondsSchema } from '../messages.js';
import { sha256HexSchema } from './provenance.js';
export const newsExportFields = ['report_hash','report_time','horizon_status','horizon_reasons','prospective_count',
  'manifest_hash','dataset_hash','cost_hash','source_revision','source_manifest_hash',
  'decision_hash','decision_time','outcome_hash','outcome_kind','outcome_time'] as const;
/** Administrative owner-reviewed evidence; no renderer grant or license inference. */
export const newsExportPermissionSchema = z.strictObject({
  version:z.literal('news-export-permission-v1'),profileId:z.union([z.literal('main'),z.string().uuid()]),
  artifactHash:sha256HexSchema,decision:z.enum(['allow','deny']),fields:z.array(z.enum(newsExportFields)).max(newsExportFields.length),
  reviewedAtMs:epochMillisecondsSchema,expiresAtMs:epochMillisecondsSchema,
  termsUrl:z.url().refine(s=>s.startsWith('https://')),termsVersion:z.string().min(1).max(200),
  termsEvidenceHash:sha256HexSchema,ownerApprovalEvidenceHash:sha256HexSchema,
  accountAuthorityEvidenceHash:sha256HexSchema.nullable(),
}).refine(v=>v.expiresAtMs>v.reviewedAtMs&&new Set(v.fields).size===v.fields.length);

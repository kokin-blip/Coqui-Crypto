import { canonicalJson, type CanonicalJsonValue } from '../evidence/index.js';
import { sha256Hex } from '../crypto/sha256.js';
import type { AssetExposureKey, ConnectionProviderV2 } from '../connections/index.js';

export interface PaperConnectionBookSnapshotV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly campaignId: string;
  readonly profileId: string;
  readonly connectionId: string;
  readonly provider: ConnectionProviderV2;
  readonly sourceConnectionSnapshotId: string;
  readonly balances: readonly { readonly exposureKey: AssetExposureKey; readonly quantity: string; readonly valueUsd: string }[];
  readonly cashUsd: string;
  readonly createdAtMs: number;
  readonly contentHash: string;
}

export interface MultiConnectionPaperCampaignV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly profileId: string;
  readonly commandId: string;
  readonly sourceUnifiedSnapshotId: string;
  readonly startedAtMs: number;
  readonly contentHash: string;
}

function hash(value: unknown): string { return sha256Hex(canonicalJson(value as CanonicalJsonValue)); }

function nonNegative(value: string): boolean {
  try { return new Decimal(value).isFinite() && new Decimal(value).gte(0); } catch { return false; }
}

export function createMultiConnectionPaperCampaign(input: Omit<MultiConnectionPaperCampaignV1,
  'schemaVersion' | 'id' | 'contentHash'>): MultiConnectionPaperCampaignV1 {
  if (!input.profileId || !input.commandId || !/^[0-9a-f]{64}$/u.test(input.sourceUnifiedSnapshotId) ||
      !Number.isSafeInteger(input.startedAtMs) || input.startedAtMs < 0) {
    throw new TypeError('Invalid multi-connection paper campaign.');
  }
  const material = { schemaVersion: 1 as const, ...input };
  const contentHash = hash(material);
  return Object.freeze({ ...material, id: sha256Hex(`multi-connection-paper-campaign-v1:${contentHash}`), contentHash });
}

export function createPaperConnectionBookSnapshot(input: Omit<PaperConnectionBookSnapshotV1,
  'schemaVersion' | 'id' | 'contentHash'>): PaperConnectionBookSnapshotV1 {
  const keys = new Set(input.balances.map((balance) => balance.exposureKey));
  if (!input.profileId || !input.connectionId || !/^[0-9a-f]{64}$/u.test(input.campaignId) ||
      !/^[0-9a-f]{64}$/u.test(input.sourceConnectionSnapshotId) ||
      !Number.isSafeInteger(input.createdAtMs) || input.createdAtMs < 0 || !nonNegative(input.cashUsd) ||
      keys.size !== input.balances.length || input.balances.some((balance) =>
        !nonNegative(balance.quantity) || !nonNegative(balance.valueUsd))) {
    throw new TypeError('Invalid paper connection book snapshot.');
  }
  const balances = Object.freeze([...input.balances].sort((a, b) => a.exposureKey.localeCompare(b.exposureKey)));
  const material = { schemaVersion: 1 as const, ...input, balances };
  const contentHash = hash(material);
  return Object.freeze({ ...material, id: sha256Hex(`paper-connection-book-v1:${contentHash}`), contentHash });
}

export function paperConnectionBookHash(value: PaperConnectionBookSnapshotV1 | MultiConnectionPaperCampaignV1): string {
  const content = { ...value } as Record<string, unknown>;
  Reflect.deleteProperty(content, 'id'); Reflect.deleteProperty(content, 'contentHash');
  return hash(content);
}
import { Decimal } from 'decimal.js';

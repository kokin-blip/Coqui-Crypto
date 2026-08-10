import type { MarketBarQuality } from '@coqui/core';

export interface ArchiveSourceArtifact {
  readonly sourceId: string;
  readonly manifestHash: string;
  readonly rawContentHash: string;
}

export interface MarketBarArchiveFile {
  readonly path: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly rowCount: number;
  readonly venue: string;
  readonly productId: string;
  readonly productType: 'spot';
  readonly interval: '1d';
  readonly year: number;
}

export interface MarketBarArchiveManifest {
  readonly schemaVersion: 1;
  readonly schemaHash: string;
  readonly datasetHash: string;
  readonly manifestHash: string;
  readonly createdAtMs: number;
  readonly codeRevision: string;
  readonly dependencies: {
    readonly duckdb: string;
    readonly node: string;
  };
  readonly sourceArtifacts: readonly ArchiveSourceArtifact[];
  readonly recordCount: number;
  readonly firstStartTimeMs: number;
  readonly lastStartTimeMs: number;
  readonly files: readonly MarketBarArchiveFile[];
}

export interface ArchivedMarketBar {
  readonly source: string;
  readonly venue: string;
  readonly productId: string;
  readonly productType: 'spot';
  readonly providerAssetId: string;
  readonly interval: '1d';
  readonly year: number;
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly volume: string | null;
  readonly isComplete: boolean;
  readonly quality: MarketBarQuality;
  readonly retrievedAtMs: number;
}

export interface MarketBarArchiveQuery {
  readonly venue?: string;
  readonly productId?: string;
  readonly source?: string;
  readonly startTimeMs?: number;
  readonly endTimeMs?: number;
}

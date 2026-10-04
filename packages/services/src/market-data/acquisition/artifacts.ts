import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256File } from '@coqui/adapters';
import type { ArchiveSourceArtifact } from '@coqui/storage';
import { PARSER_VERSION, type MarketAcquisitionConfig } from './config.js';

export function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
export interface RawArtifact { path: string; sha256: string; byteLength: number }
export interface AcquisitionEnvelope {
  schemaVersion: 1;
  sourceId: string;
  parserVersion: string;
  configurationHash: string;
  retrievedAtMs: number;
  artifacts: RawArtifact[];
  snapshots: RawArtifact[];
  providerManifest: unknown;
  upstreamChecksums: Record<string, string>;
  manifestHash: string;
}
export function configurationHash(config: MarketAcquisitionConfig): string {
  return digest(JSON.stringify({ schemaVersion: config.schemaVersion,
    products: config.products, startTimeMs: config.startTimeMs, endExclusiveMs: config.endExclusiveMs }));
}
/** Atomically publish a raw artifact bundle; existing bytes must be identical. */
export function preserveBundle(root: string, files: Record<string, string | Uint8Array>): string {
  const identity = digest(JSON.stringify(Object.entries(files).map(([name, bytes]) => [name, digest(bytes)])));
  const destination = join(root, identity);
  for (const name of Object.keys(files)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name)) throw new TypeError('Unsafe artifact filename.');
  }
  if (existsSync(destination)) {
    for (const [name, bytes] of Object.entries(files)) {
      if (digest(readFileSync(join(destination, name))) !== digest(bytes)) throw new Error('Immutable artifact differs.');
    }
    return destination;
  }
  mkdirSync(root, { recursive: true });
  const temporary = join(root, `.${identity}.${randomUUID()}`);
  mkdirSync(temporary);
  try {
    for (const [name, bytes] of Object.entries(files)) writeFileSync(join(temporary, name), bytes, { flag: 'wx' });
    renameSync(temporary, destination);
  } catch (error) { rmSync(temporary, { recursive: true, force: true }); throw error; }
  return destination;
}
export async function describeFile(path: string): Promise<RawArtifact> {
  const { stat } = await import('node:fs/promises');
  return { path, sha256: await sha256File(path), byteLength: (await stat(path)).size };
}
export function preserveEnvelope(root: string, input: Omit<AcquisitionEnvelope, 'schemaVersion' | 'parserVersion' | 'manifestHash'>):
  { path: string; envelope: AcquisitionEnvelope; source: ArchiveSourceArtifact } {
  const body = { schemaVersion: 1 as const, parserVersion: PARSER_VERSION, ...input };
  const envelope = { ...body, manifestHash: digest(JSON.stringify(body)) };
  const directory = preserveBundle(join(root, 'envelopes'), { 'manifest.json': JSON.stringify(envelope, null, 2) + '\n' });
  return { path: join(directory, 'manifest.json'), envelope,
    source: { sourceId: input.sourceId, manifestHash: envelope.manifestHash,
      rawContentHash: digest(JSON.stringify(input.artifacts.map(({ sha256 }) => sha256))) } };
}
export async function verifyEnvelope(path: string): Promise<AcquisitionEnvelope> {
  const envelope = JSON.parse(readFileSync(path, 'utf8')) as AcquisitionEnvelope;
  const { manifestHash, ...body } = envelope;
  if (envelope.schemaVersion !== 1 || envelope.parserVersion !== PARSER_VERSION ||
      digest(JSON.stringify(body)) !== manifestHash) throw new Error('Acquisition envelope failed verification.');
  for (const artifact of [...envelope.artifacts, ...envelope.snapshots]) {
    const actual = await describeFile(artifact.path);
    if (actual.sha256 !== artifact.sha256 || actual.byteLength !== artifact.byteLength) {
      throw new Error('Acquisition raw artifact failed verification.');
    }
  }
  return envelope;
}

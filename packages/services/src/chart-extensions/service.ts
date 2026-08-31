import { createHash, createPublicKey, verify } from 'node:crypto';
import { Worker } from 'node:worker_threads';

import type { Clock } from '@coqui/core';
import {
  appendChartExtensionEvent, deleteChartExtension, getChartExtension, inTransaction,
  listChartExtensions, listChartExtensionSigners, revokeChartExtensionSigner,
  saveChartExtension, saveChartExtensionSigner, setChartExtensionState, type Db,
} from '@coqui/storage';

interface Manifest { readonly id: string; readonly name: string; readonly version: string;
  readonly compatibility: string; readonly author: string; readonly license: string;
  readonly series: { readonly id: string; readonly title: string; readonly pane: number; readonly color: string } }
interface ExtensionPackage { readonly format: 'coqui-chart-extension-v1'; readonly manifest: Manifest;
  readonly payload: { readonly wasmBase64: string; readonly sha256: string };
  readonly signature: { readonly signerKeyId: string; readonly signatureBase64: string } }
interface EvaluationBar { readonly timeMs: number; readonly close: string }

function exactKeys(value: object, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
function hashBytes(value: Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
function parsePackage(packageJson: string): ExtensionPackage {
  const value = JSON.parse(packageJson) as Partial<ExtensionPackage>;
  if (value === null || typeof value !== 'object' || !exactKeys(value, ['format', 'manifest', 'payload', 'signature']) || value.format !== 'coqui-chart-extension-v1') throw new TypeError('invalid_package');
  const manifest = value.manifest, payload = value.payload, signature = value.signature;
  if (manifest === undefined || payload === undefined || signature === undefined ||
    !exactKeys(manifest, ['id', 'name', 'version', 'compatibility', 'author', 'license', 'series']) ||
    !exactKeys(payload, ['wasmBase64', 'sha256']) || !exactKeys(signature, ['signerKeyId', 'signatureBase64']) ||
    !exactKeys(manifest.series, ['id', 'title', 'pane', 'color']) ||
    !/^[a-z][a-z0-9.-]{2,63}$/u.test(manifest.id) || !/^\d+\.\d+\.\d+$/u.test(manifest.version) ||
    manifest.compatibility !== '0.1.x' || !/^#[0-9a-f]{6}$/iu.test(manifest.series.color) ||
    manifest.series.pane < 0 || manifest.series.pane > 3 ||
    !/^[0-9a-f]{64}$/u.test(payload.sha256) || !/^[0-9a-f]{64}$/u.test(signature.signerKeyId)) {
    throw new TypeError('invalid_manifest');
  }
  const wasm = Buffer.from(payload.wasmBase64, 'base64');
  if (wasm.byteLength < 8 || wasm.byteLength > 1_048_576 || hashBytes(wasm) !== payload.sha256) throw new TypeError('invalid_payload');
  return value as ExtensionPackage;
}

export class ChartExtensionService {
  constructor(private readonly input: { readonly profileId: string; readonly database: Db; readonly clock: Clock }) {}

  catalog() {
    return {
      signers: listChartExtensionSigners(this.input.profileId, this.input.database).map(({ keyId, displayName, trustedAtMs, revokedAtMs }) => ({ keyId, displayName, trustedAtMs, revokedAtMs })),
      extensions: listChartExtensions(this.input.profileId, this.input.database).map((item) => {
        const manifest = JSON.parse(item.manifestJson) as Manifest;
        return { id: item.extensionId, name: manifest.name, version: item.version, author: manifest.author,
          license: manifest.license, signerKeyId: item.signerKeyId, payloadHash: item.payloadHash,
          enabled: item.enabled, settings: JSON.parse(item.settingsJson) as Record<string, string | number | boolean>, installedAtMs: item.installedAtMs };
      }),
    };
  }

  trustSigner(displayName: string, publicKeyBase64: string): string {
    const bytes = Buffer.from(publicKeyBase64, 'base64');
    if (bytes.byteLength < 32 || bytes.byteLength > 128) throw new TypeError('invalid_signer');
    const key = createPublicKey({ key: bytes, format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519') throw new TypeError('invalid_signer');
    const keyId = hashBytes(bytes), now = this.input.clock.nowMs();
    saveChartExtensionSigner({ profileId: this.input.profileId, keyId, displayName,
      publicKeyBase64, trustedAtMs: now, revokedAtMs: null }, this.input.database);
    return keyId;
  }

  revokeSigner(keyId: string): number {
    return inTransaction(this.input.database, () => {
      const count = revokeChartExtensionSigner(this.input.profileId, keyId, this.input.clock.nowMs(), this.input.database);
      for (const item of listChartExtensions(this.input.profileId, this.input.database).filter((extension) => extension.signerKeyId === keyId)) appendChartExtensionEvent(this.input.profileId, item.extensionId, 'signer_revoked', 'signer_removed', this.input.clock.nowMs(), this.input.database);
      return count;
    });
  }

  install(packageJson: string): { readonly outcome: 'installed' | 'updated'; readonly extensionId: string } {
    const parsed = parsePackage(packageJson);
    const signer = listChartExtensionSigners(this.input.profileId, this.input.database).find((item) => item.keyId === parsed.signature.signerKeyId && item.revokedAtMs === null);
    if (signer === undefined) throw new TypeError('untrusted_signer');
    const signed = canonical({ format: parsed.format, manifest: parsed.manifest, payload: parsed.payload });
    const key = createPublicKey({ key: Buffer.from(signer.publicKeyBase64, 'base64'), format: 'der', type: 'spki' });
    if (!verify(null, Buffer.from(signed), key, Buffer.from(parsed.signature.signatureBase64, 'base64'))) throw new TypeError('invalid_signature');
    return inTransaction(this.input.database, () => {
      const updated = saveChartExtension({ profileId: this.input.profileId,
        extensionId: parsed.manifest.id, version: parsed.manifest.version,
        signerKeyId: parsed.signature.signerKeyId, manifestJson: canonical(parsed.manifest),
        payloadHash: parsed.payload.sha256, packageBlob: Buffer.from(packageJson), enabled: false,
        settingsJson: '{}', installedAtMs: this.input.clock.nowMs() }, this.input.database);
      appendChartExtensionEvent(this.input.profileId, parsed.manifest.id, updated ? 'updated' : 'installed', 'signature_verified', this.input.clock.nowMs(), this.input.database);
      return { outcome: updated ? 'updated' : 'installed', extensionId: parsed.manifest.id };
    });
  }

  set(extensionId: string, enabled: boolean, settings: Record<string, string | number | boolean>) {
    const item = getChartExtension(this.input.profileId, extensionId, this.input.database);
    const signer = item === null ? undefined : listChartExtensionSigners(this.input.profileId, this.input.database).find((entry) => entry.keyId === item.signerKeyId && entry.revokedAtMs === null);
    if (item === null || (enabled && signer === undefined)) throw new TypeError('extension_unavailable');
    setChartExtensionState(this.input.profileId, extensionId, enabled, JSON.stringify(settings), this.input.database);
    appendChartExtensionEvent(this.input.profileId, extensionId, enabled ? 'enabled' : 'disabled', 'owner_action', this.input.clock.nowMs(), this.input.database);
    return { outcome: enabled ? 'enabled' as const : 'disabled' as const, extensionId };
  }

  remove(extensionId: string) {
    if (!deleteChartExtension(this.input.profileId, extensionId, this.input.database)) throw new TypeError('extension_unavailable');
    appendChartExtensionEvent(this.input.profileId, extensionId, 'uninstalled', 'owner_action', this.input.clock.nowMs(), this.input.database);
    return { outcome: 'uninstalled' as const, extensionId };
  }

  async evaluate(extensionId: string, bars: readonly EvaluationBar[]) {
    const item = getChartExtension(this.input.profileId, extensionId, this.input.database);
    if (item === null || !item.enabled) throw new TypeError('extension_unavailable');
    const parsed = parsePackage(Buffer.from(item.packageBlob).toString('utf8'));
    const values = await new Promise<readonly number[]>((resolve, reject) => {
      const worker = new Worker(new URL('./extension-worker.js', import.meta.url), { workerData: { wasm: Buffer.from(parsed.payload.wasmBase64, 'base64'), closes: bars.map((bar) => Number(bar.close)) }, resourceLimits: { maxOldGenerationSizeMb: 16, maxYoungGenerationSizeMb: 4 } });
      const timer = setTimeout(() => { void worker.terminate(); reject(new Error('extension_timeout')); }, 100);
      worker.once('message', (result: { readonly ok: boolean; readonly values?: readonly number[]; readonly code?: string }) => {
        clearTimeout(timer); void worker.terminate();
        if (result.ok && result.values !== undefined) resolve(result.values);
        else reject(new Error(result.code ?? 'extension_failed'));
      });
      worker.once('error', (error) => { clearTimeout(timer); reject(error); });
    });
    return { series: [{ id: parsed.manifest.series.id, title: parsed.manifest.series.title,
      pane: parsed.manifest.series.pane, color: parsed.manifest.series.color,
      points: values.map((value, index) => ({ timeMs: bars[index]!.timeMs, value: String(value) })) }],
      markers: [], informationalOnly: true as const, decisionEligible: false as const };
  }
}

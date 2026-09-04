import { createHash, createPublicKey, verify } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

import type { Clock } from '@coqui/core';
import {
  appendChartExtensionEvent, deleteChartExtension, getChartExtension, inTransaction,
  listChartExtensions, listChartExtensionSigners, revokeChartExtensionSigner,
  saveChartExtension, saveChartExtensionSigner, setChartExtensionState, type Db,
} from '@coqui/storage';

interface SeriesOutput { readonly id: string; readonly kind: 'series'; readonly title: string;
  readonly pane: number; readonly color: string }
interface MarkerOutput { readonly id: string; readonly kind: 'markers'; readonly title: string;
  readonly condition: 'positive' | 'negative' | 'nonzero';
  readonly tone: 'neutral' | 'positive' | 'negative' | 'warning' }
interface SettingDefinition { readonly key: string; readonly label: string;
  readonly type: 'boolean' | 'number' | 'string'; readonly required: boolean;
  readonly default?: string | number | boolean; readonly minimum?: number; readonly maximum?: number }
interface Manifest { readonly id: string; readonly name: string; readonly version: string;
  readonly compatibility: '0.1.x' | { readonly min: string; readonly maxExclusive: string };
  readonly author: string; readonly license: string;
  readonly permissions?: readonly ['immutable_display_bars'];
  readonly settingsSchema?: readonly SettingDefinition[];
  readonly outputs?: readonly (SeriesOutput | MarkerOutput)[];
  readonly series?: Omit<SeriesOutput, 'kind'> }
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
function extensionWorkerUrl(): URL {
  const built = new URL('./extension-worker.js', import.meta.url);
  return existsSync(fileURLToPath(built)) ? built : new URL('./extension-worker.mjs', import.meta.url);
}
const IDENTIFIER = /^[a-z][a-z0-9.-]{2,63}$/u;
const SETTING_KEY = /^[a-z][a-z0-9_-]{0,39}$/u;
const COLOR = /^#[0-9a-f]{6}$/iu;
const VERSION = /^\d+\.\d+\.\d+$/u;
function versionNumber(value: string): number | null {
  if (!VERSION.test(value)) return null;
  const [major, minor, patch] = value.split('.').map(Number);
  return major! * 1_000_000 + minor! * 1_000 + patch!;
}
function normalizedManifest(manifest: Manifest) {
  const legacy = manifest.compatibility === '0.1.x';
  return {
    compatibility: legacy ? { min: '0.1.0', maxExclusive: '0.2.0' } : manifest.compatibility,
    permissions: manifest.permissions ?? ['immutable_display_bars'] as const,
    settingsSchema: manifest.settingsSchema ?? [],
    outputs: manifest.outputs ?? [{ ...manifest.series!, kind: 'series' as const }],
  };
}
function validSettingDefinition(value: SettingDefinition): boolean {
  if (!exactKeys(value, ['key', 'label', 'type', 'required',
    ...(value.default === undefined ? [] : ['default']),
    ...(value.minimum === undefined ? [] : ['minimum']),
    ...(value.maximum === undefined ? [] : ['maximum'])])) return false;
  if (!SETTING_KEY.test(value.key) || value.label.length < 1 || value.label.length > 80) return false;
  if (value.default !== undefined && typeof value.default !== value.type) return false;
  if (value.type !== 'number' && (value.minimum !== undefined || value.maximum !== undefined)) return false;
  return value.minimum === undefined || value.maximum === undefined || value.minimum <= value.maximum;
}
function validOutput(value: SeriesOutput | MarkerOutput): boolean {
  if (!IDENTIFIER.test(value.id) || value.title.length < 1 || value.title.length > 80) return false;
  if (value.kind === 'series') return exactKeys(value, ['id', 'kind', 'title', 'pane', 'color']) &&
    Number.isInteger(value.pane) && value.pane >= 0 && value.pane <= 3 && COLOR.test(value.color);
  return exactKeys(value, ['id', 'kind', 'title', 'condition', 'tone']) &&
    ['positive', 'negative', 'nonzero'].includes(value.condition) &&
    ['neutral', 'positive', 'negative', 'warning'].includes(value.tone);
}
function validateSettings(manifest: Manifest, settings: Record<string, string | number | boolean>): void {
  const schema = normalizedManifest(manifest).settingsSchema;
  if (Object.keys(settings).some((key) => !schema.some((item) => item.key === key))) throw new TypeError('invalid_settings');
  for (const definition of schema) {
    const value = settings[definition.key];
    if (value === undefined) { if (definition.required && definition.default === undefined) throw new TypeError('invalid_settings'); continue; }
    if (typeof value !== definition.type) throw new TypeError('invalid_settings');
    if (typeof value === 'number' && ((definition.minimum !== undefined && value < definition.minimum) ||
      (definition.maximum !== undefined && value > definition.maximum))) throw new TypeError('invalid_settings');
  }
}
function parsePackage(packageJson: string): ExtensionPackage {
  const value = JSON.parse(packageJson) as Partial<ExtensionPackage>;
  if (value === null || typeof value !== 'object' || !exactKeys(value, ['format', 'manifest', 'payload', 'signature']) || value.format !== 'coqui-chart-extension-v1') throw new TypeError('invalid_package');
  const manifest = value.manifest, payload = value.payload, signature = value.signature;
  const legacy = manifest !== undefined && 'series' in manifest;
  const manifestKeys = legacy
    ? ['id', 'name', 'version', 'compatibility', 'author', 'license', 'series']
    : ['id', 'name', 'version', 'compatibility', 'author', 'license', 'permissions', 'settingsSchema', 'outputs'];
  if (manifest === undefined || payload === undefined || signature === undefined ||
    !exactKeys(manifest, manifestKeys) ||
    !exactKeys(payload, ['wasmBase64', 'sha256']) || !exactKeys(signature, ['signerKeyId', 'signatureBase64']) ||
    !IDENTIFIER.test(manifest.id) || !VERSION.test(manifest.version) ||
    !/^[0-9a-f]{64}$/u.test(payload.sha256) || !/^[0-9a-f]{64}$/u.test(signature.signerKeyId)) {
    throw new TypeError('invalid_manifest');
  }
  if (legacy) {
    if (manifest.compatibility !== '0.1.x' || manifest.series === undefined ||
      !exactKeys(manifest.series, ['id', 'title', 'pane', 'color']) ||
      !IDENTIFIER.test(manifest.series.id) || !COLOR.test(manifest.series.color) ||
      !Number.isInteger(manifest.series.pane) || manifest.series.pane < 0 || manifest.series.pane > 3) throw new TypeError('invalid_manifest');
  } else {
    const normalized = normalizedManifest(manifest);
    const min = versionNumber(normalized.compatibility.min), max = versionNumber(normalized.compatibility.maxExclusive);
    if (min === null || max === null || min > 1_000 || max <= 1_000 ||
      normalized.permissions.length !== 1 || normalized.permissions[0] !== 'immutable_display_bars' ||
      normalized.settingsSchema.length > 32 || new Set(normalized.settingsSchema.map((item) => item.key)).size !== normalized.settingsSchema.length ||
      normalized.settingsSchema.some((item) => !validSettingDefinition(item)) ||
      normalized.outputs.length < 1 || normalized.outputs.length > 8 ||
      new Set(normalized.outputs.map((item) => item.id)).size !== normalized.outputs.length ||
      normalized.outputs.some((item) => !validOutput(item))) throw new TypeError('invalid_manifest');
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
        const normalized = normalizedManifest(manifest);
        return { id: item.extensionId, name: manifest.name, version: item.version, author: manifest.author,
          license: manifest.license, signerKeyId: item.signerKeyId, payloadHash: item.payloadHash,
          compatibility: normalized.compatibility, permissions: normalized.permissions,
          settingsSchema: normalized.settingsSchema, outputs: normalized.outputs,
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
    validateSettings(JSON.parse(item.manifestJson) as Manifest, settings);
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
    validateSettings(parsed.manifest, JSON.parse(item.settingsJson) as Record<string, string | number | boolean>);
    const values = await new Promise<readonly number[]>((resolve, reject) => {
      const worker = new Worker(extensionWorkerUrl(), { workerData: { wasm: Buffer.from(parsed.payload.wasmBase64, 'base64'), closes: bars.map((bar) => Number(bar.close)) }, resourceLimits: { maxOldGenerationSizeMb: 16, maxYoungGenerationSizeMb: 4 } });
      const timer = setTimeout(() => { void worker.terminate(); reject(new Error('extension_timeout')); }, 100);
      worker.once('message', (result: { readonly ok: boolean; readonly values?: readonly number[]; readonly code?: string }) => {
        clearTimeout(timer); void worker.terminate();
        if (result.ok && result.values !== undefined) resolve(result.values);
        else reject(new Error(result.code ?? 'extension_failed'));
      });
      worker.once('error', (error) => { clearTimeout(timer); reject(error); });
    });
    const outputs = normalizedManifest(parsed.manifest).outputs;
    const series = outputs.filter((output): output is SeriesOutput => output.kind === 'series').map((output) => ({
      id: output.id, title: output.title, pane: output.pane, color: output.color,
      points: values.map((value, index) => ({ timeMs: bars[index]!.timeMs, value: String(value) })),
    }));
    const markers = outputs.filter((output): output is MarkerOutput => output.kind === 'markers')
      .flatMap((output) => values.map((value, index) => ({ output, value, index })))
      .filter(({ output, value }) => output.condition === 'positive' ? value > 0 : output.condition === 'negative' ? value < 0 : value !== 0)
      .slice(0, 200).map(({ output, index }) => ({ timeMs: bars[index]!.timeMs, label: output.title, tone: output.tone }));
    return { series, markers, informationalOnly: true as const, decisionEligible: false as const };
  }
}

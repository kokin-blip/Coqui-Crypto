import {
  instrumentKey,
  nonNegativeDecimal,
  type InstrumentIdentity,
  type InstrumentKey,
  type UsdAmount,
} from '@coqui/core';

import type { ProviderAssetMapping } from './types.js';

export interface ProviderRegistryEntry {
  readonly instrument: InstrumentIdentity;
  readonly key: InstrumentKey;
  readonly providerId: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expandExponent(value: number): string {
  const text = String(value);
  const marker = text.search(/[eE]/);
  if (marker < 0) return text;
  const coefficient = text.slice(0, marker);
  const exponent = Number(text.slice(marker + 1));
  const point = coefficient.indexOf('.');
  const digits = coefficient.replace('.', '');
  const integerDigits = point < 0 ? coefficient.length : point;
  const decimalPosition = integerDigits + exponent;
  if (decimalPosition <= 0) return `0.${'0'.repeat(-decimalPosition)}${digits}`;
  if (decimalPosition >= digits.length) {
    return `${digits}${'0'.repeat(decimalPosition - digits.length)}`;
  }
  return `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
}

export function usd(value: unknown, allowZero = false): UsdAmount | null {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    (!allowZero && value === 0)
  ) return null;
  try {
    return nonNegativeDecimal(expandExponent(value));
  } catch {
    return null;
  }
}

export function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

export function timestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** Build a registry solely from canonical instruments and explicit provider IDs. */
export function registryEntries(
  mappings: readonly ProviderAssetMapping[],
  providerId: (mapping: ProviderAssetMapping) => string | null,
): ProviderRegistryEntry[] {
  const entries = new Map<InstrumentKey, ProviderRegistryEntry>();
  for (const mapping of mappings) {
    const id = providerId(mapping)?.trim();
    if (!id) continue;
    try {
      const key = instrumentKey(mapping.instrument);
      entries.set(key, { instrument: mapping.instrument, key, providerId: id });
    } catch {
      // Invalid canonical identities are omitted at the untrusted mapping boundary.
    }
  }
  return [...entries.values()];
}

export function entriesByProviderId(
  entries: readonly ProviderRegistryEntry[],
): Map<string, ProviderRegistryEntry[]> {
  const result = new Map<string, ProviderRegistryEntry[]>();
  for (const entry of entries) {
    const current = result.get(entry.providerId) ?? [];
    current.push(entry);
    result.set(entry.providerId, current);
  }
  return result;
}

export function chunks<T>(values: readonly T[], size = 100): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

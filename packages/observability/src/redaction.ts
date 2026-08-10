import type { SafeLogObject, SafeLogValue } from './types.js';

export const REDACTED = '[REDACTED]' as const;
const CIRCULAR = '[Circular]' as const;
const ACCESSOR = '[Accessor omitted]' as const;
const MAX_DEPTH = 8;
const MAX_ENTRIES = 100;
const MAX_STRING_LENGTH = 4_096;

const SENSITIVE_KEYS = new Set([
  'apikey', 'authorization', 'body', 'cookie', 'credentials', 'headers',
  'password', 'passwd', 'payload', 'privatekey', 'query', 'request',
  'response', 'secret', 'setcookie', 'signature', 'token', 'uri', 'url',
]);

function normalizedKey(key: string): string {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizedKey(key);
  if (SENSITIVE_KEYS.has(normalized)) return true;
  return ['apikey', 'password', 'privatekey', 'secret', 'signature', 'token']
    .some((part) => normalized.endsWith(part));
}

function redactString(value: string, secrets: readonly string[]): string {
  let safe = value;
  for (const secret of secrets) {
    if (secret.length > 0) safe = safe.replaceAll(secret, REDACTED);
  }
  if (
    /(?:https?|wss?):\/\//iu.test(safe) ||
    /-----BEGIN [A-Z ]*(?:PRIVATE KEY|CERTIFICATE)-----/u.test(safe) ||
    /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_.=-]+/iu.test(safe) ||
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/u.test(safe) ||
    /\b(?:api[_-]?key|authorization|password|secret|token)\s*[:=]/iu.test(safe)
  ) return REDACTED;
  return safe.length > MAX_STRING_LENGTH
    ? `${safe.slice(0, MAX_STRING_LENGTH)}[Truncated]`
    : safe;
}

function safeErrorProperty(error: Error, key: 'name' | 'message' | 'cause'): unknown {
  try {
    return error[key];
  } catch {
    return '[Unreadable]';
  }
}

function sanitize(
  value: unknown,
  secrets: readonly string[],
  seen: WeakSet<object>,
  depth: number,
): SafeLogValue {
  if (value === null) return null;
  if (typeof value === 'string') return redactString(value, secrets);
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'undefined') return '[Undefined]';
  if (typeof value === 'symbol') return '[Symbol]';
  if (typeof value === 'function') return '[Function]';
  if (depth >= MAX_DEPTH) return '[Max depth]';
  if (seen.has(value)) return CIRCULAR;
  seen.add(value);

  if (value instanceof Date) {
    try {
      return value.toISOString();
    } catch {
      return '[Invalid date]';
    }
  }
  if (value instanceof Error) {
    const result: Record<string, SafeLogValue> = {
      name: sanitize(safeErrorProperty(value, 'name'), secrets, seen, depth + 1),
      message: sanitize(safeErrorProperty(value, 'message'), secrets, seen, depth + 1),
    };
    const cause = safeErrorProperty(value, 'cause');
    if (cause !== undefined) result['cause'] = sanitize(cause, secrets, seen, depth + 1);
    return result;
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ENTRIES)
      .map((item) => sanitize(item, secrets, seen, depth + 1));
  }

  const result: Record<string, SafeLogValue> = Object.create(null) as Record<string, SafeLogValue>;
  let keys: string[];
  try {
    keys = Object.keys(value).slice(0, MAX_ENTRIES);
  } catch {
    return '[Unreadable object]';
  }
  for (const key of keys) {
    const safeKey = redactString(key, secrets);
    const outputKey = safeKey === key ? key : REDACTED;
    if (isSensitiveKey(key)) {
      result[outputKey] = REDACTED;
      continue;
    }
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      result[outputKey] = descriptor && 'value' in descriptor
        ? sanitize(descriptor.value, secrets, seen, depth + 1)
        : ACCESSOR;
    } catch {
      result[outputKey] = '[Unreadable]';
    }
  }
  return result;
}

/** Convert arbitrary diagnostic data to bounded JSON-safe data with no known secrets. */
export function sanitizeLogValue(
  value: unknown,
  secrets: readonly string[] = [],
): SafeLogValue {
  return sanitize(value, secrets.filter((secret) => secret.length > 0), new WeakSet(), 0);
}

export function sanitizeLogContext(
  context: Readonly<Record<string, unknown>>,
  secrets: readonly string[] = [],
): SafeLogObject {
  const value = sanitizeLogValue(context, secrets);
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as SafeLogObject
    : Object.freeze({ value });
}

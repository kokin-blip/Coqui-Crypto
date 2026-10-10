import { readFileSync } from 'node:fs';
/** Missing metadata stays unknown; a beta version is never a publication receipt. */
export function readBuildIdentity() {
  try {
    const value = JSON.parse(readFileSync(new URL('./build-info.json',import.meta.url),'utf8')) as Record<string,unknown>;
    if (typeof value['version'] !== 'string' || typeof value['sourceRevision'] !== 'string' ||
        !/^[a-f0-9]{40}$/u.test(value['sourceRevision']) || typeof value['sourceHash'] !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(value['sourceHash']) || typeof value['dirty'] !== 'boolean' ||
        !Number.isSafeInteger(value['builtAtMs']) || typeof value['channel'] !== 'string') return null;
    return { version: value['version'], sourceRevision: value['sourceRevision'], sourceHash: value['sourceHash'],
      dirty: value['dirty'], channel: value['channel'], builtAtMs: value['builtAtMs'] as number };
  } catch { return null; }
}

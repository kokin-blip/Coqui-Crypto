import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const OWNER_REFERENCE_SHA256 = '55dab8864e0463256ffec43de29e4c27da6f820f77737b58c59fbac855c3691a';

describe('Coqui brand mark', () => {
  it('keeps the owner-selected frog reference byte-for-byte as the canonical source', async () => {
    const [reference, packagingSource] = await Promise.all([
      readFile(new URL('../docs/design/dual-mode-reference/cute-coqui-original.png', import.meta.url)),
      readFile(new URL('../apps/desktop/build/source/coqui-icon-original.png', import.meta.url)),
    ]);
    const digest = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');
    expect(digest(reference)).toBe(OWNER_REFERENCE_SHA256);
    expect(digest(packagingSource)).toBe(OWNER_REFERENCE_SHA256);
    expect(packagingSource).toEqual(reference);
  });
});

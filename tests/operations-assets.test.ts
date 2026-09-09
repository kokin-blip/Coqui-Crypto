import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const assetDirectory = join(process.cwd(), 'apps/desktop/src/renderer/operations');
const characterNames = ['coqui', 'scout', 'darwin', 'guard', 'courier', 'advisor'] as const;

describe('operations character assets', () => {
  it('ships six non-empty PNG illustrations referenced as decorative content', () => {
    const component = readFileSync(join(process.cwd(),
      'apps/desktop/src/renderer/app/OperationsFloor.tsx'), 'utf8');
    for (const name of characterNames) {
      const asset = readFileSync(join(assetDirectory, `${name}.png`));
      expect(asset.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(asset.byteLength).toBeGreaterThan(10_000);
      expect(component).toContain(`../operations/${name}.png`);
    }
    expect(component).toContain('alt=""');
    expect(component).not.toMatch(/animation|autoplay|video/iu);
  });
});

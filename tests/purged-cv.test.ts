import { describe, expect, it } from 'vitest';
import { purgedKFold, type Span } from '../packages/core/src/validation/purged-cv.js';

describe('purgedKFold', () => {
  it('purges overlapping spans and embargoes the following sample', () => {
    const spans: Span[] = Array.from({ length: 10 }, (_, index) => ({
      entryIdx: index,
      exitIdx: index + 2,
    }));
    const folds = purgedKFold(spans, 2, 0.02);
    expect(folds).toHaveLength(2);
    const first = folds[0];
    expect(first).toBeDefined();
    expect(first?.testIdx).toEqual([0, 1, 2, 3, 4]);
    expect(first?.trainIdx).not.toContain(5);
    expect(first?.trainIdx).not.toContain(6);
    expect(first?.trainIdx).not.toContain(7);
    expect(first?.trainIdx).toContain(8);
    expect(first?.trainIdx).toContain(9);
  });

  it('partitions all test samples in chronological order', () => {
    const spans: Span[] = Array.from({ length: 12 }, (_, index) => ({
      entryIdx: index,
      exitIdx: index,
    }));
    const folds = purgedKFold(spans, 3);
    const allTest = folds.flatMap((fold) => fold.testIdx).sort((left, right) => left - right);
    expect(allTest).toEqual([...Array(12).keys()]);
  });
});

/**
 * Purged & embargoed K-fold cross-validation (López de Prado) — the leakage control
 * both research reports insist on, and the reason it finally MATTERS here: each
 * triple-barrier sample ({@link ./ml-labeling}) carries a time span [entry, exit], so
 * a sample's label peeks forward. Plain K-fold would train on samples whose spans
 * overlap the test window and silently leak the future.
 *
 * PURGE: drop from the training set any sample whose span overlaps the test window.
 * EMBARGO: additionally drop training samples that start just after the test window,
 * since serial correlation makes them near-duplicates of test information.
 *
 * Test folds are contiguous in time (never shuffled — this is time series). Pure.
 */

export interface Span {
  entryIdx: number;
  exitIdx: number;
}

export interface CvFold {
  trainIdx: number[];
  testIdx: number[];
}

function overlaps(a: Span, b: Span): boolean {
  return a.entryIdx <= b.exitIdx && b.entryIdx <= a.exitIdx;
}

/**
 * Build `k` purged+embargoed folds over time-ordered `spans`.
 * @param embargoPct fraction of the total time span to embargo after each test fold.
 */
export function purgedKFold(spans: Span[], k: number, embargoPct = 0.02): CvFold[] {
  const n = spans.length;
  if (n === 0 || k < 2 || k > n) return [];

  const maxTime = Math.max(...spans.map((s) => s.exitIdx));
  const minTime = Math.min(...spans.map((s) => s.entryIdx));
  const embargoDays = Math.ceil(embargoPct * Math.max(1, maxTime - minTime));

  const foldSize = Math.floor(n / k);
  const folds: CvFold[] = [];

  for (let f = 0; f < k; f++) {
    const testStart = f * foldSize;
    const testEnd = f === k - 1 ? n : (f + 1) * foldSize; // last fold absorbs remainder
    const testIdx: number[] = [];
    for (let i = testStart; i < testEnd; i++) testIdx.push(i);

    // Time window covered by this test fold's label spans.
    const winEntry = Math.min(...testIdx.map((i) => spans[i]!.entryIdx));
    const winExit = Math.max(...testIdx.map((i) => spans[i]!.exitIdx));
    const testWindow: Span = { entryIdx: winEntry, exitIdx: winExit };

    const trainIdx: number[] = [];
    for (let i = 0; i < n; i++) {
      if (i >= testStart && i < testEnd) continue; // in test
      const s = spans[i]!;
      if (overlaps(s, testWindow)) continue; // PURGE overlapping labels
      // EMBARGO: drop training samples starting just after the test window.
      if (s.entryIdx > winExit && s.entryIdx <= winExit + embargoDays) continue;
      trainIdx.push(i);
    }
    folds.push({ trainIdx, testIdx });
  }
  return folds;
}

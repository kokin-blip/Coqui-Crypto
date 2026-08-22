import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  negativeFindingCount,
  NEGATIVE_FINDINGS,
  NEGATIVE_FINDING_LEDGER_NOTE,
} from '../packages/core/src/index.js';

const repoRoot = process.cwd();

describe('negative-results ledger integrity', () => {
  it('resolves every Coqui study reference to a real file', () => {
    // The doc-integrity pattern tests/handler-inventory.test.ts already uses.
    // Without this the ledger could cite a study that was renamed or deleted.
    const coquiStudies = NEGATIVE_FINDINGS.filter((finding) => finding.source === 'coqui-study');
    expect(coquiStudies.length).toBeGreaterThan(0);

    for (const finding of coquiStudies) {
      expect(finding.reference).toMatch(/^docs\/studies\/[a-z0-9-]+\.md$/u);
      expect(
        existsSync(path.join(repoRoot, finding.reference)),
        `${finding.id} cites a missing study: ${finding.reference}`,
      ).toBe(true);
    }
  });

  it('marks predecessor entries as not verifiable from this repository', () => {
    // Their evidence lives in an Obsidian vault outside the repo. Claiming
    // otherwise would present unverifiable findings as Coqui's own.
    for (const finding of NEGATIVE_FINDINGS) {
      if (finding.source !== 'predecessor-vault') continue;
      expect(finding.reference).toMatch(/^predecessor vault note/u);
      expect(existsSync(path.join(repoRoot, finding.reference))).toBe(false);
    }
  });

  it('carries unique ids and a non-empty summary on every entry', () => {
    const ids = NEGATIVE_FINDINGS.map((finding) => finding.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const finding of NEGATIVE_FINDINGS) {
      expect(finding.id).toMatch(/^[a-z][a-z0-9-]*$/u);
      expect(finding.title.length).toBeGreaterThan(0);
      expect(finding.summary.length).toBeGreaterThan(20);
    }
  });

  it('uses only the two outcomes the vocabulary defines', () => {
    for (const finding of NEGATIVE_FINDINGS) {
      expect(['not-adopted', 'no-edge']).toContain(finding.outcome);
    }
    // no-edge is weaker than not-adopted and must stay distinguishable: the
    // meta-label studies could not detect signal either way.
    expect(NEGATIVE_FINDINGS.filter((finding) => finding.outcome === 'no-edge').length)
      .toBeGreaterThan(0);
  });

  it('preserves the predecessor ledger count of ten, plus Coqui’s own', () => {
    const predecessor = NEGATIVE_FINDINGS.filter((f) => f.source === 'predecessor-vault');
    // The vault's own two enumerations disagree about one slot, so both are
    // carried — eleven records for a ledger the predecessor called ten.
    expect(predecessor).toHaveLength(11);
    expect(NEGATIVE_FINDING_LEDGER_NOTE).toContain('mean-excess vs dip-buy');
    expect(negativeFindingCount()).toBe(NEGATIVE_FINDINGS.length);
  });

  it('is deeply frozen so a surface cannot edit the evidence', () => {
    expect(Object.isFrozen(NEGATIVE_FINDINGS)).toBe(true);
    for (const finding of NEGATIVE_FINDINGS) {
      expect(Object.isFrozen(finding)).toBe(true);
    }
  });
});

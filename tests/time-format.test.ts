import { describe, expect, it } from 'vitest';

import { exactUtcTimestamp, formatEvidenceTime, formatLocalTime, formatLocalTimestamp } from '../apps/desktop/src/renderer/app/time-format.js';

describe('renderer time formatting', () => {
  it('keeps exact UTC machine values while presenting readable local values', () => {
    const at = Date.UTC(2026, 8, 9, 18, 5, 0);
    expect(exactUtcTimestamp(at)).toBe('2026-09-09T18:05:00.000Z');
    expect(formatLocalTimestamp(at)).not.toContain('T18:05:00.000Z');
    expect(formatLocalTime(at).length).toBeGreaterThan(0);
  });

  it('labels absent evidence without inventing a timestamp', () => {
    expect(formatEvidenceTime(null)).toBe('No persisted observation');
  });
});

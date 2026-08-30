import { describe, expect, it } from 'vitest';

import { customPanelPatch, panelsForPreset, presetPatch, RESEARCH_GRID_PANELS } from '../apps/desktop/src/renderer/app/overview-presets.js';

describe('Advanced Overview presets', () => {
  it('defaults to the complete research grid and restores it atomically', () => {
    expect(presetPatch('research_grid')).toEqual({
      advancedOverviewPreset: 'research_grid',
      advancedOverviewPanels: RESEARCH_GRID_PANELS,
    });
    expect(Object.values(RESEARCH_GRID_PANELS).every(Boolean)).toBe(true);
  });

  it('keeps decision-critical chart and Evidence Stack outside optional flags', () => {
    expect(Object.keys(RESEARCH_GRID_PANELS)).not.toContain('chart');
    expect(Object.keys(RESEARCH_GRID_PANELS)).not.toContain('evidenceStack');
  });

  it('marks manual panel changes custom without mutating the prior value', () => {
    const prior = panelsForPreset('research_grid');
    const patch = customPanelPatch(prior, 'recentActivity');
    expect(patch.advancedOverviewPreset).toBe('custom');
    expect(patch.advancedOverviewPanels.recentActivity).toBe(false);
    expect(prior.recentActivity).toBe(true);
  });
});

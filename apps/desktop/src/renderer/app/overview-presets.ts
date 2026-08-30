import type { ChannelResponse } from '@coqui/contracts';

export type WorkspacePreferences = ChannelResponse<'accounts.workspace'>['preferences'];
export type AdvancedOverviewPreset = WorkspacePreferences['advancedOverviewPreset'];
export type AdvancedOverviewPanels = WorkspacePreferences['advancedOverviewPanels'];

export const RESEARCH_GRID_PANELS: AdvancedOverviewPanels = Object.freeze({
  strategyDetail: true,
  strategyComparison: true,
  recentActivity: true,
  proposalPreview: true,
  healthStrip: true,
  negativeFindings: true,
});

const CHART_FOCUS_PANELS: AdvancedOverviewPanels = Object.freeze({
  strategyDetail: false,
  strategyComparison: true,
  recentActivity: false,
  proposalPreview: true,
  healthStrip: true,
  negativeFindings: false,
});

const EVIDENCE_REVIEW_PANELS: AdvancedOverviewPanels = Object.freeze({
  strategyDetail: true,
  strategyComparison: true,
  recentActivity: true,
  proposalPreview: false,
  healthStrip: false,
  negativeFindings: true,
});

export function panelsForPreset(preset: Exclude<AdvancedOverviewPreset, 'custom'>): AdvancedOverviewPanels {
  if (preset === 'chart_focus') return CHART_FOCUS_PANELS;
  if (preset === 'evidence_review') return EVIDENCE_REVIEW_PANELS;
  return RESEARCH_GRID_PANELS;
}

export function presetPatch(preset: Exclude<AdvancedOverviewPreset, 'custom'>): Pick<WorkspacePreferences, 'advancedOverviewPreset' | 'advancedOverviewPanels'> {
  return { advancedOverviewPreset: preset, advancedOverviewPanels: panelsForPreset(preset) };
}

export function customPanelPatch(
  panels: AdvancedOverviewPanels,
  key: keyof AdvancedOverviewPanels,
): Pick<WorkspacePreferences, 'advancedOverviewPreset' | 'advancedOverviewPanels'> {
  return { advancedOverviewPreset: 'custom', advancedOverviewPanels: { ...panels, [key]: !panels[key] } };
}

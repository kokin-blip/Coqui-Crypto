import { AccountSettingsService } from '@coqui/services';

import type { ChannelHandlers } from './dispatch.js';

function workspacePreferences(view: ReturnType<AccountSettingsService['get']>) {
  if (!view.ok) return view;
  const { preferences } = view.value;
  return {
    ok: true as const,
    value: {
      profileId: view.value.profileId,
      asOfMs: view.value.asOfMs,
      updatedAtMs: view.value.updatedAtMs,
      source: view.value.source,
      preferences: {
        workspaceMode: preferences.workspaceMode,
        overviewChart: preferences.overviewChart,
        portfolioChart: preferences.portfolioChart,
        marketsChart: preferences.marketsChart,
        performanceChart: preferences.performanceChart,
        inspectorOpen: preferences.inspectorOpen,
        inspectorWidthPx: preferences.inspectorWidthPx,
        chartRanges: preferences.chartRanges,
      },
    },
  };
}

export function createAccountPreferenceHandlers(
  profileId: string,
  settings: AccountSettingsService,
): ChannelHandlers {
  return {
    'accounts.settings': () => settings.get(profileId),
    'accounts.settings.set': (payload: { readonly commandId: string; readonly patch: unknown }) =>
      settings.setCommand(profileId, payload),
    'accounts.workspace': () => workspacePreferences(settings.get(profileId)),
    'accounts.workspace.set': (payload: { readonly commandId: string; readonly patch: unknown }) =>
      workspacePreferences(settings.setCommand(profileId, payload)),
  } as ChannelHandlers;
}

import { sha256Hex, type Clock } from '@coqui/core';
import {
  deleteChartDrawing, inTransaction, listChartDrawings, listChartLayouts,
  listChartWatchlists, readChartWorkspaceCommand, saveChartDrawing, saveChartLayout,
  saveChartWatchlist, saveChartWorkspaceCommand, type Db, type DisplayInterval,
} from '@coqui/storage';

import type { ChannelHandlers } from './dispatch.js';

type Action =
  | { readonly kind: 'save_watchlist'; readonly id: string; readonly name: string;
      readonly productIds: readonly string[]; readonly isDefault: boolean }
  | { readonly kind: 'save_layout'; readonly id: string; readonly name: string;
      readonly layout: 'single' | 'horizontal' | 'vertical' | 'grid' | 'dominant';
      readonly tiles: readonly { readonly productId: string; readonly interval: DisplayInterval;
        readonly linkGroup: string | null }[] }
  | { readonly kind: 'save_drawing'; readonly drawing: { readonly id: string;
      readonly productId: string; readonly interval: DisplayInterval; readonly layoutId: string | null;
      readonly kind: 'horizontal' | 'vertical' | 'trend' | 'ray' | 'rectangle' | 'fibonacci' | 'text' | 'measure';
      readonly points: readonly { readonly timeMs: number; readonly value: string }[];
      readonly label: string | null } }
  | { readonly kind: 'delete_drawing'; readonly drawingId: string };

export function createChartWorkspaceHandlers(input: {
  readonly profileId: string; readonly database: Db; readonly clock: Clock;
}): ChannelHandlers {
  return {
    'app.chart.workspace': (payload: { readonly productId: string; readonly interval: DisplayInterval }) => ({
      ok: true,
      value: {
        watchlists: listChartWatchlists(input.profileId, input.database).map((item) => ({
          id: item.id, name: item.name, productIds: item.productIds, isDefault: item.isDefault,
        })),
        layouts: listChartLayouts(input.profileId, input.database).map((item) => ({
          id: item.id, name: item.name, layout: item.layout, tiles: item.tiles,
        })),
        drawings: listChartDrawings(input.profileId, payload.productId, payload.interval, input.database)
          .map((item) => ({ id: item.id, productId: item.productId, interval: item.interval,
            layoutId: item.layoutId, kind: item.kind, points: item.points, label: item.label })),
      },
    }),
    'app.chart.workspace.set': (payload: { readonly commandId: string; readonly action: Action }) => {
      const requestHash = sha256Hex(`${input.profileId}:${JSON.stringify(payload.action)}`);
      const prior = readChartWorkspaceCommand(payload.commandId, input.database);
      if (prior !== null) return prior.profileId === input.profileId && prior.requestHash === requestHash
        ? JSON.parse(prior.outcomeJson) as { readonly ok: true; readonly value: { readonly outcome: 'saved' | 'deleted'; readonly id: string } }
        : { ok: false, issues: [{ code: 'command_conflict' }] };
      const outcome = inTransaction(input.database, () => {
        const now = input.clock.nowMs();
        const action = payload.action;
        let value: { readonly outcome: 'saved' | 'deleted'; readonly id: string };
        if (action.kind === 'save_watchlist') {
          saveChartWatchlist({ ...action, profileId: input.profileId, updatedAtMs: now }, input.database);
          value = { outcome: 'saved', id: action.id };
        } else if (action.kind === 'save_layout') {
          saveChartLayout({ ...action, profileId: input.profileId, updatedAtMs: now }, input.database);
          value = { outcome: 'saved', id: action.id };
        } else if (action.kind === 'save_drawing') {
          saveChartDrawing({ ...action.drawing, profileId: input.profileId, updatedAtMs: now }, input.database);
          value = { outcome: 'saved', id: action.drawing.id };
        } else {
          deleteChartDrawing(input.profileId, action.drawingId, input.database);
          value = { outcome: 'deleted', id: action.drawingId };
        }
        const result = { ok: true as const, value };
        saveChartWorkspaceCommand({ commandId: payload.commandId, profileId: input.profileId,
          requestHash, outcomeJson: JSON.stringify(result), recordedAtMs: now }, input.database);
        return result;
      });
      return outcome;
    },
  } as ChannelHandlers;
}

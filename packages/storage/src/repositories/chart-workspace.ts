import { nonNegativeDecimal } from '@coqui/core';

import type { Db } from '../sqlite/index.js';
import type { DisplayInterval } from './display-market.js';

export type StoredChartLayoutKind = 'single' | 'horizontal' | 'vertical' | 'grid' | 'dominant';
export type StoredDrawingKind = 'horizontal' | 'vertical' | 'trend' | 'ray' |
  'rectangle' | 'fibonacci' | 'text' | 'measure';

export interface StoredWatchlist { readonly id: string; readonly profileId: string;
  readonly name: string; readonly productIds: readonly string[]; readonly isDefault: boolean;
  readonly updatedAtMs: number }
export interface StoredChartTile { readonly productId: string; readonly interval: DisplayInterval;
  readonly linkGroup: string | null }
export interface StoredChartLayout { readonly id: string; readonly profileId: string;
  readonly name: string; readonly layout: StoredChartLayoutKind;
  readonly tiles: readonly StoredChartTile[]; readonly updatedAtMs: number }
export interface StoredChartDrawing { readonly id: string; readonly profileId: string;
  readonly layoutId: string | null; readonly productId: string; readonly interval: DisplayInterval;
  readonly kind: StoredDrawingKind; readonly points: readonly { readonly timeMs: number; readonly value: string }[];
  readonly label: string | null; readonly updatedAtMs: number }
export interface StoredChartWorkspaceCommand { readonly commandId: string; readonly profileId: string;
  readonly requestHash: string; readonly outcomeJson: string; readonly recordedAtMs: number }

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PROFILE = /^(?:main|[0-9a-f-]{36})$/iu;
const PRODUCT = /^[A-Z0-9][A-Z0-9._-]{0,63}$/u;

function validTime(value: number): boolean { return Number.isSafeInteger(value) && value >= 0; }
function parseJson<T>(value: string): T { return JSON.parse(value) as T; }

export function listChartWatchlists(profileId: string, database: Db): StoredWatchlist[] {
  if (!PROFILE.test(profileId)) throw new TypeError('Invalid profile.');
  const rows = database.prepare('SELECT * FROM chart_watchlists_v1 WHERE profile_id = ? ORDER BY is_default DESC, name').all(profileId) as unknown as Array<{ id: string; profile_id: string; name: string; products_json: string; is_default: number; updated_at_ms: number }>;
  return rows.map((row) => Object.freeze({ id: row.id, profileId: row.profile_id, name: row.name,
    productIds: Object.freeze(parseJson<string[]>(row.products_json)), isDefault: row.is_default === 1,
    updatedAtMs: row.updated_at_ms }));
}

export function saveChartWatchlist(value: StoredWatchlist, database: Db): void {
  if (!ID.test(value.id) || !PROFILE.test(value.profileId) || value.name.length < 1 || value.name.length > 40 ||
    value.productIds.length > 100 || value.productIds.some((product) => !PRODUCT.test(product)) || !validTime(value.updatedAtMs)) {
    throw new TypeError('Invalid chart watchlist.');
  }
  database.prepare(`INSERT INTO chart_watchlists_v1 (id, profile_id, name, products_json, is_default, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name,
    products_json = excluded.products_json, is_default = excluded.is_default,
    updated_at_ms = excluded.updated_at_ms WHERE profile_id = excluded.profile_id`)
    .run(value.id, value.profileId, value.name, JSON.stringify([...new Set(value.productIds)]),
      value.isDefault ? 1 : 0, value.updatedAtMs);
}

export function listChartLayouts(profileId: string, database: Db): StoredChartLayout[] {
  if (!PROFILE.test(profileId)) throw new TypeError('Invalid profile.');
  const rows = database.prepare('SELECT * FROM chart_layouts_v1 WHERE profile_id = ? ORDER BY name').all(profileId) as unknown as Array<{ id: string; profile_id: string; name: string; layout: StoredChartLayoutKind; tiles_json: string; updated_at_ms: number }>;
  return rows.map((row) => Object.freeze({ id: row.id, profileId: row.profile_id, name: row.name,
    layout: row.layout, tiles: Object.freeze(parseJson<StoredChartTile[]>(row.tiles_json)),
    updatedAtMs: row.updated_at_ms }));
}

export function saveChartLayout(value: StoredChartLayout, database: Db): void {
  if (!ID.test(value.id) || !PROFILE.test(value.profileId) || value.name.length < 1 || value.name.length > 60 ||
    !['single', 'horizontal', 'vertical', 'grid', 'dominant'].includes(value.layout) ||
    value.tiles.length < 1 || value.tiles.length > 4 || value.tiles.some((tile) => !PRODUCT.test(tile.productId)) ||
    !validTime(value.updatedAtMs)) throw new TypeError('Invalid chart layout.');
  database.prepare(`INSERT INTO chart_layouts_v1 (id, profile_id, name, layout, tiles_json, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name,
    layout = excluded.layout, tiles_json = excluded.tiles_json, updated_at_ms = excluded.updated_at_ms
    WHERE profile_id = excluded.profile_id`).run(value.id, value.profileId, value.name, value.layout,
      JSON.stringify(value.tiles), value.updatedAtMs);
}

export function listChartDrawings(profileId: string, productId: string,
  interval: DisplayInterval, database: Db): StoredChartDrawing[] {
  if (!PROFILE.test(profileId) || !PRODUCT.test(productId)) throw new TypeError('Invalid drawing query.');
  const rows = database.prepare(`SELECT * FROM chart_drawings_v1 WHERE profile_id = ? AND product_id = ?
    AND interval = ? ORDER BY updated_at_ms, id`).all(profileId, productId, interval) as unknown as Array<{
      id: string; profile_id: string; layout_id: string | null; product_id: string;
      interval: DisplayInterval; kind: StoredDrawingKind; points_json: string;
      options_json: string; updated_at_ms: number;
    }>;
  return rows.map((row) => Object.freeze({ id: row.id, profileId: row.profile_id,
    layoutId: row.layout_id, productId: row.product_id, interval: row.interval, kind: row.kind,
    points: Object.freeze(parseJson<Array<{ timeMs: number; value: string }>>(row.points_json)),
    label: (parseJson<{ label?: string | null }>(row.options_json).label ?? null), updatedAtMs: row.updated_at_ms }));
}

export function saveChartDrawing(value: StoredChartDrawing, database: Db): void {
  if (!ID.test(value.id) || !PROFILE.test(value.profileId) || !PRODUCT.test(value.productId) ||
    (value.layoutId !== null && !ID.test(value.layoutId)) || value.points.length < 1 || value.points.length > 2 ||
    value.points.some((point) => !validTime(point.timeMs) || (() => { try { nonNegativeDecimal(point.value); return false; } catch { return true; } })()) ||
    (value.label !== null && value.label.length > 80) || !validTime(value.updatedAtMs)) {
    throw new TypeError('Invalid chart drawing.');
  }
  database.prepare(`INSERT INTO chart_drawings_v1 (id, profile_id, layout_id, product_id, interval, kind, points_json, options_json, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET points_json = excluded.points_json,
    options_json = excluded.options_json, updated_at_ms = excluded.updated_at_ms
    WHERE profile_id = excluded.profile_id`).run(value.id, value.profileId, value.layoutId,
      value.productId, value.interval, value.kind, JSON.stringify(value.points),
      JSON.stringify({ label: value.label }), value.updatedAtMs);
}

export function deleteChartDrawing(profileId: string, drawingId: string, database: Db): boolean {
  if (!PROFILE.test(profileId) || !ID.test(drawingId)) throw new TypeError('Invalid drawing identity.');
  return database.prepare('DELETE FROM chart_drawings_v1 WHERE profile_id = ? AND id = ?')
    .run(profileId, drawingId).changes === 1;
}

export function readChartWorkspaceCommand(commandId: string, database: Db): StoredChartWorkspaceCommand | null {
  const row = database.prepare('SELECT * FROM chart_workspace_commands_v1 WHERE command_id = ?').get(commandId) as unknown as { command_id: string; profile_id: string; request_hash: string; outcome_json: string; recorded_at_ms: number } | undefined;
  return row === undefined ? null : Object.freeze({ commandId: row.command_id, profileId: row.profile_id,
    requestHash: row.request_hash, outcomeJson: row.outcome_json, recordedAtMs: row.recorded_at_ms });
}

export function saveChartWorkspaceCommand(value: StoredChartWorkspaceCommand, database: Db): void {
  if (!ID.test(value.commandId) || !PROFILE.test(value.profileId) || !/^[0-9a-f]{64}$/u.test(value.requestHash) ||
    !validTime(value.recordedAtMs)) throw new TypeError('Invalid chart command.');
  JSON.parse(value.outcomeJson);
  database.prepare(`INSERT INTO chart_workspace_commands_v1
    (command_id, profile_id, request_hash, outcome_json, recorded_at_ms) VALUES (?, ?, ?, ?, ?)`)
    .run(value.commandId, value.profileId, value.requestHash, value.outcomeJson, value.recordedAtMs);
}

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildDecisionMarketDataset, overlayCandidates, overlayHash, costScenarioHash, rebalanceResearchBook, decideOverlayShadow } from '../packages/core/src/index.js';
import { openDatabase, listIntegrityEvents } from '../packages/storage/src/index.js';
import { setOverlayShadowEnabled, importOverlayShadowBinding, tickOverlayShadow, readOverlayShadowStatus, type ShadowBinding } from '../packages/services/src/index.js';
import { overlayFixturePlan, overlayDataset, OVERLAY_START, OVERLAY_DAY, OVERLAY_ASSETS } from './overlay-fixtures.js';
const ns = 'overlay-shadow:"fixture"', at = OVERLAY_START + 201 * OVERLAY_DAY + 600000;
function shadowDataset(count: number, nowMs: number) { const d = overlayDataset(count); return buildDecisionMarketDataset(d.barsById, d.assets, { policy: 'reject-on-gap', nowMs }); }
function binding(): ShadowBinding { const plan = overlayFixturePlan(); return { plan, scenarioHash: costScenarioHash(plan.scenarios[1]!),
  arms: [1, 14].map((cadence) => ({ cadence: cadence as 1 | 14, candidateId: overlayCandidates().find((c) => c.cadence === cadence && c.model === 'none' && c.gate === 'none')!.id, artifact: null, artifactHash: null })) }; }
describe('isolated research shadow', () => {
  it('is disabled by default; explicit settings and imports remain profile isolated', () => {
    const db = openDatabase(':memory:'); try {
      expect(readOverlayShadowStatus('fixture', at, db).enabled).toBe(false);
      const b = binding(); expect(() => importOverlayShadowBinding('fixture', b, 'bad', at, db)).toThrow();
      importOverlayShadowBinding('fixture', b, overlayHash(b), at, db);
      setOverlayShadowEnabled('fixture', true, 'enable', at, db); setOverlayShadowEnabled('fixture', true, 'enable', at, db);
      expect(listIntegrityEvents(ns, 'shadow_setting', db)).toHaveLength(1);
      expect(readOverlayShadowStatus('other', at, db).enabled).toBe(false);
      expect(readOverlayShadowStatus('fixture', at, db).qualified).toBe(false);
    } finally { db.close(); }
  });
  it('recovers pending simulations idempotently and agrees exactly with the shared Decimal book', () => {
    const db = openDatabase(':memory:'); try {
      const b = binding(); importOverlayShadowBinding('fixture', b, overlayHash(b), at, db); setOverlayShadowEnabled('fixture', true, 'enable', at, db);
      tickOverlayShadow({ profile: 'fixture', atMs: at, dataset: shadowDataset(201, at), db });
      tickOverlayShadow({ profile: 'fixture', atMs: at, dataset: shadowDataset(201, at), db });
      expect(listIntegrityEvents(ns, 'shadow_pending', db)).toHaveLength(2);
      const next = OVERLAY_START + 202 * OVERLAY_DAY;
      const prices = new Map(OVERLAY_ASSETS.map((a) => [a, 125]));
      const open = { barStartMs: next, observedAtMs: next + 30000, sourceHash: 'f'.repeat(64), prices };
      const pending = listIntegrityEvents(ns, 'shadow_pending', db)[0]!.body as unknown as { decision: ReturnType<typeof decideOverlayShadow> };
      const expected = rebalanceResearchBook({ cash: '10000', units: new Map() }, prices,
        new Map(pending.decision.targets.map((t) => [t.assetId, t.weight])), b.plan.scenarios[1]!.config);
      tickOverlayShadow({ profile: 'fixture', atMs: next + 30000, dataset: shadowDataset(201, next + 30000), open, db });
      const settlement = listIntegrityEvents(ns, 'shadow_settlement', db)[0]!.body as unknown as { fills: unknown[] };
      expect(settlement.fills).toEqual(expected.fills);
      const count = listIntegrityEvents(ns, 'shadow_settlement', db).length;
      tickOverlayShadow({ profile: 'fixture', atMs: next + 30000, dataset: shadowDataset(201, next + 30000), open, db });
      expect(listIntegrityEvents(ns, 'shadow_settlement', db)).toHaveLength(count);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%orders%' OR name LIKE '%intents%' OR name='profitability_evidence')").all() as { name: string }[];
      for (const table of tables) expect((db.prepare(`SELECT COUNT(*) AS count FROM "${table.name}"`).get() as { count: number }).count).toBe(0);
    } finally { db.close(); }
  });
  it('does not backfill missed opens or delete evidence when disabled', () => {
    const db = openDatabase(':memory:'); try {
      const b = binding(); importOverlayShadowBinding('fixture', b, overlayHash(b), at, db); setOverlayShadowEnabled('fixture', true, 'on', at, db);
      tickOverlayShadow({ profile: 'fixture', atMs: at, dataset: shadowDataset(201, at), db });
      tickOverlayShadow({ profile: 'fixture', atMs: OVERLAY_START + 202 * OVERLAY_DAY + 120000, dataset: shadowDataset(201, OVERLAY_START + 202 * OVERLAY_DAY + 120000), db });
      expect(listIntegrityEvents(ns, 'shadow_settlement', db).every((e) => (e.body as { status: string }).status === 'missed_open_no_backfill')).toBe(true);
      const pending = listIntegrityEvents(ns, 'shadow_pending', db).length;
      setOverlayShadowEnabled('fixture', false, 'off', at + 2 * OVERLAY_DAY, db);
      tickOverlayShadow({ profile: 'fixture', atMs: at + 2 * OVERLAY_DAY, dataset: shadowDataset(202, at + 2 * OVERLAY_DAY), db });
      expect(listIntegrityEvents(ns, 'shadow_pending', db)).toHaveLength(pending);
    } finally { db.close(); }
  });
});


describe('shadow safety and restart recovery', () => {
  it('a hard stop between decision and fill persists across artifact updates', () => {
    const db = openDatabase(':memory:'); try {
      const b = binding(); importOverlayShadowBinding('fixture', b, overlayHash(b), at, db); setOverlayShadowEnabled('fixture', true, 'enable', at, db);
      tickOverlayShadow({ profile: 'fixture', atMs: at, dataset: shadowDataset(201, at), db });
      const next = OVERLAY_START + 202 * OVERLAY_DAY;
      tickOverlayShadow({ profile: 'fixture', atMs: next + 30000, dataset: shadowDataset(201, next + 30000), safetyStopped: true,
        open: { barStartMs: next, observedAtMs: next + 30000, sourceHash: 'f'.repeat(64), prices: new Map(OVERLAY_ASSETS.map((a) => [a, 125])) }, db });
      expect(readOverlayShadowStatus('fixture', next, db).arms.every((arm) => arm.stopped && arm.modeledFills === 0)).toBe(true);
      const updated = { ...b, plan: { ...b.plan, id: 'explicit-new-shadow-configuration' } };
      importOverlayShadowBinding('fixture', updated, overlayHash(updated), next + 60000, db);
      expect(readOverlayShadowStatus('fixture', next, db).arms.every((arm) => arm.stopped)).toBe(true);
    } finally { db.close(); }
  });
  it('pending decisions and disabled settings survive closing and reopening a fixture database', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coqui-overlay-restart-')), path = join(dir, 'fixture.db');
    let db = openDatabase(path);
    try {
      const b = binding(); importOverlayShadowBinding('fixture', b, overlayHash(b), at, db); setOverlayShadowEnabled('fixture', true, 'enable', at, db);
      tickOverlayShadow({ profile: 'fixture', atMs: at, dataset: shadowDataset(201, at), db }); db.close(); db = openDatabase(path);
      expect(readOverlayShadowStatus('fixture', at, db).pending).toBe(2);
      const next = OVERLAY_START + 202 * OVERLAY_DAY;
      tickOverlayShadow({ profile: 'fixture', atMs: next + 120000, dataset: shadowDataset(201, next + 120000), db });
      expect(listIntegrityEvents(ns, 'shadow_settlement', db)).toHaveLength(2);
      setOverlayShadowEnabled('fixture', false, 'disable', next + 120000, db); db.close(); db = openDatabase(path);
      expect(readOverlayShadowStatus('fixture', next, db).enabled).toBe(false);
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});

import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { TaxLot } from '@coqui/core';

import { listPaperBalances, type PaperBalance } from '../repositories/paper.js';
import { listTaxLots } from '../repositories/portfolio.js';

export interface StoredProfileComparisonFacts {
  readonly schemaVersion: number;
  readonly openLots: readonly TaxLot[];
  readonly disposalCount: number;
  readonly paperBalances: readonly PaperBalance[];
}

export type ProfileComparisonFactsErrorCode = 'unavailable' | 'corrupt' | 'limit_exceeded';

export type ProfileComparisonFactsResult =
  | { readonly ok: true; readonly facts: StoredProfileComparisonFacts }
  | { readonly ok: false; readonly code: ProfileComparisonFactsErrorCode };

export interface ProfileComparisonFactsReader {
  read(profileId: string, dbFilename: string): Promise<ProfileComparisonFactsResult>;
}

const PROFILE_ID = /^(?:main|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;
const MAX_TAX_LOTS = 100_000;
const MAX_PAPER_BALANCES = 10_000;

function inside(root: string, target: string): boolean {
  const child = relative(root, target);
  return child.length > 0 && !child.startsWith('..') && !isAbsolute(child);
}

function safeFilename(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 &&
    !value.includes('\0') && !value.includes('/') && !value.includes('\\') && value.endsWith('.db');
}

function safeCount(value: unknown): number | null {
  if (typeof value === 'bigint') {
    const converted = Number(value);
    return Number.isSafeInteger(converted) && converted >= 0 ? converted : null;
  }
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function count(database: DatabaseSync, sql: string, ...parameters: string[]): number | null {
  const row = database.prepare(sql).get(...parameters) as Record<string, unknown>;
  return safeCount(row['count']);
}

function freeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

/** Open one isolated profile read-only and return bounded, detached comparison facts. */
export function createFileProfileComparisonFactsReader(
  profilesDirectory: string,
): ProfileComparisonFactsReader {
  if (!profilesDirectory) throw new TypeError('A profile database root is required.');
  return Object.freeze({
    async read(profileId: string, dbFilename: string): Promise<ProfileComparisonFactsResult> {
      if (!PROFILE_ID.test(profileId) || !safeFilename(dbFilename)) {
        return { ok: false, code: 'unavailable' };
      }
      let database: DatabaseSync | null = null;
      try {
        const root = realpathSync(profilesDirectory);
        const candidate = resolve(root, dbFilename);
        if (!inside(root, candidate) || !existsSync(candidate) || !statSync(candidate).isFile()) {
          return { ok: false, code: 'unavailable' };
        }
        const path = realpathSync(candidate);
        if (!inside(root, path)) return { ok: false, code: 'unavailable' };
        database = new DatabaseSync(path, { readOnly: true, allowExtension: false });
        const versionRow = database.prepare('PRAGMA user_version').get() as Record<string, unknown>;
        const schemaVersion = safeCount(versionRow['user_version']);
        const taxLotCount = count(database, 'SELECT COUNT(*) AS count FROM tax_lots_v2');
        const disposalCount = count(database, 'SELECT COUNT(*) AS count FROM disposals_v2');
        const paperBalanceCount = count(
          database,
          'SELECT COUNT(*) AS count FROM paper_balances_v3 WHERE profile_id = ?',
          profileId,
        );
        if (schemaVersion === null || taxLotCount === null || disposalCount === null ||
          paperBalanceCount === null) return { ok: false, code: 'corrupt' };
        if (taxLotCount > MAX_TAX_LOTS || paperBalanceCount > MAX_PAPER_BALANCES) {
          return { ok: false, code: 'limit_exceeded' };
        }
        const openLots = listTaxLots(database, true);
        const paperBalances = listPaperBalances(profileId, database);
        return freeze({
          ok: true,
          facts: { schemaVersion, openLots, disposalCount, paperBalances },
        });
      } catch {
        return { ok: false, code: 'corrupt' };
      } finally {
        database?.close();
      }
    },
  });
}

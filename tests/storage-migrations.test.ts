import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  migrations,
  openDatabase,
  runMigrations,
  type Db,
  type Migration,
} from '../packages/storage/src/index.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

function temporaryDatabase(prefix: string): { directory: string; path: string } {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return { directory, path: join(directory, 'wallet.db') };
}

function userVersion(database: Db): number {
  const row = database.prepare('PRAGMA user_version').get() as { user_version: number };
  return row.user_version;
}

function tableNames(database: Db): Set<string> {
  const rows = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

describe('ported predecessor migration manifest', () => {
  it('preserves predecessor versions 1-28 and appends Coqui-native migrations', () => {
    expect(migrations.map((migration) => migration.version)).toEqual(
      Array.from({ length: 37 }, (_, index) => index + 1),
    );
    expect(migrations.map((migration) => migration.name)).toEqual([
      'initial_schema',
      'risk_reports_and_timestamp_indexes',
      'token_history',
      'signals',
      'sim_accounts',
      'tracked_wallets',
      'app_settings',
      'holdings',
      'kokintrader_lot_ledger',
      'disposal_source',
      'portfolio_snapshots',
      'drop_memecoin_tables',
      'user_disclaimer_acceptances',
      'daily_closes',
      'evidence_snapshots',
      'coingecko_research',
      'durable_research_jobs',
      'wallet_scheduler_and_execution_journal',
      'timestamped_market_bars_v2',
      'paper_order_events_and_ledger',
      'wallet_risk_profiles_and_decision_runs',
      'canonical_asset_registry',
      'staged_coinbase_imports',
      'research_job_integrity_metadata',
      'durable_safety_stops_and_coinbase_import_completion',
      'fill_driven_decimal_paper_execution_v3',
      'canonical_asset_identity_evidence',
      'append_only_runtime_incidents',
      'canonical_decimal_portfolio_v2',
      'market_data_identity_exceptions',
      'canonical_instrument_provider_registry_v2',
      'exact_decimal_wallet_risk_state_v2',
      'point_in_time_universe_snapshots',
      'operational_metric_observations',
      'trial_registry_and_research_evidence_v2',
      'research_preregistration',
      'immutable_research_study_runs',
    ]);
  });

  it('creates the current schema while retaining only intended legacy tables', () => {
    const database = openDatabase(':memory:');
    const tables = tableNames(database);
    expect(userVersion(database)).toBe(37);
    for (const expected of [
      'app_settings',
      'tax_lots',
      'disposals',
      'allocation_targets',
      'market_bars_v2',
      'research_jobs',
      'wallet_execution_journal',
      'canonical_assets',
      'coinbase_import_jobs',
      'wallet_safety_stop_state',
      'paper_orders_v3',
      'paper_fills_v3',
      'asset_mapping_events',
      'runtime_incidents',
      'tax_lots_v2',
      'disposals_v2',
      'allocation_targets_v2',
      'portfolio_snapshots_v2',
      'portfolio_migration_exceptions',
      'market_data_migration_exceptions',
      'canonical_instruments',
      'instrument_provider_mappings',
      'instrument_mapping_events_v2',
      'canonical_mapping_migration_exceptions',
      'wallet_risk_state_v2',
      'wallet_risk_migration_exceptions',
      'universe_snapshots',
      'universe_product_observations',
      'operational_metric_observations',
      'trial_registry_meta',
      'trial_registry_records',
      'research_evidence_snapshots_v2',
      'research_preregistrations',
      'research_study_runs',
    ]) expect(tables.has(expected), `${expected} should exist`).toBe(true);
    for (const retired of ['tokens', 'trades', 'signals', 'sim_accounts', 'wallet_hits']) {
      expect(tables.has(retired), `${retired} should be retired`).toBe(false);
    }
    database.close();
  });

  it('preserves exact rows when upgrading from every preceding schema version', () => {
    for (let version = 1; version < migrations.length; version += 1) {
      const database = openDatabase(':memory:', { migrations: migrations.slice(0, version) });
      database.exec(`
        CREATE TABLE migration_sentinel (
          id INTEGER PRIMARY KEY,
          amount_text TEXT NOT NULL
        );
      `);
      database.prepare('INSERT INTO migration_sentinel VALUES (?, ?)')
        .run(9_007_199_254_740_993n, '1234567890.123456789');

      expect(runMigrations(database)).toBe(37);
      const statement = database.prepare('SELECT id, amount_text FROM migration_sentinel');
      statement.setReadBigInts(true);
      expect(statement.get()).toEqual({
        id: 9_007_199_254_740_993n,
        amount_text: '1234567890.123456789',
      });
      database.close();
    }
  });
});

describe('forward migration safety', () => {
  it('creates a restorable VACUUM backup before migrating a file database', () => {
    const fixture = temporaryDatabase('coqui-storage-backup-');
    const old = openDatabase(fixture.path, { migrations: migrations.slice(0, 17) });
    old.prepare("INSERT INTO app_settings (key, value) VALUES ('preserved', 'yes')").run();
    old.close();

    const migrated = openDatabase(fixture.path, { now: () => 123 });
    expect(userVersion(migrated)).toBe(37);
    expect(migrated.prepare("SELECT value FROM app_settings WHERE key = 'preserved'").get())
      .toEqual({ value: 'yes' });
    migrated.close();

    const backupName = 'wallet.db.pre-migration-v17-123.bak';
    expect(readdirSync(fixture.directory)).toContain(backupName);
    const backup = openDatabase(join(fixture.directory, backupName), { skipMigrations: true });
    expect(userVersion(backup)).toBe(17);
    expect(backup.prepare("SELECT value FROM app_settings WHERE key = 'preserved'").get())
      .toEqual({ value: 'yes' });
    backup.close();
  });

  it('rolls back schema changes and version advancement when a migration fails', () => {
    const database = openDatabase(':memory:');
    const failing: Migration = {
      version: 38,
      name: 'failure_fixture',
      up(db) {
        db.exec('CREATE TABLE should_rollback (id INTEGER);');
        throw new Error('injected migration failure');
      },
    };

    expect(() => runMigrations(database, [...migrations, failing]))
      .toThrow('injected migration failure');
    expect(userVersion(database)).toBe(37);
    expect(tableNames(database).has('should_rollback')).toBe(false);
    database.close();
  });

  it('rejects renumbered, reordered, and future schemas', () => {
    const database = openDatabase(':memory:');
    expect(() => runMigrations(database, [migrations[1]!, migrations[0]!]))
      .toThrow('contiguous and ordered');
    database.exec('PRAGMA user_version = 38');
    expect(() => runMigrations(database)).toThrow('newer than this application');
    database.close();
  });
});

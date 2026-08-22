import { isAbsolute, join } from 'node:path';

import type {
  CoinbaseProfileContext,
  PreparedProfileContext,
  ProfileContextManager,
  ProfileDatabaseProvisioner,
} from '@coqui/services';
import { openDatabase, type Db } from '@coqui/storage';

/**
 * Per-profile databases, at last with an implementation.
 *
 * `ProfileDatabaseProvisioner` and `ProfileContextManager` were interfaces with
 * no production implementor anywhere — only a test stub — so multi-wallet was
 * describable and unreachable. They live here rather than in `packages/services`
 * because opening a file is the composition root's business: a service that
 * knew a data directory would be a service that could open a *different*
 * profile's database, which is the cross-wallet leak P7 has to rule out.
 *
 * **One profile is open at a time.** Two open connections to two profiles is
 * the shape in which cross-wallet leakage happens — a query issued against
 * whichever handle a closure happened to capture. A single active context makes
 * that impossible rather than merely unlikely.
 */

const DB_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.db$/u;

/** Reject anything that could escape the data directory before it reaches the filesystem. */
function resolveProfilePath(dataDirectory: string, dbFilename: string): string | null {
  if (!DB_FILENAME.test(dbFilename)) return null;
  if (dbFilename.includes('..')) return null;
  const path = join(dataDirectory, dbFilename);
  return isAbsolute(path) && path.startsWith(dataDirectory) ? path : null;
}

/**
 * Create and migrate a profile's database.
 *
 * `openDatabase` migrates on open and creates the parent directory, so
 * provisioning is opening it once and closing it. Doing that at *creation*
 * time rather than first use means a profile that cannot be migrated fails
 * while the user is still looking at the dialog that created it.
 */
export function createProfileDatabaseProvisioner(
  dataDirectory: string,
): ProfileDatabaseProvisioner {
  return {
    async provision(_profileId, dbFilename) {
      const path = resolveProfilePath(dataDirectory, dbFilename);
      if (path === null) return { ok: false };
      try {
        openDatabase(path).close();
        return { ok: true };
      } catch {
        // The caller reports a failed provision to the user; the reason stays
        // local, since a filesystem error message can carry a path.
        return { ok: false };
      }
    },
  };
}

export interface ActiveProfileContext {
  readonly profileId: string;
  readonly database: Db;
}

export interface ProfileContexts extends ProfileContextManager {
  /** The open profile, or null before the first activation. */
  active(): ActiveProfileContext | null;
  dispose(): void;
}

/**
 * Prepare-then-commit switching between profiles.
 *
 * The target is opened and migrated during `prepare`, while the current profile
 * stays active and usable. Only `commit` swaps, and only after the new
 * connection is known to be good — so a profile that fails to migrate leaves
 * the user exactly where they were rather than with nothing open.
 */
export function createProfileContexts(dataDirectory: string): ProfileContexts {
  let current: ActiveProfileContext | null = null;
  let preparing = false;

  return {
    async prepare(profileId, dbFilename) {
      // One switch at a time. Two overlapping preparations could both commit,
      // and the loser's connection would leak with no handle left to close it.
      if (preparing) return { ok: false };
      const path = resolveProfilePath(dataDirectory, dbFilename);
      if (path === null) return { ok: false };

      let candidate: Db;
      try {
        preparing = true;
        candidate = openDatabase(path);
      } catch {
        preparing = false;
        return { ok: false };
      }

      let settled = false;
      const context: PreparedProfileContext = {
        async commit() {
          if (settled) return { ok: false };
          settled = true;
          preparing = false;
          // The previous profile closes only once the new one is open, so
          // there is no window in which no database is active.
          current?.database.close();
          current = { profileId, database: candidate };
          return { ok: true };
        },
        async abort() {
          if (settled) return;
          settled = true;
          preparing = false;
          candidate.close();
        },
      };
      return { ok: true, context };
    },

    active: () => current,

    dispose() {
      current?.database.close();
      current = null;
      preparing = false;
    },
  };
}

/**
 * Open a short-lived context for one Coinbase refresh.
 *
 * Sync runs against a profile that may not be the active one — a background
 * refresh should not require switching the user's view — so it gets its own
 * connection, scoped to the request and closed by the caller. The path is
 * resolved from the same guard, so a refresh cannot name a file outside the
 * data directory.
 */
export function createCoinbaseProfileContextFactory(
  dataDirectory: string,
): (request: { readonly profileId: string; readonly databaseFilename: string }) =>
  CoinbaseProfileContext {
  return (request) => {
    const path = resolveProfilePath(dataDirectory, request.databaseFilename);
    if (path === null) throw new Error('Refusing to open a profile database outside the data directory.');
    const database = openDatabase(path);
    return {
      database,
      close() {
        database.close();
      },
    };
  };
}

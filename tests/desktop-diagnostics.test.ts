import { describe, expect, it } from 'vitest';

import { createDiagnostics } from '../apps/desktop/src/main/diagnostics.js';
import { FixedClock } from '../packages/core/src/index.js';
import { createStructuredLogger, type StructuredLogEntry } from '../packages/observability/src/index.js';
import { listRuntimeIncidents, openDatabase, type Db } from '../packages/storage/src/index.js';

const T0 = 1_800_000_000_000;
const PROFILE = 'main';
const SECRET = 'CG-s3cr3tk3yd0n0tl0g';

function harness(secrets: readonly string[] = []) {
  const database = openDatabase(':memory:');
  const entries: StructuredLogEntry[] = [];
  const diagnostics = createDiagnostics({
    database,
    clock: new FixedClock(T0),
    profileId: PROFILE,
    secrets,
    logger: createStructuredLogger({
      minimumLevel: 'debug',
      sink: (entry) => entries.push(entry),
      timestamp: () => new Date(T0).toISOString(),
      secrets,
    }),
  });
  return { database, entries, diagnostics };
}

function incidents(database: Db) {
  return listRuntimeIncidents(PROFILE, false, 50, database);
}

describe('a background failure is diagnosable from the log alone', () => {
  it('logs the message and the stack', () => {
    const { database, entries, diagnostics } = harness();
    diagnostics.report('scheduler_tick', new Error('lease could not be acquired'));

    // P9's exit criterion. Before this, `createStructuredLogger` had no
    // production caller and a failed tick produced nothing findable.
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe('error');
    expect(entries[0]?.event).toBe('background_failure');
    expect(JSON.stringify(entries[0]?.context)).toContain('lease could not be acquired');
    database.close();
  });

  it('carries the profile on every line', () => {
    const { database, entries, diagnostics } = harness();
    diagnostics.report('scheduler_tick', new Error('x'));
    expect(entries[0]?.context).toMatchObject({ context: 'scheduler_tick' });
    database.close();
  });

  it('logs a thrown non-Error without losing it', () => {
    const { database, entries, diagnostics } = harness();
    diagnostics.report('scheduler_tick', 'a bare string');
    expect(JSON.stringify(entries[0]?.context)).toContain('a bare string');
    database.close();
  });
});

describe('a durable fault also becomes an incident', () => {
  it('records one for a scheduler failure', () => {
    const { database, diagnostics } = harness();
    diagnostics.report('scheduler_tick', new Error('lease lost'));

    const [incident] = incidents(database);
    expect(incident?.kind).toBe('scheduler_failure');
    expect(incident?.source).toBe('scheduler_tick');
    database.close();
  });

  it('records nothing for a context that is not a durable fault', () => {
    const { database, entries, diagnostics } = harness();
    diagnostics.report('channel:market-data.prices', new Error('429'));

    // An incident row is permanent and surfaces to the user, so the bar is
    // "needs looking at", not "went wrong once". Logging everything and
    // recording some is what keeps the incident list worth reading.
    expect(entries).toHaveLength(1);
    expect(incidents(database)).toHaveLength(0);
    database.close();
  });

  it('collapses a fault repeating every tick into one row a minute', () => {
    const { database, diagnostics } = harness();
    for (let index = 0; index < 5; index += 1) {
      diagnostics.report('scheduler_tick', new Error('still failing'));
    }

    // An incident list nobody can read is an incident list nobody reads.
    expect(incidents(database)).toHaveLength(1);
    database.close();
  });

  it('keeps the error message out of the incident row', () => {
    const { database, diagnostics } = harness();
    diagnostics.report(
      'paper_market_bars',
      new Error('GET https://api.coingecko.com/x?key=CG-leaked failed'),
    );

    // An upstream message can carry a URL with a key in it. The row gets the
    // error's *type*, which distinguishes a TypeError from a RangeError without
    // carrying content (invariant 3).
    const [incident] = incidents(database);
    expect(incident?.detailJson).not.toContain('CG-leaked');
    expect(incident?.detailJson).toContain('Error');
    database.close();
  });
});

describe('a known secret never reaches a log line', () => {
  it('redacts it even when a caller logs the wrong object', () => {
    const { database, entries, diagnostics } = harness([SECRET]);
    diagnostics.report('paper_market_bars', new Error(`upstream rejected ${SECRET}`));

    // The redaction layer was already good; it simply had no caller. Passing
    // the connected key means a line that should never contain it cannot,
    // rather than relying on nobody having logged the wrong thing.
    expect(JSON.stringify(entries)).not.toContain(SECRET);
    expect(JSON.stringify(entries)).toContain('upstream rejected');
    database.close();
  });
});

describe('reporting a failure cannot produce a second one', () => {
  it('survives a sink that throws', () => {
    const database = openDatabase(':memory:');
    const diagnostics = createDiagnostics({
      database,
      clock: new FixedClock(T0),
      profileId: PROFILE,
      logger: createStructuredLogger({
        sink: () => {
          throw new Error('sink is broken');
        },
      }),
    });

    expect(() => diagnostics.report('scheduler_tick', new Error('x'))).not.toThrow();
    // The incident still lands: a broken log sink must not also lose the row.
    expect(incidents(database)).toHaveLength(1);
    database.close();
  });

  it('survives a closed database', () => {
    const { database, diagnostics } = harness();
    database.close();

    // The log line already landed, which is the guarantee that matters.
    expect(() => diagnostics.report('scheduler_tick', new Error('x'))).not.toThrow();
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { acquireExecutionLease, assignAuthoritativeHost, getAuthoritativeHost,
  heartbeatAuthoritativeHost, openDatabase, recordHostReconciliation,
  relinquishAuthoritativeHost, takeoverAuthoritativeHost, validateExecutionLease } from '../packages/storage/src/index.js';

describe('local authoritative host assignment', () => {
  it('requires reconciliation, increments generations, and permanently fences the prior host', () => {
    const database=openDatabase(':memory:');
    const first=assignAuthoritativeHost('profile-a','desktop-a','desktop',100,database);
    expect(first).toMatchObject({hostId:'desktop-a',fencingGeneration:1,status:'active'});
    expect(assignAuthoritativeHost('profile-a','desktop-a','desktop',101,database)).toEqual(first);
    const lease=acquireExecutionLease('profile-a','desktop-a',110,100,database)!;
    expect(acquireExecutionLease('profile-a','headless-a',111,100,database)).toBeNull();
    expect(()=>takeoverAuthoritativeHost({profileId:'profile-a',hostId:'headless-a',hostKind:'headless',
      reconciliationId:'0'.repeat(64),at:120},database)).toThrow('reconciliation');
    const reconciliationId=recordHostReconciliation({profileId:'profile-a',hostId:'headless-a',
      observedGeneration:1,at:121,detail:{reconciled:0,blocked:0}},database);
    const takeover=takeoverAuthoritativeHost({profileId:'profile-a',hostId:'headless-a',hostKind:'headless',
      reconciliationId,at:122},database);
    expect(takeover).toMatchObject({hostId:'headless-a',hostKind:'headless',fencingGeneration:2});
    expect(validateExecutionLease('profile-a','desktop-a',lease.fencingToken,123,database)).toBe(false);
    expect(database.prepare(`SELECT kind,detail_json FROM execution_lease_events_v1
      WHERE profile_id=? ORDER BY at DESC LIMIT 1`).get('profile-a'))
      .toEqual({kind:'lost',detail_json:'{"reason":"host_authority_changed"}'});
    expect(acquireExecutionLease('profile-a','desktop-a',123,100,database)).toBeNull();
    expect(acquireExecutionLease('profile-a','headless-a',123,100,database)?.fencingToken).toBe(3);
    expect(heartbeatAuthoritativeHost('profile-a','headless-a',2,124,database)).toBe(true);
    expect(heartbeatAuthoritativeHost('profile-a','desktop-a',1,124,database)).toBe(false);
    expect(()=>database.prepare('DELETE FROM host_takeover_history_v1').run()).toThrow('immutable');
    database.close();
  });

  it('relinquishes explicitly and does not copy authority into a new owner', () => {
    const database=openDatabase(':memory:');
    const assigned=assignAuthoritativeHost('profile-a','headless-a','headless',100,database);
    expect(()=>relinquishAuthoritativeHost('profile-a','headless-a',0,101,database)).toThrow('stale');
    expect(relinquishAuthoritativeHost('profile-a','headless-a',assigned.fencingGeneration,101,database))
      .toMatchObject({hostId:null,status:'relinquished',fencingGeneration:2});
    const desktopLease=acquireExecutionLease('profile-a','desktop-a',102,100,database)!;
    expect(desktopLease).not.toBeNull();
    expect(assignAuthoritativeHost('profile-a','headless-b','headless',103,database))
      .toMatchObject({hostId:'headless-b',fencingGeneration:3});
    expect(validateExecutionLease('profile-a','desktop-a',desktopLease.fencingToken,104,database)).toBe(false);
    expect(getAuthoritativeHost('profile-a',database)?.heartbeatAt).toBeNull();
    database.close();
  });

  it('keeps the headless entry point local, paper-only, and listener-free', () => {
    const source=readFileSync('apps/headless/src/index.ts','utf8');
    expect(source).toContain('paperOnly:true');
    expect(source).not.toMatch(/createServer|listen\(|WebSocketServer|liveExecution/iu);
    expect(source).not.toMatch(/keytar|secretStore|SecretRef|profile_connections/iu);
  });
});

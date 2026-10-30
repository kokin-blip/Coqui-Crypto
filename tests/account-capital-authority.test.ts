import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { capitalScopeId, sha256Hex, type AccountAuthorityAction, type AccountAuthorityCommand,
  type AccountAuthorityHead } from '../packages/core/src/index.js';
import { backupAccountAuthorityJournal, createAccountAuthorityJournal, getAccountAuthorityHead,
  openAccountAuthorityJournal, openDatabase, recordAccountAuthorityCommand,
  type AccountAuthorityJournal } from '../packages/storage/src/index.js';
import { createAccountCapitalAuthorityReadPort } from '../packages/services/src/paper/account-capital-runtime.js';

const registryId = sha256Hex('synthetic-registry'), accountIdentityHash = sha256Hex('synthetic-account');
const scopeId = capitalScopeId('alpaca', 'paper', accountIdentityHash);
function command(id: string, head: AccountAuthorityHead | null, action: AccountAuthorityAction,
  atMs = 10, profileId = 'profile-a'): AccountAuthorityCommand {
  return { id:sha256Hex(id),scopeId,expectedHeadId:head?.id??null,profileId,
    hostIdentityHash:sha256Hex(`host-${profileId}`),atMs,action };
}
function fixture(run: (journal: AccountAuthorityJournal, directory: string, handles: AccountAuthorityJournal[]) => void): void {
  const directory = mkdtempSync(join(tmpdir(),'coqui-authority-'));
  const journal = createAccountAuthorityJournal({path:join(directory,'authority.sqlite'),registryId,atMs:0});
  const handles = [journal];
  try { run(journal,directory,handles); }
  finally { for (const handle of handles) handle.close(); rmSync(directory,{recursive:true,force:true}); }
}
const enroll = (journal: AccountAuthorityJournal) => recordAccountAuthorityCommand(journal,
  command('enroll',null,{kind:'record_scope',accountIdentityHash}));
const checkpoint = {sourceId:sha256Hex('source'),claimsRevision:sha256Hex('claims-head'),
  claimIds:[sha256Hex('existing-p2-claim')],reconciliationId:sha256Hex('reconciliation')};

describe('disabled account-wide authority journal', () => {
  it('shares one canonical account across two profile connections and rejects a stale or competing session', () => fixture((journal,directory,handles) => {
    const other = openAccountAuthorityJournal(join(directory,'authority.sqlite'),registryId); handles.push(other);
    const opening = enroll(journal);
    const acquired = recordAccountAuthorityCommand(journal,command('a',opening,{kind:'acquire_preparation',durationMs:1000}));
    expect(() => recordAccountAuthorityCommand(other,command('b',opening,{kind:'acquire_preparation',durationMs:1000},10,'profile-b'))).toThrow('stale_head');
    expect(() => recordAccountAuthorityCommand(other,command('b',acquired,{kind:'acquire_preparation',durationMs:1000},10,'profile-b'))).toThrow('preparation_busy');
    expect(getAccountAuthorityHead(other,scopeId)).toEqual(acquired);
    expect(journal.database.prepare('SELECT count(*) n FROM account_authority_scopes_v1').get()?.['n']).toBe(1);
    expect(createAccountCapitalAuthorityReadPort(other).read(scopeId,11)).toMatchObject({state:'unavailable',executionPermitted:false,financialClaimsFunded:false});
  }));

  it('returns the original result on exact retry and refuses conflicting command reuse', () => fixture(journal => {
    const opening = enroll(journal), request = command('acquire',opening,{kind:'acquire_preparation',durationMs:100});
    const acquired = recordAccountAuthorityCommand(journal,request);
    recordAccountAuthorityCommand(journal,command('release',acquired,{kind:'release_preparation'},11));
    expect(recordAccountAuthorityCommand(journal,request)).toEqual(acquired);
    expect(() => recordAccountAuthorityCommand(journal,{...request,atMs:12})).toThrow('command_conflict');
    expect(journal.database.prepare('SELECT count(*) n FROM account_authority_events_v1').get()?.['n']).toBe(3);
  }));

  it('preserves referenced claims through release, quarantine, reopen and backup without funding them', () => fixture((journal,directory,handles) => {
    let head = enroll(journal);
    head = recordAccountAuthorityCommand(journal,command('acquire',head,{kind:'acquire_preparation',durationMs:1000}));
    head = recordAccountAuthorityCommand(journal,command('checkpoint',head,{kind:'record_checkpoint',checkpoint},11));
    head = recordAccountAuthorityCommand(journal,command('release',head,{kind:'release_preparation'},12));
    expect(head).toMatchObject({checkpoint,session:null,generation:2,status:'disabled'});
    head = recordAccountAuthorityCommand(journal,command('quarantine',head,{kind:'quarantine',reason:'restore_uncertain'},13));
    const backup = join(directory,'backup.sqlite'); backupAccountAuthorityJournal(journal,backup);
    const restored = openAccountAuthorityJournal(backup,registryId); handles.push(restored);
    const reopened = openAccountAuthorityJournal(join(directory,'authority.sqlite'),registryId); handles.push(reopened);
    for (const copy of [restored,reopened]) {
      expect(getAccountAuthorityHead(copy,scopeId)).toEqual(head);
      const view = createAccountCapitalAuthorityReadPort(copy).read(scopeId,14);
      expect(view).toMatchObject({state:'unavailable',executionPermitted:false,financialClaimsFunded:false});
      expect(view.reasonCodes).toContain('account_authority_quarantined');
      expect(() => recordAccountAuthorityCommand(copy,command('new',head,{kind:'acquire_preparation',durationMs:1000},14))).toThrow('quarantined');
    }
  }));

  it('requires reconciliation after expiry rather than silently taking over or releasing', () => fixture(journal => {
    const opening = enroll(journal);
    const acquired = recordAccountAuthorityCommand(journal,command('a',opening,{kind:'acquire_preparation',durationMs:10}));
    for (const action of [{kind:'acquire_preparation',durationMs:100},{kind:'release_preparation'},
      {kind:'record_checkpoint',checkpoint}] as const) {
      expect(() => recordAccountAuthorityCommand(journal,command(action.kind,acquired,action,20))).toThrow('reconciliation_required');
    }
    expect(getAccountAuthorityHead(journal,scopeId)).toEqual(acquired);
    expect(createAccountCapitalAuthorityReadPort(journal).read(scopeId,20).reasonCodes).toContain('account_authority_reconciliation_required');
  }));

  it('binds ownership to the profile, host, generation, account and exact head', () => fixture(journal => {
    const opening = enroll(journal);
    const acquired = recordAccountAuthorityCommand(journal,command('a',opening,{kind:'acquire_preparation',durationMs:100}));
    expect(() => recordAccountAuthorityCommand(journal,command('foreign',acquired,{kind:'record_checkpoint',checkpoint},11,'profile-b'))).toThrow('owner_mismatch');
    expect(() => recordAccountAuthorityCommand(journal,{...command('wrong-host',acquired,{kind:'release_preparation'},11),hostIdentityHash:sha256Hex('foreign-host')})).toThrow('owner_mismatch');
    expect(() => recordAccountAuthorityCommand(journal,{...command('wrong-account',null,{kind:'record_scope',accountIdentityHash}),scopeId:capitalScopeId('alpaca','production_read_only',accountIdentityHash)})).toThrow('scope_mismatch');
    expect(() => recordAccountAuthorityCommand(journal,command('backward',acquired,{kind:'release_preparation'},9))).toThrow('clock_regression');
    const released = recordAccountAuthorityCommand(journal,command('release',acquired,{kind:'release_preparation'},11));
    expect(() => recordAccountAuthorityCommand(journal,command('stale-release',acquired,{kind:'release_preparation'},12))).toThrow('stale_head');
    const next = recordAccountAuthorityCommand(journal,command('next',released,{kind:'acquire_preparation',durationMs:100},12,'profile-b'));
    expect(next.generation).toBe(3);
  }));

  it('strictly rejects unsupported fields, duplicate references and invalid times before writing', () => fixture(journal => {
    const opening = enroll(journal);
    const acquired = recordAccountAuthorityCommand(journal,command('a',opening,{kind:'acquire_preparation',durationMs:100}));
    const base = command('bad',acquired,{kind:'record_checkpoint',checkpoint},11);
    expect(() => recordAccountAuthorityCommand(journal,{...base,credentials:'DO_NOT_STORE'} as AccountAuthorityCommand)).toThrow('fields_invalid');
    expect(() => recordAccountAuthorityCommand(journal,{...base,action:{kind:'record_checkpoint',checkpoint:{...checkpoint,claimIds:[...checkpoint.claimIds,...checkpoint.claimIds]}}})).toThrow('claim_references_invalid');
    expect(() => recordAccountAuthorityCommand(journal,{...base,atMs:Number.NaN})).toThrow('time_invalid');
    expect(getAccountAuthorityHead(journal,scopeId)).toEqual(acquired);
  }));

  it.each(['scopes','events','commands','heads'])('rolls back scope, event, command and head when the %s write fails', table => fixture(journal => {
    const request = command('enroll',null,{kind:'record_scope',accountIdentityHash});
    journal.database.exec(`CREATE TRIGGER fail_write BEFORE INSERT ON account_authority_${table}_v1 BEGIN SELECT RAISE(ABORT,'injected_failure'); END;`);
    expect(() => recordAccountAuthorityCommand(journal,request)).toThrow('injected_failure');
    for (const name of ['scopes','events','commands','heads']) expect(journal.database.prepare(`SELECT count(*) n FROM account_authority_${name}_v1`).get()?.['n']).toBe(0);
    journal.database.exec('DROP TRIGGER fail_write');
    expect(recordAccountAuthorityCommand(journal,request).sequence).toBe(1);
  }));

  it('rolls back an existing-head update failure and retains the original result', () => fixture(journal => {
    const opening = enroll(journal);
    journal.database.exec("CREATE TRIGGER fail_head BEFORE UPDATE ON account_authority_heads_v1 BEGIN SELECT RAISE(ABORT,'injected_failure'); END;");
    const request = command('acquire',opening,{kind:'acquire_preparation',durationMs:100});
    expect(() => recordAccountAuthorityCommand(journal,request)).toThrow('injected_failure');
    expect(getAccountAuthorityHead(journal,scopeId)).toEqual(opening);
    expect(journal.database.prepare('SELECT count(*) n FROM account_authority_commands_v1').get()?.['n']).toBe(1);
    journal.database.exec('DROP TRIGGER fail_head');
    expect(recordAccountAuthorityCommand(journal,request).generation).toBe(1);
  }));

  it('makes scope, event, command and registry evidence immutable and rejects a different registry', () => fixture((journal,directory) => {
    enroll(journal);
    for (const table of ['meta','scopes','events','commands']) for (const action of ['DELETE FROM','UPDATE']) {
      const sql = action === 'UPDATE' ? `UPDATE account_authority_${table}_v1 SET ${table === 'meta'?'registry_id':table === 'scopes'?'scope_id':'id'}='${'0'.repeat(64)}'` : `DELETE FROM account_authority_${table}_v1`;
      expect(() => journal.database.exec(sql)).toThrow('immutable');
    }
    expect(() => openAccountAuthorityJournal(join(directory,'authority.sqlite'),sha256Hex('other-registry'))).toThrow('registry_mismatch');
  }));

  it('never migrates or overwrites a profile, missing file or unsupported journal', () => fixture((journal,directory) => {
    const profilePath = join(directory,'profile.sqlite'), profile = openDatabase(profilePath,{skipMigrations:true});
    profile.exec("PRAGMA user_version=95; CREATE TABLE profile_sentinel(value TEXT); INSERT INTO profile_sentinel VALUES('preserve');");
    profile.close();
    const before = readFileSync(profilePath);
    expect(() => openAccountAuthorityJournal(profilePath,registryId)).toThrow('wrong_database');
    expect(() => createAccountAuthorityJournal({path:profilePath,registryId,atMs:0})).toThrow();
    expect(readFileSync(profilePath)).toEqual(before);
    expect(() => openAccountAuthorityJournal(join(directory,'missing.sqlite'),registryId)).toThrow();
    expect(() => createAccountAuthorityJournal({path:'relative.sqlite',registryId,atMs:0})).toThrow('explicit_path');
    journal.database.exec('PRAGMA user_version=2');
    expect(() => openAccountAuthorityJournal(join(directory,'authority.sqlite'),registryId)).toThrow('unsupported_format');
  }));

  it('reads without advancing heads, changing facts or interpreting a future head as current evidence', () => fixture(journal => {
    const opening = enroll(journal), port = createAccountCapitalAuthorityReadPort(journal);
    const before = journal.database.prepare('SELECT total_changes() n').get();
    expect(port.read(scopeId,1).reasonCodes).toContain('account_authority_observation_precedes_head');
    expect(port.read(sha256Hex('unknown-scope'),10).reasonCodes).toContain('account_authority_scope_unrecorded');
    expect(getAccountAuthorityHead(journal,scopeId)).toEqual(opening);
    expect(journal.database.prepare('SELECT total_changes() n').get()).toEqual(before);
  }));

  it('returns an unavailable read without exposing database errors or creating a fresh scope on corruption', () => fixture(journal => {
    enroll(journal);
    journal.database.exec('DELETE FROM account_authority_heads_v1');
    const view = createAccountCapitalAuthorityReadPort(journal).read(scopeId,11);
    expect(view).toMatchObject({head:null,state:'unavailable',executionPermitted:false,financialClaimsFunded:false});
    expect(view.reasonCodes).toContain('account_authority_journal_unreadable');
    expect(view.reasonCodes).not.toContain('account_authority_scope_unrecorded');
    expect(() => recordAccountAuthorityCommand(journal,command('fresh',null,{kind:'record_scope',accountIdentityHash}))).toThrow('integrity_failed');
    expect(journal.database.prepare('SELECT count(*) n FROM account_authority_events_v1').get()?.['n']).toBe(1);
  }));

  it('permits only one winner at a shared revision under either profile ordering, and never an execution permit', () => {
    fc.assert(fc.property(fc.boolean(),fc.integer({min:1,max:30_000}), (reverse,durationMs) => fixture((journal,directory,handles) => {
      const other = openAccountAuthorityJournal(join(directory,'authority.sqlite'),registryId); handles.push(other);
      const opening = enroll(journal), profiles = reverse ? ['profile-b','profile-a'] : ['profile-a','profile-b'];
      const first = command('first',opening,{kind:'acquire_preparation',durationMs},10,profiles[0]!);
      const winner = recordAccountAuthorityCommand(journal,first);
      expect(() => recordAccountAuthorityCommand(other,command('second',opening,{kind:'acquire_preparation',durationMs},10,profiles[1]!))).toThrow('stale_head');
      expect(recordAccountAuthorityCommand(other,first)).toEqual(winner);
      expect(createAccountCapitalAuthorityReadPort(other).read(scopeId,10).executionPermitted).toBe(false);
      expect(winner.generation).toBe(1);
    })),{numRuns:30});
  });
});

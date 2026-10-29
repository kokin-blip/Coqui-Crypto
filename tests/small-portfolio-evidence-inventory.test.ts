import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { capitalScopeId, sha256Hex } from '../packages/core/src/index.js';
import { acquireExecutionLease, assignAuthoritativeHost, openDatabase, releaseExecutionLease, saveCapitalScope,
  validateExecutionLease } from '../packages/storage/src/index.js';
const modulePath = '../scripts/inspect-small-portfolio-evidence.mjs';
const { inspectSmallPortfolioEvidence } = await import(modulePath);
describe('installed evidence inventory', () => {
  it('reads a predecessor schema without migration, outcome bodies or secrets', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`PRAGMA user_version=95; CREATE TABLE trial_registry_meta(singleton INTEGER,completeness TEXT); INSERT INTO trial_registry_meta VALUES(1,'known-lower-bound');
        CREATE TABLE prospective_book_revisions_v1(content_json TEXT); INSERT INTO prospective_book_revisions_v1 VALUES('FINAL_DO_NOT_READ');
        CREATE TABLE credentials(secret TEXT); INSERT INTO credentials VALUES('SECRET_DO_NOT_READ');`);
      const queries: string[] = [], tracked = new Proxy(db, { get(target,key) { if(key === 'prepare')return (sql: string) => { queries.push(sql); return target.prepare(sql); }; const value = Reflect.get(target,key); return typeof value === 'function' ? value.bind(target) : value; } });
      const result = inspectSmallPortfolioEvidence(tracked, { profileId:'main', accountNumber:'OWNER_NUMBER', protectedBeforeMs:0, asOfMs:1 });
      expect(result).toMatchObject({schema:95,authorityGranted:false,registry:{completeness:'known-lower-bound'},account:{numberToIdentityVerified:false},
        ownership:{exclusiveAccountOwnershipVerified:false,profileHostTablePresent:false,profileLeaseTablePresent:false,profileHost:null,profileLease:null}});
      expect(queries.join(' ')).not.toMatch(/SELECT.*(?:content_json|secret|FROM prospective_book)/u);
      expect(db.prepare('PRAGMA user_version').get()!['user_version']).toBe(95);
      expect(JSON.stringify(result)).not.toMatch(/FINAL_DO_NOT_READ|SECRET_DO_NOT_READ|OWNER_NUMBER/u);
    } finally { db.close(); }
  });
  it('help requires no build, database or account', () => {
    expect(execFileSync(process.execPath,[resolve('scripts/inspect-small-portfolio-evidence.mjs'),'--help'],{encoding:'utf8'})).toContain('No migration');
  });
  it('does not bridge gaps or inflate warmup with protected dates', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('CREATE TABLE market_bars_v2(source TEXT,asset_id TEXT,interval TEXT,start_time_ms INTEGER,end_time_ms INTEGER,retrieved_at_ms INTEGER,is_complete INTEGER)');
      const insert = db.prepare("INSERT INTO market_bars_v2 VALUES('coinbase',?,'1d',?,?,?,1)");
      for(const day of [0,1,2,4])for(const asset of ['BTC','ETH','LTC'])insert.run(`coinbase|spot|${asset}-USD`,day*86400000,(day+1)*86400000,(day+1)*86400000);
      const result = inspectSmallPortfolioEvidence(db,{profileId:'main',protectedBeforeMs:86400000,asOfMs:6*86400000});
      expect(result.jointDaily).toMatchObject({completeMatchedDates:4,datesAfterProtectedBoundary:3,longestContiguousDatesAfterBoundary:2,seedWarmupReady:false});
    } finally { db.close(); }
  });
  it('does not mistake two valid profile leases for exclusive ownership of the same account', () => {
    const databases = [openDatabase(':memory:'), openDatabase(':memory:')];
    const accountIdentityHash = sha256Hex('synthetic-paper-account');
    const scopeId = capitalScopeId('alpaca', 'paper', accountIdentityHash);
    try {
      for (const [index, db] of databases.entries()) {
        const profileId = `profile-${index}`, hostId = `private-host-${index}`;
        const scope = saveCapitalScope({id:scopeId,provider:'alpaca',environment:'paper',accountIdentityHash,
          currency:'USD',originProfileId:profileId,createdAtMs:1},db);
        expect(scope.id).toBe(scopeId);
        assignAuthoritativeHost(profileId,hostId,'desktop',1,db);
        const lease = acquireExecutionLease(profileId,hostId,2,1000,db)!;
        expect(validateExecutionLease(profileId,hostId,lease.fencingToken,3,db)).toBe(true);
        const before = db.prepare('SELECT total_changes() n').get();
        const result = inspectSmallPortfolioEvidence(db,{profileId,protectedBeforeMs:0,asOfMs:3});
        expect(result.ownership).toMatchObject({exclusiveAccountOwnershipVerified:false,
          accountWideProof:'not_verified_by_this_inventory',profileHost:{status:'active'},profileLease:{timeStatus:'unexpired'}});
        expect(result.phaseBlockers.P6_H).toContain('exclusive_account_wide_fencing_and_claims_unverified');
        expect(JSON.stringify(result)).not.toContain(hostId);
        expect(result.authorityGranted).toBe(false);
        expect(db.prepare('SELECT total_changes() n').get()).toEqual(before);
      }
    } finally { databases.forEach(db => db.close()); }
  });
  it('distinguishes absent rows, expired leases, releases and future metadata without granting authority', () => {
    const db = openDatabase(':memory:');
    try {
      const inspect = (asOfMs: number) => inspectSmallPortfolioEvidence(db,{profileId:'main',protectedBeforeMs:0,asOfMs});
      expect(inspect(10).ownership).toMatchObject({profileHostTablePresent:true,profileLeaseTablePresent:true,profileHost:null,profileLease:null});
      assignAuthoritativeHost('main','private-host','desktop',10,db);
      const lease = acquireExecutionLease('main','private-host',10,5,db)!;
      expect(inspect(15).ownership).toMatchObject({exclusiveAccountOwnershipVerified:false,profileLease:{timeStatus:'expired'}});
      expect(inspect(9).ownership).toMatchObject({profileHost:{recordedAfterAsOf:true},profileLease:{timeStatus:'recorded_after_as_of'}});
      releaseExecutionLease('main','private-host',lease.fencingToken,16,db);
      expect(inspect(16).ownership).toMatchObject({exclusiveAccountOwnershipVerified:false,profileLease:{timeStatus:'released',ownerIdentityHash:null}});
    } finally { db.close(); }
  });
  it('the standalone v2 CLI leaves an explicit predecessor copy byte-for-byte unchanged', () => {
    const directory = mkdtempSync(join(tmpdir(),'coqui-ownership-inventory-'));
    try {
      const path = join(directory,'copy.sqlite'), db = new DatabaseSync(path);
      try { db.exec('PRAGMA user_version=95; CREATE TABLE credentials(secret TEXT); INSERT INTO credentials VALUES(\'SECRET_DO_NOT_READ\')'); }
      finally { db.close(); }
      const before = readFileSync(path);
      const result = JSON.parse(execFileSync(process.execPath,[resolve('scripts/inspect-small-portfolio-evidence.mjs'),
        `--database=${path}`,'--profile-id=main','--protected-before=2026-01-01T00:00:00Z'],{encoding:'utf8'})) as Record<string,unknown>;
      expect(result).toMatchObject({version:'small-portfolio-evidence-inventory-v2',schema:95,authorityGranted:false,
        ownership:{exclusiveAccountOwnershipVerified:false,profileHost:null,profileLease:null}});
      expect(JSON.stringify(result)).not.toContain('SECRET_DO_NOT_READ');
      expect(readFileSync(path)).toEqual(before);
    } finally { rmSync(directory,{recursive:true,force:true}); }
  });
});

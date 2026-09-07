import { canonicalJson, sha256Hex, type CanonicalJsonValue } from '@coqui/core';

import { inTransaction, type Db } from '../sqlite/index.js';

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
export type LocalHostKind = 'desktop' | 'headless';
export interface AuthoritativeHost {
  readonly profileId: string; readonly hostId: string | null; readonly hostKind: LocalHostKind | null;
  readonly fencingGeneration: number; readonly status: 'active' | 'relinquished';
  readonly assignedAt: number; readonly heartbeatAt: number | null; readonly reconciliationId: string | null;
}

function valid(profileId: string, hostId: string, at: number): void {
  if (!ID.test(profileId) || !ID.test(hostId) || !Number.isSafeInteger(at) || at < 0) {
    throw new TypeError('Invalid local host authority input.');
  }
}

export function getAuthoritativeHost(profileId: string, database: Db): AuthoritativeHost | null {
  const row = database.prepare('SELECT * FROM authoritative_hosts_v1 WHERE profile_id=?').get(profileId) as Record<string, unknown> | undefined;
  return row === undefined ? null : Object.freeze({ profileId: String(row['profile_id']),
    hostId: row['host_id'] === null ? null : String(row['host_id']),
    hostKind: row['host_kind'] as LocalHostKind | null, fencingGeneration: Number(row['fencing_generation']),
    status: row['status'] as AuthoritativeHost['status'], assignedAt: Number(row['assigned_at']),
    heartbeatAt: row['heartbeat_at'] === null ? null : Number(row['heartbeat_at']),
    reconciliationId: row['reconciliation_id'] === null ? null : String(row['reconciliation_id']) });
}

function history(profileId: string, priorHostId: string | null, nextHostId: string | null,
  action: 'assigned'|'takeover'|'relinquished', generation: number, reconciliationId: string | null,
  at: number, database: Db): void {
  const id = sha256Hex(['host-authority-v1', profileId, priorHostId ?? '', nextHostId ?? '', action,
    String(generation), reconciliationId ?? '', String(at)].join(':'));
  database.prepare(`INSERT INTO host_takeover_history_v1
    (id,profile_id,prior_host_id,next_host_id,action,fencing_generation,reconciliation_id,at)
    VALUES (?,?,?,?,?,?,?,?)`).run(id,profileId,priorHostId,nextHostId,action,generation,reconciliationId,at);
}

export function assignAuthoritativeHost(profileId: string, hostId: string, hostKind: LocalHostKind,
  at: number, database: Db): AuthoritativeHost {
  valid(profileId,hostId,at);
  return inTransaction(database, () => {
    const current = getAuthoritativeHost(profileId,database);
    if (current?.status === 'active') {
      if (current.hostId === hostId && current.hostKind === hostKind) return current;
      throw new Error('authoritative_host_takeover_required');
    }
    const generation = (current?.fencingGeneration ?? 0)+1;
    invalidateExecutionLease(profileId,at,database);
    database.prepare(`INSERT INTO authoritative_hosts_v1
      (profile_id,host_id,host_kind,fencing_generation,status,assigned_at,heartbeat_at,reconciliation_id)
      VALUES (?,?,?,?, 'active',?,NULL,NULL) ON CONFLICT(profile_id) DO UPDATE SET
      host_id=excluded.host_id,host_kind=excluded.host_kind,fencing_generation=excluded.fencing_generation,
      status='active',assigned_at=excluded.assigned_at,heartbeat_at=NULL,reconciliation_id=NULL`)
      .run(profileId,hostId,hostKind,generation,at);
    history(profileId,null,hostId,'assigned',generation,null,at,database);
    return getAuthoritativeHost(profileId,database)!;
  });
}

export function recordHostReconciliation(input: { readonly profileId: string; readonly hostId: string;
  readonly observedGeneration: number; readonly at: number; readonly detail: CanonicalJsonValue }, database: Db): string {
  valid(input.profileId,input.hostId,input.at);
  if (!Number.isSafeInteger(input.observedGeneration) || input.observedGeneration < 0) throw new TypeError('Invalid host generation.');
  const detailJson=canonicalJson(input.detail), detailHash=sha256Hex(detailJson);
  const id=sha256Hex(['host-reconciliation-v1',input.profileId,input.hostId,String(input.observedGeneration),
    String(input.at),detailHash].join(':'));
  database.prepare(`INSERT INTO host_reconciliation_evidence_v1
    (id,profile_id,host_id,observed_generation,at,detail_json,detail_hash) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(id) DO NOTHING`).run(id,input.profileId,input.hostId,input.observedGeneration,input.at,detailJson,detailHash);
  return id;
}

function invalidateExecutionLease(profileId: string, at: number, database: Db): void {
  const lease=database.prepare('SELECT owner_id,fencing_token FROM execution_leases_v1 WHERE profile_id=?')
    .get(profileId) as { owner_id: string|null; fencing_token: number }|undefined;
  if (lease === undefined) return;
  if (lease.owner_id !== null) {
    const eventId=sha256Hex(`execution-lease:${profileId}:${lease.owner_id}:${lease.fencing_token}:lost:${at}`);
    database.prepare(`INSERT INTO execution_lease_events_v1
      (id,profile_id,owner_id,fencing_token,kind,at,detail_json) VALUES (?,?,?,?, 'lost',?,?)
      ON CONFLICT(id) DO NOTHING`).run(eventId,profileId,lease.owner_id,lease.fencing_token,at,
        canonicalJson({reason:'host_authority_changed'}));
  }
  database.prepare(`UPDATE execution_leases_v1 SET owner_id=NULL,leased_until=NULL,
    fencing_token=fencing_token+1,updated_at=? WHERE profile_id=?`).run(at,profileId);
}

export function takeoverAuthoritativeHost(input: { readonly profileId: string; readonly hostId: string;
  readonly hostKind: LocalHostKind; readonly reconciliationId: string; readonly at: number }, database: Db): AuthoritativeHost {
  valid(input.profileId,input.hostId,input.at);
  return inTransaction(database, () => {
    const current=getAuthoritativeHost(input.profileId,database);
    if (current === null || current.status !== 'active') throw new Error('authoritative_host_assignment_required');
    if (current.hostId === input.hostId) return current;
    const evidence=database.prepare(`SELECT profile_id,host_id,observed_generation,at FROM host_reconciliation_evidence_v1
      WHERE id=?`).get(input.reconciliationId) as { profile_id:string;host_id:string;observed_generation:number;at:number }|undefined;
    if (evidence === undefined || evidence.profile_id !== input.profileId || evidence.host_id !== input.hostId ||
        evidence.observed_generation !== current.fencingGeneration || evidence.at > input.at) throw new Error('takeover_reconciliation_required');
    const generation=current.fencingGeneration+1;
    invalidateExecutionLease(input.profileId,input.at,database);
    database.prepare(`UPDATE authoritative_hosts_v1 SET host_id=?,host_kind=?,fencing_generation=?,status='active',
      assigned_at=?,heartbeat_at=NULL,reconciliation_id=? WHERE profile_id=?`)
      .run(input.hostId,input.hostKind,generation,input.at,input.reconciliationId,input.profileId);
    history(input.profileId,current.hostId,input.hostId,'takeover',generation,input.reconciliationId,input.at,database);
    return getAuthoritativeHost(input.profileId,database)!;
  });
}

export function relinquishAuthoritativeHost(profileId: string, hostId: string, generation: number,
  at: number, database: Db): AuthoritativeHost {
  valid(profileId,hostId,at);
  return inTransaction(database, () => {
    const current=getAuthoritativeHost(profileId,database);
    if (current?.hostId !== hostId || current.fencingGeneration !== generation) throw new Error('stale_host_authority');
    const nextGeneration=generation+1;
    invalidateExecutionLease(profileId,at,database);
    database.prepare(`UPDATE authoritative_hosts_v1 SET host_id=NULL,host_kind=NULL,fencing_generation=?,
      status='relinquished',assigned_at=?,heartbeat_at=NULL,reconciliation_id=NULL WHERE profile_id=?`)
      .run(nextGeneration,at,profileId);
    history(profileId,hostId,null,'relinquished',nextGeneration,null,at,database);
    return getAuthoritativeHost(profileId,database)!;
  });
}

export function heartbeatAuthoritativeHost(profileId: string, hostId: string, generation: number,
  at: number, database: Db): boolean {
  valid(profileId,hostId,at);
  return Number(database.prepare(`UPDATE authoritative_hosts_v1 SET heartbeat_at=? WHERE profile_id=? AND
    host_id=? AND fencing_generation=? AND status='active'`).run(at,profileId,hostId,generation).changes)===1;
}

/** No assignment preserves the desktop-only behavior; an assignment fences every other host. */
export function isAuthoritativeHost(profileId: string, hostId: string, database: Db): boolean {
  const current=getAuthoritativeHost(profileId,database);
  return current === null || current.status === 'relinquished' || current.hostId === hostId;
}

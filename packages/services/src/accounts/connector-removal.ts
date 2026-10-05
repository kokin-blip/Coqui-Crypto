import { parseStoredCoinbaseCredentials, readConnectionSecret, removeConnectionSecret, type SecretStore } from '@coqui/adapters';
import { sha256Hex, type Clock } from '@coqui/core';
import {
  connectionRemoval, getLatestConnectionAccountSnapshotV2, getLegacyProfileConnectionId,
  getCurrentUnifiedPortfolioSnapshotV2, getProfileConnectionV2, latestParallelExperiment,
  listParallelEvents, parallelExperimentStatus, saveProfileConnectionV2, setConnectionRemoval,
  type Db, type ProfileManifestStore,
} from '@coqui/storage';

function failure(code: string) { return { ok:false as const, issues:[{path:[],code}] }; }

export function connectorRemovalPreview(profileId: string, connectionId: string, now: number, db: Db, busy = false) {
  const connection = getProfileConnectionV2(profileId,connectionId,db);
  if (connection === null) return null;
  const snapshot = getLatestConnectionAccountSnapshotV2(profileId,connectionId,db);
  const blockers: string[] = [];
  const exists = (sql: string): boolean => db.prepare(sql).get(profileId) !== undefined;
  if (busy) blockers.push('connection_operation_in_progress');
  if (db.prepare('SELECT 1 FROM wallet_schedule_lease WHERE profile_id=? AND leased_until>?').get(profileId,now) ||
    db.prepare('SELECT 1 FROM execution_leases_v1 WHERE profile_id=? AND leased_until>?').get(profileId,now)) blockers.push('execution_in_progress');
  // These legacy executions do not always record an account. Fail closed at profile scope.
  if (exists("SELECT 1 FROM paper_pending_executions_v1 WHERE profile_id=? AND status='submitted' LIMIT 1") ||
    exists("SELECT 1 FROM paper_execution_proposals_v1 WHERE profile_id=? AND status IN ('approved','executing','unknown') LIMIT 1")) blockers.push('pending_or_unknown_execution');
  const exploratory = db.prepare(`SELECT state.status, campaign.source_portfolio_snapshot_id AS source
    FROM exploratory_paper_campaign_state_v1 state JOIN exploratory_paper_campaigns_v1 campaign
    ON campaign.campaign_id=state.campaign_id AND campaign.profile_id=state.profile_id
    WHERE state.profile_id=? AND state.status IN ('active','stopping')`).get(profileId) as {status:string;source:string}|undefined;
  if (exploratory && db.prepare(`SELECT 1 FROM unified_portfolio_snapshot_sources_v2 sources
    JOIN connection_account_snapshots_v2 snapshot ON snapshot.id=sources.connection_snapshot_id
    WHERE sources.unified_snapshot_id=? AND snapshot.connection_id=? AND snapshot.profile_id=?`)
    .get(exploratory.source,connectionId,profileId)) blockers.push('active_exploratory_campaign');
  const parallel = latestParallelExperiment(profileId,db);
  if (parallel && parallelExperimentStatus(listParallelEvents(parallel.id,profileId,db)) === 'active' &&
    db.prepare('SELECT 1 FROM connection_account_snapshots_v2 WHERE profile_id=? AND id=? AND connection_id=?')
      .get(profileId,parallel.sourceConnectionSnapshotId,connectionId)) blockers.push('active_parallel_experiment');
  const removal = connectionRemoval(profileId,connectionId,db);
  const retainedSnapshots = Number((db.prepare('SELECT COUNT(*) AS count FROM connection_account_snapshots_v2 WHERE profile_id=? AND connection_id=?')
    .get(profileId,connectionId) as {count:number}).count);
  const affectedBalances = snapshot?.balances.map(b=>({asset:b.exposureKey,quantity:b.totalQuantity})) ?? [];
  const material = {profileId,connectionId,label:connection.label,provider:connection.provider,status:connection.status,
    updatedAtMs:connection.updatedAtMs,snapshotId:snapshot?.id??null,retainedSnapshots,affectedBalances,blockers,
    removalState:removal?.state??null};
  return {...material,revision:sha256Hex(JSON.stringify(material)),eligible:blockers.length===0,historyPreserved:true as const};
}

export class ConnectorRemovalService {
  constructor(private readonly input: {profileId:string;database:Db;clock:Clock;secrets?:SecretStore;manifestStore?:ProfileManifestStore}) {}

  async remove(connectionId: string, commandId: string, revision: string, confirmed: boolean, retire = true) {
    const {profileId,database:db,clock,secrets,manifestStore}=this.input;
    const connection=getProfileConnectionV2(profileId,connectionId,db);
    if(connection===null)return failure('connection_not_found');
    if(retire&&connection.provider!=='coinbase')return failure('removal_provider_unsupported');
    const prior=connectionRemoval(profileId,connectionId,db);
    if(retire&&prior?.state==='removed')return {ok:true as const,value:{connectionId,outcome:'removed' as const,historyPreserved:true as const}};
    if(!confirmed)return failure('confirmation_required');
    const preview=connectorRemovalPreview(profileId,connectionId,clock.nowMs(),db)!;
    if(preview.blockers.length)return failure('connection_in_use');
    if(preview.revision!==revision)return failure('removal_preview_stale');
    if(secrets===undefined)return failure('secret_store_unavailable');
    // Publish ineligibility before touching the external secret store. A crash fails closed.
    setConnectionRemoval(connection,commandId,'pending',clock.nowMs(),db);
    try {
    const ref={profileId,connectionId,provider:connection.provider,credentialType:'api_credentials' as const,schemaVersion:2 as const};
    const target=await readConnectionSecret(secrets,ref);
    if(!target.ok)return failure('removal_recovery_required');
    const removed=await removeConnectionSecret(secrets,ref);
    if(!removed.ok)return failure('removal_recovery_required');
    if(connection.provider==='coinbase') {
      const legacyId=getLegacyProfileConnectionId(profileId,connectionId,db);
      if(legacyId!==null){
        const legacyRemoved=await removeConnectionSecret(secrets,{profileId,connectionId:legacyId,provider:'coinbase',credentialType:'api_credentials'});
        if(!legacyRemoved.ok)return failure('removal_recovery_required');
      }
      const legacy=await secrets.read('coinbase-credentials',profileId);
      if(!legacy.ok)return failure('removal_recovery_required');
      const parsed=legacy.value===null?null:parseStoredCoinbaseCredentials(legacy.value);
      if(parsed!==null&&sha256Hex(parsed.keyName)===connection.credentialFingerprint){
        if(!(await secrets.remove('coinbase-credentials',profileId)).ok)return failure('removal_recovery_required');
      }
      if(manifestStore){
        const loaded=manifestStore.read();
        if(!loaded.ok||loaded.value===null)return failure('removal_recovery_required');
        const record=loaded.value.manifest.profiles.find(p=>p.id===profileId);
        if(record?.coinbaseKeyFingerprint===connection.credentialFingerprint){
          const updated={...record};delete updated.coinbaseKeyFingerprint;delete updated.coinbasePortfolioFingerprint;
          const saved=manifestStore.replace(loaded.value.revision,{...loaded.value.manifest,
            profiles:loaded.value.manifest.profiles.map(p=>p.id===profileId?updated:p)});
          if(!saved.ok)return failure('removal_recovery_required');
        }
      }
    }
    saveProfileConnectionV2({...connection,status:'disconnected',updatedAtMs:clock.nowMs()},db);
    setConnectionRemoval(connection,commandId,retire?'removed':'reactivated',clock.nowMs(),db);
    getCurrentUnifiedPortfolioSnapshotV2(profileId,db);
    return {ok:true as const,value:{connectionId,outcome:retire?'removed' as const:'disconnected' as const,historyPreserved:true as const}};
    } catch { return failure('removal_recovery_required'); }
  }
}

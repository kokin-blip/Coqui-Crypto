import {DatabaseSync} from 'node:sqlite';
import {readFileSync,realpathSync,writeFileSync,statSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

/** Schema-tolerant metadata inventory. Never selects market prices, final bodies, credentials,
 * account balances or algorithm P&L. A missing table/claim is not proof of fresh data.
 */
export function inspectSmallPortfolioEvidence(db,{profileId,accountNumber,protectedBeforeMs,asOfMs}) {
  if(!profileId||!Number.isSafeInteger(protectedBeforeMs)||!Number.isSafeInteger(asOfMs))throw new Error('evidence_scope_required');
  const hash=v=>createHash('sha256').update(v).digest('hex');
  const tables=new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(r=>r.name));
  const count=name=>tables.has(name)?Number(db.prepare(`SELECT count(*) n FROM ${name}`).get().n):null;
  const schema=Number(db.prepare('PRAGMA user_version').get().user_version);
  const output={version:'small-portfolio-evidence-inventory-v2',asOfMs,schema,profileId,sourceClass:'installed_exposed_development_and_operations',
    account:{ownerRequestedNumberHash:accountNumber?hash(accountNumber):null,installedAccountIdentityHashes:[],numberToIdentityVerified:false},
    ownership:{exclusiveAccountOwnershipVerified:false,accountWideProof:'not_verified_by_this_inventory',
      profileHostTablePresent:tables.has('authoritative_hosts_v1'),profileLeaseTablePresent:tables.has('execution_leases_v1'),
      profileHost:null,profileLease:null},
    market:[],jointDaily:null,algorithm:[],latestPause:null,registry:null,phaseBlockers:{P5_H:[],P6_G:[],P6_H:[],P7_H:[],P7_I:[],P7_J:[]},
    reads:{marketPrices:false,finalBodies:false,credentials:false,accountBalances:false},authorityGranted:false};
  // These mutable rows describe this database/profile only. Their timestamps are not historical
  // reconstruction, and even a current profile lease cannot prove account-wide exclusion.
  if(output.ownership.profileHostTablePresent) {
    const row=db.prepare('SELECT host_id,status,assigned_at,heartbeat_at FROM authoritative_hosts_v1 WHERE profile_id=?').get(profileId);
    if(row)output.ownership.profileHost={hostIdentityHash:row.host_id===null?null:hash(String(row.host_id)),
      status:row.status,assignedAtMs:row.assigned_at,heartbeatAtMs:row.heartbeat_at,
      recordedAfterAsOf:row.assigned_at>asOfMs||(row.heartbeat_at!==null&&row.heartbeat_at>asOfMs)};
  }
  if(output.ownership.profileLeaseTablePresent) {
    const row=db.prepare('SELECT owner_id,leased_until,updated_at FROM execution_leases_v1 WHERE profile_id=?').get(profileId);
    if(row)output.ownership.profileLease={ownerIdentityHash:row.owner_id===null?null:hash(String(row.owner_id)),
      leasedUntilMs:row.leased_until,updatedAtMs:row.updated_at,
      timeStatus:row.updated_at>asOfMs?'recorded_after_as_of':row.owner_id===null||row.leased_until===null?'released':row.leased_until>asOfMs?'unexpired':'expired'};
  }
  if(tables.has('parallel_paper_experiments_v1')) {
    const rows=db.prepare('SELECT DISTINCT alpaca_account_id FROM parallel_paper_experiments_v1 WHERE profile_id=? LIMIT 101').all(profileId);
    if(rows.length>100)throw new Error('evidence_account_bound');
    output.account.installedAccountIdentityHashes=rows.map(r=>hash(String(r.alpaca_account_id))).sort();
    // The installed UUID is not the owner-supplied display number. Do not guess the mapping.
  }
  if(tables.has('market_bars_v2')) {
    output.market=db.prepare(`SELECT source,asset_id,interval,count(*) rows,min(start_time_ms) firstMs,max(end_time_ms) lastMs,
      min(retrieved_at_ms) firstAcquiredMs,max(retrieved_at_ms) lastAcquiredMs,
      sum(CASE WHEN is_complete=1 THEN 1 ELSE 0 END) completeRows FROM market_bars_v2
      GROUP BY source,asset_id,interval ORDER BY source,asset_id,interval LIMIT 101`).all();
    if(output.market.length>100)throw new Error('evidence_market_bound');
    const assets=['coinbase|spot|BTC-USD','coinbase|spot|ETH-USD','coinbase|spot|LTC-USD'];
    const rows=db.prepare(`SELECT start_time_ms startMs,end_time_ms endMs,count(DISTINCT asset_id) assets
      FROM market_bars_v2 WHERE source='coinbase' AND interval='1d' AND is_complete=1 AND end_time_ms<=? AND retrieved_at_ms<=?
      AND asset_id IN (?,?,?) GROUP BY start_time_ms,end_time_ms HAVING count(DISTINCT asset_id)=3 ORDER BY start_time_ms LIMIT 5001`).all(asOfMs,asOfMs,...assets);
    if(rows.length>5000)throw new Error('evidence_calendar_bound');
    const allowed=rows.filter(r=>r.startMs>=protectedBeforeMs);
    let longest=0,current=0,last=null;
    for(const r of allowed){current=last!==null&&r.startMs===last+86400000?current+1:1;longest=Math.max(longest,current);last=r.startMs;}
    output.jointDaily={assets,completeMatchedDates:rows.length,protectedBeforeMs,datesAfterProtectedBoundary:allowed.length,
      longestContiguousDatesAfterBoundary:longest,firstAfterBoundaryMs:allowed[0]?.startMs??null,lastAfterBoundaryMs:allowed.at(-1)?.endMs??null,
      requiredSeedWarmupDays:120,seedWarmupReady:longest>=120,membershipVerified:false,nativeHistoryVerified:false,rightsVerified:false};
  }
  if(tables.has('parallel_paper_events_v1')) {
    // Explicit operational classes only. Research observations/registrations/final payloads are excluded.
    const kinds=['external_intent','external_order','external_fill','external_fee','submission_rejected','reconciliation_error','broker_position_snapshot','paused','resumed','runtime_build','local_settled'];
    output.algorithm=db.prepare(`SELECT kind,count(*) rows,min(at) firstAtMs,max(at) lastAtMs FROM parallel_paper_events_v1 WHERE profile_id=?
      AND kind IN (${kinds.map(()=>'?').join(',')}) GROUP BY kind ORDER BY kind`).all(profileId,...kinds);
    output.latestPause=db.prepare(`SELECT at atMs,json_extract(detail_json,'$.reason') reason,json_extract(detail_json,'$.manualResumeRequired') manualResumeRequired
      FROM parallel_paper_events_v1 WHERE profile_id=? AND kind='paused' ORDER BY at DESC LIMIT 1`).get(profileId)??null;
  }
  output.registry={completeness:tables.has('trial_registry_meta')?db.prepare('SELECT completeness FROM trial_registry_meta WHERE singleton=1').get()?.completeness??'unknown':'unknown',
    localIntegrityEvents:count('research_integrity_events'),legacyRegistrations:count('research_preregistrations'),prospectiveRegistrations:count('prospective_registrations_v1'),
    authoritativeCustodyVerified:false};
  output.phaseBlockers.P5_H=['permitted_physical_panel_and_manifest_required','original_global_trial_and_consumption_inventory_required','rights_membership_native_cost_evidence_required',
    ...(output.jointDaily?.seedWarmupReady?[]:['insufficient_unprotected_history_for_120_day_seed'])];
  output.phaseBlockers.P6_G=['cash_only_capability_review_and_sale_objective_required','exact_strategy_qualification_required','settled_financial_evidence_required'];
  output.phaseBlockers.P6_H=['account_number_uuid_mapping_unverified','exact_integrated_recovery_source_review_required','exclusive_account_wide_fencing_and_claims_unverified','intended_host_and_current_account_evidence_required'];
  if(schema<99)output.phaseBlockers.P6_H.push('installed_schema_predates_p6_no_enrollment');
  output.phaseBlockers.P7_H=['p5_h_development_or_separately_reviewed_design_required','owner_independent_reviewer_and_registry_custody_required','approved_future_dates_power_protocol_and_resources_required'];
  output.phaseBlockers.P7_I=['approved_registration_and_explicit_collector_required','genuine_elapsed_evidence_required'];
  output.phaseBlockers.P7_J=['timely_candidate_or_none_freeze_required','untouched_elapsed_final_and_claim_once_required','independent_exact_configuration_review_required'];
  return output;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const args=process.argv.slice(2),option=name=>args.find(x=>x.startsWith(`--${name}=`))?.slice(name.length+3);
  if(args.includes('--help')||!args.length){console.log('Read-only small-portfolio evidence inventory. --database=existing-consistent-copy --profile-id=ID --protected-before=UTC-ISO [--account-number=owner-display-number] [--output=new-file]. No migration, provider calls, final bodies, registration or execution.');process.exit(0);}
  for(const key of ['database','profile-id','protected-before'])if(!option(key))throw new Error(`Explicit ${key} required`);
  const path=realpathSync(option('database'));if(!statSync(path).isFile())throw new Error('evidence_existing_database_required');
  const hasWalData=()=>existsSync(`${path}-wal`)&&statSync(`${path}-wal`).size>0;
  if(hasWalData())throw new Error('evidence_consistent_copy_without_wal_required');
  const sourceHash=createHash('sha256').update(readFileSync(path)).digest('hex'),db=new DatabaseSync(path,{readOnly:true,allowExtension:false});
  try{db.exec('PRAGMA query_only=ON; BEGIN');const report=inspectSmallPortfolioEvidence(db,{profileId:option('profile-id'),accountNumber:option('account-number'),protectedBeforeMs:Date.parse(option('protected-before')),asOfMs:Date.now()});
    db.exec('COMMIT');if(hasWalData()||createHash('sha256').update(readFileSync(path)).digest('hex')!==sourceHash)throw new Error('evidence_database_changed_during_inspection');
    const text=JSON.stringify({...report,databaseHash:sourceHash},null,2)+'\n';
    if(option('output'))writeFileSync(option('output'),text,{flag:'wx'});else process.stdout.write(text);
  }finally{db.close();}
}

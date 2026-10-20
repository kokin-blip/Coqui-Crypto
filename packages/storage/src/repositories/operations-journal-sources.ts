/** Each branch selects allowlisted facts; no raw source payload crosses this projection. */
export const OPERATIONS_JOURNAL_SQL = `WITH scope AS (SELECT ? AS profile), raw_journal AS (
  SELECT id,work_id,attempt_id,worker,source,phase,status,at_ms,deadline_at_ms,'profile' AS scope,
    facts_json,content_hash FROM operations_activity_events_v1 WHERE profile_id=(SELECT profile FROM scope)
  UNION ALL
  SELECT 'decision:'||d.decision_id,'decision:'||d.decision_id,d.run_id,'market',
    CASE WHEN EXISTS(SELECT 1 FROM exploratory_paper_execution_links_v1 l WHERE l.decision_id=d.decision_id AND l.profile_id=d.profile_id)
      THEN 'exploratory' ELSE 'paper_ledger' END,'dataset_checked',
    CASE WHEN json_extract(d.content_json,'$.market.freshness')='fresh' THEN 'completed' ELSE 'blocked' END,
    d.created_at,NULL,'profile',json_object('decisionId',d.decision_id,'runId',d.run_id,'strategy',d.strategy_version,
      'freshness',json_extract(d.content_json,'$.market.freshness'),
      'marketAsOfMs',json_extract(d.content_json,'$.market.asOfMs'),
      'volatilityPct',json_extract(d.content_json,'$.facts.realizedVolPct'),
      'instruments',(SELECT group_concat(asset_scope,', ') FROM decision_asset_links_v1 a
        WHERE a.decision_id=d.decision_id AND a.profile_id=d.profile_id AND asset_scope<>'GLOBAL')),
    d.content_hash FROM strategy_decisions_v1 d WHERE d.profile_id=(SELECT profile FROM scope)
  UNION ALL
  SELECT 'evidence:'||e.id,'decision:'||e.decision_id,e.decision_id,
    CASE WHEN e.kind='risk_evaluated' THEN 'risk' WHEN e.kind IN('no_trade','stand_down') THEN 'host' ELSE 'execution' END,
    CASE WHEN EXISTS(SELECT 1 FROM exploratory_paper_execution_links_v1 l WHERE l.decision_id=e.decision_id AND l.profile_id=e.profile_id)
      THEN 'exploratory' ELSE 'paper_ledger' END,e.kind,
    CASE WHEN e.kind='risk_evaluated' THEN CASE WHEN json_extract(e.payload_json,'$.detail.approved')=1 THEN 'completed' ELSE 'blocked' END
      WHEN e.kind IN('stand_down','execution_refused') THEN 'blocked'
      WHEN e.kind='execution_submitted' THEN 'waiting' ELSE 'completed' END,
    e.at,NULL,'profile',json_object('decisionId',e.decision_id,'sequence',json_extract(e.payload_json,'$.sequence'),
      'reasonCode',coalesce(e.reason_code,json_extract(e.payload_json,'$.detail.reasonCodes[0]')),
      'proposalId',json_extract(e.payload_json,'$.detail.proposalId'),
      'filledCount',json_extract(e.payload_json,'$.detail.filledCount'),
      'orderId',json_extract(e.payload_json,'$.detail.orderId'),
      'instruments',(SELECT group_concat(asset_scope,', ') FROM decision_asset_links_v1 a
        WHERE a.decision_id=e.decision_id AND a.profile_id=e.profile_id AND asset_scope<>'GLOBAL')),
    e.payload_hash FROM decision_evidence_events_v1 e
    WHERE e.profile_id=(SELECT profile FROM scope) AND e.kind<>'strategy_evaluated'
  UNION ALL
  SELECT 'wallet-run:'||w.id,'run:'||w.id,w.id,'host','paper_ledger','evaluation',
    CASE w.status WHEN 'completed' THEN 'completed' WHEN 'failed' THEN 'failed' ELSE 'unknown' END,
    w.updated_at,NULL,'profile',json_object('runId',w.id,'strategy',w.strategy_version),w.snapshot_hash
    FROM wallet_decision_runs w WHERE w.profile_id=(SELECT profile FROM scope)
      AND NOT EXISTS(SELECT 1 FROM wallet_decision_links_v1 l WHERE l.run_id=w.id)
  UNION ALL
  SELECT 'research-event:'||e.id,'research:'||e.job_id,coalesce(json_extract(e.detail_json,'$.attemptId'),e.job_id),
    'research','research',e.event,
    CASE e.event WHEN 'worker_requeued' THEN 'waiting' WHEN 'worker_started' THEN 'running' WHEN 'worker_completed' THEN 'completed'
      WHEN 'worker_cancelled' THEN 'cancelled' WHEN 'worker_timed_out' THEN 'failed' WHEN 'worker_failed' THEN 'failed' ELSE 'unknown' END,
    e.at,j.deadline_at,CASE WHEN l.profile_id IS NULL THEN 'global' ELSE 'profile' END,
    json_object('jobId',e.job_id,'operation',j.kind,'reasonCode',json_extract(e.detail_json,'$.code'),
      'contentHash',json_extract(e.detail_json,'$.resultHash')),NULL
    FROM research_job_events e JOIN research_jobs j ON j.id=e.job_id
    LEFT JOIN research_trigger_job_links_v1 l ON l.job_id=j.id
    WHERE l.profile_id IS NULL OR l.profile_id=(SELECT profile FROM scope)
  UNION ALL
  SELECT 'research-job:'||j.id,'research:'||j.id,j.id,'research','research','job_snapshot',
    CASE j.status WHEN 'running' THEN 'running' WHEN 'queued' THEN 'waiting' WHEN 'completed' THEN 'completed'
      WHEN 'cancelled' THEN 'cancelled' ELSE 'failed' END,coalesce(j.completed_at,j.started_at,j.created_at),j.deadline_at,
    CASE WHEN l.profile_id IS NULL THEN 'global' ELSE 'profile' END,
    json_object('jobId',j.id,'operation',j.kind,'contentHash',j.result_hash),NULL
    FROM research_jobs j LEFT JOIN research_trigger_job_links_v1 l ON l.job_id=j.id
    WHERE (l.profile_id IS NULL OR l.profile_id=(SELECT profile FROM scope))
      AND NOT EXISTS(SELECT 1 FROM research_job_events e WHERE e.job_id=j.id)
  UNION ALL
  SELECT 'advisor-audit:'||a.sequence,
    coalesce((SELECT 'decision:'||p.decision_id FROM advisor_decision_evidence_packs_v1 p
      WHERE p.evidence_hash=a.context_hash AND p.profile_id=a.profile_id LIMIT 1),'advisor:'||a.sequence),
    'advisor-audit:'||a.sequence,'advisor','advisor','advisor_'||a.operation,
    CASE a.outcome WHEN 'succeeded' THEN 'completed' WHEN 'cancelled' THEN 'cancelled' ELSE 'failed' END,
    a.occurred_at_ms,NULL,'profile',json_object('provider',a.provider,'operation',a.operation,'contentHash',a.context_hash),a.context_hash
    FROM advisor_audit_events_v1 a WHERE a.profile_id=(SELECT profile FROM scope)
  UNION ALL
  SELECT 'advisor-navigation:'||n.id,coalesce('decision:'||n.decision_id,'advisor-navigation:'||n.id),n.id,
    'advisor','advisor','navigation',CASE n.outcome WHEN 'accepted' THEN 'completed' ELSE 'blocked' END,n.at,NULL,'profile',
    json_object('decisionId',n.decision_id,'reasonCode',n.reason_code,'operation',n.target),NULL
    FROM advisor_navigation_audit_events_v1 n WHERE n.profile_id=(SELECT profile FROM scope)
  UNION ALL
  SELECT 'scheduler:'||s.id,'host:'||s.id,s.id,'host','host','lease_'||s.kind,
    CASE WHEN s.kind IN('lost','cancelled') THEN 'blocked' ELSE 'completed' END,s.at,NULL,'profile',
    json_object('operation',s.kind),NULL FROM scheduler_lease_events_v1 s
    WHERE s.profile_id=(SELECT profile FROM scope) AND s.kind IN('acquired','released','lost','cancelled')
  UNION ALL
  SELECT 'parallel:'||p.id,'parallel:'||p.experiment_id||':'||coalesce(json_extract(p.detail_json,'$.day'),
    (SELECT json_extract(i.detail_json,'$.day') FROM parallel_paper_events_v1 i WHERE i.experiment_id=p.experiment_id
      AND i.kind='external_intent' AND
      (json_extract(i.detail_json,'$.clientOrderId')=json_extract(p.detail_json,'$.clientOrderId') OR
        json_extract(i.detail_json,'$.clientOrderId')=(SELECT json_extract(o.detail_json,'$.clientOrderId')
          FROM parallel_paper_events_v1 o WHERE o.experiment_id=p.experiment_id AND o.kind='external_order'
          AND json_extract(o.detail_json,'$.orderId')=json_extract(p.detail_json,'$.orderId') LIMIT 1)) LIMIT 1),p.id),
    p.id,CASE WHEN p.kind IN('decision','market_refresh_started','market_refresh_finished') THEN 'market'
      WHEN p.kind IN('paused','resumed','stopped','started','pass_deferred') THEN 'host'
      WHEN p.kind='intraday_skipped' THEN 'risk' ELSE 'execution' END,'parallel',p.kind,
    CASE WHEN p.kind IN('market_refresh_started','submit_attempt') THEN 'running'
      WHEN p.kind IN('paused','intraday_skipped') THEN 'blocked' WHEN p.kind='reconciliation_error' THEN 'failed'
      WHEN p.kind IN('external_intent','external_order','external_fill','pass_deferred') THEN 'waiting' ELSE 'completed' END,
    p.at,NULL,'profile',json_object('campaignId',p.experiment_id,'instruments',json_extract(p.detail_json,'$.symbol'),
      'reasonCode',json_extract(p.detail_json,'$.reason'),'orderId',json_extract(p.detail_json,'$.orderId'),
      'operation',p.kind,'amountUsd',json_extract(p.detail_json,'$.amountUsd')),NULL
    FROM parallel_paper_events_v1 p WHERE p.profile_id=(SELECT profile FROM scope)
      AND p.kind IN('decision','market_refresh_started','market_refresh_finished','external_intent','submit_attempt',
        'external_order','external_fill','local_fill','external_complete','intraday_complete','intraday_skipped',
        'paused','resumed','stopped','started','reconciliation_error','pass_deferred')
), journal AS (
  SELECT r.*,CASE WHEN phase IN('evaluation_started','paper_pass_started') THEN -1000000 WHEN phase IN('evaluation_finished','paper_pass_finished') THEN 2000000
    WHEN phase LIKE '%_started' THEN -1 ELSE coalesce(json_extract(facts_json,'$.sequence'),0) END AS event_order
    FROM raw_journal r WHERE r.id NOT IN(SELECT json_extract(a.facts_json,'$.sourceRecord')
    FROM operations_activity_events_v1 a WHERE a.profile_id=(SELECT profile FROM scope)
      AND json_type(a.facts_json,'$.sourceRecord')='text')
)`;

/** Advisory completion and later observations cannot overwrite an execution outcome. */
export const OPERATIONS_OUTCOME_PRIORITY = `CASE WHEN phase IN('evaluation_started','evaluation_finished',
  'paper_pass_started','paper_pass_finished','no_trade','stand_down','gates_started','gates_finished','eligibility',
  'risk_evaluated','execution_submitted','execution_filled','execution_refused','recovery','external_complete',
  'intraday_complete','external_fill','local_fill','external_order','paused','stopped') THEN 1 ELSE 0 END`;

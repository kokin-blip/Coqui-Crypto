import { describe,expect,it } from 'vitest';
import { FixedClock,type EvolutionPolicyV1 } from '../packages/core/src/index.js';
import { ResearchHostCoordinator,ResearchReadModelService,type RegisteredResearchDefinitionV1 } from '../packages/services/src/index.js';
import { getResearchChampion,getResearchJob,listResearchCandidateReviews,
  openDatabase,saveResearchJob } from '../packages/storage/src/index.js';

const policy:EvolutionPolicyV1={minimumOosReturnPct:-100,minimumWalkForwardPassRate:0,
  minimumStressReturnPct:-100,maximumDrawdownPct:100,maximumTurnoverPct:100,
  minimumSignificanceProbability:0,minimumStabilityScore:0,maximumTrialCount:20};
function registration(kind:'scheduled'|'event'='scheduled'):RegisteredResearchDefinitionV1 {
  return {id:`registered-${kind}`,triggerId:`trigger-${kind}`,triggerKind:kind,family:'registered-research-only',
    strategyVersion:'candidate-v1',trials:4,debounceMs:kind==='event'?10:0,cooldownMs:1_000,
    maxDurationMs:5_000,trialBudget:20,definition:{operation:'evaluate_candidate_v1',
      candidateId:`registered-${kind}`,turnoverPct:12,trialCount:4},
    snapshot:{oosReturns:[2,-1,3],walkForwardReturns:[[1,2],[-1,2]],stressReturns:[-2,3]},policy};
}

describe('research host orchestration',()=>{
  it('links a registered trigger to a durable job, worker attempt, and promotion-eligible candidate',async()=>{
    const database=openDatabase(':memory:'),clock=new FixedClock(100);
    const host=new ResearchHostCoordinator({profileId:'main',database,clock,registrations:[registration()]});
    const queued=host.request('trigger-scheduled',100);
    expect(queued.decision).toMatchObject({start:true,reasonCode:'started'});
    expect(getResearchJob(queued.jobId!,database)?.status).toBe('queued');
    await host.tick();
    expect(getResearchJob(queued.jobId!,database)).toMatchObject({status:'completed',attemptCount:1});
    const linked=database.prepare(`SELECT candidate_id FROM research_job_candidate_links_v1 WHERE job_id=?`)
      .get(queued.jobId!) as {candidate_id:string};
    expect(database.prepare(`SELECT state FROM research_candidates_v1 WHERE id=?`).get(linked.candidate_id))
      .toEqual({state:'promotion_eligible'});
    expect(getResearchChampion('registered-research-only',database)).toBeNull();
    database.close();
  });

  it('requires registration and a human audit note before activation',async()=>{
    const database=openDatabase(':memory:'),clock=new FixedClock(200);
    const host=new ResearchHostCoordinator({profileId:'main',database,clock,registrations:[registration()]});
    expect(host.request('unknown',200)).toEqual({decision:{start:false,reasonCode:'definition_unavailable',deadlineAt:null},jobId:null});
    const queued=host.request('trigger-scheduled',200); await host.tick();
    const candidate=(database.prepare(`SELECT candidate_id FROM research_job_candidate_links_v1 WHERE job_id=?`)
      .get(queued.jobId!) as {candidate_id:string}).candidate_id;
    expect(()=>host.review(candidate,'approved','', 'local-user',201)).toThrow('audit note');
    expect(getResearchChampion('registered-research-only',database)).toBeNull();
    const approved=host.review(candidate,'approved','Reviewed all recorded blockers.', 'local-user',202);
    expect(approved.champion?.candidateId).toBe(candidate);
    expect(listResearchCandidateReviews('main',candidate,database)).toEqual([
      expect.objectContaining({action:'approved',note:'Reviewed all recorded blockers.',actor:'local-user'}),
    ]);
    expect(()=>database.prepare(`UPDATE research_candidate_review_events_v1 SET note='changed'`).run())
      .toThrow('append-only');
    database.close();
  });

  it('debounces event registrations before creating any job',()=>{
    const database=openDatabase(':memory:'),clock=new FixedClock(300);
    const host=new ResearchHostCoordinator({profileId:'main',database,clock,registrations:[registration('event')]});
    expect(host.request('trigger-event',300)).toMatchObject({decision:{reasonCode:'debouncing'},jobId:null});
    expect(host.request('trigger-event',305)).toMatchObject({decision:{reasonCode:'debouncing'},jobId:null});
    expect(host.request('trigger-event',310)).toMatchObject({decision:{reasonCode:'started'},jobId:expect.any(String)});
    expect((database.prepare('SELECT COUNT(*) AS count FROM research_trigger_job_links_v1').get() as {count:number}).count).toBe(1);
    database.close();
  });

  it('finishes a completed-but-unlinked result after host recovery and keeps reads profile scoped',async()=>{
    const database=openDatabase(':memory:'),clock=new FixedClock(400);
    const host=new ResearchHostCoordinator({profileId:'main',database,clock,registrations:[registration()]});
    const queued=host.request('trigger-scheduled',400),job=getResearchJob(queued.jobId!,database)!;
    const resultJson=JSON.stringify({metrics:{oosReturnPct:1,walkForwardPassRate:1,stressReturnPct:1,
      maxDrawdownPct:1,turnoverPct:1,significanceProbability:1,stabilityScore:1,trialCount:1}});
    saveResearchJob({...job,status:'completed',completedAt:401,resultJson},database);
    await host.tick();
    expect(database.prepare(`SELECT COUNT(*) AS count FROM research_job_candidate_links_v1 WHERE job_id=?`)
      .get(job.id)).toEqual({count:1});
    expect(new ResearchReadModelService({database,profileId:'main'}).jobs(10)).toMatchObject({ok:true,value:[{id:job.id}]});
    expect(new ResearchReadModelService({database,profileId:'other'}).jobs(10)).toEqual({ok:true,value:[]});
    database.close();
  });
});

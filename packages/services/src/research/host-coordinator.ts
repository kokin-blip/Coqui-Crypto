import { canonicalJson, sha256Hex, type CanonicalJsonValue, type Clock,
  type EvolutionPolicyV1 } from '@coqui/core';
import { appendResearchCandidateReview, getResearchCandidate, getResearchJob,
  getResearchTrigger, inTransaction, listQueuedLinkedResearchJobs,
  listUnlinkedCompletedResearchJobs,
  saveResearchJob, saveResearchJobCandidateLink, saveResearchTriggerJobLink,
  type Db } from '@coqui/storage';

import { EvolutionCoordinator } from './evolution.js';
import { ResearchTriggerCoordinator, type ResearchTriggerDecision } from './triggers.js';
import { ResearchWorkerPool } from './worker-pool.js';
import type { ResearchWorkerDefinitionV1, ResearchWorkerSnapshotV1 } from './worker-protocol.js';

export interface RegisteredResearchDefinitionV1 {
  readonly id: string;
  readonly triggerId: string;
  readonly triggerKind: 'scheduled'|'event';
  readonly family: string;
  readonly strategyVersion: string;
  readonly parentId?: string;
  readonly trials: number;
  readonly debounceMs: number;
  readonly cooldownMs: number;
  readonly maxDurationMs: number;
  readonly trialBudget: number;
  readonly definition: ResearchWorkerDefinitionV1;
  readonly snapshot: ResearchWorkerSnapshotV1;
  readonly policy: EvolutionPolicyV1;
}

export interface ResearchJobRequestV1 {
  readonly format: 'coqui-research-job-request-v1'; readonly definitionId: string;
  readonly family: string; readonly strategyVersion: string; readonly parentId: string|null;
  readonly definition: ResearchWorkerDefinitionV1; readonly policy: EvolutionPolicyV1;
}

export interface ResearchTriggerRunResult {
  readonly decision: ResearchTriggerDecision;
  readonly jobId: string|null;
}

function inputHash(requestJson:string,snapshotJson:string):string {
  return sha256Hex(`${requestJson}\n${snapshotJson}`);
}

function parseRequest(value:string):ResearchJobRequestV1 {
  const parsed=JSON.parse(value) as ResearchJobRequestV1;
  if(parsed.format!=='coqui-research-job-request-v1'||typeof parsed.definitionId!=='string'||
    typeof parsed.family!=='string'||typeof parsed.strategyVersion!=='string'||
    (parsed.parentId!==null&&typeof parsed.parentId!=='string')||typeof parsed.definition!=='object'||
    parsed.definition===null||typeof parsed.policy!=='object'||parsed.policy===null) {
    throw new TypeError('invalid_registered_research_request');
  }
  return parsed;
}

function requestFor(registration:RegisteredResearchDefinitionV1):ResearchJobRequestV1 {
  return {format:'coqui-research-job-request-v1',definitionId:registration.id,
    family:registration.family,strategyVersion:registration.strategyVersion,parentId:registration.parentId??null,
    definition:registration.definition,policy:registration.policy};
}

/** Host-owned bridge from durable triggers to authority-free workers and human-gated candidates. */
export class ResearchHostCoordinator {
  readonly #trigger:ResearchTriggerCoordinator; readonly #pool:ResearchWorkerPool;
  readonly #evolution:EvolutionCoordinator; readonly #registrations:Map<string,RegisteredResearchDefinitionV1>;
  constructor(private readonly input:{readonly profileId:string;readonly database:Db;readonly clock:Clock;
    readonly registrations?:readonly RegisteredResearchDefinitionV1[];readonly concurrency?:number}) {
    this.#trigger=new ResearchTriggerCoordinator(input.database);
    this.#pool=new ResearchWorkerPool({database:input.database,clock:input.clock,concurrency:input.concurrency??2});
    this.#evolution=new EvolutionCoordinator(input.database);
    this.#registrations=new Map((input.registrations??[]).map((item)=>[item.triggerId,item]));
    for(const item of this.#registrations.values()) {
      if(item.definition.candidateId!==item.id) throw new TypeError('Registered candidate identity mismatch.');
      this.#trigger.configure({id:item.triggerId,family:item.family,kind:item.triggerKind,
        debounceMs:item.debounceMs,cooldownMs:item.cooldownMs,maxDurationMs:item.maxDurationMs,
        trialBudget:item.trialBudget,updatedAt:input.clock.nowMs()});
    }
  }

  recover(){ return this.#pool.recover(); }

  request(triggerId:string,at=this.input.clock.nowMs()):ResearchTriggerRunResult {
    const registration=this.#registrations.get(triggerId);
    if(registration===undefined) return {decision:{start:false,reasonCode:'definition_unavailable',deadlineAt:null},jobId:null};
    return inTransaction(this.input.database,()=>{
      const decision=this.#trigger.request(triggerId,registration.trials,at);
      if(!decision.start) return {decision,jobId:null};
      const request=requestFor(registration);
      const requestJson=canonicalJson(request as unknown as CanonicalJsonValue);
      const snapshotJson=canonicalJson(registration.snapshot as unknown as CanonicalJsonValue);
      const material=inputHash(requestJson,snapshotJson);
      const jobId=sha256Hex(`research-trigger-job-v1:${this.input.profileId}:${triggerId}:${at}:${material}`);
      saveResearchJob({id:jobId,kind:'matrix',status:'queued',createdAt:at,startedAt:null,completedAt:null,
        requestJson,snapshotJson,progressJson:'{"phase":"queued","percent":0}',resultJson:null,error:null,
        formatVersion:1,snapshotHash:sha256Hex(snapshotJson),deadlineAt:decision.deadlineAt},this.input.database);
      saveResearchTriggerJobLink({profileId:this.input.profileId,triggerId,jobId,
        definitionId:registration.id,inputHash:material,createdAt:at},this.input.database);
      return {decision,jobId};
    });
  }

  async tick():Promise<void> {
    const now=this.input.clock.nowMs();
    for(const registration of this.#registrations.values()) {
      if(registration.triggerKind==='scheduled') this.request(registration.triggerId,now);
    }
    const queued=listQueuedLinkedResearchJobs(this.input.profileId,100,this.input.database);
    await Promise.all(queued.map(async(link)=>{
      const job=getResearchJob(link.jobId,this.input.database);
      if(job===null||job.snapshotJson===null) return;
      const request=parseRequest(job.requestJson), registration=this.#registrations.get(link.triggerId);
      if(registration===undefined||registration.id!==request.definitionId||
        job.requestJson!==canonicalJson(requestFor(registration) as unknown as CanonicalJsonValue)||
        job.snapshotJson!==canonicalJson(registration.snapshot as unknown as CanonicalJsonValue)||
        inputHash(job.requestJson,job.snapshotJson)!==link.inputHash) return;
      const snapshot=JSON.parse(job.snapshotJson) as ResearchWorkerSnapshotV1;
      try { await this.#pool.run(job.id,request.definition,snapshot); }
      catch { /* Worker pool persists a sanitized terminal state. */ }
    }));
    for(const link of listUnlinkedCompletedResearchJobs(this.input.profileId,100,this.input.database)) this.#finalize(link);
  }

  #finalize(link:{readonly jobId:string;readonly triggerId:string;readonly inputHash:string}):void {
    const job=getResearchJob(link.jobId,this.input.database), registration=this.#registrations.get(link.triggerId);
    if(job?.resultJson===null||job?.resultJson===undefined||job.resultHash===null||job.resultHash===undefined||
      job.snapshotJson===null||registration===undefined||inputHash(job.requestJson,job.snapshotJson)!==link.inputHash||
      job.requestJson!==canonicalJson(requestFor(registration) as unknown as CanonicalJsonValue)||
      job.snapshotJson!==canonicalJson(registration.snapshot as unknown as CanonicalJsonValue)) return;
    const request=parseRequest(job.requestJson), result=JSON.parse(job.resultJson) as {readonly metrics:Parameters<EvolutionCoordinator['evaluate']>[0]['metrics']};
    const candidate=this.#evolution.evaluate({family:request.family,strategyVersion:request.strategyVersion,
      ...(request.parentId===null?{}:{parentId:request.parentId}),evidenceId:job.id,evidenceHash:job.resultHash,
      metrics:result.metrics,policy:request.policy,createdAt:this.input.clock.nowMs()});
    saveResearchJobCandidateLink({profileId:this.input.profileId,jobId:job.id,candidateId:candidate.id,
      resultHash:job.resultHash,createdAt:this.input.clock.nowMs()},this.input.database);
  }

  status(triggerId:string){
    const trigger=getResearchTrigger(triggerId,this.input.database);
    return trigger===null?null:Object.freeze({...trigger,registered:this.#registrations.has(triggerId)});
  }

  review(candidateId:string,action:'reviewed'|'approved'|'rejected',note:string,actor:string,at=this.input.clock.nowMs()) {
    if(getResearchCandidate(candidateId,this.input.database)===null) throw new Error('Research candidate not found.');
    return inTransaction(this.input.database,()=>{
      const event=appendResearchCandidateReview({profileId:this.input.profileId,candidateId,action,note,actor,at},this.input.database);
      const champion=action==='approved'?this.#evolution.approve(candidateId,event.id,at):null;
      return {event,champion};
    });
  }

  rollback(candidateId:string,note:string,actor:string,at=this.input.clock.nowMs()) {
    return inTransaction(this.input.database,()=>{
      const event=appendResearchCandidateReview({profileId:this.input.profileId,candidateId,action:'rollback',note,actor,at},this.input.database);
      return {event,champion:this.#evolution.rollback(candidateId,event.id,at)};
    });
  }
}

import { canonicalJson, sha256Hex, type CanonicalJsonValue } from '@coqui/core';
import type { Db } from '../sqlite/index.js';

export interface ResearchTriggerJobLinkV1 {
  readonly id: string; readonly profileId: string; readonly triggerId: string;
  readonly jobId: string; readonly definitionId: string; readonly inputHash: string;
  readonly createdAt: number;
}

export interface ResearchCandidateReviewEventV1 {
  readonly id: string; readonly profileId: string; readonly candidateId: string;
  readonly action: 'reviewed'|'approved'|'rejected'|'rollback'; readonly note: string;
  readonly actor: string; readonly at: number; readonly contentHash: string;
}

function triggerLink(row: Record<string, unknown>): ResearchTriggerJobLinkV1 {
  return Object.freeze({ id: String(row['id']), profileId: String(row['profile_id']),
    triggerId: String(row['trigger_id']), jobId: String(row['job_id']),
    definitionId: String(row['definition_id']), inputHash: String(row['input_hash']),
    createdAt: Number(row['created_at']) });
}

export function saveResearchTriggerJobLink(input: Omit<ResearchTriggerJobLinkV1,'id'>, database: Db): ResearchTriggerJobLinkV1 {
  const id = sha256Hex(canonicalJson(input as unknown as CanonicalJsonValue));
  database.prepare(`INSERT INTO research_trigger_job_links_v1
    (id,profile_id,trigger_id,job_id,definition_id,input_hash,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(id,input.profileId,input.triggerId,input.jobId,input.definitionId,input.inputHash,input.createdAt);
  return Object.freeze({ id, ...input });
}

export function getResearchTriggerJobLink(jobId: string, database: Db): ResearchTriggerJobLinkV1 | null {
  const row=database.prepare('SELECT * FROM research_trigger_job_links_v1 WHERE job_id=?').get(jobId) as Record<string,unknown>|undefined;
  return row===undefined?null:triggerLink(row);
}

export function listQueuedLinkedResearchJobs(profileId: string, limit: number, database: Db): readonly ResearchTriggerJobLinkV1[] {
  if(!Number.isSafeInteger(limit)||limit<1||limit>100) throw new TypeError('Invalid linked research job limit.');
  const rows=database.prepare(`SELECT link.* FROM research_trigger_job_links_v1 link
    JOIN research_jobs job ON job.id=link.job_id WHERE link.profile_id=? AND job.status='queued'
    ORDER BY link.created_at,link.id LIMIT ?`).all(profileId,limit) as unknown as Record<string,unknown>[];
  return Object.freeze(rows.map(triggerLink));
}

export function listUnlinkedCompletedResearchJobs(profileId:string,limit:number,database:Db):readonly ResearchTriggerJobLinkV1[]{
  if(!Number.isSafeInteger(limit)||limit<1||limit>100) throw new TypeError('Invalid linked research job limit.');
  const rows=database.prepare(`SELECT link.* FROM research_trigger_job_links_v1 link
    JOIN research_jobs job ON job.id=link.job_id
    LEFT JOIN research_job_candidate_links_v1 candidate ON candidate.job_id=job.id
    WHERE link.profile_id=? AND job.status='completed' AND candidate.id IS NULL
    ORDER BY link.created_at,link.id LIMIT ?`).all(profileId,limit) as unknown as Record<string,unknown>[];
  return Object.freeze(rows.map(triggerLink));
}

export function listResearchJobsForProfile(profileId:string,limit:number,database:Db) {
  const rows=database.prepare(`SELECT job.id FROM research_jobs job
    JOIN research_trigger_job_links_v1 link ON link.job_id=job.id
    WHERE link.profile_id=? ORDER BY job.created_at DESC LIMIT ?`).all(profileId,limit) as unknown as Array<{id:string}>;
  return rows.map((row)=>row.id);
}

export function researchJobBelongsToProfile(profileId:string,jobId:string,database:Db):boolean {
  return database.prepare(`SELECT 1 FROM research_trigger_job_links_v1 WHERE profile_id=? AND job_id=?`)
    .get(profileId,jobId)!==undefined;
}

export function saveResearchJobCandidateLink(input: {readonly profileId:string;readonly jobId:string;
  readonly candidateId:string;readonly resultHash:string;readonly createdAt:number}, database:Db): string {
  const id=sha256Hex(canonicalJson(input as unknown as CanonicalJsonValue));
  database.prepare(`INSERT INTO research_job_candidate_links_v1
    (id,profile_id,job_id,candidate_id,result_hash,created_at) VALUES (?,?,?,?,?,?)`)
    .run(id,input.profileId,input.jobId,input.candidateId,input.resultHash,input.createdAt);
  return id;
}

export function appendResearchCandidateReview(input: Omit<ResearchCandidateReviewEventV1,'id'|'contentHash'>, database: Db): ResearchCandidateReviewEventV1 {
  const note=input.note.trim(), actor=input.actor.trim();
  if(note.length<3||note.length>1000) throw new TypeError('A human audit note is required.');
  if(actor.length<1||actor.length>120) throw new TypeError('A human actor is required.');
  const material={...input,note,actor};
  const contentHash=sha256Hex(canonicalJson(material as unknown as CanonicalJsonValue));
  const id=sha256Hex(`research-candidate-review-v1:${contentHash}`);
  database.prepare(`INSERT INTO research_candidate_review_events_v1
    (id,profile_id,candidate_id,action,note,actor,at,content_hash) VALUES (?,?,?,?,?,?,?,?)`)
    .run(id,input.profileId,input.candidateId,input.action,note,actor,input.at,contentHash);
  return Object.freeze({id,...material,contentHash});
}

export function listResearchCandidateReviews(profileId:string,candidateId:string,database:Db):readonly ResearchCandidateReviewEventV1[]{
  const rows=database.prepare(`SELECT * FROM research_candidate_review_events_v1
    WHERE profile_id=? AND candidate_id=? ORDER BY at,id`).all(profileId,candidateId) as unknown as Record<string,unknown>[];
  return Object.freeze(rows.map((row)=>Object.freeze({id:String(row['id']),profileId:String(row['profile_id']),
    candidateId:String(row['candidate_id']),action:row['action'] as ResearchCandidateReviewEventV1['action'],note:String(row['note']),
    actor:String(row['actor']),at:Number(row['at']),contentHash:String(row['content_hash'])})));
}

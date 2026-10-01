import { Decimal } from 'decimal.js';
import { EXECUTION_ARMS, evaluateMatchedArm, pairedReturnUncertainty, declaredExecutionTrials,
  REMEDIATION_SELECTION_RULE, validateStudyProvenance, STUDY_BEHAVIOR_HASHES,
  type ExecutionArm, type EvaluationFrame, type RemediationBookObservation } from '@coqui/core';
import { listStudyInstances, listRemediationEvidence, type Db } from '@coqui/storage';
const CANDIDATE='trendvol-execution-remediation-v1';
/** Read-only evaluation uses the identical provenance gate as collection. Holdout bodies remain unread. */
export function remediationDevelopmentReport(profileId:string, instanceId:string, db:Db, nowMs:number) {
  const instance=listStudyInstances(profileId,CANDIDATE,db).find((row)=>row.id===instanceId);
  if(!instance) throw new Error('study_not_registered');
  validateStudyProvenance(instance,{profileId,experimentId:instance.definition.experimentId,
    candidateId:CANDIDATE,behaviorHash:STUDY_BEHAVIOR_HASHES[CANDIDATE]??''});
  const end=instance.definition.foldEndsMs.at(-1)!;
  const frames=listRemediationEvidence(profileId,instanceId,'frame',db,end+900_000).filter((row)=>Number(row.key)<=end);
  const failures=listRemediationEvidence(profileId,instanceId,'failure',db,end).filter((row)=>Number((row.body as {slotMs:number}).slotMs)<end);
  const starts=[instance.definition.startMs,...instance.definition.foldEndsMs.slice(0,-1)];
  const folds=starts.map((start,index)=>{
    const finish=instance.definition.foldEndsMs[index]!;
    const results=EXECUTION_ARMS.flatMap((arm)=>[1,2].map((multiplier)=>{
      const books=listRemediationEvidence(profileId,instanceId,`book:${start}:${arm}:${multiplier}`,db,finish);
      const rows=books.map((row)=>({slotMs:Number(row.key), book:row.body as unknown as RemediationBookObservation,
        frame:frames.find((frame)=>frame.key===row.key)?.body as unknown as EvaluationFrame}));
      if(rows.some((row)=>!row.frame)) throw new Error('missing_matched_frame');
      const terminal=frames.find((frame)=>frame.key===String(finish))?.body as unknown as EvaluationFrame|undefined;
      return {arm,multiplier,...evaluateMatchedArm(start,finish,arm,multiplier as 1|2,rows,terminal??null)};
    }));
    return {start,end:finish,status:nowMs<finish?'not_complete':results.every((r)=>r.status==='complete')?'complete':'incomplete_coverage',results};
  });
  const candidates=(['B','C','D'] as const).map((arm)=>{
    let eligible=folds.every((fold)=>fold.status==='complete');
    const uncertainty=[1,2].map((multiplier)=>{
      const differences:number[]=[];
      for(const fold of folds) {
        const baseline=fold.results.find((r)=>r.arm==='A'&&r.multiplier===multiplier)!.metrics;
        const candidate=fold.results.find((r)=>r.arm===arm&&r.multiplier===multiplier)!.metrics;
        if(!baseline||!candidate) {eligible=false;continue;}
        if(new Decimal(candidate.netReturn).lte(baseline.netReturn)||new Decimal(candidate.maxDrawdown).gt(baseline.maxDrawdown)) eligible=false;
        differences.push(...candidate.dailyReturns.map((value,index)=>value-baseline.dailyReturns[index]!));
      }
      const bounds=pairedReturnUncertainty(differences);
      if(bounds.status!=='estimated'||bounds.lower===null||bounds.lower<=0) eligible=false;
      return {multiplier,...bounds};
    });
    const lift=folds.reduce((sum,fold)=>{
      const a=fold.results.find((r)=>r.arm==='A'&&r.multiplier===1)!.metrics;
      const b=fold.results.find((r)=>r.arm===arm&&r.multiplier===1)!.metrics;
      return sum.plus(a&&b?new Decimal(b.netReturn).minus(a.netReturn):0);
    },new Decimal(0));
    return {arm,eligible,uncertainty,developmentLift:lift.toString()};
  });
  const winner=candidates.filter((row)=>row.eligible).sort((a,b)=>new Decimal(b.developmentLift).cmp(a.developmentLift)||a.arm.localeCompare(b.arm))[0]?.arm??null;
  return {status:folds.every((fold)=>fold.status==='complete')?'development_evaluated':'insufficient_evidence',
    studyInstanceId:instance.id,behaviorHash:instance.definition.behaviorHash,artifactHash:instance.artifactHash,
    holdout:'sealed_not_read',trialAccounting:declaredExecutionTrials(),folds,failures:failures.length,
    selection:{rule:REMEDIATION_SELECTION_RULE,candidates,proposedWinner:winner as ExecutionArm|null,frozen:false},
    costs:'modeled_only',promotionAuthorized:false};
}

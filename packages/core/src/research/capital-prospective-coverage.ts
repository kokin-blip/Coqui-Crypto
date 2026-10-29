import {PROSPECTIVE_DAY as DAY,type ProspectiveDesign,type ProspectiveCoverage,type ProspectivePhase} from './capital-prospective-types.js';
export interface ProspectiveCaptureMetadata {readonly id:string;readonly slotMs:number;readonly accepted:boolean;readonly reasonCodes:readonly string[];readonly atMs:number;readonly sourceHash:string;readonly bytes:number}
export function prospectiveCoverage(d:ProspectiveDesign,registrationId:string,phase:ProspectivePhase,rows:readonly ProspectiveCaptureMetadata[],nowMs:number):ProspectiveCoverage {
 const from=phase==='development'?d.startMs:d.finalStartMs,to=phase==='development'?d.developmentEndMs:d.endMs;
 const slots=Array.from({length:(to-from)/DAY+1},(_,i)=>from+i*DAY),due=slots.filter(s=>nowMs>=s+d.protocol.latenessMs),missingSlots:number[]=[],acceptedRows:ProspectiveCaptureMetadata[]=[];let invalid=0,conflicts=0;
 for(const slot of due){const facts=rows.filter(r=>r.slotMs===slot),valid=facts.filter(r=>r.accepted),conflict=facts.some(r=>r.reasonCodes.includes('conflicting_capture'))||new Set(valid.map(r=>r.sourceHash)).size>1;
  if(conflict)conflicts++;else if(valid.length)acceptedRows.push(valid[0]!);else{missingSlots.push(slot);if(facts.length)invalid++;}}
 return {registrationId,asOfMs:nowMs,phase,expected:due.length,accepted:acceptedRows.length,missing:missingSlots.length,invalid,conflicts,pending:slots.length-due.length,firstEligibleAtMs:acceptedRows[0]?.atMs??null,lastEligibleAtMs:acceptedRows.at(-1)?.atMs??null,missingSlots,outcomeActions:phase==='final'?'sealed_unverified':'development_only',reasonCodes:[...(missingSlots.length?['prospective_coverage_missing']:[]),...(conflicts?['prospective_capture_conflict']:[]),...(nowMs<to+d.protocol.latenessMs?['prospective_window_not_complete']:[])]};
}

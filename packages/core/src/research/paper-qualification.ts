import {capitalHash} from '../portfolio/capital-ledger.js';
import {PROSPECTIVE_VERSION,type ProspectiveArm} from './capital-prospective-types.js';
/** A distinct strategy namespace: it cannot impersonate the existing P6 TrendVol adapter. */
export function prospectiveStrategyHash(arm:Pick<ProspectiveArm,'signal'|'reserve'|'executionBand'>):string{return capitalHash({version:PROSPECTIVE_VERSION,signal:arm.signal,reserve:arm.reserve,executionBand:arm.executionBand});}
export const prospectiveStrategyId=(arm:ProspectiveArm)=>`${PROSPECTIVE_VERSION}:${prospectiveStrategyHash(arm)}`;
export interface QualifiedPaperEvidenceV1 {readonly version:'qualified-paper-evidence-v1';readonly profileId:string;readonly strategyId:string;readonly codeRevision:string;readonly costProfileHash:string;readonly horizonMs:number;readonly normalization:'gross_pct_per_turnover';readonly validFromMs:number;readonly validUntilMs:number;readonly resultHash:string;readonly sourceHashes:readonly string[];readonly integrityVerified:true;readonly grossEdgeLowerBoundPct:number;readonly netEdgeLowerBoundPct:number;readonly evidenceClass:'prospective_modeled_shadow';readonly method:'next-daily-cut-forward-counterfactual-v1';readonly registrationId:string;readonly reviewId:string}
/** Operational configuration is an additional capability; the existing P6 adapter supplies none. */
export interface ProspectivePaperConfiguration {readonly strategyId:string;readonly capitalUsd:string;readonly universeHash:string;readonly fundingHash:string;readonly riskPolicyHash:string;readonly protocolHash:string;readonly costProfileHash:string}
export function prospectivePaperConfiguration(d:import('./capital-prospective-types.js').ProspectiveDesign,arm:ProspectiveArm,capitalUsd:string):ProspectivePaperConfiguration{
 const base=d.costs.find(c=>c.multiplier===1);if(!base||!d.openings.some(o=>o.capitalUsd===capitalUsd)||!Number(d.capitalWeights[capitalUsd]??0))throw new Error('prospective_configuration_support_unavailable');
 return {strategyId:prospectiveStrategyId(arm),capitalUsd,universeHash:capitalHash(d.assets),fundingHash:capitalHash({openings:d.openings,flows:d.flows,expenses:d.externalExpenses,yield:d.yield}),riskPolicyHash:capitalHash(d.policy),protocolHash:d.protocol.hash,costProfileHash:capitalHash(base)};
}

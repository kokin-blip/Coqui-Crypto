import {describe,it,expect} from 'vitest';
import {validateCapitalContest,validateContestData,capitalHash} from '@coqui/core';
import {contestFixture} from './helpers/capital-contest.js';
describe('P5 finite specification',()=>{
 it('binds every size/arm before reading prices',()=>{const {manifest:m,data}=contestFixture();expect(validateCapitalContest(m)).toBe(capitalHash(m));validateContestData(m,data);expect(m.trials).toHaveLength(72);});
 it('refuses omitted rows, future training, loose gates and diagnostic capital weight',()=>{const {manifest:m}=contestFixture();for(const broken of [{...m,trials:m.trials.slice(1)},{...m,folds:[{...m.folds[0]!,trainToMs:m.replay.toMs}]},{...m,selection:{...m.selection,minObservations:30}},{...m,primaryWeights:{'100000':'1'}}])expect(()=>validateCapitalContest(broken)).toThrow();});
 it('rejects a workload before loading and missing/invalid price evidence without zero substitution',()=>{const {manifest:m,data,A}=contestFixture();expect(()=>validateCapitalContest({...m,resources:{...m.resources,maxOutputBytes:1000}})).toThrow('resource');const bad={...data,market:data.market.map((r,i)=>i? r:{...r,assets:{...r.assets,[A]:{...r.assets[A]!,closeUsd:'0'}}})};expect(()=>validateContestData({...m,dataHash:capitalHash(bad),replay:{...m.replay,marketTapeHash:capitalHash(bad.market)}},bad)).toThrow('price');});
});

it('enumerates the complete initial S/E/R recipe as bounded P4 batches, without raising v1 limits',()=>{
 const {manifest:m}=contestFixture();const scenarios=Array.from({length:9},(_,i)=>({...m.scenarios[0]!,id:`cost${i%3}-fund${Math.floor(i/3)}`,cost:{...m.scenarios[0]!.cost,feeRate:String((i%3)*0.001)},flows:i<3?[]:[{id:`fund${i}`,atMs:m.replay.fromMs,sequence:0,kind:'contribution' as const,amountUsd:String(i),feeUsd:'0',userReceiptUsd:'0',purpose:'principal' as const,linkedId:null,fromReserve:false,evidenceComplete:true}]}));
 const arms=[...m.arms,...['A','C'].map(id=>({...m.arms[0]!,id:`E${id}`,group:'E' as const,selectable:false,execution:id==='A'?'legacy_shaped' as const:'band_edge' as const})),...[0,2500,5000].map(shareBps=>({...m.arms[0]!,id:`R${shareBps}`,group:'R' as const,selectable:false,shareBps}))];
 const trials=arms.flatMap(a=>scenarios.flatMap(v=>m.replay.openings.map(o=>({id:`${a.id}:${v.id}:${o.capitalUsd}`,armId:a.id,variantId:v.id,capitalUsd:o.capitalUsd}))));
 const full={...m,scenarios,arms,trials,contrasts:m.contrasts.map(c=>({...c,variantId:scenarios[0]!.id}))};expect(trials).toHaveLength(1053);expect(()=>validateCapitalContest(full)).not.toThrow();
});

import {it,expect} from 'vitest';
import {contestExecutionPolicy} from '@coqui/core';
import {contestFixture} from './helpers/capital-contest.js';
it('adjusts intent to the band edge without a fabricated pending half-fill; required exits survive',()=>{const {manifest:m,A}=contestFixture(),f=contestExecutionPolicy({...m.arms[0]!,execution:'band_edge',routineBand:'0.02',changeBand:'0.02'});const i={assetId:A,deltaQuantity:'5',reason:'entry' as const,strategyRef:'same_signal'},c={targets:{[A]:'0.1'},marks:{[A]:'1'},positions:{[A]:'5'},activeUsd:'100'};expect(f([i],c)[0]?.deltaQuantity).toBe('3');expect(f([{...i,reason:'risk_exit'}],c)).toEqual([{...i,reason:'risk_exit'}]);expect(f([i],{...c,positions:{[A]:'9'}})).toEqual([]);});

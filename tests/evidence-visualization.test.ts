import {describe,expect,it} from 'vitest';
import {boundedMetricWidth,boundedRiskMeter,completedBarQuality}
  from '../apps/desktop/src/renderer/app/evidence-visualization.js';

describe('evidence visualization projections',()=>{
  it('scales recorded comparison values without inventing a non-finite bar',()=>{
    expect(boundedMetricWidth(5,[-10,5])).toBe('50%');
    expect(boundedMetricWidth(Number.NaN,[1])).toBe('0%');
  });

  it('keeps unavailable risk values unavailable and bounds display meters',()=>{
    expect(boundedRiskMeter(null)).toBeNull();
    expect(boundedRiskMeter(Number.NaN)).toBeNull();
    expect(boundedRiskMeter(-2)).toBe(0);
    expect(boundedRiskMeter(140)).toBe(100);
  });

  it('counts only observed discontinuities in completed bars',()=>{
    expect(completedBarQuality([])).toEqual({count:0,gaps:0,latest:null});
    expect(completedBarQuality([{startTimeMs:0,endTimeMs:10},{startTimeMs:10,endTimeMs:20},
      {startTimeMs:30,endTimeMs:40}])).toEqual({count:3,gaps:1,latest:40});
  });
});

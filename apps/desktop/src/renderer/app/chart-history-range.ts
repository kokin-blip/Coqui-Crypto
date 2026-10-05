import type { WorkstationInterval } from './chart-workstation-types.js';
const STEPS:Readonly<Record<WorkstationInterval,number>>={'1m':60000,'5m':300000,'15m':900000,'1h':3600000,'6h':21600000,'1d':86400000};
const LOOKBACK:Readonly<Record<WorkstationInterval,number>>={'1m':86400000,'5m':7*86400000,'15m':30*86400000,'1h':90*86400000,'6h':365*86400000,'1d':5*365*86400000};
/** Completed history has a stable cache key until the next candle boundary. */
export function chartHistoryRange(interval:WorkstationInterval,nowMs:number) {
  const endTimeMs=Math.floor(nowMs/STEPS[interval])*STEPS[interval];
  return {startTimeMs:Math.max(0,endTimeMs-LOOKBACK[interval]),endTimeMs};
}

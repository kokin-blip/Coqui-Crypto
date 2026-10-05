import {describe,expect,it} from 'vitest';
import {chartHistoryRange} from '../apps/desktop/src/renderer/app/chart-history-range.js';
describe('completed chart history cache windows',()=>{
 it('shares request identity across navigation inside a candle and advances at its boundary',()=>{
   const start=Date.parse('2026-10-04T21:40:00Z');
   expect(chartHistoryRange('5m',start+1)).toEqual(chartHistoryRange('5m',start+240000));
   expect(chartHistoryRange('5m',start+300000).endTimeMs).toBe(start+300000);
   expect(chartHistoryRange('5m',start).startTimeMs).toBe(start-7*86400000);
 });
 it('excludes an unfinished daily candle and never requests negative timestamps',()=>{
   expect(chartHistoryRange('1d',Date.parse('2026-10-04T21:40:00Z')).endTimeMs).toBe(Date.parse('2026-10-04T00:00:00Z'));
   expect(chartHistoryRange('1m',1)).toEqual({startTimeMs:0,endTimeMs:0});
 });
});

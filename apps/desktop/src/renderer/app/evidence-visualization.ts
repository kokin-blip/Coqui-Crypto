export function boundedMetricWidth(value:number,values:readonly number[]):string {
  if(!Number.isFinite(value)||values.some((item)=>!Number.isFinite(item))) return '0%';
  const magnitude=Math.max(1,...values.map((item)=>Math.abs(item)));
  return `${Math.max(2,Math.abs(value)/magnitude*100)}%`;
}

export function boundedRiskMeter(value:number|null):number|null {
  return value===null||!Number.isFinite(value)?null:Math.min(100,Math.max(0,value));
}

export function completedBarQuality(bars:readonly {readonly startTimeMs:number;readonly endTimeMs:number}[]) {
  const gaps=bars.slice(1).reduce((total,bar,index)=>
    total+(bar.startTimeMs>(bars[index]?.endTimeMs??bar.startTimeMs)?1:0),0);
  return {count:bars.length,gaps,latest:bars.at(-1)?.endTimeMs??null};
}

import { useEffect, useRef, useState } from 'react';
import { LineSeries, LineStyle, type UTCTimestamp, type ISeriesApi, type IChartApi } from 'lightweight-charts';
import type { ChannelResponse } from '@coqui/contracts';
import { formatUsd } from '@coqui/ui-kit';
import { createChartLifecycle } from './chart-lifecycle.js';
import { formatLocalTimestamp } from './time-format.js';

type Chart=ChannelResponse<'trading.activity.overview'>['closedChart'];
const money=(value:string)=>formatUsd(value)?.text??value;
export function ActivityPnlChart({data,label}:{readonly data:Chart;readonly label:string}):React.JSX.Element {
  const container=useRef<HTMLDivElement>(null);const api=useRef<IChartApi|null>(null);
  const series=useRef<ISeriesApi<'Line'>[]>([]);
  const [selected,setSelected]=useState<number|null>(null);
  const points=data.points;const pointsRef=useRef(points);pointsRef.current=points;
  useEffect(()=>{
    if(container.current===null||!data.available)return;
    const lifecycle=createChartLifecycle(container.current,{height:80,timeVisible:true});
    api.current=lifecycle.chart;
    lifecycle.chart.applyOptions({handleScale:false,handleScroll:false,timeScale:{visible:false},rightPriceScale:{visible:false},
      grid:{vertLines:{visible:false},horzLines:{visible:false}},crosshair:{horzLine:{labelVisible:false},vertLine:{labelVisible:false}}});
    lifecycle.chart.subscribeCrosshairMove(parameter=>{
      if(typeof parameter.time!=='number'){setSelected(null);return;}
      const atMs=Number(parameter.time)*1000;
      const index=pointsRef.current.findIndex(point=>Math.abs(point.atMs-atMs)<1);
      setSelected(index<0?null:index);
    });
    return ()=>{series.current=[];api.current=null;lifecycle.destroy();};
  },[data.available]);
  useEffect(()=>{
    const chart=api.current;if(chart===null||container.current===null)return;
    const style=getComputedStyle(container.current);
    const repaint=()=>{
      for(const item of series.current)chart.removeSeries(item);series.current=[];
      let segment:typeof points[number][]=[];
      const flush=()=>{
        if(segment.length===0)return;
        const last=segment.at(-1)!;
        const color=style.getPropertyValue(Number(last.valueUsd)<0?'--coqui-negative':'--coqui-positive').trim();
        const item=chart.addSeries(LineSeries,{color,lineWidth:2,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:true,
          pointMarkersVisible:segment.length===1,pointMarkersRadius:2});
        item.setData(segment.map(point=>({time:point.atMs/1000 as UTCTimestamp,value:Number(point.valueUsd)})));
        if(series.current.length===0)item.createPriceLine({price:0,color:style.getPropertyValue('--coqui-border').trim(),lineWidth:1,lineStyle:LineStyle.Dashed,axisLabelVisible:false});
        series.current.push(item);segment=[];
      };
      for(const point of points){if(point.valueUsd===null)flush();else segment.push(point);}flush();chart.timeScale().fitContent();
    };
    repaint();const theme=new MutationObserver(repaint);theme.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    return ()=>theme.disconnect();
  },[points,data.available]);
  const index=selected===null?points.length-1:Math.min(selected,points.length-1);
  const point=points[index];
  return <figure className="terminal-pnl-figure">
    {data.available?<>
      <div ref={container} className="terminal-pnl-canvas" role="img" tabIndex={0}
        aria-label={`${label}. Left and Right arrows inspect recorded observations.`}
        onKeyDown={event=>{if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight'&&event.key!=='Home'&&event.key!=='End')return;
          event.preventDefault();setSelected(event.key==='Home'?0:event.key==='End'?points.length-1:Math.max(0,Math.min(points.length-1,index+(event.key==='ArrowRight'?1:-1))));}}/>
      <figcaption aria-live="polite">{point===undefined?'No observation':`${formatLocalTimestamp(point.atMs)} · ${point.valueUsd===null?'Valuation unavailable':money(point.valueUsd)}`}</figcaption>
    </>:<p className="terminal-empty terminal-pnl-unavailable">{data.reason??'Performance history unavailable.'}</p>}
  </figure>;
}

import { mkdirSync,writeFileSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendOperationsActivity,openDatabase,OPERATIONS_WORKERS } from '@coqui/storage';
import { createOperationsJournalHandlers } from '../dist/main/operations-journal-handlers.js';
import { createDispatcher } from '../dist/main/dispatch.js';

const repository=dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const output=join(repository,'docs/implementation/evidence/coq32');mkdirSync(output,{recursive:true});
const db=openDatabase(':memory:'),now=1800000000000;
db.exec('BEGIN');
for(let i=0;i<5000;i++)appendOperationsActivity({profileId:'benchmark',workId:`host:group-${Math.floor(i/10)}`,
  attemptId:`benchmark-${i}`,worker:OPERATIONS_WORKERS[i%6],source:'host',phase:'recorded',status:'completed',
  atMs:now+i,deadlineAtMs:null,facts:{sequence:i,instruments:'BTC-USD'}},db);
db.exec('COMMIT');
const timings={uncachedIndex:[],uncachedGroup:[],cachedIndex:[]};
function dispatcher(){return createDispatcher({handlers:createOperationsJournalHandlers({profileId:'benchmark',database:db,now:()=>now+10000})});}
async function measure(name,dispatch,channel,payload){const start=globalThis.performance.now();const result=await dispatch(channel,payload);timings[name].push(globalThis.performance.now()-start);if(result.status!=='ok')throw new Error(JSON.stringify(result));return result;}
for(let i=0;i<20;i++){
  await measure('uncachedIndex',dispatcher(),'operations.journal',{worker:null,limit:5,cursor:null});
  await measure('uncachedGroup',dispatcher(),'operations.journal.group',{groupId:'host:group-499',worker:null,limit:50,cursor:null});
}
const cached=dispatcher();
await cached('operations.journal',{worker:null,limit:5,cursor:null});
for(let i=0;i<30;i++)await measure('cachedIndex',cached,'operations.journal',{worker:null,limit:5,cursor:null});
const metrics=Object.fromEntries(Object.entries(timings).map(([name,values])=>{const ordered=[...values].sort((a,b)=>a-b);return [name,{samples:values.length,p50Ms:ordered[Math.floor(ordered.length*.5)],p95Ms:ordered[Math.floor(ordered.length*.95)]}];}));
const report={fixtureOnly:true,eventCount:5000,groupCount:500,metrics,passed:Object.values(metrics).every(m=>m.p95Ms<100)};
writeFileSync(join(output,'read-performance.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));db.close();
if(!report.passed)process.exitCode=1;

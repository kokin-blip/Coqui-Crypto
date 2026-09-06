import { createHash } from 'node:crypto';
import { parentPort, workerData } from 'node:worker_threads';
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` :
  value !== null && typeof value === 'object' ? `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}` : JSON.stringify(value);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const compounded = (values) => (values.reduce((total,value) => total * (1 + value / 100), 1) - 1) * 100;
const drawdown = (values) => { let equity=1,peak=1,maximum=0; for (const value of values) { equity*=1+value/100; peak=Math.max(peak,equity); maximum=Math.max(maximum,(peak-equity)/peak*100); } return maximum; };
try {
  const e=workerData;
  if (e?.format !== 'coqui-research-worker-v1' || e?.protocolVersion !== 1 || e?.protocolHash !== hash('coqui-research-worker-v1:evaluate-candidate-v1')) throw new Error('invalid');
  const folds=e.snapshot.walkForwardReturns.map(compounded), returns=e.snapshot.oosReturns;
  parentPort.postMessage({format:'coqui-research-result-v1',jobId:e.jobId,candidateId:e.definition.candidateId,
    envelopeHash:hash(canonical(e)),metrics:{oosReturnPct:compounded(returns),walkForwardPassRate:folds.filter(v=>v>0).length/folds.length,
      stressReturnPct:compounded(e.snapshot.stressReturns),maxDrawdownPct:drawdown(returns),turnoverPct:e.definition.turnoverPct,
      significanceProbability:returns.filter(v=>v>0).length/returns.length,stabilityScore:folds.filter(v=>v>0).length/folds.length,trialCount:e.definition.trialCount}});
} catch { parentPort.postMessage({format:'coqui-research-error-v1',code:'invalid_envelope'}); }

import { assembleCapitalReplayResult, capitalReplayJsonBytes } from './capital-replay-report.js';
import { replayCapitalKernel, type ReplayRunControl } from './capital-replay-kernel.js';
import { validateCapitalReplay } from './capital-replay-tape.js';
import type { CapitalReplaySpecV1, CapitalReplayTapeV1, ReplayCell, ReplayCellResult, CapitalReplayResultV1 } from './capital-replay-types.js';
export type { ReplayRunControl } from './capital-replay-kernel.js';
/** Frozen v1 API: no dynamic decision or execution-policy port. */
export function replayCapitalCell(spec:CapitalReplaySpecV1,tape:CapitalReplayTapeV1,cell:ReplayCell,control:ReplayRunControl={}):ReplayCellResult{
 return replayCapitalKernel(spec,tape,cell,control.check?{check:control.check}:{});
}
export function replayCapitalPath(spec:CapitalReplaySpecV1,tape:CapitalReplayTapeV1,control:ReplayRunControl={}):CapitalReplayResultV1{
 validateCapitalReplay(spec,tape);const cells:ReplayCellResult[]=[];let size=0;
 for(const cell of spec.cells){control.check?.();const result=replayCapitalCell(spec,tape,cell,control);control.check?.();size+=capitalReplayJsonBytes(result);if(size>64*1024*1024)throw new Error('replay_output_bound');cells.push(result);}
 return assembleCapitalReplayResult(spec,cells);
}

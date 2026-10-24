import {capitalHash,canonicalJson,capitalReplayJsonBytes,type CanonicalJsonValue,type CapitalContestManifestV1,type ContestCellV1,type ContestPathV1,type ContestResultV1} from '@coqui/core';
import {capitalContestManifestSchema,contestCellSchema,contestPathSchema,capitalContestResultSchema} from '@coqui/contracts';
import {appendIntegrityEvent} from './research-integrity.js';
import type {Db} from '../sqlite/index.js';
export const CAPITAL_CONTEST_KINDS=['contest_spec','contest_inventory','contest_attempt','contest_input','contest_cell','contest_path','contest_chunk','contest_result','contest_choice','contest_failure','contest_interrupted'] as const;
export type ContestRecordKind=typeof CAPITAL_CONTEST_KINDS[number];
const ns=(id:string)=>{if(!/^[a-f0-9]{64}$/u.test(id))throw new Error('contest_invalid_id');return `capital-contest:${id}`;};
interface Row {namespace:string;kind:string;record_key:string;at_ms:number;body_json:string;content_hash:string}
function decode(row:Row){if(Buffer.byteLength(row.body_json)>1_000_000)throw new Error('contest_record_bound');const e={namespace:row.namespace,kind:row.kind,key:row.record_key,atMs:row.at_ms,body:JSON.parse(row.body_json) as CanonicalJsonValue};if(capitalHash(e)!==row.content_hash)throw new Error('contest_record_hash');return {...e,hash:row.content_hash};}
export function contestRecords(id:string,kind:ContestRecordKind,db:Db,limit=100000){
 if(!Number.isSafeInteger(limit)||limit<1||limit>100001)throw new Error('contest_read_bound');
 const rows=db.prepare('SELECT namespace,kind,record_key,at_ms,body_json,content_hash FROM research_integrity_events WHERE namespace=? AND kind=? ORDER BY sequence LIMIT ?').all(ns(id),kind,limit+1) as unknown as Row[];
 if(rows.length>limit)throw new Error('contest_record_count_bound');return rows.map(decode);
}
export function appendContestRecord(id:string,kind:ContestRecordKind,key:string,body:CanonicalJsonValue,atMs:number,db:Db){
 if(!CAPITAL_CONTEST_KINDS.includes(kind)||!key||key.length>256||capitalReplayJsonBytes(body)>1_000_000)throw new Error('contest_record_invalid');
 const prior=db.prepare('SELECT * FROM research_integrity_events WHERE namespace=? AND kind=? AND record_key=?').get(ns(id),kind,key) as Row|undefined;
 if(prior){const e=decode(prior);if(canonicalJson(e.body)!==canonicalJson(body))throw new Error('contest_record_conflict');return e.hash;}
 return appendIntegrityEvent({namespace:ns(id),kind,key,body,atMs},db);
}
interface Pointer {hashes:readonly string[];contentHash:string;characters:number}
export function saveContestValue(id:string,kind:ContestRecordKind,key:string,value:unknown,atMs:number,db:Db):void{
 const payload=canonicalJson(value as CanonicalJsonValue);if(capitalReplayJsonBytes(value)>64*1024*1024)throw new Error('contest_batch_output_bound');
 const prefix=capitalHash({kind,key}),hashes:string[]=[];
 for(let i=0;i<Math.ceil(payload.length/200000);i++)hashes.push(appendContestRecord(id,'contest_chunk',`${prefix}:${i}`,{payload:payload.slice(i*200000,(i+1)*200000),index:i},atMs,db));
 appendContestRecord(id,kind,key,{hashes,contentHash:capitalHash(value),characters:payload.length},atMs,db);
}
export function readContestValue(id:string,kind:ContestRecordKind,key:string,db:Db):unknown|null{
 const row=db.prepare('SELECT * FROM research_integrity_events WHERE namespace=? AND kind=? AND record_key=?').get(ns(id),kind,key) as Row|undefined;
 if(!row)return null;const p=decode(row).body as unknown as Pointer;if(!Array.isArray(p.hashes)||p.hashes.length>400||!Number.isSafeInteger(p.characters)||p.characters>64*1024*1024||p.characters<0)throw new Error('contest_pointer_invalid');
 const prefix=capitalHash({kind,key});let payload='';
 for(const [i,hash] of p.hashes.entries()){const raw=db.prepare('SELECT * FROM research_integrity_events WHERE namespace=? AND kind=? AND record_key=?').get(ns(id),'contest_chunk',`${prefix}:${i}`) as Row|undefined;
  const chunk=raw?decode(raw):null,body=chunk?.body as {payload:string;index:number}|undefined;if(chunk?.hash!==hash||body?.index!==i||typeof body.payload!=='string'||body.payload.length>200000||payload.length+body.payload.length>p.characters)throw new Error('contest_chunk_mismatch');payload+=body.payload;
 }
 if(payload.length!==p.characters)throw new Error('contest_size_mismatch');const value=JSON.parse(payload) as unknown;if(capitalHash(value)!==p.contentHash)throw new Error('contest_content_mismatch');return value;
}
export function saveContestManifest(m:CapitalContestManifestV1,atMs:number,db:Db){const parsed=capitalContestManifestSchema.parse(m),id=capitalHash(parsed);saveContestValue(id,'contest_spec','spec',parsed,atMs,db);saveContestValue(id,'contest_inventory','inventory',parsed.trials,atMs,db);return id;}
export function readContestManifest(id:string,db:Db):CapitalContestManifestV1|null{const v=readContestValue(id,'contest_spec','spec',db);if(v===null)return null;const m=capitalContestManifestSchema.parse(v);if(capitalHash(m)!==id)throw new Error('contest_manifest_hash');return m;}
export function readContestCell(id:string,key:string,db:Db):ContestCellV1|null{const v=readContestValue(id,'contest_cell',key,db);if(v===null)return null;const c=contestCellSchema.parse(v),{id:hash,...body}=c.result;if(capitalHash(body)!==hash||capitalHash(c.decisions.map(e=>e.decision))!==c.targetHash)throw new Error('contest_cell_content_hash');return c;}
export function readContestPath(id:string,key:string,db:Db):ContestPathV1|null{const v=readContestValue(id,'contest_path',key,db);if(v===null)return null;const path=contestPathSchema.parse(v),{id:hash,...body}=path;if(capitalHash({manifest:id,...body})!==hash)throw new Error('contest_path_content_hash');return path;}
export function readContestResult(id:string,db:Db):ContestResultV1|null{const v=readContestValue(id,'contest_result','result',db);if(v===null)return null;const result=capitalContestResultSchema.parse(v),{id:hash,...body}=result;if(result.manifestHash!==id||capitalHash(body)!==hash)throw new Error('contest_result_hash');return result;}
export function contestIds(db:Db,limit:number){if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('contest_list_bound');return (db.prepare("SELECT namespace FROM research_integrity_events WHERE kind='contest_spec' AND namespace LIKE 'capital-contest:%' ORDER BY sequence DESC LIMIT ?").all(limit) as {namespace:string}[]).map(r=>r.namespace.slice(16));}
export function contestStoredBytes(id:string,db:Db){return Number(db.prepare('SELECT coalesce(sum(length(cast(body_json AS blob))),0) AS n FROM research_integrity_events WHERE namespace=?').get(ns(id))?.['n']);}

export function contestRecordCount(id:string,kind:ContestRecordKind,db:Db){return Number(db.prepare('SELECT COUNT(*) AS n FROM research_integrity_events WHERE namespace=? AND kind=?').get(ns(id),kind)?.['n']);}

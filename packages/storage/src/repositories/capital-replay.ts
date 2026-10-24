import { capitalReplayJsonBytes, validateCapitalReplay, canonicalJson, capitalHash, type CanonicalJsonValue, type CapitalReplaySpecV1, type CapitalReplayTapeV1, type CapitalReplayResultV1 } from '@coqui/core';
import { capitalReplaySpecSchema, capitalReplayResultSchema } from '@coqui/contracts';
import { appendIntegrityEvent, type IntegrityEvent } from './research-integrity.js';
import type { Db } from '../sqlite/index.js';
export const CAPITAL_REPLAY_KINDS=['capital_replay_spec','capital_replay_attempt','capital_replay_input','capital_replay_chunk','capital_replay_result','capital_replay_failure','capital_replay_interrupted'] as const;
export type CapitalReplayRecordKind=typeof CAPITAL_REPLAY_KINDS[number];
interface Row {namespace:string;kind:string;record_key:string;at_ms:number;body_json:string;content_hash:string}
const namespace=(hash:string)=>{if(!/^[a-f0-9]{64}$/u.test(hash))throw new TypeError('replay_invalid_id');return `capital-replay:${hash}`;};
function decode(row:Row):IntegrityEvent {
 if(row.body_json.length>1_000_000)throw new Error('replay_record_bound');
 const event={namespace:row.namespace,kind:row.kind,key:row.record_key,atMs:row.at_ms,body:JSON.parse(row.body_json) as CanonicalJsonValue};
 if(capitalHash(event)!==row.content_hash)throw new Error('replay_record_hash_mismatch');return {...event,hash:row.content_hash};
}
export function replayRecords(specHash:string,kind:CapitalReplayRecordKind,db:Db,limit=1000):readonly IntegrityEvent[]{
 if(!Number.isSafeInteger(limit)||limit<1||limit>2000)throw new TypeError('replay_read_bound');
 const rows=db.prepare('SELECT namespace,kind,record_key,at_ms,body_json,content_hash FROM research_integrity_events WHERE namespace=? AND kind=? ORDER BY sequence LIMIT ?').all(namespace(specHash),kind,limit+1) as unknown as Row[];
 if(rows.length>limit)throw new Error('replay_record_count_bound');return rows.map(decode);
}
export function appendReplayRecord(specHash:string,kind:CapitalReplayRecordKind,key:string,body:CanonicalJsonValue,atMs:number,db:Db):string {
 if(!CAPITAL_REPLAY_KINDS.includes(kind)||!key||key.length>256||capitalReplayJsonBytes(body)>1_000_000)throw new TypeError('replay_record_invalid');
 const prior=db.prepare('SELECT * FROM research_integrity_events WHERE namespace=? AND kind=? AND record_key=?').get(namespace(specHash),kind,key) as Row|undefined;
 if(prior){const event=decode(prior);if(canonicalJson(event.body)!==canonicalJson(body))throw new Error('replay_record_conflict');return event.hash;}
 return appendIntegrityEvent({namespace:namespace(specHash),kind,key,body,atMs},db);
}
export function saveReplaySpec(spec:CapitalReplaySpecV1,atMs:number,db:Db):string{
 const parsed=capitalReplaySpecSchema.parse(spec),hash=validateCapitalReplay(parsed);appendReplayRecord(hash,'capital_replay_spec','spec',parsed as unknown as CanonicalJsonValue,atMs,db);return hash;
}
export function readReplaySpec(specHash:string,db:Db):CapitalReplaySpecV1|null{
 const row=replayRecords(specHash,'capital_replay_spec',db,1)[0];if(!row)return null;const spec=capitalReplaySpecSchema.parse(row.body);
 if(capitalHash(spec)!==specHash)throw new Error('replay_spec_hash_mismatch');return spec;
}
interface ChunkManifest {attemptId:string;contentHash:string;hashes:string[];characters:number}
export function saveReplayChunks(specHash:string,attemptId:string,kind:'capital_replay_input'|'capital_replay_chunk',value:CapitalReplayTapeV1|CapitalReplayResultV1,atMs:number,db:Db):ChunkManifest{
 const payload=canonicalJson(value as unknown as CanonicalJsonValue);if(capitalReplayJsonBytes(value)>64*1024*1024)throw new Error('replay_output_bound');
 const pieces=Array.from({length:Math.ceil(payload.length/250_000)},(_,i)=>payload.slice(i*250_000,(i+1)*250_000));
 const hashes=pieces.map((payload,index)=>appendReplayRecord(specHash,kind,`${attemptId}:${index}`,{attemptId,index,payload},atMs,db));
 return {attemptId,contentHash:capitalHash(value),hashes,characters:payload.length};
}
export function readReplayResult(specHash:string,db:Db):CapitalReplayResultV1|null{
 const roots=replayRecords(specHash,'capital_replay_result',db,100);const root=roots.at(-1);if(!root)return null;
 const m=root.body as unknown as ChunkManifest;if(!Array.isArray(m.hashes)||m.hashes.length>300||m.characters>64*1024*1024)throw new Error('replay_manifest_invalid');
 const findChunk=db.prepare('SELECT namespace,kind,record_key,at_ms,body_json,content_hash FROM research_integrity_events WHERE namespace=? AND kind=? AND record_key=?');let payload='';
 for(const [index,hash] of m.hashes.entries()){
  const stored=findChunk.get(namespace(specHash),'capital_replay_chunk',`${m.attemptId}:${index}`) as Row|undefined;
  const row=stored?decode(stored):undefined;const body=row?.body as {attemptId:string;index:number;payload:string}|undefined;
  if(!row||row.hash!==hash||!body||body.attemptId!==m.attemptId||body.index!==index||typeof body.payload!=='string')throw new Error('replay_chunk_missing_or_conflicting');payload+=body.payload;
 }
 if(payload.length!==m.characters)throw new Error('replay_result_size_mismatch');
 const result=capitalReplayResultSchema.parse(JSON.parse(payload));
 if(result.specHash!==specHash||capitalHash(result)!==m.contentHash)throw new Error('replay_result_manifest_mismatch');
 const {id,...material}=result;if(capitalHash(material)!==id)throw new Error('replay_result_content_mismatch');return result;
}
export function replaySpecIds(db:Db,limit:number):readonly string[]{
 if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new TypeError('replay_list_bound');
 return (db.prepare("SELECT namespace FROM research_integrity_events WHERE kind='capital_replay_spec' AND namespace LIKE 'capital-replay:%' ORDER BY sequence DESC LIMIT ?").all(limit) as {namespace:string}[]).map(r=>r.namespace.slice('capital-replay:'.length));
}

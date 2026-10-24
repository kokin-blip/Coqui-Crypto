import {readFileSync,realpathSync,lstatSync,statSync,mkdirSync,writeFileSync,renameSync,existsSync,rmSync,openSync,closeSync,readSync,fstatSync,constants} from 'node:fs';
import {dirname,resolve,relative,isAbsolute,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {capitalHash,canonicalJson,validateContestData,type CanonicalJsonValue,type CapitalContestManifestV1,type ContestResultV1,type ContestInputManifestV1} from '@coqui/core';
import {contestInputSchema,capitalContestResultSchema} from '@coqui/contracts';
function boundedFile(path:string,limit:number,expected?:number):Buffer{
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const size=fstatSync(fd).size;if(!Number.isSafeInteger(size)||size<1||size>limit||expected!==undefined&&size!==expected)throw new Error('contest_file_bound');
  const buffer=Buffer.alloc(size+1);let read=0;while(read<=size){const count=readSync(fd,buffer,read,size+1-read,read);if(!count)break;read+=count;}
  if(read!==size)throw new Error('contest_file_changed_during_read');return buffer.subarray(0,size);
 }finally{closeSync(fd);}
}
export interface ContestFileManifest {readonly version:1;readonly kind:'json_panel';readonly exposure:'synthetic'|'exposed_development';readonly provider:'coinbase'|'alpaca';readonly warmupFromMs:number;readonly fromMs:number;readonly toMs:number;readonly file:{readonly path:string;readonly bytes:number;readonly sha256:string}}
/** A dedicated physically bounded panel. No archive acquisition/verifier, credentials or market query. */
export function loadContestData(m:CapitalContestManifestV1,path:string):ContestInputManifestV1{
 const manifestPath=realpathSync(path);if(statSync(manifestPath).size>1_000_000)throw new Error('contest_file_manifest_bound');
 const file=JSON.parse(boundedFile(manifestPath,1_000_000).toString('utf8')) as ContestFileManifest;
 if(file.version!==1||file.kind!=='json_panel'||file.exposure!==m.replay.exposure||file.provider!==m.replay.provider||file.fromMs!==m.replay.fromMs||file.toMs!==m.replay.toMs||file.warmupFromMs!==m.replay.warmupFromMs||!m.sourceRefs.includes(capitalHash(file)))throw new Error('contest_physical_partition_mismatch');
 const root=dirname(manifestPath),full=resolve(root,file.file.path),part=relative(root,full);
 if(isAbsolute(file.file.path)||!part||part.startsWith('..')||isAbsolute(part)||lstatSync(full).isSymbolicLink())throw new Error('contest_path_refused');
 const actual=realpathSync(full),realPart=relative(root,actual);if(!realPart||realPart.startsWith('..')||isAbsolute(realPart)||!statSync(actual).isFile()||!Number.isSafeInteger(file.file.bytes)||file.file.bytes<1||file.file.bytes>64*1024*1024||statSync(actual).size!==file.file.bytes)throw new Error('contest_panel_bound');
 const raw=boundedFile(actual,64*1024*1024,file.file.bytes);if(createHash('sha256').update(raw).digest('hex')!==file.file.sha256)throw new Error('contest_panel_hash');
 const data=contestInputSchema.parse(JSON.parse(raw.toString('utf8')));validateContestData(m,data);return data;
}
export function exportCapitalContest(m:CapitalContestManifestV1,result:ContestResultV1,outputRoot:string):string{
 const parsed=capitalContestResultSchema.parse(result),{id:resultId,...resultBody}=parsed;if(capitalHash(resultBody)!==resultId)throw new Error('contest_export_content_hash');
 if(capitalHash(m)!==result.manifestHash)throw new Error('contest_export_identity');
 const root=realpathSync(outputRoot);if(!statSync(root).isDirectory())throw new Error('contest_output_root');const target=join(root,result.id);
 const spec=canonicalJson(m as unknown as CanonicalJsonValue)+'\n',body=canonicalJson(result as unknown as CanonicalJsonValue)+'\n';
 if(existsSync(target)){if(lstatSync(target).isSymbolicLink()||readFileSync(join(target,'manifest.json'),'utf8')!==spec||readFileSync(join(target,'result.json'),'utf8')!==body)throw new Error('contest_export_conflict');return target;}
 const temporary=join(root,`.contest-${randomUUID()}`);mkdirSync(temporary);
 try{writeFileSync(join(temporary,'manifest.json'),spec,{flag:'wx'});writeFileSync(join(temporary,'result.json'),body,{flag:'wx'});renameSync(temporary,target);return target;}catch(error){rmSync(temporary,{recursive:true,force:true});throw error;}
}

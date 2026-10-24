import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {capitalHash} from '@coqui/core';
import {loadContestData} from '@coqui/services';
import {contestFixture} from './helpers/capital-contest.js';
function fixture(){const {manifest:m,data}=contestFixture(),dir=mkdtempSync(join(tmpdir(),'coqui-p5-data-')),body=JSON.stringify(data),file={version:1,kind:'json_panel',exposure:'synthetic',provider:'coinbase',warmupFromMs:m.replay.warmupFromMs,fromMs:m.replay.fromMs,toMs:m.replay.toMs,file:{path:'panel.json',bytes:Buffer.byteLength(body),sha256:createHash('sha256').update(body).digest('hex')}};writeFileSync(join(dir,'panel.json'),body);writeFileSync(join(dir,'input.json'),JSON.stringify(file));return {dir,m:{...m,sourceRefs:[capitalHash(file)]},data,file};}
it('loads exact decimal panel evidence bound to the physical manifest',()=>{const {dir,m,data}=fixture();try{expect(loadContestData(m,join(dir,'input.json'))).toEqual(data);}finally{rmSync(dir,{recursive:true,force:true});}});
it('rejects mismatched physical bounds before opening a missing panel',()=>{const {dir,m,file}=fixture();try{rmSync(join(dir,'panel.json'));writeFileSync(join(dir,'input.json'),JSON.stringify({...file,toMs:file.toMs+86400000}));expect(()=>loadContestData(m,join(dir,'input.json'))).toThrow('partition');}finally{rmSync(dir,{recursive:true,force:true});}});
it('rejects replacement bytes and symbolic panel links',()=>{const {dir,m}=fixture();try{writeFileSync(join(dir,'panel.json'),'{}');expect(()=>loadContestData(m,join(dir,'input.json'))).toThrow();rmSync(join(dir,'panel.json'));symlinkSync(join(dir,'input.json'),join(dir,'panel.json'));expect(()=>loadContestData(m,join(dir,'input.json'))).toThrow('path_refused');}finally{rmSync(dir,{recursive:true,force:true});}});

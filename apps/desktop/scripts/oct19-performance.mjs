import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const desktop=dirname(dirname(fileURLToPath(import.meta.url)));
const output=join(desktop,'../../docs/implementation/evidence/oct19/performance');
mkdirSync(output,{recursive:true});
const build=JSON.parse(readFileSync(join(desktop,'dist/main/build-info.json'),'utf8'));
async function run(name,seconds){
  const startedAtMs=Date.now();
  return await new Promise((resolve,reject)=>{
    let stdout='',stderr='';
    const child=spawn(electron,['scripts/terminal-perf.mjs'],{cwd:desktop,env:{...process.env,
      COQUI_PERF_SECONDS:String(seconds),COQUI_PERF_AUDIT:'1',COQUI_PERF_INTERACTIONS:'1'},timeout:(seconds+180)*1000});
    child.stdout.on('data',data=>{stdout+=data;});
    child.stderr.on('data',data=>{stderr+=data;process.stderr.write(data);});
    child.on('error',reject);
    child.on('exit',(code,signal)=>{
      const lines=stdout.trim().split('\n');
      const line=lines.reverse().find(line=>line.startsWith('{')&&line.includes('shellMs'));
      const result={name,startedAtMs,completedAtMs:Date.now(),exitCode:code,signal,build,
        measurements:line?JSON.parse(line):null,stderr};
      writeFileSync(join(output,`${name}.json`),JSON.stringify(result,null,2)+'\n');
      console.log(JSON.stringify({name,exitCode:code,shellMs:result.measurements?.shellMs}));
      if(code!==0)reject(new Error(`${name} failed; receipt retained`));else resolve(result);
    });
  });
}
for(let i=1;i<=5;i++)await run(`cold-${i}`,0);
await run('retention-30min',1800);

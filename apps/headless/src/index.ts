#!/usr/bin/env node
import { resolve } from 'node:path';

import { createRuntime, type CoquiRuntime } from '@coqui/desktop';
import { SystemClock } from '@coqui/core';
import { recoverPaperOrdersAtStartup } from '@coqui/services';
import { assignAuthoritativeHost, getAuthoritativeHost, heartbeatAuthoritativeHost, openDatabase,
  recordHostReconciliation, relinquishAuthoritativeHost, takeoverAuthoritativeHost } from '@coqui/storage';

const HELP=`Usage: coqui-headless <start|tick|recover|status|stop|assign|relinquish|takeover>
  [--database=data/coqui.sqlite] [--profile=main] [--host=headless-local]

Authority changes require --confirm. Takeover performs reconciliation first.
This local CLI opens no listener, enrolls no credentials, and remains paper-only.`;
const rawArgs=process.argv.slice(2), args=rawArgs[0]==='--'?rawArgs.slice(1):rawArgs;
function option(name:string):string|undefined { const prefix=`--${name}=`;
  return args.slice(1).find((value)=>value.startsWith(prefix))?.slice(prefix.length); }
function confirmed():boolean { return args.slice(1).includes('--confirm'); }
function print(value:unknown):void { process.stdout.write(`${JSON.stringify(value,null,2)}\n`); }

const command=args[0];
if (command===undefined || command==='help' || args.includes('--help') || args.includes('-h')) {
  process.stdout.write(`${HELP}\n`); process.exit(0);
}
const profileId=option('profile')??'main', hostId=option('host')??'headless-local';
const databaseOption=option('database')??'data/coqui.sqlite';
const databasePath=databaseOption===':memory:'?databaseOption:resolve(databaseOption);
const clock=new SystemClock(()=>Date.now());

function requireConfirmation():void { if (!confirmed()) throw new Error('confirmation_required'); }
function requireOwnership(database:ReturnType<typeof openDatabase>) {
  const current=getAuthoritativeHost(profileId,database);
  if (current?.status!=='active' || current.hostId!==hostId) throw new Error('headless_host_not_authoritative');
  return current;
}
function reconcile(database:ReturnType<typeof openDatabase>):string {
  const current=getAuthoritativeHost(profileId,database), at=clock.nowMs();
  const result=recoverPaperOrdersAtStartup({database,clock,profileId});
  return recordHostReconciliation({profileId,hostId,observedGeneration:current?.fencingGeneration??0,
    at,detail:{kind:'paper_startup_reconciliation',...result}},database);
}
async function oneShotTick():Promise<void> {
  const probe=openDatabase(databasePath); requireOwnership(probe); probe.close();
  const runtime=createRuntime({databasePath,profileId,hostId,disableScheduler:true});
  try { runtime.startScheduler(); if (runtime.scheduler===null) throw new Error('headless_scheduler_not_started');
    await runtime.scheduler.tick(); print({ok:true,command:'tick',hostId,profileId,status:runtime.scheduler.status()});
  } finally { runtime.dispose(); }
}
async function start():Promise<void> {
  const probe=openDatabase(databasePath), authority=requireOwnership(probe); probe.close();
  const runtime:CoquiRuntime=createRuntime({databasePath,profileId,hostId});
  if(runtime.scheduler===null){runtime.dispose();throw new Error('headless_scheduler_not_started');}
  let stopping=false;
  const stop=():void=>{ if(stopping)return; stopping=true; clearInterval(control); runtime.dispose(); };
  const control=setInterval(()=>{
    const database=openDatabase(databasePath);
    try { if(!heartbeatAuthoritativeHost(profileId,hostId,authority.fencingGeneration,clock.nowMs(),database)) stop(); }
    finally { database.close(); }
  },5_000); control.unref?.();
  process.once('SIGINT',stop); process.once('SIGTERM',stop);
  print({ok:true,command:'start',hostId,profileId,paperOnly:true});
  await new Promise<void>((done)=>{ const wait=setInterval(()=>{if(stopping){clearInterval(wait);done();}},250); });
}

async function main():Promise<void> {
  if(command==='tick'){await oneShotTick();return;}
  if(command==='start'){await start();return;}
  const database=openDatabase(databasePath);
  try {
    if(command==='status'){print({ok:true,profileId,authority:getAuthoritativeHost(profileId,database),paperOnly:true});return;}
    if(command==='recover'){const current=requireOwnership(database); const reconciliationId=reconcile(database);
      print({ok:true,command,reconciliationId,fencingGeneration:current.fencingGeneration});return;}
    requireConfirmation();
    if(command==='assign'){print({ok:true,authority:assignAuthoritativeHost(profileId,hostId,'headless',clock.nowMs(),database)});return;}
    if(command==='stop'||command==='relinquish'){const current=requireOwnership(database);
      print({ok:true,authority:relinquishAuthoritativeHost(profileId,hostId,current.fencingGeneration,clock.nowMs(),database)});return;}
    if(command==='takeover'){const reconciliationId=reconcile(database);
      print({ok:true,reconciliationId,authority:takeoverAuthoritativeHost({profileId,hostId,hostKind:'headless',reconciliationId,at:clock.nowMs()},database)});return;}
    throw new Error('unknown_command');
  } finally { database.close(); }
}
main().catch((error:unknown)=>{process.stderr.write(`Headless command failed: ${error instanceof Error?error.message:'unknown_error'}\n`);process.exitCode=1;});

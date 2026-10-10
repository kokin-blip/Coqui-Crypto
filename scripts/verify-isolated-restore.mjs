import { parseArgs } from 'node:util';
import { readFileSync,realpathSync,writeFileSync } from 'node:fs';
import { dirname,basename,join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { newsEvidenceHash } from '../packages/core/dist/index.js';
import { createFileProfileBackupStore,verifyIsolatedRestore,migrations } from '../packages/storage/dist/index.js';
const {values}=parseArgs({options:{backup:{type:'string'},destination:{type:'string'},artifacts:{type:'string'},'build-identity':{type:'string'}}});
try {
  if(!values.backup||!values.destination||!values['build-identity'])throw new Error('arguments_required');
  const backup=realpathSync(values.backup),root=realpathSync(tmpdir()),destination=resolve(values.destination);
  const store=createFileProfileBackupStore(root,dirname(backup)),verified=await store.verify(basename(backup));
  if(!verified.ok||verified.backup.schemaVersion!==migrations.at(-1).version)throw new Error('backup_incompatible');
  const artifacts=values.artifacts?JSON.parse(readFileSync(values.artifacts,'utf8')):[];
  if(!Array.isArray(artifacts)||artifacts.length>1000||artifacts.some(a=>!a||typeof a.path!=='string'||typeof a.hash!=='string'||Object.keys(a).sort().join(',')!=='hash,path'))throw new Error('artifacts_invalid');
  const proof=verifyIsolatedRestore({sourceDatabase:join(backup,'profile.db'),destination,disposableRoot:root,
    expectedDatabaseHash:verified.backup.databaseSha256,schemaVersion:verified.backup.schemaVersion,
    buildIdentity:values['build-identity'],artifacts});
  const body={verification:proof,backupManifestHash:verified.backup.manifestSha256};
  writeFileSync(join(destination,'restore-proof.json'),JSON.stringify({...body,manifestHash:newsEvidenceHash(body)},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({proofHash:proof.proofHash,scope:proof.scope,credentialsIncluded:false,applicationStarted:false}));
}catch{console.error('Isolated restore verification failed; preserve the source and any incomplete disposable destination.');process.exitCode=1;}

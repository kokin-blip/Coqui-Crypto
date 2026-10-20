// Install the locally verified bundle atomically, preserving the prior app for rollback.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { URL } from 'node:url';
const repo=resolve(new URL('../../../..',import.meta.url).pathname);
const source=resolve(repo,'apps/desktop/release/local-beta18/mac-arm64/Coqui.app');
const target='/Applications/Coqui.app';
const staging='/Applications/.Coqui-fee-beta18-staging.app';
const backup='/Applications/.Coqui-beta17-backup-before-beta18-2026-10-20.app';
if(existsSync(staging)||existsSync(backup))throw new Error('Preserve existing installation paths; inspect before retrying.');
const version=execFileSync('/usr/bin/plutil',['-extract','CFBundleShortVersionString','raw',`${source}/Contents/Info.plist`],{encoding:'utf8'}).trim();
if(version!=='0.1.0-beta.18')throw new Error('Unexpected source version.');
const asar=path=>`${path}/Contents/Resources/app.asar`;
const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const expected=digest(asar(source));
const running=execFileSync('/bin/ps',['-ax','-o','command='],{encoding:'utf8'}).split('\n')
  .some(line=>line.startsWith('/Applications/Coqui.app/Contents/MacOS/Coqui'));
if(running)throw new Error('Quit Coqui before replacing its bundle.');
execFileSync('/usr/bin/ditto',[source,staging]);
execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',staging]);
if(digest(asar(staging))!==expected)throw new Error('Staged archive differs from verified bundle.');
renameSync(target,backup);
try { renameSync(staging,target); }
catch(error){renameSync(backup,target);throw error;}
execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',target]);
const result={version,installedApp:target,rollbackApp:backup,installedAsarSha256:digest(asar(target)),matchesPackagedArchive:digest(asar(target))===expected};
writeFileSync(resolve(repo,'docs/implementation/evidence/oct20/beta18-installation.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));

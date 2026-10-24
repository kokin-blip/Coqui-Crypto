import subprocess,tempfile,pathlib,json,shutil,hashlib
root=pathlib.Path.cwd();sha=lambda b:hashlib.sha256(b).hexdigest()
manifest=json.loads((root/'docs/implementation/evidence/p4-replay-2026-10-23/source-hashes.json').read_text());baseline=json.loads((root/'docs/implementation/evidence/p4-replay-2026-10-23/baseline.json').read_text());hashes={r['path']:r['sha256'] for r in baseline['dirtyFiles']}
assert not subprocess.check_output(['git','diff','--cached','--name-only']).strip()
for r in manifest:assert sha((root/r['path']).read_bytes())==r['sha256'],r['path']
paths=subprocess.check_output(['git','ls-files','-m','-o','--exclude-standard','-z']).decode().split('\0')
pathlib.Path('/tmp/coqui-p4-push-baseline.json').write_text(json.dumps([{'path':p,'sha256':sha((root/p).read_bytes()) if (root/p).is_file() else None} for p in sorted(set(paths)) if p],indent=2))
dest=pathlib.Path(tempfile.mkdtemp(prefix='coqui-p4-commit-'))
subprocess.run(['git','clone','--shared','--quiet',str(root),str(dest)],check=True)
mixed=['apps/desktop/src/main/composition.ts','apps/desktop/src/renderer/query/refetch.ts','apps/desktop/src/renderer/styles/terminal.css','package.json','packages/contracts/src/channels.ts','tests/contracts-channels.test.ts']
for r in manifest:
 p=r['path']
 if p in ['docs/studies/behavior-manifests-v1.json','packages/core/src/research/study-manifests.generated.ts']:continue
 target=dest/p;target.parent.mkdir(parents=True,exist_ok=True)
 if p not in mixed:shutil.copy2(root/p,target);continue
 before=subprocess.check_output(['git','show','HEAD:'+p],cwd=root,text=True);current=(root/p).read_text();s=before
 if p==mixed[0]:s=s.replace("import { createPaperReviewHandlers }", "import { createCapitalReplayHandlers } from './capital-replay-handlers.js'; import { createPaperReviewHandlers }").replace('...createResearchOrchestrationHandlers({coordinator:researchHost,clock}),','...createResearchOrchestrationHandlers({coordinator:researchHost,clock}), ...createCapitalReplayHandlers(options.profileId,database),')
 elif p==mixed[1]:
  lines=''.join(l for l in current.splitlines(keepends=True) if "'research.capital-replay." in l);s=s.replace('export const CHANNEL_REFETCH_POLICY', 'export const CHANNEL_REFETCH_POLICY')
  anchor=next(l for l in before.splitlines(keepends=True) if "'research.scoreboard'" in l);s=s.replace(anchor,lines+anchor)
 elif p==mixed[2]:s+= '\n.capital-replay p {'+current.split('\n.capital-replay p {',1)[1]
 elif p==mixed[3]:s=s.replace('    "research:overlay": "pnpm build && node scripts/research-overlay.mjs",\n','    "research:overlay": "pnpm build && node scripts/research-overlay.mjs",\n    "research:capital-replay": "pnpm build && node scripts/research-capital-replay.mjs",\n')
 elif p==mixed[4]:s="import { capitalReplayChannelSchemas } from './schemas/capital-replay.js';\n"+s;s=s.replace('export const CHANNEL_SCHEMAS = {','export const CHANNEL_SCHEMAS = {')
 elif p==mixed[5]:s=s.replace("'research.candidate.rollback',", "'research.candidate.rollback', 'research.capital-replay.detail', 'research.capital-replay.runs',",1)
 if p==mixed[4]:
  # Registry name is stable, but retain its current spelling.
  anchor=next(l for l in before.splitlines(keepends=True) if '...operationsJournalChannelSchemas,' in l);s=s.replace(anchor,'  ...capitalReplayChannelSchemas,\n'+anchor)
 assert s!=before,p
 target.write_text(s)
shutil.copytree(root/'docs/implementation/evidence/p4-replay-2026-10-23',dest/'docs/implementation/evidence/p4-replay-2026-10-23',dirs_exist_ok=True)
for package in [pathlib.Path('.'),*[(p.relative_to(root)) for p in (root/'packages').iterdir() if p.is_dir()],pathlib.Path('apps/desktop'),pathlib.Path('apps/headless')]:
 folder=root/package/'node_modules'
 if not folder.is_dir():continue
 target=dest/package/'node_modules';target.mkdir(parents=True,exist_ok=True)
 for entry in folder.iterdir():
  if entry.name.startswith('.vite') or entry.name=='.cache':continue
  if entry.name=='@coqui':
   (target/entry.name).mkdir(exist_ok=True)
   for link in entry.iterdir():(target/entry.name/link.name).symlink_to(str(link.resolve()).replace(str(root),str(dest)))
  else:(target/entry.name).symlink_to(entry.resolve())
record={'candidate':str(dest),'base':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'mixed':mixed,'sourceFiles':len(manifest),'Prompt used':'Commit and push P4, then lets move on to P5. Reread its full requirements in the saved roadmap, inspect the code, and prepare a concrete implementation plan before coding. Preserve P0–P4 and the full P0–P7 scope.'}
pathlib.Path('/tmp/coqui-p4-candidate.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record,indent=2))

"""Construct a P5-only verification checkout without mutating the user's index/files."""
from pathlib import Path
import subprocess,tempfile,hashlib,json,shutil
root=Path.cwd();evidence=root/'docs/implementation/evidence/p5-contest-2026-10-24'
sha=lambda data:hashlib.sha256(data).hexdigest()
manifest=json.loads((evidence/'source-hashes.json').read_text())['files']
assert not subprocess.check_output(['git','diff','--cached','--name-only']).strip()
for row in manifest:assert sha((root/row['path']).read_bytes())==row['sha256'],row['path']
paths=subprocess.check_output(['git','ls-files','-m','-o','--exclude-standard','-z']).decode().split('\0')
snapshot=[{'path':p,'sha256':sha((root/p).read_bytes()) if (root/p).is_file() else None} for p in sorted(set(paths)) if p]
Path('/tmp/coqui-p5-push-baseline.json').write_text(json.dumps(snapshot,indent=2)+'\n')
dest=Path(tempfile.mkdtemp(prefix='coqui-p5-commit-'))
subprocess.run(['git','clone','--shared','--quiet',str(root),str(dest)],check=True)
mixed=['apps/desktop/src/main/composition.ts','apps/desktop/src/renderer/query/refetch.ts','apps/desktop/src/renderer/styles/terminal.css','package.json','packages/contracts/src/channels.ts','tests/contracts-channels.test.ts']
generated=['docs/studies/behavior-manifests-v1.json','packages/core/src/research/study-manifests.generated.ts']
for row in manifest:
 rel=row['path']
 if rel in generated:continue
 target=dest/rel;target.parent.mkdir(parents=True,exist_ok=True)
 if rel not in mixed:shutil.copy2(root/rel,target);continue
 before=subprocess.check_output(['git','show','HEAD:'+rel],text=True);current=(root/rel).read_text();s=before
 if rel==mixed[0]:s=s.replace("import { createCapitalReplayHandlers }", "import { createCapitalContestHandlers } from './capital-contest-handlers.js'; import { createCapitalReplayHandlers }",1).replace('...createCapitalReplayHandlers(options.profileId,database),','...createCapitalReplayHandlers(options.profileId,database), ...createCapitalContestHandlers(options.profileId,database),',1)
 elif rel==mixed[1]:s=s.replace("  'research.capital-replay.runs':", "  'research.capital-contest.runs': { refetchIntervalMs: false, staleTimeMs: 0 },\n  'research.capital-contest.detail': { refetchIntervalMs: false, staleTimeMs: 0 },\n  'research.capital-replay.runs':",1)
 elif rel==mixed[2]:s+='\n/* P5 read-only evidence'+current.split('\n/* P5 read-only evidence',1)[1]
 elif rel==mixed[3]:s=s.replace('    "research:capital-replay":','    "research:capital-contest": "pnpm build && node scripts/research-capital-contest.mjs",\n    "research:capital-replay":',1)
 elif rel==mixed[4]:s="import { capitalContestChannelSchemas } from './schemas/capital-contest.js';\n"+s;s=s.replace('  ...capitalReplayChannelSchemas,','  ...capitalContestChannelSchemas,\n  ...capitalReplayChannelSchemas,',1)
 elif rel==mixed[5]:s=s.replace("'research.capital-replay.detail',", "'research.capital-contest.detail', 'research.capital-contest.runs', 'research.capital-replay.detail',",1)
 assert s!=before,rel
 target.write_text(s)
docs=['docs/implementation/small-portfolio-p5-implementation-plan-2026-10-23.md','docs/implementation/small-portfolio-p5-delivery-2026-10-24.md','docs/implementation/small-portfolio-phase-tracker-2026-10-23.md']
for rel in docs:shutil.copy2(root/rel,dest/rel)
for rel in ['docs/implementation/evidence/p5-strategy-planning-2026-10-23','docs/implementation/evidence/p5-contest-2026-10-24']:shutil.copytree(root/rel,dest/rel,dirs_exist_ok=True)
for package in [Path('.'),*[p.relative_to(root) for p in (root/'packages').iterdir() if p.is_dir()],Path('apps/desktop'),Path('apps/headless')]:
 folder=root/package/'node_modules'
 if not folder.is_dir():continue
 target=dest/package/'node_modules';target.mkdir(parents=True,exist_ok=True)
 for entry in folder.iterdir():
  if entry.name.startswith('.vite') or entry.name=='.cache':continue
  if entry.name=='@coqui':
   (target/entry.name).mkdir(exist_ok=True)
   for link in entry.iterdir():(target/entry.name/link.name).symlink_to(str(link.resolve()).replace(str(root),str(dest)))
  else:(target/entry.name).symlink_to(entry.resolve())
record={'candidate':str(dest),'base':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'mixed':mixed,'generated':generated,'sourceFiles':len(manifest),'snapshotEntries':len(snapshot),'promptUsed':'Commit and push P5-A–G, then lets move on to planning P6. Reread its full requirements in the saved roadmap and inspect the code before coding. Keep P5-H pending and preserve P0–P4 and the full P0–P7 scope.'}
Path('/tmp/coqui-p5-candidate.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record,indent=2))

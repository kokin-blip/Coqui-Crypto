"""Verify this planning delivery without altering application code or Git state."""
from pathlib import Path
import hashlib,json,subprocess,re
here=Path(__file__).resolve().parent;root=here.parents[3]
base=json.loads((here/'baseline.json').read_text())
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
changed=[r['path'] for r in base['dirtyFiles'] if sha(root/r['path'])!=r['sha256']]
protected=[p for p,h in base['protectedHashes'].items() if sha(root/p)!=h]
tracker='docs/implementation/small-portfolio-phase-tracker-2026-10-23.md'
archive=(here/'tracker.before.md.txt').read_bytes()==subprocess.check_output(['git','show',base['base']+':'+tracker],cwd=root)
current=subprocess.check_output(['git','ls-files','-m','-o','--exclude-standard','-z'],cwd=root).decode().split('\0')
known={r['path'] for r in base['dirtyFiles']};allowed={tracker,'docs/implementation/small-portfolio-p6-implementation-plan-2026-10-24.md'}
unexpected=[p for p in current if p and p not in known and p not in allowed and not p.startswith(str(here.relative_to(root))+'/')]
index=sha(root/'.git/index')==base['indexSha256']
preservation={'base':base['base'],'head':head,'preexistingDirtyEntries':len(base['dirtyFiles']),'byteIdentical':len(base['dirtyFiles'])-len(changed),'changedPreexisting':changed,'protectedFiles':len(base['protectedHashes']),'protectedChanged':protected,'trackerOriginalArchived':archive,'unexpectedNewChanges':unexpected,'indexUnchanged':index}
preservation['passed']=not changed and not protected and not unexpected and archive and index and head==base['base']
(here/'preservation.json').write_text(json.dumps(preservation,indent=2)+'\n')
inventory=json.loads((here/'source-inventory.json').read_text())['files']
assert all(sha(root/r['path'])==r['workingSha256'] for r in inventory)
assert all(hashlib.sha256(subprocess.check_output(['git','show','HEAD:'+r['path']],cwd=root)).hexdigest()==r['committedSha256'] for r in inventory)
documents=[root/'docs/implementation/small-portfolio-p6-implementation-plan-2026-10-24.md',root/tracker,here/'README.md'];missing=[]
for path in documents:
 for target in re.findall(r'\]\(([^)]+)\)',path.read_text()):
  if target.startswith(('http:','https:','#','codex:')):continue
  target=target.strip('<>').split('#')[0]
  if not (path.parent/target).exists():missing.append({'document':str(path.relative_to(root)),'target':target})
assert not missing,missing
phase_text=(root/tracker).read_text();assert all(re.search(r'^\| P'+str(i)+r' ',phase_text,re.M) for i in range(8))
json_files=list(here.glob('*.json'))
for p in json_files:json.loads(p.read_text())
remote=subprocess.check_output(['git','rev-parse','origin/codex/operations-crew-journal'],cwd=root,text=True).strip()
validation={'passed':preservation['passed'] and remote==head,'p5Commit':head,'pushedTrackingMatches':remote==head,'applicationCodeChangedForP6':False,'sourceInventoryFiles':len(inventory),'uncommittedSourceFiles':sum(r['uncommitted'] for r in inventory),'protectedFilesUnchanged':len(base['protectedHashes'])-len(protected),'allEightPhaseRowsRetained':True,'documentLinksValid':True,'jsonFilesParsed':len(json_files),'P5H':'pending','P6':'planning ready; implementation not started','linearSynced':(here/'linear-sync.json').exists()}
(here/'validation.json').write_text(json.dumps(validation,indent=2)+'\n');print(json.dumps(validation))
if not validation['passed']:raise SystemExit(1)

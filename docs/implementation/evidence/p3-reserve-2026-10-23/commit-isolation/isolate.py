import subprocess, tempfile, pathlib, json, shutil, hashlib, difflib, os
root=pathlib.Path.cwd(); dest=pathlib.Path(tempfile.mkdtemp(prefix='coqui-p3-commit-')); old=pathlib.Path('/private/tmp/coqui-p2-commit-7x3rtuc6')
subprocess.run(['git','clone','--shared','--quiet',str(root),str(dest)],check=True)
manifest=json.loads((root/'docs/implementation/evidence/p3-reserve-2026-10-23/source-manifest.json').read_text())
baseline=json.loads((root/'docs/implementation/evidence/p3-reserve-2026-10-23/baseline.json').read_text())
def original(path,s):
 if path=='apps/desktop/src/main/composition.ts': return s.replace(", ...(options.operationGate ? { operationGate: options.operationGate } : {}), onError: error => report('capital.initialization', error)",", onError: error => report('capital.initialization', error)")
 if path=='apps/desktop/src/renderer/query/refetch.ts':return ''.join(l for l in s.splitlines(keepends=True) if "'capital.reserve." not in l)
 if path=='apps/desktop/src/renderer/styles/terminal.css':return s.split('\n.profit-reserves {',1)[0]
 if path=='packages/contracts/src/channels.ts':return s.replace("import { profitReserveChannelSchemas } from './schemas/profit-reserve.js';\n",'').replace('  ...profitReserveChannelSchemas,\n','').replace("  'capital.reserve.inspect', 'capital.reserve.settings.save',\n",'')
 if path=='tests/contracts-channels.test.ts':
  for name in ['capital.reserve.inspect','capital.reserve.preview','capital.reserve.settings.save','capital.reserve.view']:s=s.replace("'"+name+"', ",'')
  return s
 if path=='tests/risk-dashboard.test.ts':return s.replace("      'capital.reserve.inspect', 'capital.reserve.settings.save',\n",'')
 return None
hashes={r['path']:r['sha256'] for r in baseline['dirtyFiles']}
mixed=[]; copied=[]
for name in manifest:
 if name in ['docs/studies/behavior-manifests-v1.json','packages/core/src/research/study-manifests.generated.ts']: continue
 source=(root/name).read_text(); before=original(name,source)
 if before is not None:
  assert hashlib.sha256(before.encode()).hexdigest()==hashes[name],name
  selected=source
  if name=='apps/desktop/src/main/composition.ts':
   selected=selected.replace('overlayShadow, hourlyShadow: parallel.hourlyShadow, news,','overlayShadow, news,').replace("...createParallelPaperHandlers(parallel.service, { profileId: options.profileId, hostId, database, clock, ...(options.operationGate ? { operationGate: options.operationGate } : {}) }),","...createParallelPaperHandlers(parallel.service),")
  elif name=='apps/desktop/src/renderer/query/refetch.ts':selected=''.join(l for l in selected.splitlines(keepends=True) if "'parallel.paper.hourly-study." not in l)
  elif name=='apps/desktop/src/renderer/styles/terminal.css':selected=''.join(l for l in selected.splitlines(keepends=True) if not l.startswith('.hourly-study-preview'))
  elif name=='packages/contracts/src/channels.ts':selected=selected.replace("  'parallel.paper.hourly-study.restart',\n",'')
  elif name in ['tests/contracts-channels.test.ts','tests/risk-dashboard.test.ts']:
   selected=selected.replace("'parallel.paper.hourly-study.preview', ",'').replace(" 'parallel.paper.hourly-study.restart',",'')
  expected=subprocess.check_output(['git','show','HEAD:'+name],cwd=root,text=True)
  assert original(name,selected)==expected,name+' still contains unrelated differences'
  (dest/name).write_text(selected);mixed.append(name)
 else:
  assert name not in hashes,name
  target=dest/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(root/name,target);copied.append(name)
for name in ['docs/implementation/small-portfolio-phase-tracker-2026-10-23.md','docs/implementation/small-portfolio-p3-delivery-2026-10-23.md']:
 shutil.copy2(root/name,dest/name)
shutil.copytree(root/'docs/implementation/evidence/p3-reserve-2026-10-23',dest/'docs/implementation/evidence/p3-reserve-2026-10-23',dirs_exist_ok=True)
for package in [pathlib.Path('.'),*map(lambda p:p.relative_to(old),(old/'packages').iterdir()),pathlib.Path('apps/desktop'),pathlib.Path('apps/headless')]:
 folder=old/package/'node_modules'
 if not folder.is_dir():continue
 target=dest/package/'node_modules';target.mkdir(parents=True,exist_ok=True)
 for entry in folder.iterdir():
  if entry.name.startswith('.vite'):continue
  if entry.name=='@coqui':
   (target/entry.name).mkdir(exist_ok=True)
   for link in entry.iterdir():
    (target/entry.name/link.name).symlink_to(str(link.resolve()).replace(str(old),str(dest)))
  elif entry.is_symlink():(target/entry.name).symlink_to(entry.resolve())
  else:raise RuntimeError('Unexpected installed dependency '+str(entry))
record={'candidate':str(dest),'base':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'mixed':mixed,'copied':copied}
pathlib.Path('/tmp/coqui-p3-candidate.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({'candidate':str(dest),'mixed':mixed,'copiedFiles':len(copied)},indent=2))

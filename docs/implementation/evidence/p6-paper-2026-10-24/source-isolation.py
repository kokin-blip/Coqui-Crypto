from pathlib import Path
import json,hashlib,re,subprocess,difflib,tarfile,tempfile,os,shutil
root=Path('/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto'); evidence=root/'docs/implementation/evidence/p6-paper-2026-10-24';baseline=json.loads((evidence/'baseline.json').read_text());oldhash={r['path']:r['sha256'] for r in baseline['dirtyFiles']}
sha=lambda b:hashlib.sha256(b).hexdigest()
new_names=['paper-profit-reserve','paper-capital-book','paper-capital-evidence','paper-active-sleeve','paper-reserve-authority','paper-reserve-runtime','paper-capital-decision','paper-capital-proposal-preview','paper-reserve-handlers','paper-capital-execution-handlers']
paths=set()
for folder in ['packages','apps/desktop/src','tests']:
 for p in (root/folder).rglob('*'):
  if not p.is_file() or any(x in p.parts for x in ['node_modules','dist']):continue
  if p.suffix in ['.ts','.tsx'] and (any(n in p.name for n in new_names) or p.name=='PaperProfitReserves.tsx'):paths.add(str(p.relative_to(root)))
paths.update('''packages/core/src/portfolio/index.ts
packages/core/src/risk/autotrade.ts
packages/contracts/src/channels.ts
packages/contracts/src/index.ts
packages/storage/src/migrations/index.ts
packages/storage/src/migrations/v99.ts
packages/storage/src/repositories/index.ts
packages/storage/src/repositories/profile-impact.ts
packages/storage/src/repositories/capital-budget.ts
packages/storage/src/repositories/paper-runtime.ts
packages/storage/src/profiles/duplication.ts
packages/storage/src/profiles/duplication-transient-counts.ts
packages/services/src/portfolio/index.ts
packages/services/src/paper/index.ts
packages/services/src/paper/capital-budget-port.ts
packages/services/src/paper/execution-gate.ts
packages/services/src/paper/execution-service.ts
packages/services/src/paper/oms.ts
packages/services/src/paper/routing.ts
packages/services/src/paper/runtime-model.ts
packages/services/src/paper/run-loop.ts
packages/services/src/paper/paper-scheduler-task.ts
apps/desktop/src/main/composition.ts
apps/desktop/src/main/dispatch.ts
apps/desktop/src/main/scheduler-runtime.ts
apps/desktop/src/renderer/app/Allocation.tsx
apps/desktop/src/renderer/query/refetch.ts
apps/desktop/src/renderer/styles/terminal.css
apps/desktop/scripts/paper-profit-reserve-smoke.mjs
tests/contracts-channels.test.ts
tests/risk-dashboard.test.ts
tests/secret-leak-sweep.test.ts
tests/storage-migrations.test.ts
tests/storage-canonical-assets.test.ts
tests/accounts-profiles-service.test.ts
tests/portfolio-snapshot-evidence.test.ts
tests/accounts-profile-duplication.test.ts
tests/accounts-profile-backup.test.ts
tests/accounts-profile-comparison.test.ts
tests/news-quota.test.ts
tests/news-intelligence-storage.test.ts
tests/storage-portfolio-repository.test.ts
tests/profit-reserve-storage.test.ts
tests/news-storage.test.ts
tests/news-rollout.test.ts
tests/isolated-restore.test.ts'''.splitlines())

def before(rel,s):
 if rel.endswith('/composition.ts'):
  for prefix in ["import { paperCapitalExecutionOperations } from './paper-capital-execution-handlers.js'; ","import { createMainPaperReserveRuntime } from './paper-reserve-runtime.js'; ","import { createPaperReserveHandlers } from './paper-reserve-handlers.js'; ","import { getPaperCapitalBook } from '@coqui/storage'; "]:s=s.replace(prefix,'',1)
  s=re.sub(r'(  let paperHoldings: readonly PricedHolding\[\] = \[\];) const paperReserve=.*?\n  const paperCapitalOperations=.*?; const paperExecution =',r'\1\n  const paperExecution =',s)
  s=s.replace('() => getPaperCapitalBook(options.profileId,database) ? paperReserve.execution() : new PaperExecutionService({','() => new PaperExecutionService({')
  s=s.replace(' capitalRun:paperReserve.runDecision,reserveObserve:paperReserve.observe,','')
  s=s.replace('reserveDisarm:paperReserve.disarm, ','').replace(' if(getPaperCapitalBook(options.profileId,database))await paperReserve.refreshMarketEvidence();','')
  s=s.replace('...createPaperReserveHandlers(options.profileId,database,()=>clock.nowMs(),paperReserve.service,options.operationGate,paperReserve.refreshMarketEvidence), ','')
  s=s.replace(' if(getPaperCapitalBook(options.profileId,database))return paperCapitalOperations.prepare(payload.commandId);','')
  s=s.replace('...paperCapitalOperations.reviewHandlers(createPaperReviewHandlers({ service:paperExecution,','...createPaperReviewHandlers({ service:paperExecution,')
  s=s.replace("refreshReview:async()=>{await paperMarket.refresh(clock.nowMs());paperHoldings=(await portfolio.portfolioView()).holdings;},\n    })),", "refreshReview:async()=>{await paperMarket.refresh(clock.nowMs());paperHoldings=(await portfolio.portfolioView()).holdings;},\n    }),")
  s=s.replace('disposed = true; paperReserve.disarm();','disposed = true;')
 elif rel.endswith('/dispatch.ts'):s=re.sub(r"^  'paper_reserve_revision_stale'.*\n",'',s,flags=re.M)
 elif rel.endswith('/scheduler-runtime.ts'):
  s=s.replace('  readonly reserveDisarm?:()=>void;\n','').replace('      options.reserveDisarm?.();\n','').replace('options.reserveDisarm?.(); ','')
 elif rel.endswith('/terminal.css'):s=s[:s.index('\n.paper-profit-reserves :is(p, dd, summary)')]
 elif rel.endswith('/refetch.ts'):s=re.sub(r"^  'paper\.reserve\..*\n",'',s,flags=re.M)
 elif rel=='packages/contracts/src/channels.ts':
  s=s.replace("import { paperProfitReserveChannelSchemas } from './schemas/paper-profit-reserve.js';\n",'').replace('  ...paperProfitReserveChannelSchemas,\n','');s=re.sub(r"^  'paper\.reserve\..*\n",'',s,flags=re.M)
 elif rel=='packages/services/src/paper/index.ts':s=re.sub(r"^export \* from './(?:paper-reserve-authority|paper-capital-decision|paper-capital-proposal-preview|paper-reserve-runtime)\.js';\n",'',s,flags=re.M)
 elif rel=='tests/contracts-channels.test.ts':
  s=re.sub(r"toEqual\(\['paper\.reserve\.[^\n]+\n",'toEqual([\n',s)
  start=s.index('expect([...CHANNEL_NAMES].sort()).toEqual([');end=s.index('    ].sort());',start);s=s[:end]+s[end:].replace('    ].sort());','    ]);',1)
 elif rel=='tests/risk-dashboard.test.ts':s=re.sub(r"^      'paper\.reserve\..*\n",'',s,flags=re.M)
 else:raise Exception('Unrecognized mixed '+rel)
 return s
mixed={};records=[]
for rel in sorted(paths):
 p=root/rel;assert p.is_file(),rel
 now=p.read_bytes();row={'path':rel,'workingSha256':sha(now),'preexistingDirty':rel in oldhash}
 if rel in oldhash:
  original=before(rel,now.decode()).encode();row['reconstructedBaselineSha256']=sha(original);row['baselineMatches']=sha(original)==oldhash[rel]
  (evidence/'mixed-before').mkdir(exist_ok=True)
  (evidence/'mixed-before'/rel.replace('/','__')).write_bytes(original)
  mixed[rel]=(original.decode(),now.decode())
 records.append(row)
(evidence/'source-inventory.json').write_text(json.dumps({'base':baseline['base'],'files':records},indent=2)+'\n')
bad=[r['path'] for r in records if r.get('baselineMatches') is False]
print(json.dumps({'sourceFiles':len(paths),'mixed':list(mixed),'baselineMismatch':bad}))
if bad:raise SystemExit(2)
# --verify-only never writes to the Git index, source tree, or candidate.
if '--verify-only' in __import__('sys').argv:raise SystemExit(0)
candidate=Path(tempfile.mkdtemp(prefix='coqui-p6-isolated-'))
archive=candidate/'source.tar';archive.write_bytes(subprocess.check_output(['git','archive',baseline['base']],cwd=root))
with tarfile.open(archive) as tar:tar.extractall(candidate,filter='data')
archive.unlink()
# Apply just the P6 character edits to HEAD; baseline reconstruction above proves unrelated working bytes were retained.
for rel in sorted(paths):
 target=candidate/rel;target.parent.mkdir(parents=True,exist_ok=True)
 if rel not in mixed:shutil.copy2(root/rel,target);continue
 original,current=mixed[rel];head=target.read_text()
 if rel.endswith('/scheduler-runtime.ts'):
  head=head.replace('export interface SchedulerRuntimeOptions {','export interface SchedulerRuntimeOptions {\n  readonly reserveDisarm?:()=>void;').replace('    stop() {\n','    stop() {\n      options.reserveDisarm?.();\n').replace('suspend: () => {','suspend: () => { options.reserveDisarm?.();');target.write_text(head);continue
 if rel=='packages/contracts/src/channels.ts':
  head="import { paperProfitReserveChannelSchemas } from './schemas/paper-profit-reserve.js';\n"+head
  head=head.replace('export const CHANNEL_SCHEMAS = {','export const CHANNEL_SCHEMAS = {\n  ...paperProfitReserveChannelSchemas,').replace('const WRITE_CHANNELS = [',"const WRITE_CHANNELS = [\n  'paper.reserve.observe','paper.reserve.book.create','paper.reserve.policy.save','paper.reserve.authorize','paper.reserve.pause','paper.reserve.resume','paper.reserve.review','paper.reserve.release',")
  target.write_text(head);continue
 if rel=='packages/services/src/paper/index.ts':
  target.write_text(head+''.join("export * from './"+n+".js';\n" for n in ['paper-reserve-authority','paper-capital-decision','paper-capital-proposal-preview','paper-reserve-runtime']));continue
 if rel.endswith('/terminal.css'):
  target.write_text(head+current[current.index('\n.paper-profit-reserves :is(p, dd, summary)'):]);continue
 ops=difflib.SequenceMatcher(a=original,b=current,autojunk=False).get_opcodes()
 for kind,a1,a2,b1,b2 in reversed(ops):
  if kind=='equal':continue
  old=original[a1:a2];new=current[b1:b2]
  found=[]
  for radius in [80,50,30,15,8]:
   left=original[max(0,a1-radius):a1];right=original[a2:a2+radius];needle=left+old+right
   if head.count(needle)==1:
    position=head.index(needle)+len(left);found=[position];break
  if not found and a1==0:found=[0]
  if not found:raise RuntimeError(f'Cannot safely rebase P6-only edit: {rel} {kind} {old!r} -> {new!r}')
  at=found[0];assert head[at:at+len(old)]==old,(rel,old)
  head=head[:at]+new+head[at+len(old):]
 target.write_text(head)
# Reuse installed dependencies, but every first-party @coqui link resolves inside this isolated source tree.
for original in [root/'node_modules',*(root/'packages').glob('*/node_modules'),*(root/'apps').glob('*/node_modules')]:
 rel=original.relative_to(root);dest=candidate/rel;dest.mkdir(exist_ok=True,parents=True)
 for p in original.iterdir():
  q=dest/p.name
  if p.name=='@coqui':
   q.mkdir(exist_ok=True)
   for member in p.iterdir():(q/member.name).symlink_to(candidate/('apps' if member.name=='desktop' else 'packages')/member.name,target_is_directory=True)
  elif p.is_file() and not p.is_symlink():shutil.copy2(p,q)
  else:q.symlink_to(p.resolve(),target_is_directory=p.is_dir())
record={'candidate':str(candidate),'base':baseline['base'],'sourceFiles':len(paths),'paths':sorted(paths),'mixed':list(mixed),'status':'source-isolated; validation pending'}
Path('/tmp/coqui-p6-candidate.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record))

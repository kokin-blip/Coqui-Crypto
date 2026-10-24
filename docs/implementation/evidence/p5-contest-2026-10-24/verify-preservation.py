"""Verify the P5 delivery boundary without staging or changing source files."""
from pathlib import Path
import hashlib
import json
import subprocess

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
BASE=json.loads((HERE/'baseline.json').read_text())
sha=lambda raw:hashlib.sha256(raw).hexdigest()
file_hash=lambda path:sha(path.read_bytes()) if path.is_file() else None
inverse={
 'apps/desktop/src/main/composition.ts':lambda s:s.replace("import { createCapitalContestHandlers } from './capital-contest-handlers.js'; ",'',1).replace(' ...createCapitalContestHandlers(options.profileId,database),','',1),
 'packages/contracts/src/channels.ts':lambda s:s.replace("import { capitalContestChannelSchemas } from './schemas/capital-contest.js';\n",'',1).replace('  ...capitalContestChannelSchemas,\n','',1),
 'apps/desktop/src/renderer/query/refetch.ts':lambda s:s.replace("  'research.capital-contest.runs': { refetchIntervalMs: false, staleTimeMs: 0 },\n",'',1).replace("  'research.capital-contest.detail': { refetchIntervalMs: false, staleTimeMs: 0 },\n",'',1),
 'apps/desktop/src/renderer/styles/terminal.css':lambda s:s.split('\n/* P5 read-only evidence',1)[0],
 'package.json':lambda s:s.replace('    "research:capital-contest": "pnpm build && node scripts/research-capital-contest.mjs",\n','',1),
 'tests/contracts-channels.test.ts':lambda s:s.replace("'research.capital-contest.detail', 'research.capital-contest.runs', ",'',1),
}
archives={
 'docs/studies/behavior-manifests-v1.json':HERE/'behavior-manifests-v1.json',
 'packages/core/src/research/study-manifests.generated.ts':HERE/'study-manifests.generated.ts',
 'docs/implementation/small-portfolio-phase-tracker-2026-10-23.md':HERE/'tracker.before.md.txt',
}
unchanged=[];preserved=[];unexpected=[]
for row in BASE['dirtyFiles']:
 rel=row['path'];path=ROOT/rel
 if file_hash(path)==row['sha256']:unchanged.append(rel)
 elif rel in inverse and sha(inverse[rel](path.read_text()).encode())==row['sha256']:preserved.append({'path':rel,'proof':'P5-only insertions invert exactly to baseline'})
 elif rel in archives and file_hash(archives[rel])==row['sha256']:preserved.append({'path':rel,'proof':'exact pre-change archive retained; current generated manifest or tracker intentionally updated'})
 else:unexpected.append(rel)
protected=[];exceptions=[]
for rel,expected in BASE['protectedHashes'].items():
 if file_hash(ROOT/rel)==expected:protected.append(rel)
 elif rel=='packages/core/src/research/capital-replay.ts' and file_hash(HERE/'p4-replay-before.ts.txt')==expected:exceptions.append({'path':rel,'reason':'version-preserving kernel extraction; original bytes archived; six full P4 result hashes and original regression suite guard numerical compatibility'})
 else:unexpected.append(rel)
# Existing clean canary suite receives only actual route coverage additions.
canary='tests/secret-leak-sweep.test.ts'
now=(ROOT/canary).read_text().replace("  'research.capital-contest.runs', 'research.capital-contest.detail',\n",'',1).replace("  'research.capital-contest.runs': {limit:10},\n",'',1).replace("  'research.capital-contest.detail': {runId:'a'.repeat(64),cellId:null,page:0,limit:10},\n",'',1)
canary_before=subprocess.check_output(['git','show',BASE['base']+':'+canary],cwd=ROOT)
canary_preserved=now.encode()==canary_before
report={'base':BASE['base'],'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'preexistingDirtyEntries':len(BASE['dirtyFiles']),'byteIdentical':len(unchanged),'intentionalOverlaps':preserved,'protectedUnchanged':len(protected),'protectedCompatibilityExceptions':exceptions,'unexpected':unexpected,'cleanCanarySuiteInverseVerified':canary_preserved,'indexUnchanged':file_hash(ROOT/'.git/index')==BASE['indexSha256']}
report['passed']=not unexpected and canary_preserved and report['indexUnchanged'] and report['head']==report['base']
(HERE/'preservation.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
if not report['passed']:raise SystemExit(1)

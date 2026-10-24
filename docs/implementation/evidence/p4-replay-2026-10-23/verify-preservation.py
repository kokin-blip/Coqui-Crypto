"""Check P4's dirty-checkout boundary without changing the index or source."""
import hashlib,json,pathlib,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[4]
HERE=pathlib.Path(__file__).resolve().parent
baseline=json.loads((HERE/'baseline.json').read_text())
h=lambda b:hashlib.sha256(b).hexdigest()
def strip_p4(p,s):
    if p=='apps/desktop/src/main/composition.ts':
        return s.replace("import { createCapitalReplayHandlers } from './capital-replay-handlers.js'; ",'').replace(' ...createCapitalReplayHandlers(options.profileId,database),','')
    if p=='apps/desktop/src/renderer/query/refetch.ts':
        return ''.join(l for l in s.splitlines(keepends=True) if "'research.capital-replay." not in l)
    if p=='apps/desktop/src/renderer/styles/terminal.css':
        return s.split('\n.capital-replay p {')[0]
    if p=='package.json':
        return ''.join(l for l in s.splitlines(keepends=True) if '"research:capital-replay"' not in l)
    if p=='packages/contracts/src/channels.ts':
        return s.replace("import { capitalReplayChannelSchemas } from './schemas/capital-replay.js';\n",'').replace('  ...capitalReplayChannelSchemas,\n','')
    if p=='tests/contracts-channels.test.ts':
        return s.replace(" 'research.capital-replay.detail', 'research.capital-replay.runs',",'')
    return None
unchanged=[];mixed=[];generated=[];failures=[]
for item in baseline['dirtyFiles']:
    p=item['path']
    if not (ROOT/p).is_file():
        (unchanged if item['sha256'] is None else failures).append(p);continue
    data=(ROOT/p).read_bytes()
    if h(data)==item['sha256']:unchanged.append(p);continue
    if p in ['docs/studies/behavior-manifests-v1.json','packages/core/src/research/study-manifests.generated.ts']:
        archived=HERE/'prebuild'/pathlib.Path(p).name
        if h(archived.read_bytes())==item['sha256']:generated.append({'path':p,'before':item['sha256'],'after':h(data)});continue
    restored=strip_p4(p,data.decode())
    if restored is not None and h(restored.encode())==item['sha256']:mixed.append({'path':p,'before':item['sha256'],'after':h(data),'inverseP4MatchesBaseline':True})
    else:failures.append(p)
protected=[]
for p,expected in baseline['protectedHashes'].items():
    actual=h((ROOT/p).read_bytes());protected.append({'path':p,'sha256':actual,'matches':actual==expected})
    if actual!=expected:failures.append(p)
index=subprocess.check_output(['git','diff','--cached','--name-only'],cwd=ROOT,text=True).splitlines()
result={'base':baseline['base'],'baselineDirtyCount':len(baseline['dirtyFiles']),'unchangedCount':len(unchanged),'mixedInsertions':mixed,'generatedWithExactPrebuildArchive':generated,'protected':protected,'stagedFiles':index,'failures':failures,'passed':not failures and not index}
(HERE/'preservation.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'unchanged':len(unchanged),'mixed':len(mixed),'generated':len(generated),'protected':len(protected),'failures':failures,'indexUnchanged':not index}))
if not result['passed']:raise SystemExit(1)

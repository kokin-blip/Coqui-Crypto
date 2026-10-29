from pathlib import Path
import hashlib,json,subprocess
root=Path(__file__).resolve().parents[4]
out=Path(__file__).resolve().parent
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None
baseline=json.loads((out/'baseline.json').read_text())
allowed={'docs/implementation/small-portfolio-phase-tracker-2026-10-23.md','docs/implementation/small-portfolio-p6-delivery-2026-10-24.md'}
changed=[r['path'] for r in baseline['dirtyFiles'] if sha(root/r['path'])!=r['sha256'] and r['path'] not in allowed]
assert not changed,changed
inventory=json.loads((out/'source-inventory.json').read_text())
assert all(sha(root/r['path'])==r['workingSha256'] for r in inventory['files'])
v=json.loads((root/'docs/implementation/evidence/p6-paper-2026-10-24/validation.json').read_text())
for r in v['sourceFiles']:
    data=subprocess.check_output(['git','show',inventory['base']+':'+r['path']],cwd=root)
    assert hashlib.sha256(data).hexdigest()==r['isolatedSha256'],r['path']
assert not subprocess.check_output(['git','diff','--cached','--name-only'],cwd=root).strip()
tracker=(root/'docs/implementation/small-portfolio-phase-tracker-2026-10-23.md').read_text()
assert all('| P'+str(i)+' ' in tracker for i in range(8))
assert 'P5-H and P6-G/H pending' in tracker
probes=json.loads((out/'probes.json').read_text())
assert len(probes['checks'])==6 and all(r['passed'] for r in probes['checks'])
report={'base':inventory['base'],'preservedBaselinePaths':len(baseline['dirtyFiles']),'unexpectedChanges':changed,'inventoryPaths':len(inventory['files']),'unchangedCommittedSourceHashes':len(v['sourceFiles']),'indexClean':True,'allEightPhasesRetained':True,'planningProbesPassed':6,'p7ImplementationStarted':False,'actualRegistration':False,'installedAccountAccess':False,'planSha256':sha(root/'docs/implementation/small-portfolio-p7-implementation-plan-2026-10-24.md')}
(out/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))

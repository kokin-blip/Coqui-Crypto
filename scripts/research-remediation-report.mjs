import { DatabaseSync } from 'node:sqlite';
import { remediationDevelopmentReport } from '../packages/services/dist/research/remediation-report.js';
const [path,profileId,instanceId]=process.argv.slice(2);
if(!path||!profileId||!instanceId) throw new Error('Usage: research-remediation-report.mjs database profile study-instance');
const db=new DatabaseSync(path,{readOnly:true});
try {console.log(JSON.stringify(remediationDevelopmentReport(profileId,instanceId,db,Date.now()),null,2));}
finally {db.close();}

import {describe,it,expect,vi} from 'vitest';
import {createProspectiveReadService} from '@coqui/services';
import {CHANNEL_NAMES} from '@coqui/contracts';
import {createProspectiveHandlers} from '../apps/desktop/src/main/capital-prospective-handlers.js';
import {createDispatcher} from '../apps/desktop/src/main/dispatch.js';
import {prospectiveFixture,DAY} from './helpers/capital-prospective.js';
describe('P7 production read boundary',()=>{
 it('dispatches four local reads with no registration, acquisition or sealed-body query',async()=>{const f=prospectiveFixture();try{const registration=f.register(),source=vi.spyOn(f.collector,'capture'),before=f.db.prepare('SELECT total_changes() n').get()!['n'],queries:string[]=[],prepare=f.db.prepare.bind(f.db);vi.spyOn(f.db,'prepare').mockImplementation(sql=>{queries.push(sql);return prepare(sql);});const handlers=createProspectiveHandlers(createProspectiveReadService('main',f.db,()=>35*DAY,()=>f.runtime)),dispatch=createDispatcher({handlers});
 expect((await dispatch('research.prospective.instances',{limit:50})).status).toBe('ok');for(const name of ['coverage','development'])expect((await dispatch(`research.prospective.${name}`,{registrationId:registration.registrationId})).status).toBe('ok');expect((await dispatch('research.prospective.coverage',{registrationId:registration.registrationId,actor:'owner'})).status).toBe('failed');
 expect(CHANNEL_NAMES.filter(n=>n.startsWith('research.prospective.'))).toHaveLength(4);expect(source).not.toHaveBeenCalled();expect(queries.filter(q=>/SELECT.*content_json.*prospective_(?:captures|book_revisions)_v1/u.test(q)&&!q.includes('length(CAST(content_json AS BLOB))'))).toEqual([]);expect(f.db.prepare('SELECT total_changes() n').get()!['n']).toBe(before);
 }finally{vi.restoreAllMocks();f.close();}});
});

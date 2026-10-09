import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { newsEvidenceHash, NEWS_DAY_MS as DAY, NEWS_HOUR_MS as HOUR, buildNewsStudyRows, runNewsStudy,
  type NewsIntelligenceConfiguration, type NewsStudyBar } from '@coqui/core';
import { NewsIntelligenceService } from '@coqui/services';
import { migrations, openDatabase, pendingNewsAnalysisIds, readNewsArchive, readNewsWindowAnalyses,
  saveNewsObservation, writeMarketBarArchive, queryMarketBarArchive, writeNewsArchive, type Db } from '@coqui/storage';
import { createDispatcher } from '../apps/desktop/src/main/dispatch.js';
import { createNewsHandlers } from '../apps/desktop/src/main/news-handlers.js';
import { newsFixture } from './fixtures/news/observations.js';
import { validateNewsArchiveProvenance } from '../packages/storage/src/archive/news-provenance.js';
const BTC = { venue: 'coinbase', productType: 'spot', productId: 'BTC-USD' } as const;
const configuration: NewsIntelligenceConfiguration = { schemaVersion: 1, reviewedAtMs: 100,
  instruments: [{ asset: 'BTC', instrument: BTC }], publisherAliases: [] };
const roots: string[] = [], databases: Db[] = [];
afterEach(() => { databases.splice(0).forEach(d => d.close()); roots.splice(0).forEach(p => rmSync(p, { recursive: true, force: true })); });
function root() { const p = mkdtempSync(join(tmpdir(), 'coqui-news-rollout-')); roots.push(p); return p; }
function db(path = ':memory:') { const d = openDatabase(path); databases.push(d);
  d.prepare('INSERT OR IGNORE INTO canonical_instruments VALUES (?,?,?,?,?,?,?,?,?)').run('coinbase','BTC-USD','spot','BTC','Bitcoin','BTC','USD',100,100); return d; }
function seed(d: Db, n: number, at = HOUR) {
  for (let i = 0; i < n; i++) saveNewsObservation(newsFixture({ provider: 'gdelt', providerArticleId: String(i),
    title: `Bitcoin gains ${i}`, url: `https://publisher.example/${i}`, observedAtMs: at, publishedAtMs: null }), at, d);
}
describe('restartable news rollout', () => {
  it('upgrades version 90, backs up and preserves evidence', () => {
    const directory = root(), file = join(directory,'coqui.db'), old = openDatabase(file, { migrations: migrations.filter(m => m.version <= 90) });
    old.prepare('INSERT INTO app_settings(key,value) VALUES (?,?)').run('preserved','yes'); old.close();
    const d = db(file); expect(d.prepare('PRAGMA user_version').get()?.['user_version']).toBe(91);
    expect(readdirSync(directory).some(n => n.includes('pre-migration-v90'))).toBe(true);
    expect(d.prepare('SELECT value FROM app_settings WHERE key=?').get('preserved')?.['value']).toBe('yes');
  });
  it('processes over 250 observations across restarts and overlapping connections, retaining actual availability', () => {
    const file = join(root(),'coqui.db'), d = db(file); seed(d, 251);
    const at = HOUR + 100, s = new NewsIntelligenceService({ database:d, clock:{nowMs:()=>at} });
    expect(s.advance(configuration)).toMatchObject({state:'processing',processed:250});
    const other = db(file), resumed = new NewsIntelligenceService({database:other,clock:{nowMs:()=>at}});
    expect(resumed.advance(configuration)).toMatchObject({state:'processing',processed:1});
    const complete = resumed.advance(configuration); expect(complete.result?.analyses).toHaveLength(251);
    expect(complete.result?.run.algorithmVersion).toBe('news-intelligence-window-v2');
    expect(s.featuresAsOf(BTC,HOUR)).toEqual([]);
    expect(s.featuresAsOf(BTC,at)[0]?.featureVersion).toBe('news-features-window-v2');
    expect(s.advance(configuration).result?.inserted).toBe(false);
    for (const table of ['news_analysis_chunks_v1','news_cached_analyses_v1']) {
      expect(()=>d.exec(`DELETE FROM ${table}`)).toThrow(/immutable/u);
      expect(()=>d.exec(`UPDATE ${table} SET content_hash='bad'`)).toThrow(/immutable/u);
    }
  });
  it('finishes more than ten thousand historical observations without a full-history batch', () => {
    const d=db();seed(d,10001,HOUR);
    const s=new NewsIntelligenceService({database:d,clock:{nowMs:()=>10*DAY}});
    let processing=0, step;
    do {step=s.advance(configuration);if(step.state==='processing')processing++;}while(step.state==='processing');
    expect(processing).toBe(41);expect(step.result?.analyses).toHaveLength(0);
    expect(d.prepare('SELECT count(*) AS n FROM news_cached_analyses_v1').get()?.['n']).toBe(10001);
  },60_000);
  it('keeps completed chunks when feature publication rolls back and rejects cache corruption', () => {
    const d=db();seed(d,1); const s=new NewsIntelligenceService({database:d,clock:{nowMs:()=>HOUR+100}}); s.advance(configuration);
    d.exec("CREATE TRIGGER reject_feature BEFORE INSERT ON news_feature_snapshots_v1 BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
    expect(()=>s.advance(configuration)).toThrow(/fixture failure/u);
    expect(d.prepare('SELECT count(*) AS n FROM news_analysis_runs_v1').get()?.['n']).toBe(0);
    expect(d.prepare('SELECT count(*) AS n FROM news_analysis_chunks_v1').get()?.['n']).toBe(1);
    d.exec('DROP TRIGGER reject_feature'); expect(s.advance(configuration).state).toBe('complete');
    const chunk=d.prepare('SELECT configuration_hash FROM news_analysis_chunks_v1').get() as {configuration_hash:string};
    expect(pendingNewsAnalysisIds(chunk.configuration_hash,HOUR+100,d)).toEqual([]);
    d.exec("DROP TRIGGER news_cached_analyses_v1_no_update; UPDATE news_cached_analyses_v1 SET content_hash='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'");
    expect(()=>readNewsWindowAnalyses(chunk.configuration_hash,HOUR+100,0,d)).toThrow(/integrity/u);
  });
  it('aborts worker completion and prevents writes after ownership loss', async () => {
    const d=db();seed(d,1);
    const s=new NewsIntelligenceService({database:d,clock:{nowMs:()=>HOUR+100},workerUrl:new URL('./fixtures/news/worker-delay.mjs',import.meta.url)});
    s.advance(configuration);
    const abort=new AbortController(), pending=s.advanceAsync(configuration,abort.signal,()=>true);
    abort.abort();await expect(pending).rejects.toThrow(/aborted/u);
    expect(d.prepare('SELECT count(*) AS n FROM news_analysis_runs_v1').get()?.['n']).toBe(0);
    await expect(s.advanceAsync(configuration,new AbortController().signal,()=>false)).rejects.toThrow(/ownership/u);
  });
  it('rechecks ownership under the write lock for both chunks and worker completion', async () => {
    const d=db();seed(d,1);
    const s=new NewsIntelligenceService({database:d,clock:{nowMs:()=>HOUR+100},workerUrl:new URL('./fixtures/news/worker-delay.mjs',import.meta.url)});
    let checks=0;
    await expect(s.advanceAsync(configuration,new AbortController().signal,()=>++checks===1)).rejects.toThrow(/ownership/u);
    expect(d.prepare('SELECT count(*) AS n FROM news_analysis_chunks_v1').get()?.['n']).toBe(0);
    s.advance(configuration);checks=0;
    await expect(s.advanceAsync(configuration,new AbortController().signal,()=>++checks<3)).rejects.toThrow(/ownership/u);
    expect(d.prepare('SELECT count(*) AS n FROM news_analysis_runs_v1').get()?.['n']).toBe(0);
  });
  it('does not accumulate old history into the active window and appends corrections', () => {
    const d=db();seed(d,1,HOUR); const s=new NewsIntelligenceService({database:d,clock:{nowMs:()=>5*DAY}});
    s.advance(configuration);expect(s.advance(configuration).result?.analyses).toHaveLength(0);
    seed(d,1,5*DAY); // Identical metadata remains the original evidence, regardless of receipt time.
    expect(s.advance(configuration).result?.analyses).toHaveLength(0);
    saveNewsObservation(newsFixture({provider:'gdelt',providerArticleId:'new',url:'https://publisher.example/new',title:'Ethereum gains',observedAtMs:5*DAY}),5*DAY,d);
    expect(s.advance(configuration).state).toBe('processing');expect(s.advance(configuration).result?.analyses).toHaveLength(1);
  });
  it('provides disabled defaults, Main-only enablement and bounded news reads', async () => {
    const d=db(), handlers=createNewsHandlers('secondary',d,{nowMs:()=>HOUR});
    const dispatch=createDispatcher({handlers}); const health=await dispatch('news.health',{}); expect(health).toMatchObject({status:'ok',value:{mainProfile:false,analysisEnabled:false,studyStatus:'not_run'}});
    expect(await dispatch('news.analysis.set-enabled',{commandId:crypto.randomUUID(),enabled:true})).toMatchObject({status:'failed'});
  });
});
describe('news and hourly archives', () => {
  it('round-trips observations and derived provenance, replays and detects byte corruption', async () => {
    const d=db();seed(d,1);const s=new NewsIntelligenceService({database:d,clock:{nowMs:()=>HOUR+100}});s.advance(configuration);s.advance(configuration);
    const rootDir=root(), input={database:d,rootDir,cutoffMs:HOUR+100,createdAtMs:HOUR+200,codeRevision:'synthetic-fixture'};
    const m=await writeNewsArchive(input), directory=join(rootDir,'news',m.datasetHash), read=await readNewsArchive(directory);
    expect(read.records.some(r=>r.kind==='feature')).toBe(true);expect(read.manifest.attribution).toContain('GDELT');
    expect(()=>validateNewsArchiveProvenance(read.records.filter(r=>r.kind!=='observation'),HOUR+100)).toThrow(/provenance/u);
    const interrupted=join(rootDir,'news',`.${m.datasetHash}.interrupted`);mkdirSync(interrupted);writeFileSync(join(interrupted,'partial'),'incomplete');
    expect((await writeNewsArchive(input)).datasetHash).toBe(m.datasetHash);
    expect(read.records.filter(r=>r.kind==='observation')).toHaveLength(Number(d.prepare('SELECT count(*) AS n FROM news_observations_v1').get()?.['n']));
    const file=join(directory,m.files[0]!.path);writeFileSync(file,Buffer.concat([readFileSync(file),Buffer.from('corrupted')]));
    await expect(readNewsArchive(directory)).rejects.toThrow(/integrity/u);
  });
  it('rejects metered archival before writing files', async () => {
    const d=db();saveNewsObservation(newsFixture(),300,d);const rootDir=root();
    await expect(writeNewsArchive({database:d,rootDir,cutoffMs:HOUR,createdAtMs:HOUR,codeRevision:'fixture'})).rejects.toThrow(/permission/u);
    expect(readdirSync(rootDir)).toEqual([]);
  });
  it('archives genuine hourly intervals separately and rejects daily values mislabeled hourly', async () => {
    const rootDir=root(), row={source:'coinbase' as const,instrument:BTC,providerAssetId:'BTC-USD',interval:'1h' as const,
      startTimeMs:HOUR,endTimeMs:2*HOUR,open:'100',high:'110',low:'90',close:'101',volume:'1',isComplete:true,quality:'reported_ohlc' as const,retrievedAtMs:2*HOUR};
    const input={rootDir,records:[row],sourceArtifacts:[{sourceId:'synthetic-hourly',manifestHash:'a'.repeat(64),rawContentHash:'b'.repeat(64)}],codeRevision:'fixture',createdAtMs:2*HOUR};
    const m=await writeMarketBarArchive(input);expect((await queryMarketBarArchive(join(rootDir,'datasets',m.datasetHash),{interval:'1h'}))[0]?.interval).toBe('1h');
    await expect(writeMarketBarArchive({...input,records:[{...row,endTimeMs:HOUR+DAY}]})).rejects.toThrow(/interval/u);
  });
});
describe('point-in-time news research', () => {
  function bars(): NewsStudyBar[] { return Array.from({length:12*24},(_,i)=>({instrumentKey:'coinbase|spot|BTC-USD',interval:'1h',startTimeMs:i*HOUR,endTimeMs:(i+1)*HOUR,open:100+i,close:101+i,availableAtMs:(i+1)*HOUR+300000})); }
  it('reports insufficient prospective evidence, freezes deterministic inputs and validates market gaps', () => {
    const input={bars:bars(),features:[],cadence:'hourly' as const,horizonHours:4 as const,cost:{feeBps:60,spreadBps:10,slippageBps:10,minUsefulTradeUsd:25},sourceManifestHashes:['a'.repeat(64)],codeRevision:'fixture',completedAtMs:15*DAY};
    const report=runNewsStudy(input);expect(report.status).toBe('insufficient_evidence');expect(report.reasons).toContain('no_eligible_prospective_news');
    expect(report.manifestHash).toBe(runNewsStudy(input).manifestHash);
    expect(()=>buildNewsStudyRows([...bars(),bars()[0]!],[],'hourly',1)).toThrow(/duplicate/u);
    expect(()=>buildNewsStudyRows(bars(),[],'daily',4)).toThrow(/bounds/u);
  });
  it('evaluates synthetic daily and hourly studies without fitting on test outcomes', () => {
    const d=db();seed(d,1);const service=new NewsIntelligenceService({database:d,clock:{nowMs:()=>HOUR+100}});service.advance(configuration);service.advance(configuration);
    const template=service.featuresAsOf(BTC,HOUR+100)[0]!;
    for (const cadence of ['daily','hourly'] as const) {
      const width=cadence==='daily'?DAY:HOUR, syntheticBars: NewsStudyBar[]=[], features=[];
      for (const asset of ['BTC','ETH','SOL']) for (let i=0;i<225*DAY/width;i++) {
        const start=i*width, price=100+Math.sin(i/20)*2+i/1000;
        syntheticBars.push({instrumentKey:`coinbase|spot|${asset}-USD`,interval:cadence==='daily'?'1d':'1h',startTimeMs:start,endTimeMs:start+width,open:price,close:price+0.1,availableAtMs:start+width+300000});
        features.push({...template,id:newsEvidenceHash({asset,start,cadence}),instrument:{...BTC,productId:`${asset}-USD`},cadence,decisionAtMs:start,availableAtMs:start+100});
      }
      const input={bars:syntheticBars,features,cadence,horizonHours:24 as const,cost:{feeBps:60,spreadBps:10,slippageBps:15,minUsefulTradeUsd:25},sourceManifestHashes:['a'.repeat(64)],codeRevision:'synthetic-fixture',completedAtMs:226*DAY};
      const report=runNewsStudy(input);expect(report.status).toBe('evaluated');expect(report.evaluations).toHaveLength(6);
      expect(report.evaluations.every(e=>Number.isFinite(e.predictive.mse)&&e.replay.modeledCostUsd>=0)).toBe(true);
      if(cadence==='daily') {
        const changed=runNewsStudy({...input,bars:syntheticBars.map(b=>b.startTimeMs>200*DAY?{...b,close:b.close*2}:b)});
        expect(changed.evaluations.map(e=>e.frozenModelHash)).toEqual(report.evaluations.map(e=>e.frozenModelHash));
      }
    }
  }, 30_000);
  it('excludes reconstructed and delayed features and keeps future labels distinct', () => {
    const d=db();seed(d,1);const service=new NewsIntelligenceService({database:d,clock:{nowMs:()=>8*DAY}});service.advance(configuration);service.advance(configuration);
    const f=service.featuresAsOf(BTC,8*DAY).find(f=>f.cadence==='hourly')!;
    const early={...f,decisionAtMs:8*DAY,availableAtMs:9*DAY};
    const rows=buildNewsStudyRows(bars(),[early],'hourly',4);
    expect(rows.filter(r=>r.decisionAtMs<9*DAY).every(r=>r.featureId===null)).toBe(true);
    expect(buildNewsStudyRows(bars(),[{...early,reconstruction:true}],'hourly',4).every(r=>r.featureId===null)).toBe(true);
    expect(rows.every(r=>r.labelAvailableAtMs>r.decisionAtMs)).toBe(true);
    expect(newsEvidenceHash(rows)).toHaveLength(64);
  });
});

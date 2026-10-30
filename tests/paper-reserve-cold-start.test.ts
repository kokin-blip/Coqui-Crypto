import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FixedClock, sha256Hex } from '../packages/core/src/index.js';
import { openDatabase } from '../packages/storage/src/index.js';
const artifact = vi.hoisted(() => vi.fn());
vi.mock('../apps/desktop/src/main/research-provenance.js', () => ({fullApplicationArtifactHash:artifact}));
import { createMainPaperReserveRuntime } from '../apps/desktop/src/main/paper-reserve-runtime.js';
beforeEach(() => { artifact.mockReset(); });
function fixture(run: (runtime: ReturnType<typeof createMainPaperReserveRuntime>, database: ReturnType<typeof openDatabase>) => void): void {
  const database = openDatabase(':memory:');
  try {
    const runtime = createMainPaperReserveRuntime({profileId:'main',database,clock:new FixedClock(10),hostId:'fixture-host',
      market:{bars:()=>[],rules:()=>null},preparation:()=>{throw new Error('market_must_not_be_read');},
      operationAllowed:()=>true,priceSource:{name:'fixture',spot:async()=>new Map()}});
    run(runtime,database);
  } finally { database.close(); }
}
describe('disabled reserve cold startup', () => {
  it('constructs and observes an empty legacy profile without compiled-artifact access', () => {
    artifact.mockImplementation(() => {throw new Error('compiled_artifact_unavailable');});
    fixture(runtime => {
      runtime.observe();runtime.disarm();
      expect(runtime.authority.armed).toBe(false);expect(artifact).not.toHaveBeenCalled();
    });
  });
  it('withholds authority when an explicit operation cannot prove the compiled artifact', () => {
    artifact.mockImplementation(() => {throw new Error('compiled_artifact_unavailable');});
    fixture((runtime,database) => {
      expect(() => runtime.authority.arm(sha256Hex('policy'),0)).toThrow('compiled_artifact_unavailable');
      expect(runtime.authority.armed).toBe(false);
      for(const table of ['paper_capital_book_origins_v1','paper_reserve_policy_versions_v1','paper_orders_v3']) {
        expect(database.prepare(`SELECT count(*) n FROM ${table}`).get()?.['n']).toBe(0);
      }
    });
  });
  it('caches a successful identity only on demand and does not convert it into permission', () => {
    artifact.mockReturnValue(sha256Hex('actual-compiled-fixture'));
    fixture(runtime => {
      expect(artifact).not.toHaveBeenCalled();
      for(let attempt=0;attempt<2;attempt++)expect(() => runtime.authority.arm(sha256Hex('policy'),0)).toThrow();
      expect(artifact).toHaveBeenCalledTimes(1);expect(runtime.authority.armed).toBe(false);
    });
  });
});

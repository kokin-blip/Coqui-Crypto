import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const requireDesktop = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
import type { CoquiClient, Outcome } from '../packages/contracts/src/index.js';

const state = vi.hoisted(() => ({ events: [] as unknown[], invalidate: vi.fn(async () => {}), values: [] as unknown[] }));
vi.doMock(requireDesktop.resolve('react'), () => ({
  useCallback: (fn: unknown) => fn,
  useReducer: () => [{ kind: 'idle' }, (event: unknown) => state.events.push(event)],
  useRef: (value: unknown) => ({ current: value }),
  useState: () => [null, (value: unknown) => state.values.push(value)],
}));
vi.doMock(requireDesktop.resolve('@tanstack/react-query').replace('/index.cjs', '/index.js'), () => ({ useQueryClient: () => ({ invalidateQueries: state.invalidate }) }));
const { useCommand } = await import('../apps/desktop/src/renderer/query/use-command.js');

function handle(query: () => Promise<Outcome<unknown>>) {
  state.events.length = 0; state.values.length = 0; state.invalidate.mockClear();
  return useCommand({ query } as unknown as CoquiClient, 'app.person.set', ['app.person']);
}
const payload = { commandId: '00000000-0000-4000-8000-000000000001', displayName: 'Kokin' };
describe('confirmed command results', () => {
  it.each(['failed', 'blocked', 'unknown'] as const)('returns %s without invalidating or confirming', async status => {
    const result = { status, issues: [{ path: [], code: 'test_refusal' }] };
    expect(await handle(async () => result).run(payload)).toEqual(result);
    expect(state.invalidate).not.toHaveBeenCalled();
    expect(state.events).toContainEqual({ type: 'settled', status, codes: ['test_refusal'] });
  });
  it('returns authoritative success and invalidates after confirmation', async () => {
    const result = { status: 'ok' as const, value: { confirmed: true } };
    expect(await handle(async () => result).run(payload)).toEqual(result);
    expect(state.invalidate).toHaveBeenCalledOnce();
  });
  it('suppresses a concurrent call without reporting a second success', async () => {
    let finish!: (value: Outcome<unknown>) => void;
    const query = vi.fn(() => new Promise<Outcome<unknown>>(resolve => { finish = resolve; }));
    const command = handle(query), first = command.run(payload);
    expect(await command.run(payload)).toEqual({ status: 'in_flight' });
    expect(query).toHaveBeenCalledOnce();
    finish({ status: 'blocked', issues: [] });
    await first;
  });
  it('retains unknown completion until an explicit reset', async () => {
    const query = vi.fn(async () => { throw new Error('sensitive transport detail'); });
    const command = handle(query);
    expect(await command.run(payload)).toEqual({ status: 'unknown', issues: [{ path: ['transport'], code: 'command_completion_unknown' }] });
    expect(await command.run(payload)).toHaveProperty('status', 'unknown');
    expect(query).toHaveBeenCalledOnce();
    command.reset();
    await command.run(payload);
    expect(query).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(state.events)).not.toContain('sensitive');
  });
});

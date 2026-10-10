import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useReducer, useRef, useState } from 'react';

import { reduceAction, type ActionState } from '@coqui/ui-kit';
import type {
  ChannelName,
  ChannelRequest,
  ChannelResponse,
  CoquiClient,
  Outcome,
} from '@coqui/contracts';

/**
 * Run one write channel, through the action state machine.
 *
 * The machine lives in `@coqui/ui-kit` rather than here because the rule it
 * enforces is not visual: `docs/UI-UX.md` §3.1 forbids optimistic success, and
 * a hook that flipped to "done" on click would satisfy every visual review
 * while breaking the contract. `reduceAction` makes `settled` the only path to
 * `succeeded`, so this hook *cannot* report success before the main process
 * confirms it — that is why the transition is reduced rather than assigned.
 *
 * This is not `useMutation`. TanStack would retry, and a retry of a write is a
 * second command; the read hook already refuses retries for the same reason.
 */

export interface CommandHandle<TChannel extends ChannelName> {
  readonly state: ActionState;
  readonly value: ChannelResponse<TChannel> | null;
  run(payload: ChannelRequest<TChannel>): Promise<Outcome<ChannelResponse<TChannel>> | { readonly status: 'in_flight' }>;
  reset(): void;
}

export function useCommand<TChannel extends ChannelName>(
  client: CoquiClient,
  channel: TChannel,
  /** Read channels to invalidate once the write is confirmed. */
  invalidates: readonly ChannelName[] = [],
): CommandHandle<TChannel> {
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(reduceAction, { kind: 'idle' } as ActionState);
  const [value, setValue] = useState<ChannelResponse<TChannel> | null>(null);
  const inFlight = useRef(false);
  const uncertain = useRef<Outcome<ChannelResponse<TChannel>> | null>(null);

  const run = useCallback(
    async (payload: ChannelRequest<TChannel>) => {
      if (uncertain.current) return uncertain.current;
      if (inFlight.current) return { status: 'in_flight' as const };
      inFlight.current = true;
      dispatch({ type: 'activate' });
      setValue(null);
      try {
        const outcome = await client.query(channel, payload);
        if (outcome.status === 'ok') {
          setValue(outcome.value as ChannelResponse<TChannel>);
          dispatch({ type: 'settled', status: 'ok' });
          // Invalidate only after confirmation. Refetching on activation would
          // paint the pre-write value back over the pending state.
          void Promise.all(
            invalidates.map((name) => queryClient.invalidateQueries({ queryKey: [name] })),
          ).catch(() => {});
          return outcome;
        }
        if (outcome.status === 'unknown') uncertain.current = outcome;
        dispatch({
          type: 'settled',
          status: outcome.status,
          codes: outcome.issues.map((issue) => issue.code),
        });
        return outcome;
      } catch {
        // A rejected transport cannot establish whether the write completed.
        dispatch({ type: 'settled', status: 'unknown', codes: ['command_completion_unknown'] });
        const outcome = { status: 'unknown' as const, issues: [{ path: ['transport'], code: 'command_completion_unknown' }] };
        uncertain.current = outcome;
        return outcome;
      } finally {
        inFlight.current = false;
      }
    },
    [channel, client, invalidates, queryClient],
  );

  const reset = useCallback(() => {
    if (inFlight.current) return;
    uncertain.current = null;
    setValue(null);
    dispatch({ type: 'reset' });
  }, []);

  return { state, value, run, reset };
}

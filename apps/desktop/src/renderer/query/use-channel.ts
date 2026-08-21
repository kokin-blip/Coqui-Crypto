import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';

import type {
  ChannelName,
  ChannelRequest,
  ChannelResponse,
  ContractIssue,
  CoquiClient,
  Outcome,
} from '@coqui/contracts';

import { CHANNEL_POLICIES } from './refetch.js';

/**
 * What a component receives. Deliberately not a raw `Outcome`.
 *
 * `docs/UI-UX.md` §7.6 requires loading, empty, stale, partial, error, blocked
 * and recovery states to be designed rather than left to incidental component
 * behaviour. Handing a component a discriminated union with a case per state
 * makes forgetting one a type error instead of a blank panel.
 */
export type ChannelState<TValue> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly value: TValue; readonly isStale: boolean }
  | { readonly kind: 'failed'; readonly issues: readonly ContractIssue[] }
  | { readonly kind: 'blocked'; readonly issues: readonly ContractIssue[] }
  | { readonly kind: 'unknown'; readonly issues: readonly ContractIssue[] };

function toState<TValue>(
  query: UseQueryResult<Outcome<TValue>, Error>,
): ChannelState<TValue> {
  if (query.data === undefined) return { kind: 'loading' };
  const outcome = query.data;
  if (outcome.status === 'ok') {
    return { kind: 'ready', value: outcome.value, isStale: query.isStale };
  }
  return { kind: outcome.status, issues: outcome.issues };
}

/**
 * Read one channel.
 *
 * The refetch interval is not a parameter. It comes from `CHANNEL_POLICIES`, so
 * a component cannot set its own cadence and the total polling load of the
 * application stays readable in one file.
 */
export function useChannel<TChannel extends ChannelName>(
  client: CoquiClient,
  channel: TChannel,
  payload: ChannelRequest<TChannel>,
): ChannelState<ChannelResponse<TChannel>> {
  const policy = CHANNEL_POLICIES[channel];
  const key = useMemo(() => [channel, payload] as const, [channel, payload]);

  const query = useQuery<Outcome<ChannelResponse<TChannel>>, Error>({
    queryKey: key,
    queryFn: () => client.query(channel, payload),
    refetchInterval: policy.refetchIntervalMs,
    staleTime: policy.staleTimeMs,
    // The transport never rejects; a failure is a value. Retrying here would
    // re-run a call the main process already declined, and for a non-idempotent
    // channel it would be a duplicate command.
    retry: false,
    // A refresh must not blank the screen: UI-UX §1 requires layout and focus
    // to survive one, so the previous value stays mounted until the next lands.
    placeholderData: (previous) => previous,
  });

  return toState(query);
}

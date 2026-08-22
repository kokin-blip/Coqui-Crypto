import { useState } from 'react';

import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { presentAction } from '@coqui/ui-kit';

import { useCommand } from '../query/use-command.js';

type Reconciliation = ChannelResponse<'portfolio.reconciliation'>;
type Option = Reconciliation['options'][number];
type Kind = Option['kind'];

/**
 * Record a decision about one exception.
 *
 * Every outcome offered here leaves the tax lots exactly as they are. That is
 * invariant 12, and it is why the option list comes from the service rather
 * than being written in the component: the explanations are claims about what
 * the application does to the ledger, and they belong beside the code that
 * honours them.
 *
 * There is no optimistic success. `useCommand` reduces through the shared
 * action machine, where `settled` is the only path to `succeeded`.
 */

const REFUSAL_COPY: Record<string, string> = {
  unknown_discrepancy: 'That exception is no longer in the evidence.',
  unknown_lot: 'That lot does not exist. Record the lot with its real cost basis first.',
  lot_required: 'Choose which existing lot explains this.',
  lot_not_allowed: 'Only “explained by an existing lot” takes a lot.',
  note_required: 'Say why. An unexplained resolution is indistinguishable from dismissing it.',
};

export function ResolveException({
  client,
  profileId,
  discrepancyId,
  options,
}: {
  readonly client: CoquiClient;
  readonly profileId: string;
  readonly discrepancyId: string;
  readonly options: Reconciliation['options'];
}): React.JSX.Element {
  const [kind, setKind] = useState<Kind>('investigating');
  const [note, setNote] = useState('');
  const [lotId, setLotId] = useState('');
  const command = useCommand(client, 'portfolio.reconciliation.resolve', [
    'portfolio.reconciliation',
  ]);

  const selected = options.find((option) => option.kind === kind);
  const presentation = presentAction(
    command.state,
    { idle: 'Record decision', pending: 'Recording…' },
    // Consequential: it settles how a balance is explained, and the explanation
    // is what a later tax figure rests on.
    'consequential',
  );

  return (
    <form
      className="mt-2 space-y-2 border-l-2 pl-3"
      onSubmit={(event) => {
        event.preventDefault();
        void command.run({
          profileId,
          discrepancyId,
          kind,
          linkedLotId: kind === 'matched_to_lot' ? lotId.trim() : null,
          note: note.trim(),
        });
      }}
    >
      <label className="block">
        <span className="opacity-70">How is this explained?</span>
        <select
          className="mt-1 block w-full border px-2 py-1"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as Kind);
            // A stale outcome must not survive a changed choice; reset so the
            // button re-confirms rather than reporting the previous decision.
            command.reset();
          }}
        >
          {options.map((option) => (
            <option key={option.kind} value={option.kind}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {selected !== undefined && <p className="opacity-70">{selected.explanation}</p>}

      {selected?.requiresLot === true && (
        <label className="block">
          <span className="opacity-70">Which existing lot?</span>
          <input
            className="mt-1 block w-full border px-2 py-1"
            value={lotId}
            onChange={(event) => setLotId(event.target.value)}
            placeholder="lot id"
          />
        </label>
      )}

      <label className="block">
        <span className="opacity-70">Why (recorded permanently)</span>
        <input
          className="mt-1 block w-full border px-2 py-1"
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="border px-3 py-1"
          disabled={presentation.disabled || note.trim().length === 0}
          aria-busy={presentation.busy}
        >
          {presentation.label}
        </button>
        {/* Announced, never inferred from a colour change. */}
        <span aria-live="polite">{presentation.liveMessage}</span>
      </div>

      {(command.state.kind === 'failed' || command.state.kind === 'blocked') && (
        <p role="alert">
          {command.state.codes.map((code) => REFUSAL_COPY[code] ?? code).join(' ')}
        </p>
      )}

      {presentation.requiresReconfirmation && (
        <button type="button" className="underline" onClick={command.reset}>
          Start over
        </button>
      )}
    </form>
  );
}

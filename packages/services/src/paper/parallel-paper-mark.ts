import { Decimal } from 'decimal.js';
import type { ParallelPaperEvent, ParallelPaperExperiment } from '@coqui/storage';
import { instrumentKey } from '@coqui/core';
import { PARALLEL_INSTRUMENTS } from './parallel-signal.js';
import { dayAfter } from './parallel-paper-activity.js';
import { money, symbolFor, eventFor } from './parallel-paper-utils.js';
import type { PaperDecisionPreparation } from './runtime-model.js';
const ASSET_IDS = PARALLEL_INSTRUMENTS.map(instrumentKey), CUTOFF_MS = 900_000;

export function recordParallelMark(input: { experiment: ParallelPaperExperiment; events: readonly ParallelPaperEvent[];
  nowMs: number; append: (kind: string, key: string, detail: Record<string, unknown>) => void },
    preparation: Extract<PaperDecisionPreparation, { ok: true }>,
    account: { readonly cash: string; readonly equity: string },
    positions: readonly { readonly symbol: string; readonly qty: string; readonly market_value: string }[]): void {
    const { experiment, events } = input;
    const day = preparation.dataset.dayKeys.at(-1)!;
    const latestIntraday = [...events].reverse().find((event) => event.kind === 'intraday_complete' &&
      String(event.detail['slot']).startsWith(dayAfter(day)));
    const markKey = `${latestIntraday === undefined ? day : String(latestIntraday.detail['slot'])}:${Math.floor(input.nowMs / 3_600_000)}`;
    if (events.some((event) => event.kind === 'account_mark' && (event.detail['markKey'] ?? event.detail['day']) === markKey)) return;
    const nextOpenMs = Date.parse(`${dayAfter(day)}T00:00:00Z`);
    if (eventFor(events, 'external_complete', day) === undefined &&
        input.nowMs - nextOpenMs < CUTOFF_MS) return;
    let cash = money(experiment.openingCoquiCash);
    const held = new Map<string, Decimal>(ASSET_IDS.map((id) => [id, new Decimal(0)]));
    for (const fill of events.filter((event) => event.kind === 'local_fill')) {
      const id = String(fill.detail['assetId']);
      held.set(id, held.get(id)!.plus(String(fill.detail['qty'])));
      cash = cash.plus(String(fill.detail['cashDelta']));
    }
    const local = ASSET_IDS.reduce((sum, id) => sum.plus(held.get(id)!.mul(
      String(preparation.dataset.closesById[id]?.at(-1)))), cash);
    const decision = [...events].reverse().find((event) => event.kind === 'decision');
    const weights = (decision?.detail['weights'] ?? {}) as Record<string, number>;
    const detail = { day, markKey, slot: latestIntraday?.detail['slot'] ?? null, markedAtMs: input.nowMs, coquiEquityUsd: local.toFixed(2), coquiCashUsd: cash.toFixed(2),
      alpacaEquityUsd: money(account.equity).toFixed(2), alpacaCashUsd: money(account.cash).toFixed(2),
      positions: ASSET_IDS.map((id) => {
        const symbol = symbolFor(id);
        const external = positions.find((item) => item.symbol.replace('/', '') === symbol);
        return { symbol, coquiQty: held.get(id)!.toString(),
          alpacaQty: external?.qty ?? '0',
          coquiValueUsd: held.get(id)!.mul(String(preparation.dataset.closesById[id]?.at(-1))).toFixed(2),
          alpacaValueUsd: external?.market_value ?? '0' };
      }),
      targets: ASSET_IDS.map((id) => ({ symbol: symbolFor(id), weightPct: String(money(String(weights[id] ?? 0)).mul(100)) })),
    };
    input.append('account_mark', `mark:${markKey}`, detail);
  }


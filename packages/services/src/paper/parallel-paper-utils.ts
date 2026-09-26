import { Decimal } from 'decimal.js';

import type { AlpacaPaperAsset } from '@coqui/adapters';
import { instrumentKey } from '@coqui/core';
import type { ParallelPaperEvent } from '@coqui/storage';

import { PARALLEL_INSTRUMENTS } from './parallel-signal.js';

export function money(value: string | number | Decimal): Decimal {
  const result = new Decimal(value);
  if (!result.isFinite()) throw new Error('invalid_amount');
  return result;
}

export function quantity(value: Decimal): string {
  return value.toDecimalPlaces(8, Decimal.ROUND_HALF_EVEN).toFixed(8);
}

export function alpacaQuantity(value: Decimal, asset: AlpacaPaperAsset): Decimal {
  const increment = money(asset.min_trade_increment ?? '0');
  const minimum = money(asset.min_order_size ?? '0');
  if (!increment.isPositive() || !minimum.isPositive() || !asset.tradable || asset.status !== 'active') {
    throw new Error('alpaca_asset_rules_unavailable');
  }
  const rounded = value.abs().div(increment).floor().mul(increment);
  return rounded.lessThan(minimum) ? new Decimal(0) : rounded;
}

export function symbolFor(id: string): string {
  const found = PARALLEL_INSTRUMENTS.find((item) => instrumentKey(item) === id);
  if (found === undefined) throw new Error('unknown_asset');
  return found.productId.replace('-', '');
}

export function eventFor(events: readonly ParallelPaperEvent[], kind: string, day: string): ParallelPaperEvent | undefined {
  return events.find((event) => event.kind === kind && event.detail['day'] === day);
}

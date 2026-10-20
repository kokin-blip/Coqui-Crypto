import { Decimal } from 'decimal.js';

/** Price friction is already embedded in executionPrice; venue fees are additional. */
export interface ActivityFill {
  readonly id: string; readonly productId: string; readonly side: 'buy' | 'sell';
  readonly quantity: string; readonly price: string; readonly feeUsd: string | null;
  readonly atMs: number;
}
interface Lot { quantity: Decimal; cost: Decimal | null; price: Decimal | null; atMs: number | null }
const text = (value: Decimal): string => value.toDecimalPlaces(12).toFixed();

/** Shared FIFO replay for current positions and historical snapshots. */
function createPositionReplay(openingQuantity:string) {
  const lots: Lot[] = [];
  const opening = new Decimal(openingQuantity);
  if (opening.gt(0)) lots.push({ quantity: opening, cost: null, price: null, atMs: null });
  let realized = new Decimal(0); let unknownRealized = false;
  const exits: Array<{ fillId: string; atMs: number; price: string; quantity: string; realizedPnlUsd: string | null; feeUsd: string | null }> = [];
  const seen = new Set<string>();
  let held=opening,knownHeld=new Decimal(0),knownCostTotal=new Decimal(0);
  const apply=(fill:ActivityFill):void=>{
    if (seen.has(fill.id)) return; seen.add(fill.id);
    const quantity = new Decimal(fill.quantity); const price = new Decimal(fill.price);
    if (!quantity.gt(0) || !price.gt(0)) throw new TypeError('Invalid recorded fill');
    if (fill.side === 'buy') {
      const cost=fill.feeUsd===null?null:quantity.mul(price).add(fill.feeUsd);
      lots.push({quantity,cost,price,atMs:fill.atMs});held=held.add(quantity);
      if(cost!==null){knownHeld=knownHeld.add(quantity);knownCostTotal=knownCostTotal.add(cost);}return;
    }
    let remaining = quantity; let basis = new Decimal(0); let unknown = fill.feeUsd === null;
    while (remaining.gt(0) && lots.length > 0) {
      const lot = lots[0]!; const consumed = Decimal.min(remaining, lot.quantity);
      if (lot.cost === null) unknown = true;
      else { const allocated = lot.cost.mul(consumed.div(lot.quantity)); basis = basis.add(allocated); lot.cost = lot.cost.minus(allocated);
        knownHeld=knownHeld.minus(consumed);knownCostTotal=knownCostTotal.minus(allocated); }
      lot.quantity = lot.quantity.minus(consumed); remaining = remaining.minus(consumed);held=held.minus(consumed);
      if (lot.quantity.isZero()) lots.shift();
    }
    if (remaining.gt(0)) unknown = true;
    const profit = unknown ? null : quantity.mul(price).minus(fill.feeUsd!).minus(basis);
    if (profit === null) unknownRealized = true; else realized = realized.add(profit);
    exits.push({ fillId: fill.id, atMs: fill.atMs, price: fill.price, quantity: fill.quantity, realizedPnlUsd: profit === null ? null : text(profit), feeUsd: fill.feeUsd });
  };
  const snapshot=(markUsd:string|null)=>{
  const quantity = lots.reduce((sum, lot) => sum.add(lot.quantity), new Decimal(0));
  const knownLots = lots.filter(lot => lot.cost !== null);
  const knownQuantity = knownLots.reduce((sum, lot) => sum.add(lot.quantity), new Decimal(0));
  const knownCost = knownLots.reduce((sum, lot) => sum.add(lot.cost!), new Decimal(0));
  const basisComplete = quantity.eq(knownQuantity);
  const pnl = markUsd === null ? null : knownQuantity.mul(markUsd).minus(knownCost);
  const pricesComplete = lots.every(lot => lot.price !== null);
  const entry = quantity.isZero() || !pricesComplete ? null : text(lots.reduce((sum,lot)=>sum.add(lot.quantity.mul(lot.price!)),new Decimal(0)).div(quantity));
  return { quantity: quantity.toFixed(), entryAtMs: quantity.isZero() || lots.some(lot=>lot.atMs===null) ? null : Math.min(...lots.map(lot=>lot.atMs!)),
    averageEntryUsd: entry, knownBasisUsd: text(knownCost), knownQuantity: knownQuantity.toFixed(), basisComplete,
    unrealizedPnlUsd: basisComplete && pnl !== null ? text(pnl) : null,
    knownUnrealizedPnlUsd: pnl === null ? null : text(pnl),
    unrealizedPnlPct: basisComplete && pnl !== null && knownCost.gt(0) ? text(pnl.div(knownCost).mul(100)) : null,
    realizedPnlUsd: unknownRealized ? null : text(realized), knownRealizedPnlUsd: text(realized), realizedComplete: !unknownRealized,
    status: quantity.gt(0) ? 'holding' as const : exits.length > 0 ? 'closed' as const : 'watching' as const,
    exits };
  };
  const totals=()=>({quantity:held.toFixed(),basisComplete:held.eq(knownHeld),knownBasisUsd:text(knownCostTotal),
    realizedComplete:!unknownRealized,realizedPnlUsd:unknownRealized?null:text(realized)});
  return {apply,snapshot,totals};
}

/** Unknown opening inventory is consumed before later known buys, never assigned their basis. */
export function projectPaperPosition(input:{readonly fills:readonly ActivityFill[];readonly openingQuantity:string;readonly markUsd:string|null}) {
  const replay=createPositionReplay(input.openingQuantity);
  for(const fill of [...input.fills].sort((a,b)=>a.atMs-b.atMs||a.id.localeCompare(b.id)))replay.apply(fill);
  return replay.snapshot(input.markUsd);
}

/** Replay once in chronological order; historical quantities must reconcile with recorded marks. */
export function projectPaperPositionTimeline(input:{readonly fills:readonly ActivityFill[];readonly openingQuantity:string;
  readonly observations:readonly {atMs:number;quantity:string|null;valueUsd:string|null}[]}) {
  const replay=createPositionReplay(input.openingQuantity);
  const fills=[...input.fills].sort((a,b)=>a.atMs-b.atMs||a.id.localeCompare(b.id));let index=0;
  return input.observations.map(observation=>{
    while(index<fills.length&&fills[index]!.atMs<=observation.atMs)replay.apply(fills[index++]!);
    const position=replay.totals();
    const empty=new Decimal(position.quantity).isZero();
    const reconciled=observation.quantity===null?empty:samePaperQuantity(position.quantity,observation.quantity);
    const totalPnlUsd=!reconciled||!position.basisComplete||!position.realizedComplete||!empty&&observation.valueUsd===null?null:
      new Decimal(position.realizedPnlUsd!).add(empty?'0':observation.valueUsd!).minus(position.knownBasisUsd).toFixed();
    return {atMs:observation.atMs,totalPnlUsd};
  });
}

export function allocationPercent(weight: number): string { return new Decimal(weight).mul(100).toFixed(); }
export function samePaperQuantity(left:string,right:string):boolean { return new Decimal(left).eq(right); }
export function markPaperPosition(position:ReturnType<typeof projectPaperPosition>,markUsd:string|null) {
  const profit=markUsd===null?null:new Decimal(position.knownQuantity).mul(markUsd).minus(position.knownBasisUsd);
  return { ...position, knownUnrealizedPnlUsd:profit===null?null:text(profit),
    unrealizedPnlUsd:position.basisComplete&&profit!==null?text(profit):null,
    unrealizedPnlPct:position.basisComplete&&profit!==null&&new Decimal(position.knownBasisUsd).gt(0)?text(profit.div(position.knownBasisUsd).mul(100)):null };
}

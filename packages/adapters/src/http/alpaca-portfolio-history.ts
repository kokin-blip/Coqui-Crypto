import { Decimal } from 'decimal.js';

export interface AlpacaPortfolioHistory {
  readonly baseValueUsd:string;
  readonly points:readonly {atMs:number;equityUsd:string|null;reportedPnlUsd:string|null}[];
  readonly cashflows:Readonly<Record<string,readonly (string|null)[]>>|null;
}
/** Provider JSON numbers are normalized immediately; money arithmetic uses Decimal. */
export function parseAlpacaPortfolioHistory(value:unknown):AlpacaPortfolioHistory {
  const fail=():never=>{throw new TypeError('invalid_alpaca_portfolio_history');};
  const money=(raw:unknown):string=>{
    if(typeof raw!=='string'&&typeof raw!=='number')return fail();
    const parsed=new Decimal(String(raw));if(!parsed.isFinite()||parsed.precision()>40)return fail();
    return parsed.toFixed();
  };
  if(value===null||typeof value!=='object')return fail();
  const raw=value as Record<string,unknown>,times=raw['timestamp'],equity=raw['equity'],pnl=raw['profit_loss'];
  if(!Array.isArray(times)||!Array.isArray(equity)||!Array.isArray(pnl)||times.length>5000||
    times.length!==equity.length||times.length!==pnl.length)return fail();
  let previous=-1;
  const points=times.map((at,index)=>{
    if(typeof at!=='number'||!Number.isSafeInteger(at)||at<0||at<=previous||!Number.isSafeInteger(at*1000))return fail();
    previous=at;return {atMs:at*1000,equityUsd:equity[index]===null?null:money(equity[index]),reportedPnlUsd:pnl[index]===null?null:money(pnl[index])};
  });
  let cashflows:Record<string,(string|null)[]>|null=null;
  if(raw['cashflow']!==undefined&&raw['cashflow']!==null){
    const flows=raw['cashflow'];if(typeof flows!=='object'||Array.isArray(flows)||Object.keys(flows).length>40)return fail();
    cashflows={};
    for(const [kind,amounts]of Object.entries(flows)){
      if(!/^[A-Z]{1,12}$/u.test(kind)||!Array.isArray(amounts)||amounts.length!==times.length)return fail();
      cashflows[kind]=amounts.map(amount=>amount===null?null:money(amount));
    }
  }
  return {baseValueUsd:money(raw['base_value']),points,cashflows};
}

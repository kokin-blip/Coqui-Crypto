/** P5 presentation only; canonical decimal values and methods remain unchanged. */
const LABELS: Readonly<Record<string,string>> = {
 equityUsd:'Total managed equity', activeEquityUsd:'Active-sleeve equity', balanceChangeUsd:'Raw equity change',
 economicPnlUsd:'Economic P&L', realizedPnlUsd:'Realized investment P&L', unrealizedPnlUsd:'Unrealized investment P&L',
 contributionsUsd:'External contributions', netOutflowsUsd:'Net external outflows', confirmedUserReceiptsUsd:'Simulated confirmed user receipts',
 feesUsd:'Modeled account fees', incomeUsd:'Simulated investment income', completedWins:'Completed winning trades',
 timeWeightedReturnPct:'Total time-weighted return (period)', sleeveTimeWeightedReturnPct:'Active-sleeve time-weighted return (period)',
 annualizedReturnPct:'Annualized total TWR (ACT/365)', moneyWeightedReturnPct:'Money-weighted annual IRR (ACT/365)',
 maxDrawdownPct:'Maximum daily drawdown', volatilityPct:'Daily volatility (annualized)', sharpe:'Sharpe (zero risk-free rate)',
 sortino:'Sortino (zero target)', calmar:'Calmar', timeBelowHighPct:'Time below daily high',
 userNetZeroExtraExpenseUsd:'Equity plus simulated receipts', userNetDeclaredExpenseUsd:'User net after declared outside expenses',
 receiptsToContributedPct:'Simulated receipts / contributed capital', meanInvestedPct:'Mean observed active exposure',
 maxConcentrationPct:'Maximum observed active concentration',
};
export function contestMetricLabel(name:string):string {
 const days=/^worstRolling(\d+)ReturnPct$/u.exec(name)?.[1];
 return LABELS[name]??(days?`Worst complete ${days}-day NAV return`:`Additional metric: ${name}`);
}
/** Truncate display to four places with an explicit ellipsis for omitted nonzero digits. */
export function contestMetricNumber(value:string):string {
 const [whole,fraction='']=value.split('.');
 if(fraction.length<=4)return value;
 return `${whole}.${fraction.slice(0,4)}${/[1-9]/u.test(fraction.slice(4))?'…':''}`;
}

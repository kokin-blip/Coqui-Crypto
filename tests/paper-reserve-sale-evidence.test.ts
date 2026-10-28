import {describe,it,expect} from 'vitest';
import {readPaperReserveSaleLots,capturePaperCapitalEvidence} from '@coqui/services';
import {saleServiceFixture} from './helpers/paper-reserve-sale.js';
const key='coinbase|spot|BTC-USD';
describe('Main FIFO sale evidence',()=>{
 it('includes the actual buy fee in remaining basis after a partial sell',()=>{const f=saleServiceFixture();try{
  f.db.prepare("UPDATE paper_fills_v3 SET execution_price_text='49.5',notional_text='495',venue_fee_text='5' WHERE id='buy-fill'").run();
  f.db.prepare("UPDATE paper_ledger_entries_v3 SET amount_usd_text='495' WHERE id='buy-fill:asset'").run();f.db.prepare("UPDATE paper_ledger_entries_v3 SET amount_usd_text='5' WHERE id='buy-fill:venue_fee'").run();
  const at=f.now()+1;f.db.prepare('INSERT INTO paper_orders_v3 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('sell','main','sell-run','BTC-USD',key,'sell','2','110','filled','rules','decision',null,at,at);
  f.db.prepare('INSERT INTO paper_fills_v3 VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('sell-fill','sell','main','2','55','110','1','0','0','0',at,'mark');
  for(const [account,id,q,amount] of [['cash',null,'0','109'],['asset',key,'-2','-110'],['venue_fee',null,'0','1']] as const)f.db.prepare('INSERT INTO paper_ledger_entries_v3 VALUES(?,?,?,?,?,?,?,?,?,?)').run(`sell-fill:${account}`,'main','sell-run','sell','sell-fill',account,id,amount,q,at);
  f.db.prepare("UPDATE paper_balances_v3 SET quantity_text='109',updated_at=? WHERE asset_id='USD'").run(at);f.db.prepare("UPDATE paper_balances_v3 SET quantity_text='8',updated_at=? WHERE asset_id=?").run(at,key);f.advance(2);capturePaperCapitalEvidence('main',f.now(),f.marks(),f.db);
  expect(readPaperReserveSaleLots('main',f.now(),f.db)).toMatchObject([{id:'buy-fill',quantity:'8',basisUsd:'400'}]);
 }finally{f.db.close();}});
 it('does not repair incoherent quantities or missing acquisition history',()=>{const f=saleServiceFixture();try{
  f.db.prepare("UPDATE paper_balances_v3 SET quantity_text='11' WHERE asset_id=?").run(key);capturePaperCapitalEvidence('main',f.now(),f.marks(),f.db);expect(()=>readPaperReserveSaleLots('main',f.now(),f.db)).toThrow('sale_fifo_history_unavailable');
 }finally{f.db.close();}});
 it('refuses same-asset equal-time ordering rather than using receipt or row ID order',()=>{const f=saleServiceFixture();try{
  const at=f.now()-1;f.db.prepare("UPDATE paper_fills_v3 SET quantity_text='5',notional_text='250' WHERE id='buy-fill'").run();f.db.prepare("UPDATE paper_ledger_entries_v3 SET amount_usd_text='-250' WHERE id='buy-fill:cash'").run();f.db.prepare("UPDATE paper_ledger_entries_v3 SET quantity_text='5',amount_usd_text='250' WHERE id='buy-fill:asset'").run();
  f.db.prepare('INSERT INTO paper_orders_v3 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('second-buy','main','second-run','BTC-USD',key,'buy','5','250','filled','rules','decision',null,at,at);f.db.prepare('INSERT INTO paper_fills_v3 VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('second-fill','second-buy','main','5','50','250','0','0','0','0',at,'mark');
  // Same timestamp as the original acquisition; the canonical investment reader must refuse ordering first.
  f.db.prepare("UPDATE paper_fills_v3 SET filled_at=? WHERE id='buy-fill'").run(at);f.db.prepare("UPDATE paper_ledger_entries_v3 SET at=? WHERE fill_id='buy-fill'").run(at);
  for(const [account,id,q,amount] of [['cash',null,'0','-250'],['asset',key,'5','250'],['venue_fee',null,'0','0']] as const)f.db.prepare('INSERT INTO paper_ledger_entries_v3 VALUES(?,?,?,?,?,?,?,?,?,?)').run(`second-fill:${account}`,'main','second-run','second-buy','second-fill',account,id,amount,q,at);
  capturePaperCapitalEvidence('main',f.now(),f.marks(),f.db);expect(()=>readPaperReserveSaleLots('main',f.now(),f.db)).toThrow('sale_fifo_history_unavailable');
 }finally{f.db.close();}});
});

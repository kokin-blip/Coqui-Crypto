import {describe,it,expect} from 'vitest';
// @ts-expect-error TS6142: Vitest compiles renderer JSX; root test config excludes JSX.
import {saleDisplayAmount} from '../apps/desktop/src/renderer/app/PaperReserveSale.js';
describe('sale review display precision',()=>{
 it('rounds only the display and explicitly marks changed USD values',()=>{const exact='3.062763686046817489000000001837641986565';expect(saleDisplayAmount(exact)).toBe('≈ 3.06');expect(exact).toBe('3.062763686046817489000000001837641986565');expect(saleDisplayAmount('50')).toBe('50.00');});
 it('keeps unavailable distinct from actual zero and preserves signs',()=>{expect(saleDisplayAmount(null)).toBe('Unavailable');expect(saleDisplayAmount('0')).toBe('0.00');expect(saleDisplayAmount('-0.004')).toBe('≈ 0.00');});
 it('keeps quantities readable without converting decimal strings through binary floating point',()=>{expect(saleDisplayAmount('6.55130833',8)).toBe('6.55130833');expect(saleDisplayAmount('0.000000001',8)).toBe('≈ 0');expect(saleDisplayAmount('9007199254740993.00')).toBe('9007199254740993.00');});
});

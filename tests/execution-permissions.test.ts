import { describe, expect, it } from 'vitest';
import { canExecute, liveTradingUnlocked } from '../packages/core/src/index.js';

describe('execution permissions', () => {
  it('allows paper execution only while the kill switch is clear', () => {
    expect(canExecute('paper', false)).toBe(true);
    expect(canExecute('paper', true)).toBe(false);
    expect(canExecute('off', false)).toBe(false);
  });

  it.each([false, true])('keeps live execution disabled when killed=%s', (killed) => {
    expect(canExecute('live', killed)).toBe(false);
  });

  it('keeps the independent future-live gates closed', () => {
    expect(liveTradingUnlocked()).toBe(false);
  });
});

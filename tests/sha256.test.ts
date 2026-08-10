import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../packages/core/src/crypto/sha256.js';

describe('shared SHA-256', () => {
  it('matches the standard empty and abc vectors', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

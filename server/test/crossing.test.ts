import { describe, expect, it } from 'vitest';
import { directionFor, hasReached, watchedPrice } from '../src/logic/crossing.js';

describe('watchedPrice', () => {
  const q = { bid: 1.085, ask: 1.0852 };
  it('uses the ask for BUY alerts', () => expect(watchedPrice(q, 'BUY')).toBe(1.0852));
  it('uses the bid for SELL alerts', () => expect(watchedPrice(q, 'SELL')).toBe(1.085));
  it('uses the bid for plain alerts', () => expect(watchedPrice(q, null)).toBe(1.085));
});

describe('directionFor', () => {
  it('is up when price is below the target', () => expect(directionFor(1.08, 1.09)).toBe('up'));
  it('is down when price is above the target', () => expect(directionFor(1.1, 1.09)).toBe('down'));
  it('is null when price is already on the target', () => expect(directionFor(1.09, 1.09)).toBeNull());
});

describe('hasReached', () => {
  it('does not fire before price gets there', () => {
    expect(hasReached(1.0899, 1.09, 'up')).toBe(false);
    expect(hasReached(1.0901, 1.09, 'down')).toBe(false);
  });
  it('fires exactly at the price', () => {
    expect(hasReached(1.09, 1.09, 'up')).toBe(true);
    expect(hasReached(1.09, 1.09, 'down')).toBe(true);
  });
  it('fires when price gaps through the level', () => {
    expect(hasReached(1.095, 1.09, 'up')).toBe(true);
    expect(hasReached(1.085, 1.09, 'down')).toBe(true);
  });
  it('does not fire on a move away from the target', () => {
    expect(hasReached(1.07, 1.09, 'up')).toBe(false);
    expect(hasReached(1.12, 1.09, 'down')).toBe(false);
  });
});

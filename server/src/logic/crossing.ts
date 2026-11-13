import type { Direction, Quote, Side } from '../types.js';

/**
 * The price an alert is compared against. A BUY fills at the ask, so a BUY alert
 * watches the ask. Everything else watches the bid, which is what charts show.
 */
export function watchedPrice(quote: Pick<Quote, 'bid' | 'ask'>, side: Side | null): number {
  return side === 'BUY' ? quote.ask : quote.bid;
}

/**
 * Which way price has to travel to reach the target. Returns null when price is
 * already exactly on the target, which the caller treats as "reached".
 */
export function directionFor(price: number, target: number): Direction | null {
  if (price < target) return 'up';
  if (price > target) return 'down';
  return null;
}

/**
 * True once price has reached or gone through the target. A gap straight through
 * the level counts, so an alert is never skipped by a fast market or a reconnect.
 */
export function hasReached(price: number, target: number, direction: Direction): boolean {
  return direction === 'up' ? price >= target : price <= target;
}

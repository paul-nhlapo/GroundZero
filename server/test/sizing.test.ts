import { describe, expect, it } from 'vitest';
import { floorToStep, planTrade, spreadInPips, type TradeRequest } from '../src/logic/sizing.js';
import type { Quote, SymbolSpec } from '../src/types.js';

const EURUSD: SymbolSpec = {
  symbol: 'EURUSD', digits: 5, point: 0.00001, tickSize: 0.00001, pipSize: 0.0001,
  minVolume: 0.01, maxVolume: 100, volumeStep: 0.01, stopsLevel: 0,
};
const XAUUSD: SymbolSpec = {
  symbol: 'XAUUSD', digits: 2, point: 0.01, tickSize: 0.01, pipSize: 0.1,
  minVolume: 0.01, maxVolume: 50, volumeStep: 0.01, stopsLevel: 0,
};
const USDJPY: SymbolSpec = {
  symbol: 'USDJPY', digits: 3, point: 0.001, tickSize: 0.001, pipSize: 0.01,
  minVolume: 0.01, maxVolume: 100, volumeStep: 0.01, stopsLevel: 0,
};
const quote = (symbol: string, bid: number, ask: number, lossTickValue: number): Quote => ({
  symbol, bid, ask, lossTickValue, time: 0,
});
const req = (over: Partial<TradeRequest>): TradeRequest => ({
  side: 'BUY', slPrice: null, slPips: null, rr: 2, riskMode: 'percent', riskValue: 1, ...over,
});
const plan = (...args: Parameters<typeof planTrade>) => {
  const r = planTrade(...args);
  if (!r.ok) throw new Error(r.reason);
  return r.plan;
};

describe('floorToStep', () => {
  it('rounds down, never up', () => expect(floorToStep(0.129, 0.01)).toBe(0.12));
  it('has no floating point drift', () => {
    expect(floorToStep(0.3, 0.1)).toBe(0.3);
    expect(floorToStep(0.07, 0.01)).toBe(0.07);
    expect(floorToStep(1.15, 0.05)).toBe(1.15);
  });
  it('handles whole-lot steps', () => expect(floorToStep(3.9, 1)).toBe(3));
});

describe('planTrade take profit from Risk to Reward', () => {
  it('BUY: TP is RR times the stop distance above the ask', () => {
    const p = plan(req({ side: 'BUY', slPips: 20, rr: 2 }), quote('EURUSD', 1.0848, 1.085, 1), EURUSD, 10_000);
    expect(p.entry).toBe(1.085);
    expect(p.sl).toBe(1.083);
    expect(p.tp).toBe(1.089);
  });
  it('SELL: TP is RR times the stop distance below the bid', () => {
    const p = plan(req({ side: 'SELL', slPips: 20, rr: 3 }), quote('EURUSD', 1.085, 1.0852, 1), EURUSD, 10_000);
    expect(p.entry).toBe(1.085);
    expect(p.sl).toBe(1.087);
    expect(p.tp).toBe(1.079);
  });
  it('accepts a stop loss given as a price', () => {
    const p = plan(req({ side: 'SELL', slPrice: 2410, rr: 1.5 }), quote('XAUUSD', 2400, 2400.3, 1), XAUUSD, 10_000);
    expect(p.sl).toBe(2410);
    expect(p.tp).toBe(2385);
  });
});

describe('planTrade lot size', () => {
  it('EURUSD: 1% of 10,000 with a 20 pip stop is 0.50 lots', () => {
    // 200 ticks x $1 per tick per lot = $200 loss per lot; $100 risk / $200 = 0.5
    const p = plan(req({ slPips: 20 }), quote('EURUSD', 1.0848, 1.085, 1), EURUSD, 10_000);
    expect(p.volume).toBe(0.5);
    expect(p.riskMoney).toBe(100);
  });
  it('XAUUSD: 1% of 5,000 with a $5 stop is 0.10 lots', () => {
    // 500 ticks x $1 = $500 per lot; $50 / $500 = 0.1
    const p = plan(req({ slPrice: 2395 }), quote('XAUUSD', 2399.7, 2400, 1), XAUUSD, 5_000);
    expect(p.volume).toBe(0.1);
  });
  it('USDJPY: uses the broker tick value for a non-USD quote currency', () => {
    // 300 ticks x $0.65 = $195 per lot; $100 / $195 = 0.5128 -> 0.51
    const p = plan(req({ slPips: 30 }), quote('USDJPY', 153.98, 154, 0.65), USDJPY, 10_000);
    expect(p.volume).toBe(0.51);
    expect(p.riskMoney).toBeLessThanOrEqual(100);
  });
  it('rounds down so risk is never exceeded', () => {
    const p = plan(req({ slPips: 15 }), quote('EURUSD', 1.0848, 1.085, 1), EURUSD, 10_000);
    expect(p.volume).toBe(0.66);
    expect(p.riskMoney).toBeLessThanOrEqual(100);
  });
  it('caps at the broker maximum lot', () => {
    const p = plan(req({ slPips: 1, riskValue: 50 }), quote('EURUSD', 1.0848, 1.085, 1), EURUSD, 10_000_000);
    expect(p.volume).toBe(100);
  });
  it('uses a fixed lot as given', () => {
    const p = plan(req({ slPips: 20, riskMode: 'fixed', riskValue: 0.25 }), quote('EURUSD', 1.0848, 1.085, 1), EURUSD, 10_000);
    expect(p.volume).toBe(0.25);
  });
});

describe('planTrade refusals', () => {
  const q = quote('EURUSD', 1.0848, 1.085, 1);
  it('refuses when the lot would be below the broker minimum', () => {
    const r = planTrade(req({ slPips: 200, riskValue: 0.1 }), q, EURUSD, 100);
    expect(r).toMatchObject({ ok: false });
  });
  it('refuses a BUY stop loss above the entry', () => {
    const r = planTrade(req({ side: 'BUY', slPrice: 1.09 }), q, EURUSD, 10_000);
    expect(r).toMatchObject({ ok: false });
  });
  it('refuses a SELL stop loss below the entry', () => {
    const r = planTrade(req({ side: 'SELL', slPrice: 1.08 }), q, EURUSD, 10_000);
    expect(r).toMatchObject({ ok: false });
  });
  it('refuses when no stop loss is set', () => {
    expect(planTrade(req({}), q, EURUSD, 10_000)).toMatchObject({ ok: false });
  });
  it('refuses a stop closer than the broker stops level', () => {
    const r = planTrade(req({ slPips: 1 }), q, { ...EURUSD, stopsLevel: 50 }, 10_000);
    expect(r).toMatchObject({ ok: false });
  });
  it('refuses percent risk when the broker sent no tick value', () => {
    const r = planTrade(req({ slPips: 20 }), { ...q, lossTickValue: undefined }, EURUSD, 10_000);
    expect(r).toMatchObject({ ok: false });
  });
});

describe('spreadInPips', () => {
  it('measures the spread in pips', () => {
    expect(spreadInPips({ bid: 1.085, ask: 1.0852 }, EURUSD)).toBeCloseTo(2, 6);
    expect(spreadInPips({ bid: 2400, ask: 2400.3 }, XAUUSD)).toBeCloseTo(3, 6);
  });
});

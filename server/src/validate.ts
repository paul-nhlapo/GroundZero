import type { AlertInput } from './db.js';
import type { Settings } from './types.js';

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
};

/** Checks an alert sent by the app. Trade fields are only required when auto-execute is on. */
export function parseAlert(body: unknown, knownSymbols: string[], defaults: Settings): Result<AlertInput> {
  const b = (body ?? {}) as Record<string, unknown>;
  const symbol = String(b.symbol ?? '').trim();
  if (!symbol) return { ok: false, error: 'Choose a symbol' };
  if (knownSymbols.length > 0 && !knownSymbols.includes(symbol)) {
    return { ok: false, error: `${symbol} is not available on this account` };
  }
  const target = num(b.target);
  if (target == null || !(target > 0)) return { ok: false, error: 'Enter the price to be alerted at' };
  const note = String(b.note ?? '').slice(0, 200);
  const autoExecute = b.autoExecute === true;

  const side = b.side === 'BUY' || b.side === 'SELL' ? b.side : null;
  const slPrice = num(b.slPrice);
  const slPips = num(b.slPips);
  const rr = num(b.rr) ?? defaults.defaultRr;
  const riskMode = b.riskMode === 'fixed' ? 'fixed' : 'percent';
  const riskValue = num(b.riskValue) ?? (riskMode === 'percent' ? defaults.defaultRiskPercent : null);

  if (autoExecute) {
    if (!side) return { ok: false, error: 'Choose Buy or Sell for the automatic trade' };
    const hasPrice = slPrice != null && slPrice > 0;
    const hasPips = slPips != null && slPips > 0;
    if (!hasPrice && !hasPips) return { ok: false, error: 'Set a stop loss for the automatic trade' };
    if (hasPrice && side === 'BUY' && slPrice >= target) {
      return { ok: false, error: 'For a Buy, the stop loss must be below the alert price' };
    }
    if (hasPrice && side === 'SELL' && slPrice <= target) {
      return { ok: false, error: 'For a Sell, the stop loss must be above the alert price' };
    }
    if (!(rr > 0) || rr > 50) return { ok: false, error: 'Risk to Reward must be between 0 and 50' };
    if (riskValue == null || !(riskValue > 0)) return { ok: false, error: 'Enter how much to risk' };
    if (riskMode === 'percent' && riskValue > 10) {
      return { ok: false, error: 'Risk per trade is limited to 10% of the balance' };
    }
  }

  return {
    ok: true,
    value: {
      symbol, target, note, autoExecute, side,
      slPrice: slPrice != null && slPrice > 0 ? slPrice : null,
      slPips: slPrice != null && slPrice > 0 ? null : slPips != null && slPips > 0 ? slPips : null,
      rr: Number.isFinite(rr) ? rr : null,
      riskMode: side ? riskMode : null,
      riskValue: side && riskValue != null && Number.isFinite(riskValue) ? riskValue : null,
    },
  };
}

export function parseSettings(body: unknown): Result<Partial<Settings>> {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: Partial<Settings> = {};
  if (typeof b.autoTradeEnabled === 'boolean') out.autoTradeEnabled = b.autoTradeEnabled;
  if (b.defaultRiskPercent !== undefined) {
    const v = num(b.defaultRiskPercent);
    if (v == null || !(v > 0) || v > 10) return { ok: false, error: 'Default risk must be between 0 and 10%' };
    out.defaultRiskPercent = v;
  }
  if (b.defaultRr !== undefined) {
    const v = num(b.defaultRr);
    if (v == null || !(v > 0) || v > 50) return { ok: false, error: 'Default Risk to Reward must be between 0 and 50' };
    out.defaultRr = v;
  }
  if (b.maxSpreadPips !== undefined) {
    const v = num(b.maxSpreadPips);
    if (v == null || !(v >= 0)) return { ok: false, error: 'Maximum spread cannot be negative' };
    out.maxSpreadPips = v;
  }
  return { ok: true, value: out };
}

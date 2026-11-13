import type { Quote, RiskMode, Side, SymbolSpec } from '../types.js';

export interface TradeRequest {
  side: Side;
  slPrice: number | null;
  slPips: number | null;
  rr: number;
  riskMode: RiskMode;
  /** Percent of balance when riskMode is 'percent', lots when it is 'fixed'. */
  riskValue: number;
}

export interface TradePlan {
  side: Side;
  volume: number;
  entry: number;
  sl: number;
  tp: number;
  /** Money lost if the stop loss is hit, in account currency. Undefined when unknown. */
  riskMoney?: number;
}

export type PlanResult = { ok: true; plan: TradePlan } | { ok: false; reason: string };

const EPS = 1e-9;

export function roundTo(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

/** Rounds a volume down to the broker's lot step, without floating point drift. */
export function floorToStep(volume: number, step: number): number {
  const steps = Math.floor(volume / step + EPS);
  const decimals = Math.max(0, Math.ceil(-Math.log10(step) - EPS));
  return Number((steps * step).toFixed(decimals));
}

export function spreadInPips(quote: Pick<Quote, 'bid' | 'ask'>, spec: SymbolSpec): number {
  return (quote.ask - quote.bid) / spec.pipSize;
}

/**
 * Works out entry, stop loss, take profit and lot size for a market order.
 * Never rounds a position up: if the risk allows less than the minimum lot the
 * trade is refused, because taking it would risk more than the user asked for.
 */
export function planTrade(
  req: TradeRequest,
  quote: Quote,
  spec: SymbolSpec,
  balance: number,
): PlanResult {
  const buy = req.side === 'BUY';
  const entry = buy ? quote.ask : quote.bid;

  let sl: number;
  if (req.slPrice != null) {
    sl = req.slPrice;
  } else if (req.slPips != null && req.slPips > 0) {
    sl = buy ? entry - req.slPips * spec.pipSize : entry + req.slPips * spec.pipSize;
  } else {
    return { ok: false, reason: 'No stop loss set' };
  }
  sl = roundTo(sl, spec.digits);

  const slDistance = buy ? entry - sl : sl - entry;
  if (slDistance <= EPS) {
    return {
      ok: false,
      reason: `Stop loss ${sl} is on the wrong side of the ${req.side} entry ${roundTo(entry, spec.digits)}`,
    };
  }
  const minDistance = spec.stopsLevel * spec.point;
  if (slDistance + EPS < minDistance) {
    return {
      ok: false,
      reason: `Stop loss is closer than the broker minimum of ${spec.stopsLevel} points`,
    };
  }
  if (!(req.rr > 0)) return { ok: false, reason: 'Risk to Reward ratio must be above 0' };

  const tp = roundTo(buy ? entry + slDistance * req.rr : entry - slDistance * req.rr, spec.digits);

  let volume: number;
  let riskMoney: number | undefined;
  const lossPerLot =
    quote.lossTickValue && quote.lossTickValue > 0
      ? (slDistance / spec.tickSize) * quote.lossTickValue
      : undefined;

  if (req.riskMode === 'fixed') {
    volume = floorToStep(req.riskValue, spec.volumeStep);
  } else {
    if (!(req.riskValue > 0)) return { ok: false, reason: 'Risk percent must be above 0' };
    if (!(balance > 0)) return { ok: false, reason: 'Account balance is not available' };
    if (lossPerLot == null) {
      return { ok: false, reason: 'Broker did not send a tick value, so lot size cannot be calculated' };
    }
    volume = floorToStep((balance * req.riskValue) / 100 / lossPerLot, spec.volumeStep);
  }

  if (volume + EPS < spec.minVolume) {
    return {
      ok: false,
      reason: `Calculated lot ${volume} is below the broker minimum ${spec.minVolume}`,
    };
  }
  if (volume > spec.maxVolume) volume = floorToStep(spec.maxVolume, spec.volumeStep);
  if (lossPerLot != null) riskMoney = roundTo(lossPerLot * volume, 2);

  return {
    ok: true,
    plan: { side: req.side, volume, entry: roundTo(entry, spec.digits), sl, tp, riskMoney },
  };
}

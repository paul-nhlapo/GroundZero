export type Side = 'BUY' | 'SELL';
export type Direction = 'up' | 'down';
export type AlertStatus = 'active' | 'triggered' | 'cancelled';
export type RiskMode = 'percent' | 'fixed';

export interface Quote {
  symbol: string;
  bid: number;
  ask: number;
  /** Account-currency value of one tick for one lot, when the trade loses. */
  lossTickValue?: number;
  time: number;
}

export interface SymbolSpec {
  symbol: string;
  digits: number;
  point: number;
  tickSize: number;
  pipSize: number;
  minVolume: number;
  maxVolume: number;
  volumeStep: number;
  /** Minimum SL/TP distance from price, in points. */
  stopsLevel: number;
}

export interface Alert {
  id: number;
  symbol: string;
  target: number;
  note: string;
  status: AlertStatus;
  /** Set when the first price is seen: which way price must move to reach the target. */
  direction: Direction | null;
  autoExecute: boolean;
  side: Side | null;
  slPrice: number | null;
  slPips: number | null;
  rr: number | null;
  riskMode: RiskMode | null;
  riskValue: number | null;
  createdAt: number;
  triggeredAt: number | null;
  triggeredPrice: number | null;
}

export interface Settings {
  /** Master switch. When false no alert places a trade, whatever its own toggle says. */
  autoTradeEnabled: boolean;
  defaultRiskPercent: number;
  defaultRr: number;
  /** 0 disables the spread check. */
  maxSpreadPips: number;
}

export interface OrderLog {
  id: number;
  alertId: number;
  symbol: string;
  side: Side;
  status: 'filled' | 'skipped' | 'failed';
  volume: number | null;
  entry: number | null;
  sl: number | null;
  tp: number | null;
  message: string;
  createdAt: number;
}

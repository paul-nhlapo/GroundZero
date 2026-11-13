import type { Quote, Side, SymbolSpec } from './types.js';

export interface OrderRequest {
  symbol: string;
  side: Side;
  volume: number;
  sl: number;
  tp: number;
  /** Stable id for this order, so a retry can never open a second position. */
  clientId: string;
  comment: string;
}

export interface OrderResult {
  orderId?: string;
  positionId?: string;
  message: string;
}

export interface BrokerStatus {
  kind: 'metaapi' | 'sim';
  /** True when prices are flowing and orders can be sent. */
  connected: boolean;
  /** Short text for the app, e.g. "Connected" or what is missing. */
  detail: string;
  accountName?: string;
  balance?: number;
  currency?: string;
  tradeAllowed?: boolean;
}

export interface Broker {
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): BrokerStatus;
  /** Symbols the account can trade. Empty until connected. */
  symbols(): string[];
  spec(symbol: string): SymbolSpec | undefined;
  /** Latest known price, if the symbol is being watched. */
  quote(symbol: string): Quote | undefined;
  /** Start streaming prices for a symbol. Resolves with the first price when one is available. */
  watch(symbol: string): Promise<Quote | undefined>;
  unwatch(symbol: string): Promise<void>;
  onQuote(listener: (quote: Quote) => void): void;
  placeMarketOrder(order: OrderRequest): Promise<OrderResult>;
}

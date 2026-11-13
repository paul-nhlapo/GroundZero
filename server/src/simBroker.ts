import type { Broker, BrokerStatus, OrderRequest, OrderResult } from './broker.js';
import type { Quote, SymbolSpec } from './types.js';

interface SimSymbol {
  spec: SymbolSpec;
  mid: number;
  spread: number;
  tickValue: number;
}

const fx = (symbol: string, mid: number, digits: 3 | 5, tickValue: number): SimSymbol => {
  const point = digits === 5 ? 0.00001 : 0.001;
  return {
    spec: { symbol, digits, point, tickSize: point, pipSize: point * 10, minVolume: 0.01, maxVolume: 100, volumeStep: 0.01, stopsLevel: 0 },
    mid, spread: point * 12, tickValue,
  };
};

/**
 * A fake market for trying the app without a broker: random-walk prices and
 * orders that always fill at the current price. Nothing here touches real money.
 */
export class SimBroker implements Broker {
  private readonly market = new Map<string, SimSymbol>([
    ['EURUSD', fx('EURUSD', 1.085, 5, 1)],
    ['GBPUSD', fx('GBPUSD', 1.27, 5, 1)],
    ['USDJPY', fx('USDJPY', 154, 3, 0.65)],
    ['XAUUSD', {
      spec: { symbol: 'XAUUSD', digits: 2, point: 0.01, tickSize: 0.01, pipSize: 0.1, minVolume: 0.01, maxVolume: 50, volumeStep: 0.01, stopsLevel: 0 },
      mid: 2400, spread: 0.3, tickValue: 1,
    }],
  ]);
  private readonly watched = new Set<string>();
  private readonly listeners: Array<(q: Quote) => void> = [];
  private timer?: NodeJS.Timeout;
  private nextOrder = 1;
  balance = 10_000;
  readonly orders: OrderRequest[] = [];

  /** @param tickMs how often prices move. 0 keeps prices still, for tests. */
  constructor(private readonly tickMs = 1000) {}

  async start(): Promise<void> {
    if (this.tickMs > 0) {
      this.timer = setInterval(() => {
        for (const symbol of this.watched) {
          const s = this.market.get(symbol)!;
          this.setPrice(symbol, s.mid + (Math.random() - 0.5) * s.spec.pipSize * 4);
        }
      }, this.tickMs);
      this.timer.unref();
    }
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
  }

  status(): BrokerStatus {
    return {
      kind: 'sim', connected: true, detail: 'Simulated market (no real account)',
      accountName: 'Simulator', balance: this.balance, currency: 'USD', tradeAllowed: true,
    };
  }

  symbols(): string[] {
    return [...this.market.keys()];
  }

  spec(symbol: string): SymbolSpec | undefined {
    return this.market.get(symbol)?.spec;
  }

  quote(symbol: string): Quote | undefined {
    const s = this.market.get(symbol);
    if (!s) return undefined;
    const d = s.spec.digits;
    return {
      symbol,
      bid: Number((s.mid - s.spread / 2).toFixed(d)),
      ask: Number((s.mid + s.spread / 2).toFixed(d)),
      lossTickValue: s.tickValue,
      time: Date.now(),
    };
  }

  async watch(symbol: string): Promise<Quote | undefined> {
    if (!this.market.has(symbol)) return undefined;
    this.watched.add(symbol);
    return this.quote(symbol);
  }

  async unwatch(symbol: string): Promise<void> {
    this.watched.delete(symbol);
  }

  onQuote(listener: (quote: Quote) => void): void {
    this.listeners.push(listener);
  }

  /** Moves the simulated mid price and publishes the new quote. */
  setPrice(symbol: string, mid: number): void {
    const s = this.market.get(symbol);
    if (!s) throw new Error(`Unknown symbol ${symbol}`);
    s.mid = mid;
    const q = this.quote(symbol)!;
    for (const l of this.listeners) l(q);
  }

  async placeMarketOrder(order: OrderRequest): Promise<OrderResult> {
    this.orders.push(order);
    const id = String(this.nextOrder++);
    return { orderId: id, positionId: id, message: 'Simulated fill' };
  }
}

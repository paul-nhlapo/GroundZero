import type { Broker } from './broker.js';
import { claimTrigger, getSettings, listAlerts, logOrder, setDirection, type Db } from './db.js';
import { directionFor, hasReached, watchedPrice } from './logic/crossing.js';
import { planTrade, spreadInPips } from './logic/sizing.js';
import type { Notifier } from './push.js';
import type { Alert, Quote } from './types.js';

/**
 * Watches live prices against the active alerts. When price reaches an alert it
 * sends a push notification and, if the alert allows it, a market order.
 */
export class Engine {
  /** Active alerts grouped by symbol, kept in memory so each tick is cheap to check. */
  private bySymbol = new Map<string, Alert[]>();

  constructor(
    private readonly db: Db,
    private readonly broker: Broker,
    private readonly notifier: Notifier,
    private readonly log: (msg: string) => void = () => {},
  ) {
    broker.onQuote((q) => this.onQuote(q));
  }

  /** Reloads active alerts and makes the price subscriptions match them. Call after any alert change. */
  async refresh(): Promise<void> {
    const next = new Map<string, Alert[]>();
    for (const a of listAlerts(this.db, 'active')) {
      const list = next.get(a.symbol);
      if (list) list.push(a);
      else next.set(a.symbol, [a]);
    }
    const previous = this.bySymbol;
    this.bySymbol = next;
    for (const symbol of previous.keys()) {
      if (!next.has(symbol)) void this.broker.unwatch(symbol);
    }
    await Promise.all(
      [...next.keys()].map(async (symbol) => {
        // The price in hand may already be past an alert, e.g. after a restart.
        const quote = await this.broker.watch(symbol);
        if (quote) this.onQuote(quote);
      }),
    );
  }

  /**
   * Current price for a symbol that may not have an alert yet, for the "new alert"
   * form. The subscription is dropped again shortly after if no alert needs it.
   */
  async peek(symbol: string): Promise<Quote | undefined> {
    const quote = await this.broker.watch(symbol);
    if (!this.bySymbol.has(symbol)) {
      setTimeout(() => {
        if (!this.bySymbol.has(symbol)) void this.broker.unwatch(symbol);
      }, 60_000).unref();
    }
    return quote;
  }

  private onQuote(quote: Quote): void {
    const alerts = this.bySymbol.get(quote.symbol);
    if (!alerts?.length) return;
    for (const alert of alerts) {
      const price = watchedPrice(quote, alert.autoExecute ? alert.side : null);
      if (alert.direction == null) {
        const direction = directionFor(price, alert.target);
        if (direction != null) {
          alert.direction = direction;
          setDirection(this.db, alert.id, direction);
          continue;
        }
      } else if (!hasReached(price, alert.target, alert.direction)) {
        continue;
      }
      // Claimed in the database first: only one tick can ever win this.
      if (!claimTrigger(this.db, alert.id, price)) continue;
      this.bySymbol.set(quote.symbol, (this.bySymbol.get(quote.symbol) ?? []).filter((a) => a.id !== alert.id));
      void this.fire(alert, quote, price).catch((err) => this.log(`Alert ${alert.id} failed: ${err}`));
    }
    if (!this.bySymbol.get(quote.symbol)?.length) {
      this.bySymbol.delete(quote.symbol);
      void this.broker.unwatch(quote.symbol);
    }
  }

  private async fire(alert: Alert, quote: Quote, price: number): Promise<void> {
    this.log(`Alert ${alert.id} ${alert.symbol} reached ${alert.target} (price ${price})`);
    const note = alert.note ? ` — ${alert.note}` : '';
    await this.notifier.send({
      title: `${alert.symbol} reached ${alert.target}`,
      body: `Price is now ${price}${note}`,
      tag: `alert-${alert.id}`,
    });
    if (alert.autoExecute) await this.execute(alert, quote);
  }

  private async execute(alert: Alert, quote: Quote): Promise<void> {
    const side = alert.side ?? 'BUY';
    const skip = async (reason: string) => {
      logOrder(this.db, { alertId: alert.id, symbol: alert.symbol, side, status: 'skipped', volume: null, entry: null, sl: null, tp: null, message: reason });
      await this.notifier.send({ title: `${alert.symbol} trade not placed`, body: reason, tag: `order-${alert.id}` });
    };

    const settings = getSettings(this.db);
    if (!settings.autoTradeEnabled) return skip('Auto-trading is switched off in Settings');
    const status = this.broker.status();
    if (!status.connected) return skip('Trading account is not connected');
    if (status.tradeAllowed === false) return skip('Trading is not allowed on this account');
    const spec = this.broker.spec(alert.symbol);
    if (!spec) return skip(`No symbol details for ${alert.symbol}`);

    const spread = spreadInPips(quote, spec);
    if (settings.maxSpreadPips > 0 && spread > settings.maxSpreadPips) {
      return skip(`Spread ${spread.toFixed(1)} pips is above your limit of ${settings.maxSpreadPips}`);
    }

    const result = planTrade(
      {
        side,
        slPrice: alert.slPrice,
        slPips: alert.slPips,
        rr: alert.rr ?? settings.defaultRr,
        riskMode: alert.riskMode ?? 'percent',
        riskValue: alert.riskValue ?? settings.defaultRiskPercent,
      },
      quote,
      spec,
      status.balance ?? 0,
    );
    if (!result.ok) return skip(result.reason);
    const plan = result.plan;
    const record = { alertId: alert.id, symbol: alert.symbol, side, volume: plan.volume, entry: plan.entry, sl: plan.sl, tp: plan.tp };

    try {
      const res = await this.broker.placeMarketOrder({
        symbol: alert.symbol, side, volume: plan.volume, sl: plan.sl, tp: plan.tp,
        clientId: `GZ_${alert.id}`, comment: `GZ alert ${alert.id}`,
      });
      logOrder(this.db, { ...record, status: 'filled', message: res.message });
      await this.notifier.send({
        title: `${side} ${plan.volume} ${alert.symbol} placed`,
        body: `Entry about ${plan.entry}, SL ${plan.sl}, TP ${plan.tp}`,
        tag: `order-${alert.id}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logOrder(this.db, { ...record, status: 'failed', message });
      await this.notifier.send({ title: `${alert.symbol} order failed`, body: message, tag: `order-${alert.id}` });
    }
  }
}

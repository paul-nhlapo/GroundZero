import { beforeEach, describe, expect, it } from 'vitest';
import { createAlert, getAlert, listOrders, openDb, saveSettings, type AlertInput, type Db } from '../src/db.js';
import { Engine } from '../src/engine.js';
import type { Notifier, PushMessage } from '../src/push.js';
import { SimBroker } from '../src/simBroker.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

function fakeNotifier(): Notifier & { sent: PushMessage[] } {
  const sent: PushMessage[] = [];
  return {
    sent, publicKey: 'test',
    subscribe() {}, unsubscribe() {}, count: () => 1,
    async send(m) { sent.push(m); return { sent: 1, failed: 0 }; },
  };
}

const plain = (over: Partial<AlertInput>): AlertInput => ({
  symbol: 'EURUSD', target: 1.09, note: '', autoExecute: false, side: null,
  slPrice: null, slPips: null, rr: null, riskMode: null, riskValue: null, ...over,
});
const trade = (over: Partial<AlertInput>): AlertInput =>
  plain({ autoExecute: true, side: 'BUY', slPips: 20, rr: 2, riskMode: 'percent', riskValue: 1, ...over });

describe('Engine', () => {
  let db: Db;
  let broker: SimBroker;
  let notifier: ReturnType<typeof fakeNotifier>;
  let engine: Engine;

  beforeEach(() => {
    db = openDb(':memory:');
    broker = new SimBroker(0); // prices only move when the test moves them
    notifier = fakeNotifier();
    engine = new Engine(db, broker, notifier);
    broker.setPrice('EURUSD', 1.085);
  });

  it('sends one push when price rises to the alert', async () => {
    const a = createAlert(db, plain({ target: 1.09 }));
    await engine.refresh();
    broker.setPrice('EURUSD', 1.088);
    await flush();
    expect(notifier.sent).toHaveLength(0);
    broker.setPrice('EURUSD', 1.0905);
    await flush();
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0].title).toBe('EURUSD reached 1.09');
    expect(getAlert(db, a.id)?.status).toBe('triggered');
  });

  it('sends one push when price falls to the alert', async () => {
    createAlert(db, plain({ target: 1.08 }));
    await engine.refresh();
    broker.setPrice('EURUSD', 1.0795);
    await flush();
    expect(notifier.sent).toHaveLength(1);
  });

  it('never fires twice, even if price keeps crossing the level', async () => {
    createAlert(db, plain({ target: 1.09 }));
    await engine.refresh();
    for (const p of [1.091, 1.089, 1.091, 1.089, 1.092]) broker.setPrice('EURUSD', p);
    await flush();
    expect(notifier.sent).toHaveLength(1);
  });

  it('fires straight away after a restart if price already went through the level', async () => {
    createAlert(db, plain({ target: 1.09 }));
    await engine.refresh(); // direction "up" is recorded
    const restarted = new SimBroker(0);
    restarted.setPrice('EURUSD', 1.095); // price moved while the server was down
    const engine2 = new Engine(db, restarted, notifier);
    await engine2.refresh();
    await flush();
    expect(notifier.sent).toHaveLength(1);
  });

  it('does not trade when the alert toggle is off', async () => {
    saveSettings(db, { autoTradeEnabled: true });
    createAlert(db, plain({ target: 1.09 }));
    await engine.refresh();
    broker.setPrice('EURUSD', 1.091);
    await flush();
    expect(broker.orders).toHaveLength(0);
    expect(listOrders(db)).toHaveLength(0);
  });

  it('places one market order with SL, TP and lot size when both switches are on', async () => {
    saveSettings(db, { autoTradeEnabled: true });
    const a = createAlert(db, trade({ target: 1.09 }));
    await engine.refresh();
    broker.setPrice('EURUSD', 1.09); // ask = 1.09006, which reaches the BUY target
    broker.setPrice('EURUSD', 1.0902);
    await flush();
    expect(broker.orders).toHaveLength(1);
    const o = broker.orders[0];
    expect(o).toMatchObject({ symbol: 'EURUSD', side: 'BUY', clientId: `GZ_${a.id}`, volume: 0.5 });
    expect(o.sl).toBeCloseTo(o.tp - 0.006, 5); // 20 pip stop, 40 pip target
    expect(listOrders(db)[0]).toMatchObject({ status: 'filled', alertId: a.id });
    expect(notifier.sent.map((m) => m.title)).toEqual(['EURUSD reached 1.09', 'BUY 0.5 EURUSD placed']);
  });

  it('only alerts, with a reason, when the master switch is off', async () => {
    createAlert(db, trade({ target: 1.09 }));
    await engine.refresh();
    broker.setPrice('EURUSD', 1.091);
    await flush();
    expect(broker.orders).toHaveLength(0);
    expect(listOrders(db)[0]).toMatchObject({ status: 'skipped' });
    expect(notifier.sent[1].title).toBe('EURUSD trade not placed');
  });

  it('skips the trade when the spread is above the limit', async () => {
    saveSettings(db, { autoTradeEnabled: true, maxSpreadPips: 0.5 });
    createAlert(db, trade({ target: 1.09 }));
    await engine.refresh();
    broker.setPrice('EURUSD', 1.091);
    await flush();
    expect(broker.orders).toHaveLength(0);
    expect(listOrders(db)[0].message).toMatch(/Spread/);
  });

  it('reports a rejected order', async () => {
    saveSettings(db, { autoTradeEnabled: true });
    createAlert(db, trade({ target: 1.09 }));
    await engine.refresh();
    broker.placeMarketOrder = async () => { throw new Error('Not enough money'); };
    broker.setPrice('EURUSD', 1.091);
    await flush();
    expect(listOrders(db)[0]).toMatchObject({ status: 'failed', message: 'Not enough money' });
    expect(notifier.sent[1].title).toBe('EURUSD order failed');
  });
});

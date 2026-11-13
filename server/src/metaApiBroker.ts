import MetaApi, { SynchronizationListener } from 'metaapi.cloud-sdk/esm-node';
import type { Broker, BrokerStatus, OrderRequest, OrderResult } from './broker.js';
import type { Quote, SymbolSpec } from './types.js';

type Sdk = InstanceType<typeof MetaApi>;
type Account = Awaited<ReturnType<Sdk['metatraderAccountApi']['getAccount']>>;
type Connection = ReturnType<Account['getStreamingConnection']>;

export interface NewAccount {
  login: string;
  password: string;
  server: string;
  name?: string;
}

/**
 * Talks to one MT5 account through MetaApi: live prices over the streaming
 * connection, and market orders with SL/TP.
 */
export class MetaApiBroker implements Broker {
  private readonly api: Sdk;
  private connection?: Connection;
  private readonly watched = new Set<string>();
  private readonly listeners: Array<(q: Quote) => void> = [];
  private detail = 'Not connected';
  private stopped = false;

  constructor(
    token: string,
    private accountId: string,
    private readonly log: (msg: string) => void = () => {},
  ) {
    this.api = new MetaApi(token);
  }

  get hasAccount(): boolean {
    return this.accountId !== '';
  }

  /** Registers an MT5 account with MetaApi. The password goes to MetaApi only and is not kept here. */
  async createAccount(a: NewAccount): Promise<string> {
    const account = await this.api.metatraderAccountApi.createAccount({
      name: a.name ?? `GroundZero ${a.login}`,
      type: 'cloud',
      login: a.login,
      password: a.password,
      server: a.server,
      platform: 'mt5',
      magic: 0,
    } as Parameters<Sdk['metatraderAccountApi']['createAccount']>[0]);
    return account.id;
  }

  /** Switches to a different MetaApi account and reconnects. */
  async useAccount(accountId: string): Promise<void> {
    await this.closeConnection();
    this.accountId = accountId;
    void this.start();
  }

  async start(): Promise<void> {
    this.stopped = false;
    if (!this.accountId) {
      this.detail = 'No MT5 account linked yet';
      return;
    }
    // Connecting can take a minute or more while MetaApi starts the terminal,
    // so it runs in the background and is retried until it works.
    let delay = 5_000;
    while (!this.stopped && !this.connection) {
      try {
        await this.connect();
        return;
      } catch (err) {
        this.detail = `Connection failed: ${errorText(err)}`;
        this.log(this.detail);
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 60_000);
      }
    }
  }

  private async connect(): Promise<void> {
    this.detail = 'Connecting to MetaApi';
    const account = await this.api.metatraderAccountApi.getAccount(this.accountId);
    if (account.state !== 'DEPLOYED' && account.state !== 'DEPLOYING') {
      this.detail = 'Starting the cloud MT5 terminal';
      await account.deploy();
    }
    this.detail = 'Waiting for the broker connection';
    await account.waitConnected();

    const connection = account.getStreamingConnection();
    const broker = this;
    class Listener extends SynchronizationListener {
      async onSymbolPriceUpdated(_instance: string, price: SdkPrice): Promise<void> {
        if (broker.watched.has(price.symbol)) broker.emit(toQuote(price));
      }
    }
    connection.addSynchronizationListener(new Listener());
    await connection.connect();
    this.detail = 'Synchronizing account';
    await connection.waitSynchronized({ timeoutInSeconds: 300 });
    this.connection = connection;
    this.detail = 'Connected';
    this.log('MetaApi connected and synchronized');
    for (const symbol of this.watched) await this.subscribe(symbol).catch(() => undefined);
  }

  private async closeConnection(): Promise<void> {
    const c = this.connection;
    this.connection = undefined;
    if (c) await c.close().catch(() => undefined);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.closeConnection();
  }

  private get state() {
    return this.connection?.terminalState;
  }

  status(): BrokerStatus {
    const s = this.state;
    const info = s?.accountInformation;
    const connected = Boolean(s?.connected && s.connectedToBroker);
    return {
      kind: 'metaapi',
      connected,
      detail: this.connection && !connected ? 'Reconnecting to the broker' : this.detail,
      accountName: info ? `${info.name} (${info.login})` : undefined,
      balance: info?.balance,
      currency: info?.currency,
      tradeAllowed: info?.tradeAllowed,
    };
  }

  symbols(): string[] {
    return (this.state?.specifications ?? []).map((s: { symbol: string }) => s.symbol).sort();
  }

  spec(symbol: string): SymbolSpec | undefined {
    const s = this.state?.specification(symbol);
    if (!s) return undefined;
    return {
      symbol: s.symbol,
      digits: s.digits,
      point: s.point,
      tickSize: s.tickSize,
      // Brokers quote FX with one extra digit, so a pip is ten points on 3 and 5 digit symbols.
      pipSize: s.pipSize ?? (s.digits === 3 || s.digits === 5 ? s.point * 10 : s.point),
      minVolume: s.minVolume,
      maxVolume: s.maxVolume,
      volumeStep: s.volumeStep,
      stopsLevel: s.stopsLevel ?? 0,
    };
  }

  quote(symbol: string): Quote | undefined {
    const p = this.state?.price(symbol);
    return p ? toQuote(p) : undefined;
  }

  private async subscribe(symbol: string): Promise<Quote | undefined> {
    if (!this.connection) return undefined;
    const price = await this.connection.subscribeToMarketData(symbol, [{ type: 'quotes' }], 30);
    return price ? toQuote(price) : this.quote(symbol);
  }

  async watch(symbol: string): Promise<Quote | undefined> {
    this.watched.add(symbol);
    try {
      return await this.subscribe(symbol);
    } catch (err) {
      this.log(`Could not subscribe to ${symbol}: ${errorText(err)}`);
      return this.quote(symbol);
    }
  }

  async unwatch(symbol: string): Promise<void> {
    this.watched.delete(symbol);
    await this.connection?.unsubscribeFromMarketData(symbol, [{ type: 'quotes' }]).catch(() => undefined);
  }

  onQuote(listener: (quote: Quote) => void): void {
    this.listeners.push(listener);
  }

  private emit(quote: Quote): void {
    for (const l of this.listeners) l(quote);
  }

  async placeMarketOrder(order: OrderRequest): Promise<OrderResult> {
    if (!this.connection) throw new Error('Not connected to the trading account');
    const options = { clientId: order.clientId, comment: order.comment };
    const res =
      order.side === 'BUY'
        ? await this.connection.createMarketBuyOrder(order.symbol, order.volume, order.sl, order.tp, options)
        : await this.connection.createMarketSellOrder(order.symbol, order.volume, order.sl, order.tp, options);
    return { orderId: res.orderId, positionId: res.positionId, message: res.message ?? res.stringCode };
  }
}

interface SdkPrice {
  symbol: string;
  bid: number;
  ask: number;
  lossTickValue?: number;
  time?: Date;
}

function toQuote(p: SdkPrice): Quote {
  return {
    symbol: p.symbol,
    bid: p.bid,
    ask: p.ask,
    lossTickValue: p.lossTickValue,
    time: p.time ? new Date(p.time).getTime() : Date.now(),
  };
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

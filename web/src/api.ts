export type Side = 'BUY' | 'SELL';
export type RiskMode = 'percent' | 'fixed';

export interface Alert {
  id: number;
  symbol: string;
  target: number;
  note: string;
  status: 'active' | 'triggered' | 'cancelled';
  direction: 'up' | 'down' | null;
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

export interface AlertInput {
  symbol: string;
  target: number;
  note: string;
  autoExecute: boolean;
  side: Side | null;
  slPrice: number | null;
  slPips: number | null;
  rr: number | null;
  riskMode: RiskMode;
  riskValue: number | null;
}

export interface Settings {
  autoTradeEnabled: boolean;
  defaultRiskPercent: number;
  defaultRr: number;
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

export interface BrokerStatus {
  kind: 'metaapi' | 'sim';
  connected: boolean;
  detail: string;
  accountName?: string;
  balance?: number;
  currency?: string;
  tradeAllowed?: boolean;
  needsAccount: boolean;
}

export interface AppState {
  broker: BrokerStatus;
  settings: Settings;
  alerts: Alert[];
  quotes: Record<string, { bid: number; ask: number }>;
  digits: Record<string, number>;
  orders: OrderLog[];
  push: { publicKey: string; devices: number };
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
}

export interface QuoteInfo {
  quote: { bid: number; ask: number; lossTickValue?: number } | null;
  spec: SymbolSpec | null;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export const api = {
  me: () => request<{ loggedIn: boolean }>('GET', '/api/me'),
  login: (password: string) => request<{ ok: true }>('POST', '/api/login', { password }),
  logout: () => request('POST', '/api/logout', {}),
  state: () => request<AppState>('GET', '/api/state'),
  symbols: () => request<{ symbols: string[] }>('GET', '/api/symbols'),
  quote: (symbol: string) => request<QuoteInfo>('GET', `/api/quote?symbol=${encodeURIComponent(symbol)}`),
  createAlert: (a: AlertInput) => request<{ alert: Alert }>('POST', '/api/alerts', a),
  updateAlert: (id: number, a: AlertInput) => request<{ alert: Alert }>('PUT', `/api/alerts/${id}`, a),
  setAuto: (id: number, on: boolean) => request<{ alert: Alert }>('POST', `/api/alerts/${id}/auto`, { on }),
  cancelAlert: (id: number) => request('POST', `/api/alerts/${id}/cancel`, {}),
  deleteAlert: (id: number) => request('DELETE', `/api/alerts/${id}`),
  saveSettings: (s: Partial<Settings>) => request<{ settings: Settings }>('PUT', '/api/settings', s),
  pushSubscribe: (sub: PushSubscriptionJSON) => request<{ devices: number }>('POST', '/api/push/subscribe', sub),
  pushUnsubscribe: (endpoint: string) => request('POST', '/api/push/unsubscribe', { endpoint }),
  pushTest: () => request<{ sent: number; failed: number }>('POST', '/api/push/test', {}),
  linkAccount: (login: string, password: string, server: string) =>
    request('POST', '/api/account/link', { login, password, server }),
  simPrice: (symbol: string, price: number) => request('POST', '/api/sim/price', { symbol, price }),
};

export function fmtPrice(value: number | null | undefined, digits?: number): string {
  if (value == null) return '—';
  return digits == null ? String(value) : value.toFixed(digits);
}

export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

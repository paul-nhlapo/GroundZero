import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { Alert, OrderLog, Settings } from './types.js';

export type Db = Database.Database;

export function openDb(dataDir: string | ':memory:'): Db {
  let db: Db;
  if (dataDir === ':memory:') {
    db = new Database(':memory:');
  } else {
    fs.mkdirSync(dataDir, { recursive: true });
    db = new Database(path.join(dataDir, 'groundzero.db'));
    db.pragma('journal_mode = WAL');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      target REAL NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      direction TEXT,
      auto_execute INTEGER NOT NULL DEFAULT 0,
      side TEXT,
      sl_price REAL,
      sl_pips REAL,
      rr REAL,
      risk_mode TEXT,
      risk_value REAL,
      created_at INTEGER NOT NULL,
      triggered_at INTEGER,
      triggered_price REAL
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id INTEGER NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      status TEXT NOT NULL,
      volume REAL,
      entry REAL,
      sl REAL,
      tp REAL,
      message TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return db;
}

// ---------- key/value ----------

export function kvGet(db: Db, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function kvSet(db: Db, key: string, value: string): void {
  db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export function kvDelete(db: Db, key: string): void {
  db.prepare('DELETE FROM kv WHERE key = ?').run(key);
}

// ---------- settings ----------

const DEFAULT_SETTINGS: Settings = {
  autoTradeEnabled: false,
  defaultRiskPercent: 1,
  defaultRr: 2,
  maxSpreadPips: 0,
};

export function getSettings(db: Db): Settings {
  const raw = kvGet(db, 'settings');
  return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
}

export function saveSettings(db: Db, patch: Partial<Settings>): Settings {
  const next = { ...getSettings(db), ...patch };
  kvSet(db, 'settings', JSON.stringify(next));
  return next;
}

// ---------- alerts ----------

interface AlertRow {
  id: number; symbol: string; target: number; note: string; status: Alert['status'];
  direction: Alert['direction']; auto_execute: number; side: Alert['side'];
  sl_price: number | null; sl_pips: number | null; rr: number | null;
  risk_mode: Alert['riskMode']; risk_value: number | null;
  created_at: number; triggered_at: number | null; triggered_price: number | null;
}

function toAlert(r: AlertRow): Alert {
  return {
    id: r.id, symbol: r.symbol, target: r.target, note: r.note, status: r.status,
    direction: r.direction, autoExecute: r.auto_execute === 1, side: r.side,
    slPrice: r.sl_price, slPips: r.sl_pips, rr: r.rr, riskMode: r.risk_mode, riskValue: r.risk_value,
    createdAt: r.created_at, triggeredAt: r.triggered_at, triggeredPrice: r.triggered_price,
  };
}

export type AlertInput = Pick<
  Alert,
  'symbol' | 'target' | 'note' | 'autoExecute' | 'side' | 'slPrice' | 'slPips' | 'rr' | 'riskMode' | 'riskValue'
>;

export function listAlerts(db: Db, status?: Alert['status']): Alert[] {
  const rows = status
    ? db.prepare('SELECT * FROM alerts WHERE status = ? ORDER BY id DESC').all(status)
    : db.prepare('SELECT * FROM alerts ORDER BY id DESC LIMIT 200').all();
  return (rows as AlertRow[]).map(toAlert);
}

export function getAlert(db: Db, id: number): Alert | undefined {
  const row = db.prepare('SELECT * FROM alerts WHERE id = ?').get(id) as AlertRow | undefined;
  return row && toAlert(row);
}

export function createAlert(db: Db, a: AlertInput): Alert {
  const info = db
    .prepare(
      `INSERT INTO alerts (symbol, target, note, auto_execute, side, sl_price, sl_pips, rr, risk_mode, risk_value, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(a.symbol, a.target, a.note, a.autoExecute ? 1 : 0, a.side, a.slPrice, a.slPips, a.rr, a.riskMode, a.riskValue, Date.now());
  return getAlert(db, Number(info.lastInsertRowid))!;
}

/** Edits an alert that has not fired yet. The direction is reset so it is worked out again from the next price. */
export function updateAlert(db: Db, id: number, a: AlertInput): Alert | undefined {
  db.prepare(
    `UPDATE alerts SET symbol = ?, target = ?, note = ?, auto_execute = ?, side = ?, sl_price = ?, sl_pips = ?,
       rr = ?, risk_mode = ?, risk_value = ?, direction = NULL
     WHERE id = ? AND status = 'active'`,
  ).run(a.symbol, a.target, a.note, a.autoExecute ? 1 : 0, a.side, a.slPrice, a.slPips, a.rr, a.riskMode, a.riskValue, id);
  return getAlert(db, id);
}

export function setAutoExecute(db: Db, id: number, on: boolean): void {
  db.prepare("UPDATE alerts SET auto_execute = ? WHERE id = ? AND status = 'active'").run(on ? 1 : 0, id);
}

export function setDirection(db: Db, id: number, direction: NonNullable<Alert['direction']>): void {
  db.prepare("UPDATE alerts SET direction = ? WHERE id = ? AND status = 'active' AND direction IS NULL").run(direction, id);
}

/**
 * Marks an alert as triggered. Returns true only for the one caller that made the
 * change, which is what guarantees an alert can never fire or trade twice.
 */
export function claimTrigger(db: Db, id: number, price: number): boolean {
  const info = db
    .prepare("UPDATE alerts SET status = 'triggered', triggered_at = ?, triggered_price = ? WHERE id = ? AND status = 'active'")
    .run(Date.now(), price, id);
  return info.changes === 1;
}

export function cancelAlert(db: Db, id: number): void {
  db.prepare("UPDATE alerts SET status = 'cancelled' WHERE id = ? AND status = 'active'").run(id);
}

export function deleteAlert(db: Db, id: number): void {
  db.prepare('DELETE FROM alerts WHERE id = ?').run(id);
}

// ---------- orders ----------

interface OrderRow {
  id: number; alert_id: number; symbol: string; side: OrderLog['side']; status: OrderLog['status'];
  volume: number | null; entry: number | null; sl: number | null; tp: number | null; message: string; created_at: number;
}

export function logOrder(db: Db, o: Omit<OrderLog, 'id' | 'createdAt'>): void {
  db.prepare(
    'INSERT INTO orders (alert_id, symbol, side, status, volume, entry, sl, tp, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(o.alertId, o.symbol, o.side, o.status, o.volume, o.entry, o.sl, o.tp, o.message, Date.now());
}

export function listOrders(db: Db): OrderLog[] {
  const rows = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 100').all() as OrderRow[];
  return rows.map((r) => ({
    id: r.id, alertId: r.alert_id, symbol: r.symbol, side: r.side, status: r.status, volume: r.volume,
    entry: r.entry, sl: r.sl, tp: r.tp, message: r.message, createdAt: r.created_at,
  }));
}

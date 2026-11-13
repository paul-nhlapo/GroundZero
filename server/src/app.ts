import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import fs from 'node:fs';
import { Auth } from './auth.js';
import type { Broker } from './broker.js';
import {
  cancelAlert, createAlert, deleteAlert, getAlert, getSettings, kvSet, listAlerts, listOrders,
  saveSettings, setAutoExecute, updateAlert, type Db,
} from './db.js';
import { Engine } from './engine.js';
import { errorText, MetaApiBroker } from './metaApiBroker.js';
import type { Notifier } from './push.js';
import { SimBroker } from './simBroker.js';
import { parseAlert, parseSettings } from './validate.js';

export interface AppDeps {
  db: Db;
  broker: Broker;
  engine: Engine;
  notifier: Notifier;
  passwordHash: string;
  production: boolean;
  webDir: string;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { db, broker, engine, notifier } = deps;
  const app = Fastify({ logger: { level: 'info' }, trustProxy: true, bodyLimit: 64 * 1024 });
  await app.register(cookie);
  const auth = new Auth(db, deps.passwordHash, deps.production);

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
  });

  // Everything under /api needs a login, except logging in itself.
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    if (req.url === '/api/login' || req.url === '/api/me') return;
    if (!auth.isLoggedIn(req)) return reply.code(401).send({ error: 'Please log in' });
  });

  app.post('/api/login', async (req, reply) => {
    const { password } = (req.body ?? {}) as { password?: string };
    const res = await auth.login(password ?? '', reply);
    return res.ok ? { ok: true } : reply.code(401).send({ error: res.error });
  });
  app.post('/api/logout', async (req, reply) => {
    auth.logout(req, reply);
    return { ok: true };
  });
  app.get('/api/me', async (req) => ({ loggedIn: auth.isLoggedIn(req) }));

  app.get('/api/state', async () => {
    const alerts = listAlerts(db);
    const quotes: Record<string, { bid: number; ask: number }> = {};
    const digits: Record<string, number> = {};
    for (const a of alerts) {
      if (a.status !== 'active' || quotes[a.symbol]) continue;
      const q = broker.quote(a.symbol);
      if (q) quotes[a.symbol] = { bid: q.bid, ask: q.ask };
      const s = broker.spec(a.symbol);
      if (s) digits[a.symbol] = s.digits;
    }
    return {
      broker: { ...broker.status(), needsAccount: broker instanceof MetaApiBroker && !broker.hasAccount },
      settings: getSettings(db),
      alerts,
      quotes,
      digits,
      orders: listOrders(db),
      push: { publicKey: notifier.publicKey, devices: notifier.count() },
    };
  });

  app.get('/api/symbols', async () => ({ symbols: broker.symbols() }));

  app.get('/api/quote', async (req, reply) => {
    const symbol = String((req.query as { symbol?: string }).symbol ?? '');
    if (!symbol) return reply.code(400).send({ error: 'symbol is required' });
    const known = broker.symbols();
    if (known.length > 0 && !known.includes(symbol)) return reply.code(404).send({ error: 'Unknown symbol' });
    const quote = await engine.peek(symbol);
    return { quote: quote ?? null, spec: broker.spec(symbol) ?? null };
  });

  // ---------- alerts ----------

  app.post('/api/alerts', async (req, reply) => {
    const parsed = parseAlert(req.body, broker.symbols(), getSettings(db));
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const alert = createAlert(db, parsed.value);
    await engine.refresh();
    return { alert: getAlert(db, alert.id) };
  });

  app.put('/api/alerts/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const existing = getAlert(db, id);
    if (!existing) return reply.code(404).send({ error: 'Alert not found' });
    if (existing.status !== 'active') return reply.code(409).send({ error: 'This alert has already finished' });
    const parsed = parseAlert(req.body, broker.symbols(), getSettings(db));
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    updateAlert(db, id, parsed.value);
    await engine.refresh();
    return { alert: getAlert(db, id) };
  });

  app.post('/api/alerts/:id/auto', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const on = (req.body as { on?: boolean } | undefined)?.on === true;
    const alert = getAlert(db, id);
    if (!alert) return reply.code(404).send({ error: 'Alert not found' });
    if (on && (!alert.side || (alert.slPrice == null && alert.slPips == null))) {
      return reply.code(400).send({ error: 'Add Buy/Sell and a stop loss to this alert before turning on auto-execute' });
    }
    setAutoExecute(db, id, on);
    await engine.refresh();
    return { alert: getAlert(db, id) };
  });

  app.post('/api/alerts/:id/cancel', async (req) => {
    cancelAlert(db, Number((req.params as { id: string }).id));
    await engine.refresh();
    return { ok: true };
  });

  app.delete('/api/alerts/:id', async (req) => {
    deleteAlert(db, Number((req.params as { id: string }).id));
    await engine.refresh();
    return { ok: true };
  });

  // ---------- settings ----------

  app.put('/api/settings', async (req, reply) => {
    const parsed = parseSettings(req.body);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    return { settings: saveSettings(db, parsed.value) };
  });

  // ---------- push ----------

  app.post('/api/push/subscribe', async (req, reply) => {
    const sub = req.body as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | undefined;
    if (!sub?.endpoint?.startsWith('https://') || !sub.keys?.p256dh || !sub.keys.auth) {
      return reply.code(400).send({ error: 'Invalid push subscription' });
    }
    notifier.subscribe({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
    return { ok: true, devices: notifier.count() };
  });

  app.post('/api/push/unsubscribe', async (req) => {
    const endpoint = (req.body as { endpoint?: string } | undefined)?.endpoint;
    if (endpoint) notifier.unsubscribe(endpoint);
    return { ok: true, devices: notifier.count() };
  });

  app.post('/api/push/test', async () => {
    const res = await notifier.send({ title: 'GroundZero test', body: 'Notifications are working on this device.', tag: 'test' });
    return res;
  });

  // ---------- trading account ----------

  app.post('/api/account/link', async (req, reply) => {
    if (!(broker instanceof MetaApiBroker)) {
      return reply.code(400).send({ error: 'The server is running the simulator. Set METAAPI_TOKEN to link a real account.' });
    }
    const b = (req.body ?? {}) as { login?: string; password?: string; server?: string };
    const login = String(b.login ?? '').trim();
    const server = String(b.server ?? '').trim();
    if (!login || !b.password || !server) return reply.code(400).send({ error: 'Login, password and server are all required' });
    try {
      const accountId = await broker.createAccount({ login, password: b.password, server });
      kvSet(db, 'metaapi_account_id', accountId);
      await broker.useAccount(accountId);
      void engine.refresh();
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: `MetaApi could not add the account: ${errorText(err)}` });
    }
  });

  // ---------- simulator only ----------

  if (broker instanceof SimBroker) {
    app.post('/api/sim/price', async (req, reply) => {
      const b = (req.body ?? {}) as { symbol?: string; price?: number };
      if (!b.symbol || !broker.spec(b.symbol) || !(Number(b.price) > 0)) {
        return reply.code(400).send({ error: 'symbol and price are required' });
      }
      broker.setPrice(b.symbol, Number(b.price));
      return { quote: broker.quote(b.symbol) };
    });
  }

  // ---------- the web app ----------

  if (fs.existsSync(deps.webDir)) {
    await app.register(fastifyStatic, {
      root: deps.webDir,
      setHeaders(res, filePath) {
        // The service worker and page shell must always be fresh; hashed assets can be cached.
        if (filePath.endsWith('sw.js') || filePath.endsWith('.html') || filePath.endsWith('.webmanifest')) {
          res.header('Cache-Control', 'no-cache');
        } else if (filePath.includes('/assets/')) {
          res.header('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'Not found' });
    });
  }

  return app;
}

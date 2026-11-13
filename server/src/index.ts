import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { buildApp } from './app.js';
import type { Broker } from './broker.js';
import { config } from './config.js';
import { kvGet, openDb } from './db.js';
import { Engine } from './engine.js';
import { MetaApiBroker } from './metaApiBroker.js';
import { createNotifier } from './push.js';
import { SimBroker } from './simBroker.js';

const log = (msg: string) => console.log(`[groundzero] ${msg}`);

let passwordHash = config.passwordHash;
if (!passwordHash) {
  if (config.production || config.broker === 'metaapi') {
    console.error('APP_PASSWORD_HASH is not set. Create one with: npm run hash-password');
    process.exit(1);
  }
  // Simulator on a developer machine: make a throwaway password so the app is still locked.
  const temp = crypto.randomBytes(6).toString('base64url');
  passwordHash = await bcrypt.hash(temp, 10);
  log(`No APP_PASSWORD_HASH set. Temporary password for this run: ${temp}`);
}

const db = openDb(config.dataDir);
const notifier = createNotifier(db, config.vapidSubject, log);

let broker: Broker;
if (config.broker === 'metaapi') {
  if (!config.metaApiToken) {
    console.error('BROKER=metaapi needs METAAPI_TOKEN.');
    process.exit(1);
  }
  // An account linked from the app's Settings screen is remembered in the database.
  const accountId = config.metaApiAccountId || kvGet(db, 'metaapi_account_id') || '';
  broker = new MetaApiBroker(config.metaApiToken, accountId, log);
} else {
  broker = new SimBroker();
  log('Running with the simulated market. Set METAAPI_TOKEN to use a real MT5 account.');
}

const engine = new Engine(db, broker, notifier, log);
const app = await buildApp({
  db, broker, engine, notifier, passwordHash,
  production: config.production, webDir: config.webDir,
});

await app.listen({ port: config.port, host: config.host });

// The broker can take a minute to connect, so the web app is reachable first.
void broker.start().then(() => engine.refresh());
await engine.refresh();

const shutdown = async () => {
  await app.close();
  await broker.stop();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

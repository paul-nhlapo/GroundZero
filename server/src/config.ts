import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  production: process.env.NODE_ENV === 'production',
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(here, '..', 'data')),
  webDir: path.resolve(process.env.WEB_DIR ?? path.join(here, '..', '..', 'web', 'dist')),
  /** bcrypt hash of the login password. Create one with `npm run hash-password`. */
  passwordHash: process.env.APP_PASSWORD_HASH ?? '',
  /** 'metaapi' talks to a real MT5 account. 'sim' runs a built-in fake market for trying the app. */
  broker: (process.env.BROKER ?? (process.env.METAAPI_TOKEN ? 'metaapi' : 'sim')) as 'metaapi' | 'sim',
  metaApiToken: process.env.METAAPI_TOKEN ?? '',
  metaApiAccountId: process.env.METAAPI_ACCOUNT_ID ?? '',
  /** Contact address sent to push services with each notification, e.g. mailto:you@example.com */
  vapidSubject: process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com',
};

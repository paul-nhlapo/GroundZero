import * as webpush from 'web-push';
import { kvGet, kvSet, type Db } from './db.js';

export interface PushMessage {
  title: string;
  body: string;
  /** Notifications with the same tag replace each other on the phone. */
  tag?: string;
  url?: string;
}

export interface Notifier {
  publicKey: string;
  subscribe(subscription: webpush.PushSubscription): void;
  unsubscribe(endpoint: string): void;
  count(): number;
  send(message: PushMessage): Promise<{ sent: number; failed: number }>;
}

/**
 * Web Push sender. The VAPID key pair identifies this server to the phone's push
 * service; it is created once and kept in the database so subscriptions keep working.
 */
export function createNotifier(db: Db, subject: string, log: (msg: string) => void = () => {}): Notifier {
  let publicKey = kvGet(db, 'vapid_public');
  let privateKey = kvGet(db, 'vapid_private');
  if (!publicKey || !privateKey) {
    const keys = webpush.generateVAPIDKeys();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
    kvSet(db, 'vapid_public', publicKey);
    kvSet(db, 'vapid_private', privateKey);
  }
  const vapid = { subject, publicKey, privateKey };

  return {
    publicKey,
    subscribe(subscription) {
      db.prepare(
        'INSERT INTO push_subscriptions (endpoint, json, created_at) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET json = excluded.json',
      ).run(subscription.endpoint, JSON.stringify(subscription), Date.now());
    },
    unsubscribe(endpoint) {
      db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
    },
    count() {
      return (db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get() as { n: number }).n;
    },
    async send(message) {
      const rows = db.prepare('SELECT endpoint, json FROM push_subscriptions').all() as Array<{ endpoint: string; json: string }>;
      let sent = 0;
      let failed = 0;
      await Promise.all(
        rows.map(async (row) => {
          try {
            await webpush.sendNotification(JSON.parse(row.json), JSON.stringify(message), {
              vapidDetails: vapid,
              urgency: 'high',
              TTL: 3600,
            });
            sent++;
          } catch (err) {
            failed++;
            const status = (err as { statusCode?: number }).statusCode;
            // The phone removed the subscription (app uninstalled or permission revoked).
            if (status === 404 || status === 410) this.unsubscribe(row.endpoint);
            else log(`Push failed (${status ?? 'network'}): ${(err as Error).message}`);
          }
        }),
      );
      return { sent, failed };
    },
  };
}

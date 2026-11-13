import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as webpush from 'web-push';
import { openDb } from '../src/db.js';
import { createNotifier } from '../src/push.js';

/** A subscription like the one a phone's browser hands to the app. */
function fakeSubscription(endpoint = 'https://push.example.test/send/abc') {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint,
    keys: { p256dh: ecdh.getPublicKey('base64url'), auth: crypto.randomBytes(16).toString('base64url') },
  };
}

describe('notifier', () => {
  it('creates the server key pair once and reuses it', () => {
    const db = openDb(':memory:');
    const first = createNotifier(db, 'mailto:test@example.test');
    const second = createNotifier(db, 'mailto:test@example.test');
    expect(first.publicKey).toHaveLength(87);
    expect(second.publicKey).toBe(first.publicKey);
  });

  it('stores one subscription per device', () => {
    const db = openDb(':memory:');
    const n = createNotifier(db, 'mailto:test@example.test');
    const sub = fakeSubscription();
    n.subscribe(sub);
    n.subscribe(sub);
    n.subscribe(fakeSubscription('https://push.example.test/send/other'));
    expect(n.count()).toBe(2);
    n.unsubscribe(sub.endpoint);
    expect(n.count()).toBe(1);
  });

  it('builds an encrypted, signed push request from the stored keys', () => {
    const db = openDb(':memory:');
    const n = createNotifier(db, 'mailto:test@example.test');
    const keys = db.prepare("SELECT value FROM kv WHERE key = 'vapid_private'").get() as { value: string };
    const details = webpush.generateRequestDetails(fakeSubscription(), JSON.stringify({ title: 'EURUSD reached 1.09', body: 'x' }), {
      vapidDetails: { subject: 'mailto:test@example.test', publicKey: n.publicKey, privateKey: keys.value },
      urgency: 'high',
      TTL: 3600,
    });
    expect(details.endpoint).toBe('https://push.example.test/send/abc');
    expect(details.headers.Authorization).toMatch(/^vapid t=.+, k=.+/);
    expect(details.headers.Urgency).toBe('high');
    expect(details.body.length).toBeGreaterThan(40);
    expect(details.body.toString()).not.toContain('EURUSD'); // payload is encrypted
  });
});

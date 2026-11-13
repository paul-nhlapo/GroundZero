import { api } from './api';

export type PushSupport =
  | { state: 'ready' }
  /** iPhone/iPad in Safari: push only works after "Add to Home Screen". */
  | { state: 'needs-install' }
  | { state: 'unsupported' };

export function pushSupport(): PushSupport {
  const hasApis = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (hasApis) return { state: 'ready' };
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios ? { state: 'needs-install' } : { state: 'unsupported' };
}

export async function registerServiceWorker(): Promise<void> {
  if ('serviceWorker' in navigator) await navigator.serviceWorker.register('/sw.js').catch(() => undefined);
}

function keyToBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** True when this device already has a push subscription saved on the server side. */
export async function isSubscribed(): Promise<boolean> {
  if (pushSupport().state !== 'ready' || Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return Boolean(await reg?.pushManager.getSubscription());
}

export async function enablePush(publicKey: string): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notifications are blocked for this app. Allow them in your phone or browser settings, then try again.');
  }
  const reg = await navigator.serviceWorker.ready;
  // A subscription made with an older server key cannot be reused.
  const existing = await reg.pushManager.getSubscription();
  if (existing) await existing.unsubscribe();
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) });
  await api.pushSubscribe(sub.toJSON());
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api.pushUnsubscribe(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe();
}

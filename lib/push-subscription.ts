// web-push POSTs to whatever `endpoint` a subscription holds, so an unvalidated
// subscription turns /api/push/send into a server-side request forgery primitive.
// Only real push services are accepted.
//
// Validated on write (subscribe) *and* on read (send) — rows stored before this
// check existed are otherwise still live.

const ALLOWED_PUSH_HOSTS = new Set([
  'fcm.googleapis.com',
  'android.googleapis.com',
  'web.push.apple.com',
]);
const ALLOWED_PUSH_HOST_SUFFIXES = [
  '.push.services.mozilla.com',
  '.notify.windows.com',
];

const MAX_KEY_LENGTH = 256;

export interface StoredSubscription {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
}

export function isAllowedEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;

  const host = url.hostname.toLowerCase();
  return (
    ALLOWED_PUSH_HOSTS.has(host) ||
    ALLOWED_PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  );
}

/** Normalizes to a known shape — extra client-supplied fields are dropped. */
export function parseSubscription(body: unknown): StoredSubscription | null {
  if (typeof body !== 'object' || body === null) return null;

  const { endpoint, keys, expirationTime } = body as Record<string, unknown>;
  if (typeof endpoint !== 'string' || !isAllowedEndpoint(endpoint)) return null;

  if (typeof keys !== 'object' || keys === null) return null;
  const { p256dh, auth } = keys as Record<string, unknown>;
  if (typeof p256dh !== 'string' || typeof auth !== 'string') return null;
  if (!p256dh || !auth) return null;
  if (p256dh.length > MAX_KEY_LENGTH || auth.length > MAX_KEY_LENGTH) return null;

  return {
    endpoint,
    expirationTime: typeof expirationTime === 'number' ? expirationTime : null,
    keys: { p256dh, auth },
  };
}

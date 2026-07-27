// Fixed-window rate limiter, in-process.
//
// Scope caveat: on Vercel each serverless instance keeps its own map, so the
// effective limit is (limit x live instances). That is enough to stop a single
// client hammering an endpoint, which is what these routes need. Move to a
// shared store (Upstash/Redis) if a hard global cap is ever required.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_TRACKED_KEYS = 10_000;

function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(key);
  }
}

/** Returns true if the call is allowed, false if the caller is over the limit. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    // Keep the map from growing without bound on a long-lived instance.
    if (buckets.size >= MAX_TRACKED_KEYS) sweep(now);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= limit) return false;

  bucket.count += 1;
  return true;
}

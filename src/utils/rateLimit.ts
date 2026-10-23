export type RateLimitOptions = {
  windowMs: number;
  max: number;
};

// Global cache for rate limiting.
// Note: In a distributed production environment (e.g. Vercel), this only limits per-instance.
// A more robust solution would use Redis (e.g. Upstash).
const rateLimitCache = new Map<string, { count: number; resetTime: number }>();

// Keys can be derived from client input (login identifiers), so the store is
// bounded: expired entries are swept first, then the oldest insertions go.
export const RATE_LIMIT_MAX_ENTRIES = 50_000;

function makeRoom(now: number): void {
  rateLimitCache.forEach((record, key) => {
    if (now > record.resetTime) rateLimitCache.delete(key);
  });

  for (const key of Array.from(rateLimitCache.keys())) {
    if (rateLimitCache.size < RATE_LIMIT_MAX_ENTRIES) break;
    rateLimitCache.delete(key);
  }
}

export function rateLimit(
  key: string,
  options: RateLimitOptions
): { success: boolean; limit: number; remaining: number; reset: number } {
  const now = Date.now();

  if (!rateLimitCache.has(key)) {
    if (rateLimitCache.size >= RATE_LIMIT_MAX_ENTRIES) makeRoom(now);
    const resetTime = now + options.windowMs;
    rateLimitCache.set(key, { count: 1, resetTime });
    return { success: true, limit: options.max, remaining: options.max - 1, reset: resetTime };
  }

  const record = rateLimitCache.get(key)!;

  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + options.windowMs;
    return { success: true, limit: options.max, remaining: options.max - 1, reset: record.resetTime };
  }

  record.count += 1;

  if (record.count > options.max) {
    return { success: false, limit: options.max, remaining: 0, reset: record.resetTime };
  }

  return { success: true, limit: options.max, remaining: options.max - record.count, reset: record.resetTime };
}

export function rateLimitEntryCount(): number {
  return rateLimitCache.size;
}

type ProxyEnvironment = Readonly<Record<string, string | undefined>>;

function trustedProxyHops(env: ProxyEnvironment): number {
  const configured = env.TRUSTED_PROXY_HOPS?.trim();
  if (configured) return /^\d{1,2}$/.test(configured) ? Number(configured) : 0;

  // Vercel's edge replaces X-Forwarded-For with the address that connected to it.
  return env.VERCEL === "1" ? 1 : 0;
}

/**
 * Returns the client address only when the deployment declares which proxy hop
 * to trust (TRUSTED_PROXY_HOPS, or Vercel). Every X-Forwarded-For entry left of
 * the trusted proxies is client-controlled, and Next only fills the header when
 * it is absent, so with no trusted proxy there is no reliable address and
 * callers must not key limits on one.
 */
export function getClientIP(req: Request, env: ProxyEnvironment = process.env): string | null {
  const hops = trustedProxyHops(env);
  if (hops === 0) return null;

  const chain = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  // Each trusted proxy appends the address it received the request from.
  return chain.length >= hops ? chain[chain.length - hops] : null;
}

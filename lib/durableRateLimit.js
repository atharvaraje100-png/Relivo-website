// /lib/durableRateLimit.js
//
// Durable, cross-instance rate limiting using Upstash Redis's REST API.
// This directly addresses the biggest real gap in the in-memory Map
// limiters used throughout this project: on Vercel, concurrent requests
// can land on different serverless instances, each with its own memory,
// so an in-memory Map only limits traffic *within one instance*. A
// determined caller (or a script hitting /api/call directly, with no
// browser involved) can get multiple calls through by getting lucky with
// instance routing.
//
// SETUP (takes ~2 minutes):
//   Vercel project → Storage tab → Create Database → Upstash for Redis.
//   Vercel auto-injects KV_REST_API_URL and KV_REST_API_TOKEN — nothing
//   else to configure. No package to install; this uses plain fetch
//   against Upstash's REST API, no @upstash/redis dependency needed.
//
// GRACEFUL DEGRADATION: if these env vars aren't set (e.g. during early
// private testing), checkDurableRateLimit() returns null rather than
// throwing — callers fall back to their in-memory limiter in that case.
//
// FIXED-WINDOW CORRECTNESS: expiry is only set on the FIRST increment for
// a key (count === 1), not on every request. An earlier version set the
// expiry on every call, which meant repeated requests kept extending the
// TTL — a sliding lockout, not the fixed window the rest of the code
// assumed. That wasn't insecure (if anything it was stricter), but it
// didn't behave as documented, so it's fixed here.

function isDurableConfigured() {
  return !!(
    (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) &&
    (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)
  );
}

async function checkDurableRateLimit(key, maxPerWindow, windowSeconds) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null; // not configured — caller falls back to in-memory

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000); // never let Redis latency hang a call
  try {
    const incrRes = await fetch(`${url}/incr/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!incrRes.ok) {
      console.error('Upstash INCR failed:', incrRes.status);
      return null; // fail open (or closed, per caller policy — see checkLimit)
    }
    const incrData = await incrRes.json();
    const count = incrData && incrData.result;
    if (typeof count !== 'number') return null;

    if (count === 1) {
      // Only the request that just created this key sets its expiry.
      // Best-effort: if this fails, the key just won't expire on schedule
      // (fails toward "over-blocks eventually get cleared late", not a
      // security problem) — don't let it affect the actual rate-limit result.
      await fetch(`${url}/expire/${encodeURIComponent(key)}/${windowSeconds}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      }).catch(() => {});
    }

    return count > maxPerWindow;
  } catch (err) {
    console.error('Durable rate limit check errored:', err.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Simple wrapper: durable check if configured, else the in-memory fallback.
// Always fails open on Redis errors — appropriate for lower-cost endpoints
// (browser voice calls, lead emails) where availability matters more than
// squeezing out the last bit of abuse resistance.
async function isRateLimitedDurable(key, maxPerWindow, windowSeconds, inMemoryFallbackFn) {
  const durableResult = await checkDurableRateLimit(key, maxPerWindow, windowSeconds);
  if (durableResult !== null) return durableResult;
  return inMemoryFallbackFn();
}

// Stricter wrapper for endpoints where an unnoticed rate-limit outage is
// expensive (e.g. real outbound phone calls cost money per call). If Redis
// is configured but errors, and failClosedInProduction is set, this
// returns { blocked: true, unavailable: true } in production — treat that
// as a 503 (service temporarily unavailable), not a normal 429. If Redis
// simply isn't configured at all, this still falls back to in-memory
// (that's a deliberate setup choice, not an outage) so private testing
// isn't blocked before you've set up Upstash.
async function checkLimit(key, maxPerWindow, windowSeconds, inMemoryFallbackFn, { failClosedInProduction = false } = {}) {
  const result = await checkDurableRateLimit(key, maxPerWindow, windowSeconds);
  if (result !== null) return { blocked: result, unavailable: false };
  if (isDurableConfigured() && failClosedInProduction && process.env.NODE_ENV === 'production') {
    console.error(`Durable rate limit unavailable for key=${key} — failing closed in production`);
    return { blocked: true, unavailable: true };
  }
  return { blocked: inMemoryFallbackFn(), unavailable: false };
}

module.exports = { checkDurableRateLimit, isRateLimitedDurable, checkLimit, isDurableConfigured };

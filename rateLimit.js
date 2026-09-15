// lib/rateLimit.js
// Two real implementations, picked automatically:
//   - Upstash Redis (fast, atomic, built for exactly this) if
//     UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set.
//   - Supabase-backed fixed window (works out of the box, no extra
//     account needed) otherwise.
// Both are fully working code paths today — this isn't a "swap it later"
// placeholder. To turn on Upstash: create a free database at
// https://upstash.com, copy its REST URL + token into Vercel's environment
// variables, redeploy. Nothing else changes; every endpoint that calls
// checkRateLimit() picks it up automatically.

const { admin } = require('./supabaseAdmin');

async function checkRateLimitSupabase(key, limit, windowSeconds) {
  const db = admin();
  const now = Date.now();

  const { data: row } = await db.from('rate_limits').select('*').eq('key', key).maybeSingle();

  if (!row) {
    await db.from('rate_limits').insert({ key, window_start: new Date(now).toISOString(), count: 1 });
    return { allowed: true };
  }

  const windowStart = new Date(row.window_start).getTime();
  const elapsed = (now - windowStart) / 1000;

  if (elapsed > windowSeconds) {
    await db.from('rate_limits').update({ window_start: new Date(now).toISOString(), count: 1 }).eq('key', key);
    return { allowed: true };
  }

  if (row.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.ceil(windowSeconds - elapsed) };
  }

  await db.from('rate_limits').update({ count: row.count + 1 }).eq('key', key);
  return { allowed: true };
}

// Upstash's REST API supports plain HTTP commands, so this needs no SDK —
// just fetch, which every Vercel Node runtime has natively.
async function checkRateLimitUpstash(key, limit, windowSeconds) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const redisKey = `ratelimit:${key}`;

  // INCR the counter, then set its expiry only on the first hit in the
  // window (NX-style: EXPIRE ... NX is Redis 7+; Upstash supports it).
  const incrRes = await fetch(`${url}/incr/${encodeURIComponent(redisKey)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const incrData = await incrRes.json();
  const count = incrData.result;

  if (count === 1) {
    await fetch(`${url}/expire/${encodeURIComponent(redisKey)}/${windowSeconds}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  if (count > limit) {
    const ttlRes = await fetch(`${url}/ttl/${encodeURIComponent(redisKey)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const ttlData = await ttlRes.json();
    return { allowed: false, retryAfterSeconds: Math.max(1, ttlData.result) };
  }

  return { allowed: true };
}

/**
 * @param {string} key - unique per user+endpoint, e.g. `session-turn:${userId}`
 * @param {number} limit - max calls allowed inside the window
 * @param {number} windowSeconds - window length
 * @returns {Promise<{ allowed: boolean, retryAfterSeconds?: number }>}
 */
async function checkRateLimit(key, limit, windowSeconds) {
  const useUpstash = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
  if (useUpstash) {
    try {
      return await checkRateLimitUpstash(key, limit, windowSeconds);
    } catch (err) {
      // Upstash hiccup shouldn't take the whole endpoint down — fall back
      // to the Supabase path for this one call.
      return checkRateLimitSupabase(key, limit, windowSeconds);
    }
  }
  return checkRateLimitSupabase(key, limit, windowSeconds);
}

module.exports = { checkRateLimit };

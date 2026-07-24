// /api/call.js — Vercel serverless function (Node.js runtime)
//
// Triggers a real outbound call from your Retell AI agent, personalized
// with the caller's name. The Retell API key lives ONLY in this server-side
// function (as a Vercel environment variable) — it is never sent to the browser.
//
// Required environment variables (set in Vercel: Project Settings → Environment Variables):
//   RETELL_API_KEY        — your Retell secret API key
//   RETELL_FROM_NUMBER     — the Retell/Twilio number to call FROM, in E.164 format
//   RETELL_PHONE_AGENT_ID  — REQUIRED, no fallback. This endpoint is exactly
//                            as public and anonymous as the browser demo, so
//                            it gets the same isolation treatment as
//                            RETELL_WEB_AGENT_ID in api/web-call.js: a
//                            dedicated agent, never the phone number's
//                            default agent. Give it no production tools
//                            (no real calendar, no unrestricted SMS, no
//                            customer data, no transfers).
// Optional (durable rate limiting — see lib/durableRateLimit.js):
//   KV_REST_API_URL / KV_REST_API_TOKEN — auto-set if you add Upstash Redis
//   via the Vercel Storage tab. Without these, falls back to a weaker
//   in-memory limiter that only works within a single warm instance.
// Optional caps (defaults are intentionally conservative for an early-stage
// demo — raise them once you understand real traffic):
//   DAILY_CALL_CAP        — max total calls per day, all visitors (default 25)
//   PER_NUMBER_DAILY_CAP  — max calls to one destination number per day (default 2)
//   PER_IP_HOURLY_CAP     — max calls from one IP per hour (default 4)
//
// COUNTRY RESTRICTION: only +1 NANP numbers are accepted (US/Canada, plus a
// few Caribbean territories that also use +1 — the E.164 country code alone
// can't distinguish those from US/Canada without a fuller numbering-plan
// lookup, which this intentionally doesn't attempt). If you need broader or
// narrower coverage, adjust the regex below.
//
// ABUSE NOTE: rate limiting controls volume; it doesn't verify a request
// came from a real human. Nothing here replaces a CAPTCHA (e.g. Cloudflare
// Turnstile) in front of this form — that's a real gap, not solved by
// anything in this file.
//
// FAIL-CLOSED ON REDIS OUTAGE: unlike the browser demo (api/web-call.js),
// this endpoint fails CLOSED (503) in production if Redis is configured but
// unreachable, rather than silently falling back to the weaker in-memory
// limiter. Real money and a real phone call are on the line here; losing
// your strongest abuse control silently is worse than a temporary outage
// message. In development (no NODE_ENV=production), it still falls back to
// in-memory so local testing isn't blocked by not having Redis configured.
//
// CONSENT: the frontend must send consent:true, meaning the visitor checked
// a box confirming this is their own number and they're requesting this
// specific call. Requests without it are rejected. Consent metadata is
// logged (not stored in a database — there isn't one here) so Vercel's
// function logs give you an audit trail. For real compliance-grade
// retention, pipe these logs to persistent storage.
//
// This is intentionally dependency-free (uses the native `fetch` available in
// Vercel's Node 18+ runtime) so no package.json / npm install is required,
// aside from the sibling lib/durableRateLimit.js file.

const { checkLimit } = require('../lib/durableRateLimit');

const CONSENT_VERSION = 'v1-2026-07';
const UNAVAILABLE_MSG = { error: 'The phone demo is temporarily unavailable. Please try again shortly.' };

// Weak fallback limiters — only used when Redis isn't configured, or in
// development. See lib/durableRateLimit.js for why these alone aren't
// sufficient cross-instance protection on Vercel.
//
// These are proper fixed-window COUNTERS (count within a window vs a max),
// not simple "block until cooldown elapses" checks — an earlier version of
// this file's per-IP limiter was actually the latter, which meant a
// configured cap like "4 per hour" silently behaved as "1 per hour" no
// matter what the number said. Fixed here.
function makeInMemoryCounter(windowMs) {
  const store = new Map();
  return (key, max) => {
    const now = Date.now();
    let entry = store.get(key);
    if (!entry || now - entry.windowStart > windowMs) {
      entry = { windowStart: now, count: 0 };
    }
    entry.count += 1;
    store.set(key, entry);
    if (store.size > 2000) {
      for (const [k, v] of store) {
        if (now - v.windowStart > windowMs) store.delete(k);
      }
    }
    return entry.count > max;
  };
}
const numberCooldownCounter = makeInMemoryCounter(60 * 1000);
const ipHourlyCounter = makeInMemoryCounter(60 * 60 * 1000);

function normalizePhone(raw) {
  let digits = String(raw || '').replace(/[^\d+]/g, '');
  if (!digits.startsWith('+')) {
    if (digits.length === 10) digits = '+1' + digits;               // bare US number
    else if (digits.length === 11 && digits.startsWith('1')) digits = '+' + digits;
    else digits = '+' + digits;
  }
  return digits;
}

function getClientIp(req) {
  const fwd = req.headers && req.headers['x-forwarded-for'];
  if (fwd) {
    const first = Array.isArray(fwd) ? fwd[0] : String(fwd).split(',')[0];
    const trimmed = first.trim();
    if (trimmed) return trimmed;
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// NANP (+1) only — see COUNTRY RESTRICTION note above.
const NANP = /^\+1\d{10}$/;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { name, phone, consent, hp } = body || {};

  // Honeypot field — real users never fill this in. Bots that fill every
  // field usually do. Pretend success so bots don't learn to skip it.
  if (hp) {
    return res.status(200).json({ ok: true });
  }

  const cleanName = String(name || '').trim();
  if (!cleanName || cleanName.length > 60) {
    return res.status(400).json({ error: 'Please enter your name.' });
  }

  const toNumber = normalizePhone(phone);
  if (!NANP.test(toNumber)) {
    return res.status(400).json({ error: 'The phone demo currently supports US and Canadian numbers only.' });
  }

  if (consent !== true) {
    return res.status(400).json({ error: 'Please confirm this is your own number to continue.' });
  }

  const clientIp = getClientIp(req);
  const perNumberCap = parseInt(process.env.PER_NUMBER_DAILY_CAP, 10) || 2;
  const perIpCap = parseInt(process.env.PER_IP_HOURLY_CAP, 10) || 4;
  const dailyCap = parseInt(process.env.DAILY_CALL_CAP, 10) || 25;
  const today = new Date().toISOString().slice(0, 10);

  // 1. Short cooldown per destination number — catches accidental double-submits fast.
  const cooldown = await checkLimit(`ratelimit:call:cooldown:${toNumber}`, 1, 60,
    () => numberCooldownCounter(toNumber, 1), { failClosedInProduction: true });
  if (cooldown.unavailable) return res.status(503).json(UNAVAILABLE_MSG);
  if (cooldown.blocked) return res.status(429).json({ error: 'A call was just sent to that number — give it a minute.' });

  // 2. Per-number daily cap — stops one number being called repeatedly across the day.
  const perNumberDaily = await checkLimit(`ratelimit:call:daynum:${toNumber}:${today}`, perNumberCap, 86400,
    () => false, { failClosedInProduction: true }); // no meaningful in-memory equivalent for a daily cap; see note below
  if (perNumberDaily.unavailable) return res.status(503).json(UNAVAILABLE_MSG);
  if (perNumberDaily.blocked) return res.status(429).json({ error: 'This number has reached today\'s demo call limit.' });

  // 3. Per-IP hourly cap — stops one visitor rotating destination numbers to bypass #1/#2.
  const perIp = await checkLimit(`ratelimit:call:ip:${clientIp}`, perIpCap, 3600,
    () => ipHourlyCounter(clientIp, perIpCap), { failClosedInProduction: true });
  if (perIp.unavailable) return res.status(503).json(UNAVAILABLE_MSG);
  if (perIp.blocked) return res.status(429).json({ error: 'Too many demo calls from your network — please try again later.' });

  // 4. Global daily cap — hard ceiling on total spend regardless of source.
  const global_ = await checkLimit(`ratelimit:call:global:${today}`, dailyCap, 86400,
    () => false, { failClosedInProduction: true }); // no meaningful in-memory equivalent for a global cap across instances
  if (global_.unavailable) return res.status(503).json(UNAVAILABLE_MSG);
  if (global_.blocked) {
    console.error(`Daily call cap (${dailyCap}) reached for ${today}`);
    return res.status(429).json({ error: 'This demo has reached its call limit for today — please try again tomorrow.' });
  }

  const apiKey = process.env.RETELL_API_KEY;
  const fromNumber = process.env.RETELL_FROM_NUMBER;
  const agentId = process.env.RETELL_PHONE_AGENT_ID; // required, no fallback — see file header

  if (!apiKey || !fromNumber || !agentId) {
    console.error('Missing RETELL_API_KEY, RETELL_FROM_NUMBER, or RETELL_PHONE_AGENT_ID');
    return res.status(500).json({ error: 'Call service is not configured yet.' });
  }

  // Audit trail in Vercel's function logs (no database here — see file header).
  console.log('CALL_CONSENT', JSON.stringify({
    ts: new Date().toISOString(),
    to: toNumber,
    consentVersion: CONSENT_VERSION,
    ip: clientIp,
  }));

  const payload = {
    from_number: fromNumber,
    to_number: toNumber,
    override_agent_id: agentId,
    retell_llm_dynamic_variables: { customer_name: cleanName },
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // don't let a slow/hung Retell API hang this function

    let retellRes;
    try {
      retellRes = await fetch('https://api.retellai.com/v2/create-phone-call', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const data = await retellRes.json().catch(() => ({}));

    if (!retellRes.ok) {
      console.error('Retell API error:', retellRes.status, data);
      return res.status(502).json({ error: 'Could not start the call. Please try again shortly.' });
    }

    return res.status(200).json({ ok: true, call_id: data.call_id });
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error('Retell API timed out after 10s');
      return res.status(504).json({ error: 'The call service took too long to respond. Please try again.' });
    }
    console.error('Call trigger failed:', err);
    return res.status(500).json({ error: 'Something went wrong starting the call.' });
  }
};

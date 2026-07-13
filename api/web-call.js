// /api/web-call.js — Vercel serverless function
//
// Mints a fresh, single-use access token for an in-browser voice call with
// your Retell agent. This is deliberately NOT the same as api/call.js:
// - api/call.js places a real outbound PHONE call to a number the visitor gives.
// - This endpoint starts a browser-mic call (WebRTC via Retell's Web SDK) —
//   the visitor talks into their laptop/phone mic, no phone number involved.
//
// SECURITY NOTE: the access_token returned here is intentionally safe to
// send to the browser — Retell designs it to be short-lived (invalidated if
// unused for 30s) and single-call. Your actual RETELL_API_KEY never leaves
// this server-side function. Don't be tempted to skip this endpoint and
// call Retell directly from the browser with the real API key — that would
// permanently expose it to anyone who views page source.
//
// PERSONALIZED DEMO: the visitor's business name/city/services/hours are
// passed through as retell_llm_dynamic_variables. That alone does nothing —
// your Retell agent's prompt must actually contain {{business_name}} etc.
// placeholders for these to show up in the conversation. See the prompt
// template provided alongside this file.
//
// PROMPT-INJECTION NOTE: these four fields are visitor-supplied free text
// that gets injected directly into a live LLM conversation. Someone could
// type something like "ignore your instructions and..." into the services
// field. Length caps here reduce the blast radius but don't eliminate it —
// the real mitigation has to be in the agent prompt itself (treat these
// values as reference data, never as instructions — see the template).
//
// AGENT ISOLATION: this endpoint reads RETELL_WEB_AGENT_ID specifically —
// it deliberately does NOT fall back to RETELL_AGENT_ID (the one api/call.js
// uses). This is a public, anonymous, unauthenticated endpoint; if you ever
// deploy a more capable "production" agent with real calendar/SMS/transfer
// tools under RETELL_AGENT_ID, a silent fallback here would let anonymous
// visitors reach it. Keep the demo agent deliberately limited: no booking
// tools, no transfers, no outbound SMS, no access to real customer data.
//
// Required environment variables:
//   RETELL_API_KEY      — your Retell secret API key
//   RETELL_WEB_AGENT_ID  — no fallback. If unset, this fails loudly (500)
//                          rather than silently reusing another agent.
// Optional (durable rate limiting — see lib/durableRateLimit.js):
//   KV_REST_API_URL / KV_REST_API_TOKEN — auto-set via Vercel's Storage tab
//   (add Upstash Redis). Without these, falls back to a weaker in-memory
//   limiter that only works within a single warm instance.
//   DAILY_WEBCALL_CAP — max web calls per day across all visitors (default
//   200). Only enforced when Redis is configured, same as api/call.js.
//
// FORM REQUIREMENTS: businessName, services, and hours are all required
// (city and the visitor's name are optional) — a demo where the agent has
// nothing to work with just says "I'd confirm that with the team" for
// everything, which is a weak demo. Better to ask for a little more upfront.

const { isRateLimitedDurable, checkDurableRateLimit } = require('../lib/durableRateLimit');

const recentRequests = new Map();
const COOLDOWN_MS = 15 * 1000; // web calls are cheap to retry, shorter cooldown than phone calls

function isRateLimitedInMemory(key) {
  const last = recentRequests.get(key);
  const now = Date.now();
  if (last && now - last < COOLDOWN_MS) return true;
  recentRequests.set(key, now);
  if (recentRequests.size > 1000) {
    for (const [k, t] of recentRequests) {
      if (now - t > COOLDOWN_MS) recentRequests.delete(k);
    }
  }
  return false;
}

function clean(v, maxLen) {
  return String(v || '').trim().slice(0, maxLen);
}

// x-forwarded-for can be "client, proxy1, proxy2" — use just the first
// (real client) address as the rate-limit key, not the whole header.
function getClientIp(req) {
  const fwd = req.headers && req.headers['x-forwarded-for'];
  if (fwd) {
    const first = Array.isArray(fwd) ? fwd[0] : String(fwd).split(',')[0];
    const trimmed = first.trim();
    if (trimmed) return trimmed;
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { name, businessName, city, services, hours, hp } = body || {};

  if (hp) {
    // Honeypot — don't mint a real token for bots, but don't tip them off either.
    return res.status(200).json({ ok: false, error: 'Could not start call.' });
  }

  const cleanBusinessName = clean(businessName, 100);
  if (!cleanBusinessName) {
    return res.status(400).json({ error: 'Please enter your business name.' });
  }
  const cleanServicesCheck = clean(services, 300);
  if (!cleanServicesCheck) {
    return res.status(400).json({ error: 'Please enter at least one service you offer.' });
  }
  const cleanHoursCheck = clean(hours, 150);
  if (!cleanHoursCheck) {
    return res.status(400).json({ error: 'Please enter your business hours.' });
  }

  // x-forwarded-for can be a comma-separated proxy chain ("client, proxy1, proxy2") —
  // take just the first (client) address rather than the whole header as the rate-limit key.
  const clientKey = getClientIp(req);
  const limited = await isRateLimitedDurable(
    `ratelimit:webcall:${clientKey}`, 1, 15,
    () => isRateLimitedInMemory(String(clientKey))
  );
  if (limited) {
    return res.status(429).json({ error: 'Please wait a moment before starting another call.' });
  }

  // Global daily cap for web calls — same rationale as api/call.js's DAILY_CALL_CAP,
  // only meaningfully enforceable once Redis is configured.
  const dailyCap = parseInt(process.env.DAILY_WEBCALL_CAP, 10) || 200;
  const today = new Date().toISOString().slice(0, 10);
  const globalLimited = await checkDurableRateLimit(`ratelimit:webcall:global:${today}`, dailyCap, 86400);
  if (globalLimited === true) {
    console.error(`Daily web-call cap (${dailyCap}) reached for ${today}`);
    return res.status(429).json({ error: 'This demo has reached its call limit for today — please try again tomorrow.' });
  }

  const apiKey = process.env.RETELL_API_KEY;
  const agentId = process.env.RETELL_WEB_AGENT_ID; // deliberately no fallback to RETELL_AGENT_ID — see file header

  if (!apiKey || !agentId) {
    console.error('Missing RETELL_API_KEY or RETELL_WEB_AGENT_ID — this endpoint requires its own dedicated agent id, not a shared fallback');
    return res.status(500).json({ error: 'Voice demo is not configured yet.' });
  }

  const dynamicVariables = {
    customer_name: clean(name, 60) || 'there',
    business_name: cleanBusinessName,
    business_city: clean(city, 100),
    services: clean(services, 300),
    business_hours: clean(hours, 150),
  };

  const payload = { agent_id: agentId, retell_llm_dynamic_variables: dynamicVariables };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let r;
    try {
      r = await fetch('https://api.retellai.com/v2/create-web-call', {
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

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('Retell create-web-call error:', r.status, data);
      return res.status(502).json({ error: 'Could not start the voice demo. Please try again.' });
    }

    // Only forward what the browser actually needs — not the full Retell response.
    return res.status(200).json({ ok: true, access_token: data.access_token, call_id: data.call_id });
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'The call service took too long to respond. Please try again.' });
    }
    console.error('web-call trigger failed:', err);
    return res.status(500).json({ error: 'Something went wrong starting the voice demo.' });
  }
};

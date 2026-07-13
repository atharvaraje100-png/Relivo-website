// /api/lead.js — Vercel serverless function
//
// Captures the "Book a Demo" form and emails the lead context to you via
// Resend. This does NOT do the actual scheduling — that's the separate
// Cal.com widget on the page, which sends its own booking confirmations
// independently. This function's only job is getting the qualifying
// context (medspa name, locations, what they're trying to solve) into
// your inbox, since Cal.com's own booking form won't capture that.
//
// Required environment variables:
//   RESEND_API_KEY — from resend.com/api-keys
//   NOTIFY_EMAIL   — the inbox that should receive lead notifications
// Optional:
//   RESEND_FROM    — defaults to Resend's shared test sender, which can
//                     only deliver to the email on YOUR OWN Resend account
//                     until you verify a real sending domain.
//
// Design choice: this function tries hard not to block the visitor from
// reaching the calendar step. Validation errors (bad name/email) return
// 400 so the form can show a real error. Everything past that — Resend
// misconfigured, Resend down, etc — returns 200 with emailed:false so the
// front end still advances to scheduling. A missed internal notification
// email is a much smaller problem than a lost booking.

const recentSubmissions = new Map();
const COOLDOWN_MS = 30 * 1000;

function isRateLimited(key) {
  const last = recentSubmissions.get(key);
  const now = Date.now();
  if (last && now - last < COOLDOWN_MS) return true;
  recentSubmissions.set(key, now);
  if (recentSubmissions.size > 500) {
    for (const [k, t] of recentSubmissions) {
      if (now - t > COOLDOWN_MS) recentSubmissions.delete(k);
    }
  }
  return false;
}

function esc(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { name, business, email, phone, locations, message, hp } = body || {};

  // Honeypot — real visitors never fill this in.
  if (hp) {
    return res.status(200).json({ ok: true });
  }

  const cleanName = String(name || '').trim();
  const cleanEmail = String(email || '').trim();

  if (!cleanName || cleanName.length > 80) {
    return res.status(400).json({ error: 'Please enter your name.' });
  }
  if (!EMAIL_RE.test(cleanEmail) || cleanEmail.length > 200) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  if (isRateLimited(cleanEmail.toLowerCase())) {
    return res.status(429).json({ error: 'Already got that one — check your inbox shortly.' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const notifyEmail = process.env.NOTIFY_EMAIL || 'relivoai@gmail.com';
  const fromAddr = process.env.RESEND_FROM || 'Relivo Leads <onboarding@resend.dev>';

  if (!apiKey) {
    console.error('Missing RESEND_API_KEY env var — skipping email, not blocking visitor');
    return res.status(200).json({ ok: true, emailed: false });
  }

  const html = `
    <h2>New demo request</h2>
    <p><strong>Name:</strong> ${esc(cleanName)}</p>
    <p><strong>Medspa:</strong> ${esc(business)}</p>
    <p><strong>Email:</strong> ${esc(cleanEmail)}</p>
    <p><strong>Phone:</strong> ${esc(phone)}</p>
    <p><strong>Locations:</strong> ${esc(locations)}</p>
    <p><strong>What they want to solve:</strong><br>${esc(message).replace(/\n/g, '<br>')}</p>
  `.trim();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let r;
    try {
      r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: fromAddr,
          to: notifyEmail,
          reply_to: cleanEmail,
          subject: `New demo request — ${business || cleanName}`,
          html,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('Resend error:', r.status, data);
      return res.status(200).json({ ok: true, emailed: false });
    }
    return res.status(200).json({ ok: true, emailed: true });
  } catch (err) {
    console.error('Lead email failed:', err.name === 'AbortError' ? 'timed out after 8s' : err);
    return res.status(200).json({ ok: true, emailed: false });
  }
};

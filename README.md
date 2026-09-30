# Relivo — AI Phone Reception for Medical Spas

Marketing site + working demo integrations for Relivo, an AI receptionist
product for medical spas. Static HTML/CSS/JS with Vercel serverless
functions for the parts that need a real backend (outbound calls, browser
voice demo, lead capture).

## Structure

```
index.html, pricing.html, ...   — the 10 top-level static pages
                                  (incl. privacy.html, terms.html)
industries/                     — 5 industry-specific landing pages
css/styles.css                  — full design system (single file)
js/main.js                      — all client-side interactivity
js/retell-web-sdk.bundle.js     — bundled Retell Web SDK (self-contained,
                                   no CDN dependency, no npm install needed)
api/call.js                     — real outbound phone call (Retell)
api/web-call.js                 — real browser voice call (Retell)
api/lead.js                     — Book a Demo lead capture (Resend email)
lib/durableRateLimit.js         — shared Redis-backed rate limiter with
                                   automatic in-memory fallback
.env.example                    — every environment variable explained
```

## Deploy

1. Push this repo to GitHub (see below if you haven't already).
2. Vercel → **Add New → Project → Import Git Repository** → select this repo.
3. Framework preset: **Other** (it's zero-config — no build command needed).
4. Add the environment variables from `.env.example` under
   **Project Settings → Environment Variables**. At minimum:
   - `RETELL_API_KEY`, `RETELL_FROM_NUMBER` — outbound phone calls
   - `RETELL_PHONE_AGENT_ID` — dedicated demo agent for outbound calls
     (deliberately separate from any production agent — no fallback)
   - `RETELL_WEB_AGENT_ID` — dedicated demo agent for the browser voice
     demo (also deliberately separate, also no fallback)
   - `RESEND_API_KEY` — lead notification emails
   - `KV_REST_API_URL` / `KV_REST_API_TOKEN` — strongly recommended before
     public launch; add Upstash Redis via Vercel's Storage tab. Without
     these, rate limiting falls back to a weaker in-memory limiter, and
     the phone endpoint fails closed (503) in production if Redis is
     configured but unreachable — see `api/call.js` comments.
5. Deploy. Every future `git push` to the connected branch auto-deploys.
6. Configure your Retell demo agent's system prompt with the
   business-context template — the personalized demo (business
   name/city/hours/services) does nothing without this step. The prompt
   template was removed from the deployed web root so it isn't publicly
   downloadable; keep your working copy somewhere private (it is still
   present in this repo's git history if you need to recover it).

## Pushing this repo to GitHub for the first time

```bash
# from inside this folder
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git branch -M main
git push -u origin main
```

(Create the empty repo on github.com first — don't initialize it with a
README/license there, since this folder already has its own git history.)

## Local testing

No build step. Open any `.html` file directly, or serve the folder with
any static file server. The `/api/*` functions only run on Vercel (or via
`vercel dev` locally, if you install the Vercel CLI) — opening the HTML
files directly means the widgets that call those endpoints will fail
gracefully with a network error, which is expected.

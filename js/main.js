// ---------- Mobile nav ----------
document.addEventListener('DOMContentLoaded', () => {
  // ---------- Animated consult-card reveal ("live capture" feel) ----------
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('.consult-card[data-animate]').forEach(card => {
    const fields = card.querySelectorAll('.consult-field');
    const status = card.querySelector('.consult-status');
    const timerEl = card.querySelector('[data-call-timer]');

    if (reduceMotion) return; // leave everything visible as-is, no staggered reveal

    fields.forEach(f => f.classList.add('pre-reveal'));
    if (status) status.classList.add('pre-reveal');

    let elapsedSec = 7;
    let timerInterval = null;
    if (timerEl) {
      timerEl.textContent = '0:07';
      timerInterval = setInterval(() => {
        elapsedSec += 3;
        const m = Math.floor(elapsedSec / 60), s = elapsedSec % 60;
        timerEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
      }, 480);
    }

    fields.forEach((f, i) => {
      setTimeout(() => f.classList.add('revealed'), 400 + i * 480);
    });
    if (status) {
      setTimeout(() => {
        status.classList.add('revealed');
        if (timerInterval) clearInterval(timerInterval);
      }, 400 + fields.length * 480 + 250);
    }
  });

  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');
  if (toggle && links) {
    const setMenuOpen = (open) => {
      links.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    };
    toggle.addEventListener('click', () => {
      const opening = !links.classList.contains('open');
      setMenuOpen(opening);
      // The menu panel sits before the toggle in DOM order, so move focus to
      // its first link on open — Tab then walks the menu naturally.
      if (opening) {
        const first = links.querySelector('a');
        if (first) first.focus();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && links.classList.contains('open')) {
        setMenuOpen(false);
        toggle.focus();
      }
    });
  }
  document.querySelectorAll('.has-dropdown > a').forEach(a => {
    a.addEventListener('click', (e) => {
      if (window.innerWidth <= 900) {
        e.preventDefault();
        a.parentElement.classList.toggle('open');
      }
    });
  });

  // ---------- FAQ accordion ----------
  document.querySelectorAll('.faq-item').forEach(item => {
    const q = item.querySelector('.faq-q');
    if (!q) return;
    q.setAttribute('aria-expanded', item.classList.contains('open') ? 'true' : 'false');
    q.addEventListener('click', () => {
      const wasOpen = item.classList.contains('open');
      item.parentElement.querySelectorAll('.faq-item').forEach(i => {
        i.classList.remove('open');
        const b = i.querySelector('.faq-q');
        if (b) b.setAttribute('aria-expanded', 'false');
      });
      if (!wasOpen) {
        item.classList.add('open');
        q.setAttribute('aria-expanded', 'true');
      }
    });
  });

  // ---------- One-time section reveals ----------
  // Content is fully visible by default; the pre-reveal state is only applied
  // when the observer exists and the visitor allows motion.
  const revealEls = document.querySelectorAll('.reveal');
  if (revealEls.length && !reduceMotion && 'IntersectionObserver' in window) {
    revealEls.forEach(el => el.classList.add('reveal-init'));
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('reveal-in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    revealEls.forEach(el => io.observe(el));
  }

  // ---------- ROI calculator ----------
  const roi = document.getElementById('roi-calculator');
  if (roi) {
    const calls = document.getElementById('roi-calls');
    const missed = document.getElementById('roi-missed');
    const value = document.getElementById('roi-value');
    const close = document.getElementById('roi-close');
    const outputs = {
      calls: document.getElementById('roi-calls-out'),
      missed: document.getElementById('roi-missed-out'),
      value: document.getElementById('roi-value-out'),
      close: document.getElementById('roi-close-out'),
      monthly: document.getElementById('roi-monthly'),
      bookings: document.getElementById('roi-bookings'),
      yearly: document.getElementById('roi-yearly'),
    };
    function fmt(n){ return '$' + Math.round(n).toLocaleString('en-US'); }
    function update(){
      const c = parseInt(calls.value, 10);
      const m = parseInt(missed.value, 10) / 100;
      const v = parseInt(value.value, 10);
      const cl = parseInt(close.value, 10) / 100;
      outputs.calls.textContent = c;
      outputs.missed.textContent = Math.round(m * 100) + '%';
      outputs.value.textContent = '$' + v.toLocaleString('en-US');
      outputs.close.textContent = Math.round(cl * 100) + '%';
      const missedCallsPerMonth = c * 4.3 * m;
      const recoveredBookings = missedCallsPerMonth * cl * 0.7; // recovery capture rate
      const monthlyRevenue = recoveredBookings * v;
      outputs.monthly.textContent = fmt(monthlyRevenue);
      outputs.bookings.textContent = Math.round(recoveredBookings);
      outputs.yearly.textContent = fmt(monthlyRevenue * 12);
    }
    [calls, missed, value, close].forEach(el => el.addEventListener('input', update));
    update();
  }

  // ---------- Web call widget (real Retell browser call via /api/web-call) ----------
  const webCallStartBtn = document.getElementById('wc-start-btn');
  if (webCallStartBtn) {
    if (typeof window.RetellWebClient !== 'function') {
      const errEl = document.getElementById('wc-error');
      if (errEl) errEl.textContent = 'Voice widget failed to load — try refreshing the page.';
      webCallStartBtn.disabled = true;
    } else {
      const client = new window.RetellWebClient();
      const idleEl = document.getElementById('web-call-idle');
      const activeEl = document.getElementById('web-call-active');
      const completeEl = document.getElementById('web-call-complete');
      const summaryListEl = document.getElementById('wc-summary-list');
      const statusText = document.getElementById('wc-status-text');
      const transcriptEl = document.getElementById('wc-transcript');
      const errorEl = document.getElementById('wc-error');
      const endBtn = document.getElementById('wc-end-btn');
      const againBtn = document.getElementById('wc-again-btn');
      const CHECK_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7"/></svg>';

      let lastSubmission = null; // captured at submit time so call_ended can show a summary

      function resetToIdle() {
        idleEl.style.display = 'block';
        activeEl.style.display = 'none';
        completeEl.style.display = 'none';
        webCallStartBtn.disabled = false;
        webCallStartBtn.textContent = 'Start Talking';
      }

      function showCompletionSummary() {
        activeEl.style.display = 'none';
        completeEl.style.display = 'block';
        summaryListEl.textContent = '';
        if (!lastSubmission) return;
        const rows = [
          lastSubmission.businessName,
          lastSubmission.city,
          lastSubmission.hours,
          lastSubmission.services,
        ].filter(Boolean);
        rows.forEach((value) => {
          const li = document.createElement('li');
          li.className = 'wc-summary-item';
          const iconSpan = document.createElement('span');
          iconSpan.innerHTML = CHECK_SVG; // static trusted markup, not user input — safe
          const textSpan = document.createElement('span');
          textSpan.textContent = value;
          li.appendChild(iconSpan);
          li.appendChild(textSpan);
          summaryListEl.appendChild(li);
        });
      }

      client.on('call_started', () => { statusText.textContent = 'Listening…'; });
      client.on('call_ended', showCompletionSummary);
      client.on('agent_start_talking', () => { statusText.textContent = 'Relivo is speaking…'; });
      client.on('agent_stop_talking', () => { statusText.textContent = 'Listening…'; });
      client.on('update', (update) => {
        const transcript = update && update.transcript;
        if (typeof transcript !== 'string') return; // don't let an unexpected payload shape break the live call
        transcriptEl.textContent = '';
        transcript.split('\n').filter(Boolean).forEach((line) => {
          const isAgent = line.startsWith('Agent:');
          const text = line.replace(/^Agent:|^User:/, '').trim();
          const row = document.createElement('div');
          row.className = 'line';
          const who = document.createElement('span');
          who.className = 'who' + (isAgent ? ' ai' : '');
          who.textContent = isAgent ? 'Relivo' : 'You';
          const txt = document.createElement('span');
          txt.className = 'txt';
          txt.textContent = text; // textContent, not innerHTML — safe by construction regardless of content
          row.appendChild(who);
          row.appendChild(txt);
          transcriptEl.appendChild(row);
        });
        transcriptEl.scrollTop = transcriptEl.scrollHeight;
      });
      client.on('error', (err) => {
        console.error('Retell web call error', err);
        if (errorEl) errorEl.textContent = 'Call error — please try again.';
        client.stopCall();
        resetToIdle();
      });

      webCallStartBtn.addEventListener('click', async () => {
        if (errorEl) errorEl.textContent = '';
        const businessName = document.getElementById('wc-business-name').value.trim();
        const hours = document.getElementById('wc-hours').value.trim();
        const services = document.getElementById('wc-services').value.trim();
        if (!businessName) {
          if (errorEl) errorEl.textContent = 'Please enter your business name.';
          document.getElementById('wc-business-name').focus();
          return;
        }
        if (!hours) {
          if (errorEl) errorEl.textContent = 'Please enter your business hours.';
          document.getElementById('wc-hours').focus();
          return;
        }
        if (!services) {
          if (errorEl) errorEl.textContent = 'Please enter at least one service you offer.';
          document.getElementById('wc-services').focus();
          return;
        }
        webCallStartBtn.disabled = true;
        webCallStartBtn.textContent = 'Connecting…';
        const name = document.getElementById('wc-name').value;
        const city = document.getElementById('wc-city').value;
        const hp = document.getElementById('wc-hp').value;
        try {
          const res = await fetch('/api/web-call', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, businessName, city, hours, services, hp }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.access_token) {
            if (errorEl) errorEl.textContent = (data && data.error) || 'Could not start the call.';
            resetToIdle();
            return;
          }
          lastSubmission = { businessName, city, hours, services };
          // Must call within ~30s of minting or Retell invalidates the token.
          await client.startCall({ accessToken: data.access_token });
          idleEl.style.display = 'none';
          activeEl.style.display = 'block';
          transcriptEl.textContent = '';
        } catch (err) {
          console.error(err);
          if (errorEl) errorEl.textContent = 'Microphone access is needed to start the call.';
          resetToIdle();
        }
      });

      endBtn.addEventListener('click', () => client.stopCall());
      if (againBtn) againBtn.addEventListener('click', resetToIdle);
    }
  }

  // ---------- Live call widget (real Retell call via /api/call) ----------
  const liveCallForm = document.getElementById('live-call-form');
  if (liveCallForm) {
    liveCallForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = liveCallForm.querySelector('button[type="submit"]');
      const status = document.getElementById('lc-status');
      const name = document.getElementById('lc-name').value;
      const phone = document.getElementById('lc-phone').value;
      const consent = document.getElementById('lc-consent').checked;
      const hp = document.getElementById('lc-hp').value;
      if (!consent) {
        status.textContent = 'Please confirm this is your own number to continue.';
        status.style.color = 'var(--negative)';
        return;
      }
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Calling…';
      status.textContent = '';
      status.style.color = 'var(--ink-faint)';
      try {
        const res = await fetch('/api/call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, phone, consent, hp }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          status.textContent = 'Calling you now — pick up in the next few seconds.';
          status.style.color = 'var(--positive)';
          liveCallForm.reset();
        } else {
          status.textContent = (data && data.error) || 'Something went wrong. Please try again.';
          status.style.color = 'var(--negative)';
        }
      } catch (err) {
        status.textContent = 'Network error — please try again.';
        status.style.color = 'var(--negative)';
      } finally {
        btn.disabled = false;
        btn.textContent = original;
      }
    });
  }

  // ---------- Demo call simulator ----------
  const demoRoot = document.getElementById('demo-simulator');
  if (demoRoot) {
    const scripts = {
      botox: [
        ['caller', 'Hi, I wanted to ask about Botox pricing and if you have anything open this week.'],
        ['ai', 'Happy to help. Botox is priced per unit, and the right amount really depends on your goals and anatomy — that is exactly what your injector determines at the consult. Have you had Botox before?'],
        ['caller', 'Yeah, I get it every few months, just moved here.'],
        ['ai', 'Welcome to the area. I can get you on the schedule with one of our injectors this week. Would Wednesday or Thursday work better?'],
        ['caller', 'Thursday afternoon.'],
        ['ai', 'Thursday at 2:15pm with Dr. Alvarez is open. I will text you a confirmation and a quick intake form now.'],
        ['status', 'Consultation booked · Thu 2:15 PM · Dr. Alvarez'],
      ],
      weightloss: [
        ['caller', 'Hi, I saw your semaglutide program online, is it still $299 a month?'],
        ['ai', 'That is right, $299 a month for the medical weight loss program, including your provider visits. Are you a current patient or just getting started?'],
        ['caller', 'Just starting. I do have a question about side effects though.'],
        ['ai', 'Totally understand. I am not able to give medical guidance over the phone, but I can get you a same-week consult with our provider so you get a real answer, not a guess.'],
        ['caller', 'That works.'],
        ['ai', 'I have Tuesday 10am or Friday 4pm with Nurse Practitioner Ruiz. Which is better?'],
        ['caller', 'Friday.'],
        ['status', 'Consultation booked · Fri 4:00 PM · NP Ruiz · Flagged for clinical intake'],
      ],
      laser: [
        ['caller', 'Do you guys do laser hair removal packages, and how many sessions do I need?'],
        ['ai', 'We do — session count varies by area and hair type, and we will confirm your exact package at a free consult and patch test. Which area were you thinking about?'],
        ['caller', 'Underarms and legs.'],
        ['ai', 'We have a bundle for both of those. I can get you in for a free consult and patch test first, that is how we confirm your package price. Mornings or evenings work better for you?'],
        ['caller', 'Evenings.'],
        ['ai', 'I have Monday at 5:30pm. I will send a confirmation text with parking instructions.'],
        ['status', 'Consultation booked · Mon 5:30 PM · Patch test included'],
      ],
    };
    const transcriptEl = document.getElementById('demo-transcript');
    const statusEl = document.getElementById('demo-status');
    const buttons = demoRoot.querySelectorAll('[data-scenario]');
    let running = false;

    function renderScript(key){
      if (running) return;
      running = true;
      buttons.forEach(b => b.classList.remove('active'));
      demoRoot.querySelector(`[data-scenario="${key}"]`).classList.add('active');
      transcriptEl.textContent = '';
      statusEl.textContent = '';
      const connectingPill = document.createElement('span');
      connectingPill.className = 'pill pill-neutral';
      connectingPill.textContent = 'Connecting…';
      statusEl.appendChild(connectingPill);
      const lines = scripts[key];
      let i = 0;
      function step(){
        if (i >= lines.length){ running = false; return; }
        const [who, text] = lines[i];
        if (who === 'status'){
          statusEl.textContent = '';
          const pill = document.createElement('span');
          pill.className = 'pill pill-positive';
          pill.textContent = text;
          statusEl.appendChild(pill);
          i++;
          setTimeout(step, 500);
          return;
        }
        const row = document.createElement('div');
        row.className = 'line';
        const whoEl = document.createElement('span');
        whoEl.className = 'who' + (who === 'ai' ? ' ai' : '');
        whoEl.textContent = who === 'ai' ? 'Relivo' : 'Caller';
        const txtEl = document.createElement('span');
        txtEl.className = 'txt';
        txtEl.textContent = text;
        row.appendChild(whoEl);
        row.appendChild(txtEl);
        transcriptEl.appendChild(row);
        transcriptEl.scrollTop = transcriptEl.scrollHeight;
        i++;
        setTimeout(step, 1400);
      }
      step();
    }
    buttons.forEach(btn => btn.addEventListener('click', () => renderScript(btn.dataset.scenario)));
    renderScript('botox');
  }

  // ---------- Contact / Book a Demo: capture lead, then reveal Cal.com scheduling ----------
  const contactForm = document.getElementById('contact-form');
  if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = contactForm.querySelector('button[type="submit"]');
      const original = btn.textContent;
      const errorEl = document.getElementById('cf-error');
      if (errorEl) errorEl.textContent = '';
      btn.disabled = true;
      btn.textContent = 'Submitting…';

      const payload = {
        name: document.getElementById('cf-name').value,
        business: document.getElementById('cf-business').value,
        email: document.getElementById('cf-email').value,
        phone: document.getElementById('cf-phone').value,
        locations: document.getElementById('cf-locations').value,
        message: document.getElementById('cf-message').value,
        hp: document.getElementById('cf-hp').value,
      };

      try {
        const res = await fetch('/api/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok && (res.status === 400 || res.status === 429)) {
          const data = await res.json().catch(() => ({}));
          if (errorEl) errorEl.textContent = data.error || 'Something went wrong — please try again.';
          btn.disabled = false;
          btn.textContent = original;
          return; // real validation error — don't advance to scheduling
        }
      } catch (err) {
        // Network error reaching our own API — still let them try to schedule below.
      }

      const formStep = document.getElementById('contact-step-form');
      const calStep = document.getElementById('contact-step-calendar');
      if (formStep && calStep) {
        formStep.style.display = 'none';
        calStep.style.display = 'block';
        if (window.Cal) {
          Cal('inline', {
            elementOrSelector: '#cal-embed',
            calLink: window.RELIVO_CAL_LINK || 'ari-relivoai/15min',
            config: {
              name: payload.name,
              email: payload.email,
              notes: payload.message,
              theme: 'dark',
              layout: 'month_view',
            },
          });
          Cal('ui', {
            theme: 'dark',
            styles: { branding: { brandColor: '#C9A25E' } },
            hideEventTypeDetails: false,
            layout: 'month_view',
          });
        }
      }
    });
  }

});

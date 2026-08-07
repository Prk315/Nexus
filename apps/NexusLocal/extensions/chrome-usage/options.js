/*
 * Nexus Web Usage — settings page.
 *
 * Plain DOM, no framework. Talks to chrome.storage.local for settings and to
 * the background worker for the health check / manual flush (the worker owns
 * the token, so it does the authenticated calls).
 */

'use strict';

const HEALTH_URL = 'http://127.0.0.1:1431/usage/health';
const TOKEN_LEN = 48;

const $ = (id) => document.getElementById(id);

const el = {
  token: $('token'),
  reveal: $('reveal'),
  save: $('save'),
  tokenStatus: $('tokenStatus'),
  enabled: $('enabled'),
  enabledLabel: $('enabledLabel'),
  enabledHint: $('enabledHint'),
  test: $('test'),
  healthStatus: $('healthStatus'),
  queueCount: $('queueCount'),
  flush: $('flush'),
  lastFlush: $('lastFlush'),
};

function setStatus(node, text, kind) {
  node.textContent = text;
  node.classList.remove('ok', 'bad');
  if (kind) node.classList.add(kind);
}

// --- load ------------------------------------------------------------------

async function load() {
  const out = await chrome.storage.local.get(['token', 'enabled', 'queue', 'lastFlush']);
  const token = typeof out.token === 'string' ? out.token : '';
  el.token.value = token;
  applyTokenState(token, out.enabled === true);
  renderQueue(out.queue, out.lastFlush);
}

function applyTokenState(token, enabled) {
  const hasToken = token.trim().length > 0;
  // Tracking cannot be switched on until a token exists — without one every
  // upload would 401 and the queue would just accumulate.
  el.enabled.disabled = !hasToken;
  el.enabled.checked = hasToken && enabled;
  el.enabledLabel.textContent = el.enabled.checked ? 'Tracking is on' : 'Tracking is off';
  el.enabledHint.textContent = hasToken
    ? 'Only the active tab of the focused Chrome window is measured. Time stops when you switch apps or go idle.'
    : 'Save a token first to enable tracking.';
}

function renderQueue(queue, lastFlush) {
  const n = Array.isArray(queue) ? queue.length : 0;
  el.queueCount.textContent = String(n);

  if (!lastFlush || !lastFlush.at) {
    el.lastFlush.textContent =
      n > 0
        ? 'Nothing uploaded yet — is the Nexus Local app running?'
        : 'No upload attempted yet.';
    el.lastFlush.classList.remove('ok', 'bad');
    return;
  }

  const when = new Date(lastFlush.at).toLocaleTimeString();
  const prefix = lastFlush.ok ? 'Last upload ' + when + ': ' : 'Last upload failed at ' + when + ': ';
  setStatus(el.lastFlush, prefix + (lastFlush.message || ''), lastFlush.ok ? 'ok' : 'bad');
  el.lastFlush.classList.add('hint');
}

// --- token -----------------------------------------------------------------

el.reveal.addEventListener('click', () => {
  const showing = el.token.type === 'text';
  el.token.type = showing ? 'password' : 'text';
  el.reveal.textContent = showing ? 'Show' : 'Hide';
});

el.save.addEventListener('click', async () => {
  const token = el.token.value.trim();
  if (token.length === 0) {
    await chrome.storage.local.set({ token: '', enabled: false });
    applyTokenState('', false);
    setStatus(el.tokenStatus, 'Token cleared. Tracking turned off.', 'bad');
    return;
  }
  await chrome.storage.local.set({ token });
  const current = await chrome.storage.local.get('enabled');
  applyTokenState(token, current.enabled === true);
  if (token.length !== TOKEN_LEN) {
    setStatus(
      el.tokenStatus,
      'Saved, but this is ' + token.length + ' characters — the Nexus token is normally ' + TOKEN_LEN + '.',
      'bad'
    );
  } else {
    setStatus(el.tokenStatus, 'Token saved.', 'ok');
  }
});

// --- tracking switch -------------------------------------------------------

el.enabled.addEventListener('change', async () => {
  await chrome.storage.local.set({ enabled: el.enabled.checked });
  el.enabledLabel.textContent = el.enabled.checked ? 'Tracking is on' : 'Tracking is off';
});

// --- connection test -------------------------------------------------------

el.test.addEventListener('click', async () => {
  el.test.disabled = true;
  setStatus(el.healthStatus, 'Checking…');
  try {
    // Done from this page directly (host permission covers extension pages);
    // no token is required by /usage/health.
    const res = await fetch(HEALTH_URL, { cache: 'no-store' });
    const body = await res.json().catch(() => null);
    if (res.ok && body && body.ok === true) {
      setStatus(el.healthStatus, 'Connected — daemon is running on 127.0.0.1:1431.', 'ok');
    } else {
      setStatus(el.healthStatus, 'Reached 127.0.0.1:1431 but got an unexpected response (HTTP ' + res.status + ').', 'bad');
    }
  } catch (e) {
    setStatus(
      el.healthStatus,
      'Not connected — nothing is listening on 127.0.0.1:1431. Start the Nexus Local app.',
      'bad'
    );
  } finally {
    el.test.disabled = false;
  }
});

// --- manual flush ----------------------------------------------------------

el.flush.addEventListener('click', async () => {
  el.flush.disabled = true;
  try {
    await chrome.runtime.sendMessage({ type: 'flushNow' });
  } catch (e) {
    // Worker may have been asleep; sendMessage wakes it, so a failure here is
    // rare and harmless — the periodic alarm will retry anyway.
  } finally {
    el.flush.disabled = false;
  }
  const out = await chrome.storage.local.get(['queue', 'lastFlush']);
  renderQueue(out.queue, out.lastFlush);
});

// --- live updates ----------------------------------------------------------

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('queue' in changes || 'lastFlush' in changes) {
    chrome.storage.local.get(['queue', 'lastFlush']).then((out) => {
      renderQueue(out.queue, out.lastFlush);
    });
  }
});

load();

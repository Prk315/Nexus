/*
 * Nexus Web Usage — MV3 background service worker.
 *
 * Job: measure how long the user ACTIVELY looks at each website, and POST
 * completed intervals to the Nexus Local daemon at http://127.0.0.1:1431.
 *
 * ---------------------------------------------------------------------------
 * THE THING THAT MAKES THIS HARD: MV3 SERVICE WORKER TERMINATION
 * ---------------------------------------------------------------------------
 * Chrome kills this worker after ~30s of inactivity. Every in-memory variable
 * dies with it. A naive tracker keeps `intervalStart` in a module-level `let`,
 * and one of two bad things happens:
 *
 *   (a) the worker dies mid-interval and the time is silently lost, or
 *   (b) worse, some stale value survives (or is re-read from disk hours later)
 *       and we report a bogus 6-hour session on a tab the user closed at lunch.
 *
 * So: the in-progress interval lives in chrome.storage.session (falling back to
 * chrome.storage.local), is rewritten on EVERY state change, and carries a
 * `lastSeenMs` heartbeat. On worker startup we recover it, and:
 *   - if the heartbeat is older than STALE_MS we throw the interval away
 *     entirely rather than guess (see recoverOrDiscard),
 *   - when we do close an interval we clamp its end to lastSeenMs + grace, so
 *     a laptop that slept for 3 hours cannot inflate a 2-minute interval.
 *
 * Similarly: NO setInterval / setTimeout for periodic work. Timers do not
 * survive worker termination. chrome.alarms does — it wakes the worker back up.
 *
 * ---------------------------------------------------------------------------
 * CORRECTNESS RULE: UNDER-REPORT, NEVER OVER-REPORT.
 * ---------------------------------------------------------------------------
 * Any ambiguity — unknown window focus, missing tab URL, stale recovered
 * interval, non-http scheme — resolves to "record nothing".
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ENDPOINT_BASE = 'http://127.0.0.1:1431';
const ENDPOINT_USAGE = ENDPOINT_BASE + '/usage/web';
const ENDPOINT_HEALTH = ENDPOINT_BASE + '/usage/health';

const ALARM_TICK = 'nexus-usage-tick';
const ALARM_PERIOD_MINUTES = 1; // chrome.alarms minimum in stable Chrome.

// chrome.idle threshold, in seconds. Minimum accepted by Chrome is 15.
const IDLE_DETECTION_SECONDS = 60;

// Intervals shorter than this are tab-flipping noise, not attention.
const MIN_INTERVAL_SECONDS = 2;

// If a recovered interval's heartbeat is older than this, we cannot say what
// the user was doing in between, so we discard the whole interval.
const STALE_MS = 10 * 60 * 1000; // 10 minutes

// When closing an interval we allow the end to run at most this far past the
// last heartbeat. The heartbeat fires every ALARM_PERIOD_MINUTES, so anything
// beyond ~2x that means the worker (or the machine) was asleep and we should
// not credit the gap.
const HEARTBEAT_GRACE_MS = 2 * ALARM_PERIOD_MINUTES * 60 * 1000;

// Queue safety valve. Oldest entries are dropped first.
const MAX_QUEUE = 5000;

// How many records we attempt per flush, so a huge backlog does not monopolise
// the worker in one wake-up.
const FLUSH_BATCH = 50;

const MAX_URL_LEN = 2048;
const MAX_TITLE_LEN = 512;

// Storage keys
const K_CURRENT = 'currentInterval'; // session-scoped: the in-progress interval
const K_QUEUE = 'queue'; // local: completed-but-unsent records
const K_TOKEN = 'token'; // local
const K_ENABLED = 'enabled'; // local
const K_STATUS = 'lastFlush'; // local: {at, ok, message, sent}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

// chrome.storage.session is ideal for the in-progress interval: it is cleared
// when the browser restarts, which is exactly the semantics we want (an
// interval cannot survive a browser restart). Older Chrome lacks it, so fall
// back to local — the stale-heartbeat check below is what actually keeps us
// honest either way.
const sessionArea = chrome.storage.session || chrome.storage.local;

async function getLocal(keys) {
  try {
    return await chrome.storage.local.get(keys);
  } catch (e) {
    console.warn('[nexus-usage] storage.local.get failed', e);
    return {};
  }
}

async function setLocal(obj) {
  try {
    await chrome.storage.local.set(obj);
  } catch (e) {
    console.warn('[nexus-usage] storage.local.set failed', e);
  }
}

// chrome.tabs / chrome.windows / chrome.storage have returned promises since
// Chrome 88, but chrome.idle and chrome.alarms only gained promise support in
// much later builds (111/116). Wrapping their callback form keeps this working
// on any MV3-capable Chromium without a version gate.
function idleQueryState(seconds) {
  return new Promise((resolve) => {
    try {
      chrome.idle.queryState(seconds, (state) => {
        resolve(chrome.runtime.lastError ? null : state);
      });
    } catch (e) {
      resolve(null);
    }
  });
}

function alarmsGet(name) {
  return new Promise((resolve) => {
    try {
      chrome.alarms.get(name, (alarm) => {
        resolve(chrome.runtime.lastError ? null : alarm || null);
      });
    } catch (e) {
      resolve(null);
    }
  });
}

function alarmsCreate(name, info) {
  try {
    chrome.alarms.create(name, info);
  } catch (e) {
    console.warn('[nexus-usage] alarms.create failed', e);
  }
}

async function getCurrent() {
  try {
    const out = await sessionArea.get(K_CURRENT);
    return out[K_CURRENT] || null;
  } catch (e) {
    console.warn('[nexus-usage] failed to read current interval', e);
    return null;
  }
}

async function setCurrent(cur) {
  try {
    if (cur) await sessionArea.set({ [K_CURRENT]: cur });
    else await sessionArea.remove(K_CURRENT);
  } catch (e) {
    console.warn('[nexus-usage] failed to write current interval', e);
  }
}

// ---------------------------------------------------------------------------
// Settings cache
//
// Kept in memory for speed but ALWAYS re-hydrated from storage on worker
// startup, and refreshed via storage.onChanged. Never treated as authoritative
// before `ready` resolves.
// ---------------------------------------------------------------------------

let settings = { token: '', enabled: false };

async function loadSettings() {
  const out = await getLocal([K_TOKEN, K_ENABLED]);
  settings = {
    token: typeof out[K_TOKEN] === 'string' ? out[K_TOKEN] : '',
    // Tracking defaults to OFF and stays off until a token exists.
    enabled: out[K_ENABLED] === true,
  };
}

function trackingActive() {
  return settings.enabled && settings.token.length > 0;
}

// ---------------------------------------------------------------------------
// Serialisation
//
// tabs.onActivated / tabs.onUpdated / windows.onFocusChanged can fire within
// milliseconds of each other (e.g. click a link in a background window). Each
// handler does an async read-modify-write of the stored interval, so without a
// lock two handlers can both read `null` and both open an interval, or both
// close the same one and emit it twice. Everything that touches the interval
// goes through this single promise chain.
// ---------------------------------------------------------------------------

let chain = Promise.resolve();

function serialize(fn) {
  const next = chain.then(fn).catch((e) => {
    console.warn('[nexus-usage] task failed', e);
  });
  chain = next;
  return next;
}

// ---------------------------------------------------------------------------
// Deciding what the user is currently looking at
// ---------------------------------------------------------------------------

function normaliseUrl(rawUrl) {
  // Only real web pages count. This allowlist implicitly drops chrome://,
  // chrome-extension://, about:, file://, view-source:, data:, devtools:, etc.
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) return null;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (e) {
    return null; // Unparseable URL -> record nothing.
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const host = parsed.hostname;
  if (!host) return null;
  return { url: rawUrl.slice(0, MAX_URL_LEN), host };
}

/**
 * Returns {url, host, title} for the page the user is actually looking at
 * right now, or null if we cannot say with confidence.
 *
 * This re-queries Chrome from scratch rather than trusting the event payload.
 * Event payloads can be stale by the time an awakened worker processes them
 * (the classic bug: onActivated for a tab the user has already navigated away
 * from), and being wrong here means mis-attributed time.
 */
async function computeTarget() {
  if (!trackingActive()) return null;

  // 1. Is the user at the machine at all? 'idle' or 'locked' => not watching.
  //    A null result means we could not determine it, which also => not watching.
  const idleState = await idleQueryState(IDLE_DETECTION_SECONDS);
  if (idleState !== 'active') return null;

  // 2. Is Chrome the frontmost app? getLastFocused() returns the most recently
  //    focused Chrome window; its `focused` flag is true ONLY while Chrome
  //    itself has OS focus. If the user alt-tabbed to their editor this is
  //    false, and we must not keep counting. This is the check that stops the
  //    extension reporting time while the user is in another application.
  let win;
  try {
    win = await chrome.windows.getLastFocused();
  } catch (e) {
    return null;
  }
  if (!win || win.focused !== true) return null;

  // Devtools windows, and anything exotic, do not count as browsing.
  if (win.type !== 'normal' && win.type !== 'popup') return null;

  // 3. Which tab is active in that window?
  let tabs;
  try {
    tabs = await chrome.tabs.query({ active: true, windowId: win.id });
  } catch (e) {
    return null;
  }
  const tab = tabs && tabs[0];
  if (!tab) return null;

  // The `tabs` permission is what gives us url/title here. We deliberately do
  // NOT request <all_urls> — the active tab's url and title are all we need.
  const norm = normaliseUrl(tab.url);
  if (!norm) return null;

  return {
    url: norm.url,
    host: norm.host,
    title: typeof tab.title === 'string' ? tab.title.slice(0, MAX_TITLE_LEN) : '',
  };
}

// ---------------------------------------------------------------------------
// Interval lifecycle
// ---------------------------------------------------------------------------

/**
 * The end timestamp we are willing to claim for an interval.
 *
 * Never later than lastSeenMs + grace. If the worker was terminated or the
 * machine slept, `now` may be hours past the last time we verified the user
 * was actually on this page; crediting that gap would be pure fiction.
 */
function clampedEnd(cur, nowMs) {
  return Math.min(nowMs, cur.lastSeenMs + HEARTBEAT_GRACE_MS);
}

/** Close the in-progress interval (if any) and queue it if it is long enough. */
async function closeCurrent(nowMs) {
  const cur = await getCurrent();
  if (!cur) return;
  await setCurrent(null);

  const endMs = clampedEnd(cur, nowMs);
  // floor, not round: prefer to lose a fraction of a second than invent one.
  const seconds = Math.floor((endMs - cur.startMs) / 1000);
  if (!Number.isFinite(seconds) || seconds < MIN_INTERVAL_SECONDS) return;

  await enqueue({
    url: cur.url,
    title: cur.title || '',
    host: cur.host,
    seconds,
    start: new Date(cur.startMs).toISOString(), // RFC3339, UTC ("...Z")
    end: new Date(endMs).toISOString(),
  });
}

/** Start a fresh interval for `target`. */
async function openCurrent(target, nowMs) {
  await setCurrent({
    url: target.url,
    title: target.title,
    host: target.host,
    startMs: nowMs,
    lastSeenMs: nowMs,
  });
}

/**
 * The single entry point for "something changed, work out what to do".
 *
 * Rules:
 *   - target null  -> close whatever is open, open nothing.
 *   - same URL     -> keep the interval open, refresh heartbeat (+ title, which
 *                     often arrives after the URL does).
 *   - different URL-> close the old interval, open a new one.
 *
 * We close on URL change, not merely host change. A host change is a URL
 * change so the required behaviour is covered, but closing on URL change also
 * stops a 50-minute YouTube session being attributed entirely to whichever
 * video happened to be playing when the interval opened.
 */
async function reevaluate() {
  const nowMs = Date.now();
  const target = await computeTarget();
  const cur = await getCurrent();

  if (!target) {
    if (cur) await closeCurrent(nowMs);
    return;
  }

  if (cur && cur.url === target.url) {
    // If the heartbeat had gone stale we must not silently extend the old
    // interval across the gap, even though the user is on the same page —
    // close it (clamped to the last heartbeat) and start a new one.
    if (nowMs - cur.lastSeenMs > STALE_MS) {
      await closeCurrent(nowMs);
      await openCurrent(target, nowMs);
      return;
    }
    // Same page, heartbeat fresh: keep the interval open, refresh the
    // heartbeat, and pick up a title that arrived after the URL did.
    const next = { ...cur, lastSeenMs: nowMs };
    if (target.title && target.title !== cur.title) next.title = target.title;
    await setCurrent(next);
    return;
  }

  if (cur) await closeCurrent(nowMs);
  await openCurrent(target, nowMs);
}

/**
 * Runs once per worker startup. Decides the fate of an interval that was open
 * when the previous worker instance was killed.
 *
 * If the heartbeat is fresh, reevaluate() will either continue the interval
 * (user still on the same page) or close it cleanly. If the heartbeat is stale
 * we DISCARD it outright — we have no evidence about the intervening time, and
 * reporting a multi-hour phantom session is far worse than losing a few real
 * minutes.
 */
async function recoverOrDiscard() {
  const cur = await getCurrent();
  if (!cur) return;
  const nowMs = Date.now();

  const looksCorrupt =
    typeof cur.startMs !== 'number' ||
    typeof cur.lastSeenMs !== 'number' ||
    cur.startMs > nowMs + 60000 || // clock went backwards / bogus record
    cur.lastSeenMs < cur.startMs;

  if (looksCorrupt || nowMs - cur.lastSeenMs > STALE_MS) {
    console.info('[nexus-usage] discarding stale/corrupt recovered interval', cur);
    await setCurrent(null);
  }
}

// ---------------------------------------------------------------------------
// Queue + delivery
//
// Tracking must never wait on the network. enqueue() only touches storage;
// flushQueue() is fired off separately and its failures are irrelevant to the
// tracking state machine.
// ---------------------------------------------------------------------------

async function enqueue(record) {
  const out = await getLocal(K_QUEUE);
  const queue = Array.isArray(out[K_QUEUE]) ? out[K_QUEUE] : [];
  queue.push(record);
  // Bounded buffer: drop the OLDEST entries so a daemon that has been down for
  // weeks cannot fill the profile's storage.
  const trimmed = queue.length > MAX_QUEUE ? queue.slice(queue.length - MAX_QUEUE) : queue;
  await setLocal({ [K_QUEUE]: trimmed });

  // Fire and forget — deliberately not awaited by the caller's critical path.
  flushQueue();
}

let flushing = false;

async function flushQueue() {
  if (flushing) return;
  flushing = true;
  try {
    await flushQueueInner();
  } catch (e) {
    console.warn('[nexus-usage] flush failed', e);
  } finally {
    flushing = false;
  }
}

async function flushQueueInner() {
  if (!settings.token) return; // Nothing to authenticate with; keep queued.

  let out = await getLocal(K_QUEUE);
  let queue = Array.isArray(out[K_QUEUE]) ? out[K_QUEUE] : [];
  if (queue.length === 0) return;

  let sent = 0;
  let stopReason = null;

  for (let i = 0; i < FLUSH_BATCH && queue.length > 0; i++) {
    const record = queue[0];
    const result = await postRecord(record);

    if (result.kind === 'ok' || result.kind === 'permanent') {
      // 'permanent' = the daemon will never accept this record (malformed).
      // Dropping it is the only way to stop it blocking the queue head.
      queue = queue.slice(1);
      // Persist progress after every record. If the worker is killed mid-flush
      // we resume from here; the worst case is that a record whose POST
      // succeeded but whose dequeue did not gets delivered twice. At-least-once
      // is the right trade here — losing data is worse than a duplicate.
      await setLocal({ [K_QUEUE]: queue });
      if (result.kind === 'ok') sent++;
      else console.warn('[nexus-usage] dropping record rejected by daemon', result.message);
    } else {
      // Retryable: daemon down, 401, 429, 5xx. Keep everything queued.
      stopReason = result.message;
      break;
    }
  }

  await setLocal({
    [K_STATUS]: {
      at: new Date().toISOString(),
      ok: stopReason === null,
      message: stopReason || (sent > 0 ? 'Delivered ' + sent + ' record(s).' : 'Up to date.'),
      sent,
      queued: queue.length,
    },
  });
}

/**
 * POST one record. Returns:
 *   {kind:'ok'}                       -> delivered, remove from queue
 *   {kind:'permanent', message}       -> daemon rejected it as malformed, drop
 *   {kind:'retry', message}           -> keep it queued and try again later
 */
async function postRecord(record) {
  let res;
  try {
    res = await fetch(ENDPOINT_USAGE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Nexus-Token': settings.token,
      },
      body: JSON.stringify(record),
      cache: 'no-store',
    });
  } catch (e) {
    // Daemon not running / connection refused. This is the normal case when
    // the Nexus Local app is closed — never a reason to drop data.
    return { kind: 'retry', message: 'Daemon unreachable on 127.0.0.1:1431.' };
  }

  if (res.ok) return { kind: 'ok' };

  if (res.status === 401 || res.status === 403) {
    return { kind: 'retry', message: 'Rejected (' + res.status + ') — check the token in settings.' };
  }
  if (res.status === 400 || res.status === 413 || res.status === 422) {
    return { kind: 'permanent', message: 'HTTP ' + res.status };
  }
  return { kind: 'retry', message: 'Daemon returned HTTP ' + res.status + '.' };
}

// ---------------------------------------------------------------------------
// Alarms
//
// The alarm serves two purposes:
//   1. it heartbeats the in-progress interval so the stale check above can
//      distinguish "still reading" from "worker died 3 hours ago", and
//   2. it retries the queue against a daemon that may have come back up.
// It also periodically resurrects the worker, which is why setInterval is not
// an option: a plain timer dies with the worker and never fires again.
// ---------------------------------------------------------------------------

async function ensureAlarm() {
  const existing = await alarmsGet(ALARM_TICK);
  // Re-creating an existing alarm resets its schedule, so only create when
  // missing — otherwise a worker that wakes frequently would keep pushing the
  // tick into the future and it would never fire.
  if (!existing) {
    alarmsCreate(ALARM_TICK, {
      periodInMinutes: ALARM_PERIOD_MINUTES,
      delayInMinutes: ALARM_PERIOD_MINUTES,
    });
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function init() {
  try {
    await loadSettings();
    try {
      chrome.idle.setDetectionInterval(IDLE_DETECTION_SECONDS);
    } catch (e) {
      console.warn('[nexus-usage] setDetectionInterval failed', e);
    }
    await ensureAlarm();
    await serialize(recoverOrDiscard);
    await serialize(reevaluate);
  } catch (e) {
    console.warn('[nexus-usage] init failed', e);
  }
}

// `ready` never rejects; every listener awaits it so that no event is processed
// against half-loaded settings or an unrecovered interval.
const ready = init();

// ---------------------------------------------------------------------------
// Event listeners
//
// These MUST be registered synchronously at the top level. Chrome only routes
// a wake-up event to the worker if the listener is registered during the
// worker's initial evaluation — registering inside an async callback would
// mean events silently stop waking the worker.
// ---------------------------------------------------------------------------

chrome.tabs.onActivated.addListener(async () => {
  await ready;
  serialize(reevaluate);
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  // onUpdated is chatty (favicons, loading states). Only navigation and title
  // changes on the ACTIVE tab can affect what we are measuring.
  if (!tab || tab.active !== true) return;
  if (changeInfo.url === undefined && changeInfo.title === undefined) return;
  await ready;
  serialize(reevaluate);
});

chrome.tabs.onRemoved.addListener(async () => {
  await ready;
  serialize(reevaluate);
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  await ready;
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Chrome lost OS focus entirely — the user switched to another app. Close
    // immediately; do not wait for the next tick, or we would credit up to a
    // minute of time spent in a different application.
    serialize(() => closeCurrent(Date.now()));
    return;
  }
  serialize(reevaluate);
});

chrome.idle.onStateChanged.addListener(async (state) => {
  await ready;
  if (state === 'active') {
    // Coming back from idle starts a NEW interval; the idle gap is not credited.
    serialize(reevaluate);
  } else {
    // 'idle' or 'locked'. chrome.idle only tells us the user went idle at the
    // moment the threshold elapsed, and clampedEnd() keeps the end honest.
    serialize(() => closeCurrent(Date.now()));
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_TICK) return;
  await ready;
  serialize(reevaluate); // heartbeat / close if the situation changed
  flushQueue(); // retry delivery; never blocks tracking
});

chrome.runtime.onStartup.addListener(async () => {
  await ready;
  // A browser restart can never continue an interval.
  serialize(async () => {
    await setCurrent(null);
    await reevaluate();
  });
  flushQueue();
});

chrome.runtime.onInstalled.addListener(async () => {
  const out = await getLocal([K_ENABLED, K_TOKEN]);
  if (out[K_ENABLED] === undefined) await setLocal({ [K_ENABLED]: false });
  if (out[K_TOKEN] === undefined) await setLocal({ [K_TOKEN]: '' });
  await ready;
  await ensureAlarm();
  serialize(reevaluate);
});

// Settings changed from the options page.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (!(K_TOKEN in changes) && !(K_ENABLED in changes)) return;
  await ready;
  await loadSettings();
  if (!trackingActive()) {
    // Turning tracking off must close (and keep) the interval in flight rather
    // than let it dangle and be discarded later as stale.
    serialize(() => closeCurrent(Date.now()));
  } else {
    serialize(reevaluate);
  }
  flushQueue();
});

// Clicking the toolbar icon opens the settings page.
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

// Let the options page trigger an immediate flush / read live status.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'flushNow') {
    (async () => {
      await ready;
      await loadSettings();
      await flushQueue();
      sendResponse({ ok: true });
    })();
    return true; // keep the message channel open for the async response
  }
  if (msg && msg.type === 'health') {
    (async () => {
      try {
        const res = await fetch(ENDPOINT_HEALTH, { cache: 'no-store' });
        const body = await res.json().catch(() => null);
        sendResponse({ ok: res.ok && !!body && body.ok === true, status: res.status });
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
      }
    })();
    return true;
  }
  return false;
});

'use strict';

/**
 * Google Cloud Translation (the Basic, v2 API) as a translator for file names and notes, with an
 * API key from Settings → MakerWorld.
 *
 * Google gives the first 500,000 characters each month free (its months are in Pacific time) and
 * charges for more. JusttPrint counts every character it sends, warns in the notifications at 80%
 * and 95% and when the free characters are used up, and then either stops using Google until the
 * month resets (the next translator takes over) or keeps going, as chosen in Settings.
 */

const database = require('../core/database');
const { httpsFetch, readLimited, USER_AGENT } = require('./link-import');

const KEY_SETTING = 'googleTranslateApiKey';
/** 'stop' (the default) or 'pay': what happens once the free characters are used up. */
const AT_LIMIT_SETTING = 'googleTranslateAtLimit';
/** The free characters a month (Google's allowance; changeable in case Google changes it). */
const FREE_SETTING = 'googleTranslateFreeChars';
const DEFAULT_FREE = 500000;
const WARN_AT = [0.8, 0.95, 1];
const ENDPOINT = 'https://translation.googleapis.com/language/translate/v2';
const TIMEOUT_MS = 30000;
/** Google takes up to 128 texts and about 5,000 characters a request (it advises). */
const MAX_TEXTS = 128;
const MAX_CHARS = 5000;
const TIME_ZONE = 'America/Los_Angeles';

let readyFor = null;
function table() {
  const db = database.db;
  if (readyFor !== db) {
    db.prepare(
      `CREATE TABLE IF NOT EXISTS google_translate_usage (
      month TEXT PRIMARY KEY,
      chars INTEGER NOT NULL DEFAULT 0
    )`
    ).run();
    readyFor = db;
  }
  return db;
}

const setting = (key) => {
  const row = database.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
};

const apiKey = () => String(setting(KEY_SETTING) || '').trim() || null;
const freeChars = () => {
  const n = Number(setting(FREE_SETTING));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_FREE;
};
const atLimit = () => (setting(AT_LIMIT_SETTING) === 'pay' ? 'pay' : 'stop');

/** Characters as Google counts them (code points). */
const charCount = (texts) => texts.reduce((sum, text) => sum + [...String(text)].length, 0);

/**
 * Google's month (Pacific time): { month: '2026-10', label: 'October', daysLeft, resetsOn: '2026-11-01' }.
 * `daysLeft` counts today: on the last day of the month it is 1 (it resets at midnight).
 */
function billingMonth(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(now)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)])
  );
  const { year, month, day } = parts;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  const pad = (n) => String(n).padStart(2, '0');
  return {
    month: `${year}-${pad(month)}`,
    label: new Date(Date.UTC(year, month - 1, 15)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }),
    daysLeft: daysInMonth - day + 1,
    resetsOn: `${next.year}-${pad(next.month)}-01`
  };
}

function usedThisMonth(now = new Date()) {
  const row = table().prepare('SELECT chars FROM google_translate_usage WHERE month = ?').get(billingMonth(now).month);
  return row ? row.chars : 0;
}

/** Settings → MakerWorld: { hasKey, keyHint, used, free, percent, month, daysLeft, resetsOn, atLimit, stopped }. */
function status(now = new Date()) {
  const key = apiKey();
  const used = usedThisMonth(now);
  const free = freeChars();
  const month = billingMonth(now);
  return {
    hasKey: !!key,
    keyHint: key ? `…${key.slice(-4)}` : null,
    used,
    free,
    percent: Math.min(100, Math.round((used / free) * 1000) / 10),
    month: month.label,
    daysLeft: month.daysLeft,
    resetsOn: month.resetsOn,
    atLimit: atLimit(),
    stopped: atLimit() === 'stop' && used >= free
  };
}

const days = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;

/** Notifications when this month's use passes 80%, 95% and 100% of the free characters (each once). */
function warn(before, after, now = new Date()) {
  const free = freeChars();
  const month = billingMonth(now);
  const notifications = require('./notifications');
  for (const share of WARN_AT) {
    const line = free * share;
    if (before >= line || after < line) continue;
    const reset = `It resets in ${days(month.daysLeft)} (${month.resetsOn}).`;
    const choice =
      atLimit() === 'stop'
        ? 'When they are used up, JusttPrint stops using Google until then and uses the next translator.'
        : 'After that Google charges for each character (Settings → MakerWorld can stop that).';
    notifications.notify({
      level: share >= 1 ? 'warning' : 'info',
      title:
        share >= 1
          ? atLimit() === 'stop'
            ? "Google Translate's free characters are used up"
            : 'Google Translate is now charging'
          : `Google Translate: ${Math.round(share * 100)}% of this month's free characters used`,
      body:
        share >= 1
          ? `${after.toLocaleString('en-US')} of ${free.toLocaleString('en-US')} free characters used in ${month.label}. ${
              atLimit() === 'stop'
                ? 'JusttPrint stopped using Google until the month resets and uses the next translator.'
                : 'JusttPrint keeps using Google, which now charges about $20 per million characters.'
            } ${reset} Change this under Settings → MakerWorld.`
          : `${after.toLocaleString('en-US')} of ${free.toLocaleString('en-US')} free characters used in ${month.label}. ${choice} ${reset}`,
      link: '#/settings/integrations',
      minRole: 'admin',
      key: `google-translate-${month.month}-${Math.round(share * 100)}`,
      now
    });
  }
}

function limitError(now = new Date()) {
  const month = billingMonth(now);
  return Object.assign(new Error(`Google Translate's free characters for ${month.label} are used up (it resets in ${days(month.daysLeft)})`), {
    code: 'GOOGLE_LIMIT'
  });
}

/** Texts in requests Google takes: at most 128 texts and about 5,000 characters each. */
function requestsOf(texts) {
  const out = [];
  let current = [];
  let size = 0;
  for (const text of texts) {
    const n = [...text].length;
    if (current.length && (current.length >= MAX_TEXTS || size + n > MAX_CHARS)) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(text);
    size += n;
  }
  if (current.length) out.push(current);
  return out;
}

/** HTML entities Google may leave in text (it should not with format=text). */
const decode = (text) =>
  String(text)
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/**
 * English for each text, in order. Throws without a key, when the free characters are used up
 * and Settings says to stop, or when Google refuses.
 * @param {string[]} texts
 * @param {{ fetchImpl?: Function, key?: string | null, now?: Date, count?: boolean }} [deps] `key` and `count: false` for checking a key.
 */
async function translateGoogle(texts, { fetchImpl = httpsFetch, key = null, now = new Date(), count = true } = {}) {
  const useKey = key || apiKey();
  if (!useKey) throw Object.assign(new Error('Google Translate has no API key (Settings → MakerWorld)'), { code: 'GOOGLE_KEY' });
  const out = [];
  for (const batch of requestsOf(texts.map(String))) {
    const chars = charCount(batch);
    const before = count ? usedThisMonth(now) : 0;
    if (count && atLimit() === 'stop' && before + chars > freeChars()) throw limitError(now);
    const response = await fetchImpl(`${ENDPOINT}?key=${encodeURIComponent(useKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': USER_AGENT },
      body: JSON.stringify({ q: batch, target: 'en', format: 'text' }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const body = JSON.parse((await readLimited(response, 8 * 1024 * 1024)).toString('utf8') || '{}');
    if (!response.ok) {
      const message = (body.error && body.error.message) || `Google answered ${response.status}`;
      throw new Error(`Google Translate: ${message}`);
    }
    const translations = (body.data && body.data.translations) || [];
    if (translations.length !== batch.length) throw new Error('Google Translate did not answer every text');
    if (count) {
      // Google counts what it was sent, translated or not.
      const month = billingMonth(now).month;
      table()
        .prepare('INSERT INTO google_translate_usage (month, chars) VALUES (?, ?) ON CONFLICT(month) DO UPDATE SET chars = chars + excluded.chars')
        .run(month, chars);
      warn(before, before + chars, now);
    }
    out.push(...translations.map((t) => decode(t.translatedText || '')));
  }
  return out;
}

/** A text of any length, line breaks kept: long texts go in pieces at paragraph and line ends. */
async function translateLongText(text, deps = {}) {
  const pieces = [];
  let current = '';
  for (const line of String(text).split(/(\n)/)) {
    if ([...current].length + [...line].length > MAX_CHARS - 50 && current) {
      pieces.push(current);
      current = '';
    }
    current += line;
  }
  if (current) pieces.push(current);
  return (await translateGoogle(pieces, deps)).join('');
}

/** Keep (or with '' remove) the API key, after checking it with Google (a few characters). */
async function setKey(value, deps = {}) {
  const key = String(value || '').trim();
  if (!key) {
    database.db.prepare('DELETE FROM settings WHERE key = ?').run(KEY_SETTING);
    return status();
  }
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(key)) throw new Error('That does not look like a Google API key');
  await translateGoogle(['Hola'], { ...deps, key, count: false });
  database.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(KEY_SETTING, key);
  return status();
}

module.exports = {
  AT_LIMIT_SETTING,
  DEFAULT_FREE,
  FREE_SETTING,
  KEY_SETTING,
  billingMonth,
  requestsOf,
  setKey,
  status,
  translateGoogle,
  translateLongText
};

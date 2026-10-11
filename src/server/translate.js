'use strict';

/**
 * English names for MakerWorld file names (腿部.stl → Legs), the way Settings → MakerWorld says.
 * The translators, tried in the order chosen there (the next one when one fails or is used up):
 * 'google' (Google Cloud Translation, with an API key: google-translate.js), 'free' (MyMemory, a
 * free service, no account) and 'ai' (the AI service set up for AI Tagging). None ticked: off.
 * Names already in Latin script are left as they are.
 */

const { needsTranslation } = require('../core/makerworld');
const { httpsFetch, readLimited, USER_AGENT } = require('./link-import');

const MODES = ['free', 'ai', 'off'];
const DEFAULT_MODE = 'free';
const SETTING_KEY = 'makerWorldTranslation';
// MyMemory takes up to 500 bytes per request.
const FREE_BATCH_BYTES = 450;
const TIMEOUT_MS = 20000;

const modeOf = (value) => (MODES.includes(value) ? value : DEFAULT_MODE);

/** The translators, in the order to try them (Settings → MakerWorld). */
const TRANSLATORS = ['google', 'free', 'ai'];
const ORDER_KEY = 'translationOrder';

/** The order from its setting (a JSON list), else from the older single choice (free, ai or off). */
function orderFrom(orderValue, legacyValue) {
  if (orderValue != null) {
    try {
      const list = JSON.parse(orderValue);
      if (Array.isArray(list)) return [...new Set(list.filter((t) => TRANSLATORS.includes(t)))];
    } catch (_) {
      /* the older setting below */
    }
  }
  const mode = modeOf(legacyValue);
  return mode === 'off' ? [] : [mode];
}

/** The translators to try now, in order (none: translation is off). */
function currentOrder() {
  const read = (key) => {
    const row = require('../core/database').db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  };
  return orderFrom(read(ORDER_KEY), read(SETTING_KEY));
}

/** The order as one word, for knowing kept translations apart ("google,free"; "off"). */
const orderKey = (order) => (order.length ? order.join(',') : 'off');

/** Split texts into batches of at most `limit` bytes, one text per line. */
function batches(texts, limit) {
  const out = [];
  let current = [];
  let size = 0;
  for (const text of texts) {
    const bytes = Buffer.byteLength(text, 'utf8') + 1;
    if (current.length && size + bytes > limit) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(text);
    size += bytes;
  }
  if (current.length) out.push(current);
  return out;
}

/** MyMemory, one request per batch of lines; the language is detected. */
async function translateFree(texts, fetchImpl = httpsFetch) {
  const result = [];
  for (const batch of batches(texts, FREE_BATCH_BYTES)) {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(batch.join('\n'))}&langpair=${encodeURIComponent('Autodetect|en')}`;
    const response = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = JSON.parse((await readLimited(response, 1024 * 1024)).toString('utf8'));
    if (!response.ok || Number(body.responseStatus) !== 200) {
      throw new Error(body.responseDetails ? `MyMemory: ${body.responseDetails}` : `MyMemory answered ${response.status}`);
    }
    const lines = String((body.responseData && body.responseData.translatedText) || '').split('\n');
    // A batch that comes back with a different number of lines is translated name by name.
    if (lines.length === batch.length) result.push(...lines);
    else if (batch.length > 1) for (const text of batch) result.push(...(await translateFree([text], fetchImpl)));
    else result.push(lines.join(' '));
  }
  return result;
}

const PROMPT = (texts) =>
  `Translate each of these 3D model file names into short, natural English. Answer with only a JSON array of strings, the same length and order as the input, nothing else.\n\n${JSON.stringify(texts)}`;

/** The AI's answer → its JSON array of names, or throws. */
function parseAiAnswer(content, count) {
  const text = typeof content === 'string' ? content : (content && ((content.message && content.message.content) || content.text || content.content)) || '';
  const match = /\[[\s\S]*\]/.exec(String(text));
  const list = match ? JSON.parse(match[0]) : null;
  if (!Array.isArray(list) || list.length !== count) throw new Error('The AI service did not answer with the translations');
  return list.map((item) => String(item ?? ''));
}

/**
 * The AI service from AI Tagging (Puter runs in the browser that asked).
 * @param {string[]} texts
 * @param {{ aiSettings?: any, puterHandler?: any }} deps
 */
async function translateAi(texts, { aiSettings, puterHandler }) {
  return parseAiAnswer(await require('./ai-ask').askAi(PROMPT(texts), { aiSettings, puterHandler, maxTokens: 2000 }), texts.length);
}

/** One translator's English for texts, or throws. */
async function translateWith(translator, texts, deps) {
  if (translator === 'google') return require('./google-translate').translateGoogle(texts, { fetchImpl: deps.fetchImpl });
  if (translator === 'ai') return translateAi(texts, deps);
  return translateFree(texts, deps.fetchImpl);
}

/**
 * English names for `names` (null where none is needed or none came back), and what translated
 * them. The translators are tried in order until one answers. Never throws: when none does, the
 * names stay as they are, with the last `error`.
 * @param {string[]} names
 * @param {string | string[]} order the translators in order (or the older single choice: off | free | ai)
 * @param {{ aiSettings?: any, puterHandler?: any, fetchImpl?: typeof httpsFetch }} [deps]
 */
async function translateNames(names, order, deps = {}) {
  const english = names.map(() => /** @type {string | null} */ (null));
  const wanted = names.map((name, i) => ({ name: String(name || ''), i })).filter((item) => needsTranslation(item.name));
  const translators = Array.isArray(order) ? order : orderFrom(null, order);
  if (!translators.length || !wanted.length) return { english, by: null, error: null };
  /** @type {string | null} */
  let error = null;
  for (const translator of translators) {
    try {
      const translated = await translateWith(
        translator,
        wanted.map((item) => item.name),
        deps
      );
      wanted.forEach((item, k) => {
        const text = String(translated[k] || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 255);
        if (text && text !== item.name) english[item.i] = text;
      });
      return { english, by: translator, error: null };
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    }
  }
  return { english, by: null, error };
}

module.exports = {
  DEFAULT_MODE,
  MODES,
  ORDER_KEY,
  SETTING_KEY,
  TRANSLATORS,
  batches,
  currentOrder,
  modeOf,
  orderFrom,
  orderKey,
  parseAiAnswer,
  translateFree,
  translateNames
};

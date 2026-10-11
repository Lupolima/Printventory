'use strict';

/**
 * English for notes in another language (a MakerWorld designer's description in Chinese, say),
 * with the translator set under Settings → MakerWorld (the free MyMemory service, the AI service,
 * or off):
 *
 * - shown: a model page and the details panel show an English translation under such notes;
 * - when added: a new model's notes are translated in the background and saved as the English,
 *   with the original kept under it ("Original:"), so nothing is lost.
 *
 * Each text is translated once (text_translations), so showing a page again costs nothing.
 */

const crypto = require('crypto');
const database = require('../core/database');
const { needsTranslation } = require('../core/makerworld');
const translate = require('./translate');

/** Where saved notes keep the original under the English. */
const ORIGINAL_MARK = '\n\n---\n\nOriginal:\n\n';
/** MyMemory takes about 500 bytes a request. */
const CHUNK_BYTES = 450;
const MAX_TEXT = 20000;

let readyFor = null;
function table() {
  const db = database.db;
  if (readyFor !== db) {
    db.prepare(
      `CREATE TABLE IF NOT EXISTS text_translations (
      key TEXT PRIMARY KEY,
      english TEXT NOT NULL,
      by TEXT,
      created_at TEXT NOT NULL
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

/** The part of notes to translate: before "Original:" when an English translation is already there. */
function originalPart(notes) {
  const text = String(notes || '');
  return text.includes(ORIGINAL_MARK) ? '' : text;
}

/** Whether notes are (mostly) in a script other than Latin and have no English yet. */
function notesNeedTranslation(notes) {
  const text = originalPart(notes).trim();
  if (!text) return false;
  const letters = [...text].filter((ch) => /\p{L}/u.test(ch));
  const foreign = letters.filter((ch) => needsTranslation(ch));
  return foreign.length >= 3 && foreign.length / Math.max(1, letters.length) > 0.2;
}

/** Long lines cut at sentence ends (and then anywhere) into pieces of at most `limit` bytes. */
function pieces(line, limit = CHUNK_BYTES) {
  if (Buffer.byteLength(line, 'utf8') <= limit) return [line];
  const sentences = line.match(/[^。！？.!?]+[。！？.!?]*\s*/gu) || [line];
  const out = [];
  let current = '';
  const flush = () => {
    if (current) out.push(current);
    current = '';
  };
  for (const sentence of sentences) {
    if (Buffer.byteLength(current + sentence, 'utf8') <= limit) {
      current += sentence;
      continue;
    }
    flush();
    if (Buffer.byteLength(sentence, 'utf8') <= limit) current = sentence;
    else {
      // One very long sentence: by characters.
      let part = '';
      for (const ch of sentence) {
        if (Buffer.byteLength(part + ch, 'utf8') > limit) {
          out.push(part);
          part = '';
        }
        part += ch;
      }
      current = part;
    }
  }
  flush();
  return out;
}

/** The free service: line by line (long lines in pieces), keeping the lines. */
async function translateFreeText(text, fetchImpl) {
  const lines = text.split('\n');
  const parts = [];
  const where = [];
  lines.forEach((line, index) => {
    if (!line.trim() || !needsTranslation(line)) return;
    for (const piece of pieces(line)) {
      parts.push(piece);
      where.push(index);
    }
  });
  if (!parts.length) return text;
  const translated = await translate.translateFree(parts, fetchImpl);
  const out = lines.map((line, index) => (where.includes(index) ? '' : line));
  translated.forEach((piece, i) => {
    out[where[i]] = out[where[i]] ? `${out[where[i]]} ${piece.trim()}` : piece.trim();
  });
  return out.join('\n');
}

const AI_PROMPT = (text) =>
  `Translate these notes about a 3D printable model into natural English. Keep the line breaks, lists and any Markdown, and leave names, numbers and units as they are. Answer with only the translation.\n\n${text}`;

/**
 * English for a text: { english, by, error }; english null when the text needs none, or the
 * translator is off or failed. Never throws. `deps`: { fetchImpl, aiSettings, puterHandler, ask }.
 */
async function translateText(text, deps = {}) {
  const source = String(text || '')
    .trim()
    .slice(0, MAX_TEXT);
  if (!notesNeedTranslation(source)) return { english: null, by: null, error: null };
  const mode = translate.modeOf(setting(translate.SETTING_KEY));
  if (mode === 'off') return { english: null, by: null, error: null };
  const key = crypto.createHash('sha1').update(`${mode}\n${source}`).digest('hex');
  const kept = table().prepare('SELECT english, by FROM text_translations WHERE key = ?').get(key);
  if (kept) return { english: kept.english, by: kept.by, error: null };
  try {
    let english;
    let by;
    if (mode === 'ai') {
      const settings = deps.aiSettings || require('./ipc/ai').getAISettings();
      const ask =
        deps.ask || ((prompt) => require('./ai-ask').askAi(prompt, { aiSettings: settings, puterHandler: deps.puterHandler || null, maxTokens: 4000 }));
      english = String(await ask(AI_PROMPT(source))).trim();
      by = 'ai';
    } else {
      english = (await translateFreeText(source, deps.fetchImpl)).trim();
      by = 'free';
    }
    if (!english) throw new Error('The translator answered nothing');
    table()
      .prepare('INSERT OR REPLACE INTO text_translations (key, english, by, created_at) VALUES (?, ?, ?, ?)')
      .run(key, english, by, new Date().toISOString());
    return { english, by, error: null };
  } catch (error) {
    return { english: null, by: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/** A model's notes in English, to show under them: { english, by, error } (english null when not needed). */
async function englishForModel(filePath, deps = {}) {
  const model = database.db.prepare('SELECT notes FROM models WHERE filePath = ?').get(String(filePath || ''));
  if (!model) throw new Error('This model is not in the library');
  return translateText(originalPart(model.notes), deps);
}

// ---- New models: translated in the background ----

/** @type {number[]} */
const queue = [];
let running = false;
/** After the free service's daily limit: no more tries until this time. */
let pausedUntil = 0;

/** A new model was added: translate its notes when they need it (in the background). */
function noteAdded(modelId) {
  if (!Number.isInteger(Number(modelId))) return;
  queue.push(Number(modelId));
  if (!running) setTimeout(() => void work(), 2000).unref?.();
}

async function work(deps = {}) {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      if (Date.now() < pausedUntil) {
        queue.length = 0;
        break;
      }
      const id = queue.shift();
      const model = database.db.prepare('SELECT id, notes FROM models WHERE id = ?').get(id);
      if (!model || !notesNeedTranslation(model.notes)) continue;
      // Puter runs in a browser: background translations need the free service or another AI service.
      if (translate.modeOf(setting(translate.SETTING_KEY)) === 'ai' && (require('./ipc/ai').getAISettings().aiService || '') === 'puter') continue;
      const { english, error } = await translateText(model.notes, deps);
      if (error && /limit|quota|free translations/i.test(error)) {
        pausedUntil = Date.now() + 12 * 3600 * 1000;
        console.warn(`[Notes] Translations paused: ${error}`);
        continue;
      }
      if (!english) continue;
      // Only when the notes are still as they were (nobody changed them meanwhile).
      database.db.prepare('UPDATE models SET notes = ? WHERE id = ? AND notes = ?').run(`${english}${ORIGINAL_MARK}${model.notes}`, model.id, model.notes);
    }
  } finally {
    running = false;
  }
}

module.exports = { ORIGINAL_MARK, englishForModel, noteAdded, notesNeedTranslation, originalPart, pieces, translateText, work, _queue: queue };

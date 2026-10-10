'use strict';

/**
 * The library's AI searches. Both turn what the person asked into search words, and the library
 * then searches for any of them, so the search stays the usual one (and shows which words it used):
 *
 * - by meaning: "phone stand" also finds holders, docks and cradles;
 * - by photo: a picture of a part or object becomes words for what it shows.
 *
 * They use the AI service set up under Settings → AI Tagging (src/server/ai-ask.js).
 */

const { askAi, parseList } = require('./ai-ask');

const MAX_WORDS = 12;
const MAX_QUERY = 200;
/** A photo as a data URL, already made small by the browser (about 1 MB at most). */
const MAX_PHOTO_CHARS = 4 * 1024 * 1024;
const PHOTO_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

/** Search words from an answer: trimmed, short, no repeats (ignoring case), at most 12. */
function cleanWords(list, extra = []) {
  const seen = new Set();
  const out = [];
  for (const raw of [...extra, ...list]) {
    const word = String(raw ?? '')
      .replace(/["*]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);
    const key = word.toLowerCase();
    if (word.length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push(word);
    if (out.length >= MAX_WORDS) break;
  }
  return out;
}

const meaningPrompt = (query) =>
  `Someone searches a library of 3D printable models (STL and 3MF files) for: "${query}". ` +
  `List up to ${MAX_WORDS} short English search words or two-word phrases that the matching models are likely to have in their file names, tags or ` +
  `categories: the search's own words, synonyms, the names of the things it describes and closely related objects. Prefer single words. ` +
  `Answer with only a JSON array of strings, like ["holder", "stand", "dock"].`;

const PHOTO_PROMPT =
  `This photo shows something a person wants to find among 3D printable models (a part, a replacement piece, a toy, a tool, a decoration). ` +
  `List up to ${MAX_WORDS} short English search words or two-word phrases for what it shows: what the object is, what it is for, ` +
  `and other names for it, most important first. Answer with only a JSON array of strings, like ["knob", "drawer pull", "handle"].`;

/** Search words for a search by meaning (the search's own words first). */
async function searchWordsForMeaning(query, deps) {
  const text = String(query ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY);
  if (!text) throw new Error('Type what you are looking for');
  return cleanWords(parseList(await askAi(meaningPrompt(text), { ...deps, maxTokens: 400, temperature: 0 })), [text]);
}

/** Search words for what a photo shows. */
async function searchWordsForPhoto(dataUrl, deps) {
  const image = String(dataUrl || '');
  if (!PHOTO_URL.test(image)) throw new Error('That is not a photo JusttPrint can read (PNG, JPEG, WebP or GIF)');
  if (image.length > MAX_PHOTO_CHARS) throw new Error('The photo is too large');
  const words = cleanWords(parseList(await askAi(PHOTO_PROMPT, { ...deps, image, maxTokens: 400, temperature: 0 })));
  if (!words.length) throw new Error('The AI service could not tell what the photo shows');
  return words;
}

module.exports = { MAX_WORDS, cleanWords, searchWordsForMeaning, searchWordsForPhoto };

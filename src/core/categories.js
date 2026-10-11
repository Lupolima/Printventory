'use strict';

/**
 * Categories: every model has one place, a Category and one of its Subcategories ("Toys & Games ›
 * Puzzles"), from a fixed list (category-list.js, MakerWorld's own). A model's place is kept as two
 * rows in model_categories, the Category's and the Subcategory's, so searching for either finds
 * it. Each place remembers where it came from: 'site' (the category MakerWorld, Printables or
 * Thingiverse gives the model), 'folder', 'tag' or 'name' (a word found there, used when no AI
 * sorts the models), 'ai' (picked by the AI service), or 'manual' (the Edit dialog).
 */

const database = require('./database');
const { folderTagsFromPath } = require('./library-context');
const { CATEGORY_LIST, SITE_SYNONYMS } = require('./category-list');

const SOURCES = ['site', 'folder', 'tag', 'name', 'ai', 'manual'];
/** Sources that are guesses from words: an AI run looks at those models again. */
const GUESSES = ['folder', 'tag', 'name'];
const LIST_VERSION = '2';

/** Lower case, "&" as "and", only letters and digits as words: "Toys & Games" → "toys and games". */
function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** A word without a plural "s" (not for short words like "rc" or "dnd"). */
const singular = (word) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word);
const words = (text) => normalize(text).split(' ').filter(Boolean).map(singular);

/** Whether `phrase` appears in `text` as whole words (plurals count). */
function hasPhrase(text, phrase) {
  const haystack = ` ${words(text).join(' ')} `;
  const needle = words(phrase).join(' ');
  return !!needle && haystack.includes(` ${needle} `);
}

const keywordList = (text) =>
  String(text ?? '')
    .split(',')
    .map((word) => word.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

const readyFor = new WeakSet();

const hasTable = (db, name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
const setting = (db, key) => (hasTable(db, 'settings') ? db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value : undefined);
const saveSetting = (db, key, value) => {
  if (hasTable(db, 'settings')) db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
};

/** The categories tables, with the list in place (once: the older list is replaced). */
function ensureTables(db = database.db) {
  if (!db || readyFor.has(db)) return db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      keywords TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      parent_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS model_categories (
      model_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      PRIMARY KEY (model_id, category_id)
    );
    CREATE INDEX IF NOT EXISTS idx_model_categories_category ON model_categories(category_id);
  `);
  if (!db.prepare("SELECT 1 FROM pragma_table_info('categories') WHERE name = 'parent_id'").get()) {
    db.exec('ALTER TABLE categories ADD COLUMN parent_id INTEGER');
  }
  if (hasTable(db, 'models'))
    db.exec('CREATE TRIGGER IF NOT EXISTS model_categories_removed AFTER DELETE ON models BEGIN DELETE FROM model_categories WHERE model_id = OLD.id; END;');
  if (setting(db, 'categoriesList') !== LIST_VERSION) installList(db);
  readyFor.add(db);
  return db;
}

/**
 * Put the list in place: its categories keep their ids (and models) where the names match, other
 * categories go. Places a person chose are kept when they are on the list (a Category alone gets
 * its Subcategory at the next sort); every other place goes, so every model is sorted again
 * (categoriesResort says so, category-scan.js).
 */
function installList(db) {
  db.transaction(() => {
    const byName = new Map(
      db
        .prepare('SELECT id, name FROM categories')
        .all()
        .map((row) => [normalize(row.name), row.id])
    );
    const keep = new Set();
    const put = (name, keywords, position, parentId) => {
      const existing = byName.get(normalize(name));
      if (existing) {
        db.prepare('UPDATE categories SET name = ?, keywords = ?, position = ?, parent_id = ? WHERE id = ?').run(
          name,
          keywords.join(', '),
          position,
          parentId,
          existing
        );
        keep.add(existing);
        return existing;
      }
      const id = Number(
        db.prepare('INSERT INTO categories (name, keywords, position, parent_id) VALUES (?, ?, ?, ?)').run(name, keywords.join(', '), position, parentId)
          .lastInsertRowid
      );
      keep.add(id);
      return id;
    };
    CATEGORY_LIST.forEach((category, i) => {
      const mainId = put(category.name, category.keywords, i * 100, null);
      category.subcategories.forEach((sub, j) => put(sub.name, sub.keywords, i * 100 + j + 1, mainId));
    });
    for (const row of db.prepare('SELECT id FROM categories').all()) {
      if (keep.has(row.id)) continue;
      db.prepare('DELETE FROM model_categories WHERE category_id = ?').run(row.id);
      db.prepare('DELETE FROM categories WHERE id = ?').run(row.id);
    }
    // Every model is sorted again; what a person chose stays (one place each).
    db.prepare("DELETE FROM model_categories WHERE source != 'manual'").run();
    const manual = db
      .prepare(
        `SELECT mc.model_id, c.id, c.parent_id FROM model_categories mc JOIN categories c ON c.id = mc.category_id
        ORDER BY mc.model_id, c.parent_id IS NULL, c.position`
      )
      .all();
    const first = new Map();
    for (const row of manual) if (!first.has(row.model_id)) first.set(row.model_id, row);
    db.prepare('DELETE FROM model_categories').run();
    const insert = db.prepare("INSERT OR IGNORE INTO model_categories (model_id, category_id, source) VALUES (?, ?, 'manual')");
    for (const row of first.values()) {
      insert.run(row.model_id, row.id);
      if (row.parent_id) insert.run(row.model_id, row.parent_id);
    }
    saveSetting(db, 'categoriesList', LIST_VERSION);
    saveSetting(db, 'categoriesResort', '1');
  })();
}

/**
 * Every Category and Subcategory with how many models it has: [{ id, name, parent_id, keywords,
 * model_count }], in the list's order (each Category, then its Subcategories).
 */
function listCategories() {
  const db = ensureTables();
  return db
    .prepare(
      `SELECT c.id, c.name, c.parent_id, c.keywords, COUNT(mc.model_id) AS model_count
    FROM categories c LEFT JOIN model_categories mc ON mc.category_id = c.id
    GROUP BY c.id ORDER BY c.position, c.name COLLATE NOCASE`
    )
    .all()
    .map((row) => ({ ...row, keywords: keywordList(row.keywords) }));
}

/** The list as a tree: [{ ...category, subcategories: [...] }]. */
function categoryTree(list = listCategories()) {
  return list.filter((c) => !c.parent_id).map((main) => ({ ...main, subcategories: list.filter((c) => c.parent_id === main.id) }));
}

/** How many models have no Subcategory yet (no place, or a Category alone). */
function uncategorizedCount() {
  const db = ensureTables();
  return db
    .prepare(
      'SELECT COUNT(*) AS n FROM models WHERE id NOT IN (SELECT mc.model_id FROM model_categories mc JOIN categories c ON c.id = mc.category_id WHERE c.parent_id IS NOT NULL)'
    )
    .get().n;
}

/**
 * Change the words that point to a Category or Subcategory (the list's names are fixed).
 * @param {number} id
 * @param {{ keywords?: string }} [changes]
 */
function updateCategory(id, { keywords } = {}) {
  const db = ensureTables();
  const row = db.prepare('SELECT id, name, keywords FROM categories WHERE id = ?').get(id);
  if (!row) throw new Error('This category is gone');
  if (keywords !== undefined) db.prepare('UPDATE categories SET keywords = ? WHERE id = ?').run(keywordList(keywords).join(', '), id);
  return { id, name: row.name };
}

/** A model's place as names: [Category, Subcategory] (or [Category], or []). */
function modelCategoryNames(modelId) {
  const db = ensureTables();
  return db
    .prepare(
      `SELECT c.name FROM model_categories mc JOIN categories c ON c.id = mc.category_id
    WHERE mc.model_id = ? ORDER BY c.parent_id IS NOT NULL, c.position`
    )
    .all(modelId)
    .map((row) => row.name);
}

/** A model's place: { category, subcategory, source } (names; null when not placed). */
function modelPlace(modelId) {
  const db = ensureTables();
  const rows = db
    .prepare('SELECT c.name, c.parent_id, mc.source FROM model_categories mc JOIN categories c ON c.id = mc.category_id WHERE mc.model_id = ?')
    .all(modelId);
  const sub = rows.find((r) => r.parent_id);
  const main = rows.find((r) => !r.parent_id);
  return { category: main ? main.name : null, subcategory: sub ? sub.name : null, source: (sub || main || {}).source || null };
}

/** The list's row for a name (a Category or a Subcategory, written loosely), or null. */
function findCategory(name, list = listCategories()) {
  const key = normalize(name);
  if (!key) return null;
  return list.find((c) => normalize(c.name) === key) || list.find((c) => normalize(c.name.replace(/&/g, ' ')) === key) || null;
}

/**
 * Give a model its place (replacing the one it had): `name` a Subcategory (its Category comes with
 * it) or a Category alone. Unknown names leave the model without a place. Answers its names.
 */
function setModelPlace(modelId, name, source = 'manual') {
  const db = ensureTables();
  const found = name ? findCategory(name) : null;
  db.transaction(() => {
    db.prepare('DELETE FROM model_categories WHERE model_id = ?').run(modelId);
    if (!found) return;
    const insert = db.prepare('INSERT INTO model_categories (model_id, category_id, source) VALUES (?, ?, ?)');
    const from = SOURCES.includes(source) ? source : 'manual';
    insert.run(modelId, found.id, from);
    if (found.parent_id) insert.run(modelId, found.parent_id, from);
  })();
  return modelCategoryNames(modelId);
}

/**
 * The Edit dialog's and history's form: names (a Category and a Subcategory, or one of them); the
 * Subcategory decides. Answers the model's names.
 */
function setModelCategories(modelId, names, source = 'manual') {
  const list = listCategories();
  const found = (Array.isArray(names) ? names : []).map((name) => findCategory(name, list)).filter(Boolean);
  const pick = found.find((c) => c.parent_id) || found[0] || null;
  return setModelPlace(modelId, pick ? pick.name : null, source);
}

/** The "Other …" Subcategory of a Category (the place for what fits no other), or null. */
function otherOf(main, list) {
  return list.find((c) => c.parent_id === main.id && /^other\b/i.test(c.name)) || null;
}

/**
 * The best match of the list's words in `texts`: the longest phrase wins (ties: list order).
 * Answers the row, or null.
 */
function bestWordMatch(texts, list) {
  /** @type {any} */
  let best = null;
  let bestLength = 0;
  for (const category of list) {
    for (const phrase of [category.name, ...category.keywords]) {
      const length = words(phrase).length;
      if (length <= bestLength) continue;
      if (texts.some((text) => hasPhrase(text, phrase))) {
        best = category;
        bestLength = length;
      }
    }
  }
  return best;
}

/**
 * Where a model's own information puts it, without asking anyone: { category, subcategory, source }
 * (rows; subcategory null when only the Category is known), or null.
 * - `site`: the categories its site gives it (MakerWorld's are this list) are used first;
 * - with `words` (when no AI sorts the models), the list's words in its folders, tags and name.
 *
 * @param {{ siteCategories?: string[], filePath?: string, fileName?: string, tags?: string[] }} model
 * @param {any[]} list listCategories()
 * @param {{ words?: boolean }} [options]
 */
function freeMatches(model, list, { words: useWords = true } = {}) {
  const byId = new Map(list.map((c) => [c.id, c]));
  const placeOf = (row, source) => (row ? { category: row.parent_id ? byId.get(row.parent_id) : row, subcategory: row.parent_id ? row : null, source } : null);
  // The site's categories: a Subcategory beats a Category.
  const site = (model.siteCategories || []).map((raw) => findCategory(raw, list) || findCategory(SITE_SYNONYMS[normalize(raw)] || '', list)).filter(Boolean);
  const siteSub = site.find((c) => c.parent_id);
  if (siteSub || site.length) return placeOf(siteSub || site[0], 'site');
  if (!useWords) return null;
  const name = String(model.fileName || '').replace(/\.[a-z0-9]{2,5}$/i, '');
  const sources = [
    [folderTagsFromPath(model.filePath || '', 3), 'folder'],
    [model.tags || [], 'tag'],
    [name ? [name] : [], 'name']
  ];
  for (const [texts, source] of sources) {
    const found = texts.length ? bestWordMatch(texts, list) : null;
    if (!found) continue;
    // Only the Category: its Subcategories' words anywhere ("Warhammer/orc.stl": Miniatures › Creatures).
    const sub = found.parent_id
      ? null
      : bestWordMatch(
          sources.flatMap(([all]) => all),
          list.filter((c) => c.parent_id === found.id)
        );
    return placeOf(sub || found, source);
  }
  return null;
}

/**
 * The choices the AI is given: "Category > Subcategory" for every Subcategory (of `main` only, when given).
 * @param {any[]} list
 * @param {{ id: number } | null} [main]
 */
function aiChoices(list, main = null) {
  const byId = new Map(list.map((c) => [c.id, c]));
  return list.filter((c) => c.parent_id && (!main || c.parent_id === main.id)).map((c) => `${byId.get(c.parent_id).name} > ${c.name}`);
}

/** The AI's answer ("Toys & Games > Puzzles", "Puzzles", spelled loosely) as the Subcategory's row, or null. */
function matchAiCategory(answer, list) {
  const text = String(answer || '').trim();
  if (!text) return null;
  const subs = list.filter((c) => c.parent_id);
  const byId = new Map(list.map((c) => [c.id, c]));
  const key = normalize(text);
  const keyLoose = normalize(text.replace(/&/g, ' '));
  for (const sub of subs) {
    const main = byId.get(sub.parent_id);
    const full = normalize(`${main.name} ${sub.name}`);
    if (key === full || keyLoose === normalize(`${main.name} ${sub.name}`.replace(/&/g, ' '))) return sub;
  }
  // The Subcategory alone (their names are unique), or the part after the last ">".
  const last = text.split(/>|›|\/|:/).pop() || '';
  return findCategory(last, subs) || findCategory(text, subs);
}

/**
 * Where a model's place may be changed by the AI: none yet, a Category alone, or a guess from
 * words. A person's choice, the site's and an earlier AI pick stay (an AI run with `again`
 * changes the AI's too).
 */
function aiMayPlace(modelId, { again = false } = {}) {
  const place = modelPlace(modelId);
  if (!place.subcategory) return true;
  if (place.source === 'manual' || place.source === 'site') return false;
  if (place.source === 'ai') return again;
  return GUESSES.includes(place.source);
}

/**
 * For an AI request about a model: the choices to give it ("Category > Subcategory"), or null when
 * its place should not change (a person's choice, the site's, an earlier AI pick unless `again`).
 * A Category alone limits the choices to its Subcategories.
 */
function aiCategoryChoices(modelId, { again = false } = {}) {
  if (!aiMayPlace(modelId, { again })) return null;
  const list = listCategories();
  const place = modelPlace(modelId);
  const main = place.category && !place.subcategory ? findCategory(place.category, list) : null;
  return aiChoices(list, main);
}

/** Save the AI's answer as the model's place (source 'ai'). Answers the Subcategory's name, or null when it named none. */
function saveAiCategory(modelId, answer) {
  const list = listCategories();
  const sub = matchAiCategory(answer, list);
  if (!sub) return null;
  setModelPlace(modelId, sub.name, 'ai');
  return sub.name;
}

module.exports = {
  aiCategoryChoices,
  saveAiCategory,
  CATEGORY_LIST,
  GUESSES,
  SITE_SYNONYMS,
  SOURCES,
  aiChoices,
  aiMayPlace,
  categoryTree,
  ensureTables,
  findCategory,
  freeMatches,
  hasPhrase,
  listCategories,
  matchAiCategory,
  modelCategoryNames,
  modelPlace,
  normalize,
  otherOf,
  setModelCategories,
  setModelPlace,
  uncategorizedCount,
  updateCategory
};

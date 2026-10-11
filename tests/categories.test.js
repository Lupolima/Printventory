'use strict';

// Categories: the fixed list of Categories and Subcategories, a model's one place, what a model's
// own information points to, the AI's answers, searching, the update from the older list, and
// Categorize Library.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const database = require('../src/core/database');
const categories = require('../src/core/categories');
const { CATEGORY_LIST } = require('../src/core/category-list');
const aitagging = require('../src/core/aitagging');
const { buildModelFilterConditions } = require('../src/core/model-filters');

const SCHEMA = `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE models (id INTEGER PRIMARY KEY, filePath TEXT UNIQUE, fileName TEXT, designer TEXT, license TEXT, parentModel TEXT, source TEXT, notes TEXT,
    rating INTEGER DEFAULT 0, favorite INTEGER DEFAULT 0, print_status TEXT DEFAULT 'unprinted', printed INTEGER, print_count INTEGER DEFAULT 0, last_printed_at TEXT,
    thumbnail TEXT, isNew INTEGER, dateAdded TEXT, size INTEGER, hash TEXT, modifiedDate TEXT, bundleKey TEXT, bundleLabel TEXT, bundleKind TEXT);
  CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT UNIQUE);
  CREATE TABLE model_tags (model_id INTEGER, tag_id INTEGER);
`;

async function main() {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-categories-')));

  // --- The update from the older list (one level, several per model) ---
  database.db = new Database(path.join(tmp, 'old.db'));
  database.db.exec(SCHEMA);
  database.db.exec(`
    CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE, keywords TEXT, position INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE model_categories (model_id INTEGER NOT NULL, category_id INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'manual', PRIMARY KEY (model_id, category_id));
    INSERT INTO categories (id, name, position) VALUES (1, 'Toys & Games', 0), (2, 'Art', 1), (3, 'Lighting', 2), (4, 'Puzzles', 3);
    INSERT INTO settings VALUES ('categoriesSeeded', '1');
    INSERT INTO models (id, filePath, fileName) VALUES (1, '/l/a.stl', 'a.stl'), (2, '/l/b.stl', 'b.stl'), (3, '/l/c.stl', 'c.stl'), (4, '/l/d.stl', 'd.stl');
    INSERT INTO model_categories VALUES (1, 1, 'manual'), (1, 2, 'manual'), (2, 2, 'site'), (3, 3, 'manual'), (4, 4, 'manual');
  `);
  let list = categories.listCategories();
  assert.strictEqual(list.filter((c) => !c.parent_id).length, 11, 'eleven Categories');
  assert.strictEqual(
    list.filter((c) => c.parent_id).length,
    CATEGORY_LIST.reduce((n, c) => n + c.subcategories.length, 0)
  );
  assert.ok(!list.some((c) => c.name === 'Lighting'), 'categories not on the list go');
  assert.strictEqual(list.find((c) => c.name === 'Toys & Games').id, 1, 'categories on the list keep their ids');
  assert.deepStrictEqual(
    categories.modelCategoryNames(1),
    ['Art'],
    "a person's Category stays (the first in the list: one per model), waiting for its Subcategory"
  );
  assert.deepStrictEqual(categories.modelCategoryNames(2), [], 'other places go: every model is sorted again');
  assert.deepStrictEqual(categories.modelCategoryNames(3), [], 'a place on a category that went goes with it');
  assert.deepStrictEqual(categories.modelCategoryNames(4), ['Toys & Games', 'Puzzles'], 'a Subcategory a person chose stays, with its Category');
  assert.strictEqual(database.db.prepare("SELECT value FROM settings WHERE key = 'categoriesResort'").get().value, '1');
  assert.strictEqual(categories.uncategorizedCount(), 3, 'models without a Subcategory');
  database.db.close();

  // --- A new library ---
  database.db = new Database(path.join(tmp, 'test.db'));
  database.db.exec(SCHEMA);
  const add = (filePath, extra = {}) =>
    Number(
      database.db
        .prepare('INSERT INTO models (filePath, fileName, source, thumbnail) VALUES (?, ?, ?, ?)')
        .run(filePath, extra.fileName || path.basename(filePath), extra.source || null, extra.thumbnail || null).lastInsertRowid
    );
  list = categories.listCategories();
  const tree = categories.categoryTree(list);
  assert.deepStrictEqual(
    tree.map((c) => c.name),
    CATEGORY_LIST.map((c) => c.name)
  );
  assert.deepStrictEqual(
    tree.find((c) => c.name === '3D Printer').subcategories.map((c) => c.name),
    ['3D Printer Accessories', '3D Printer Parts', 'Test Models']
  );
  const art = list.find((c) => c.name === 'Art');
  categories.updateCategory(art.id, { keywords: 'art, artwork, mural' });
  assert.deepStrictEqual(categories.listCategories().find((c) => c.name === 'Art').keywords, ['art', 'artwork', 'mural'], 'the words can change');

  // --- A model's one place ---
  const vase = add('/l/Vase.stl');
  assert.deepStrictEqual(categories.setModelPlace(vase, 'puzzles'), ['Toys & Games', 'Puzzles'], 'a Subcategory brings its Category');
  assert.deepStrictEqual(categories.setModelCategories(vase, ['Household', 'Decor']), ['Household', 'Decor'], 'the place replaces the one before');
  assert.deepStrictEqual(categories.setModelCategories(vase, ['Art']), ['Art'], 'a Category alone');
  assert.deepStrictEqual(categories.setModelCategories(vase, ['Nope']), [], 'not on the list: no place');
  categories.setModelPlace(vase, 'Decor');
  assert.deepStrictEqual(categories.modelPlace(vase), { category: 'Household', subcategory: 'Decor', source: 'manual' });
  const counts = categories.listCategories();
  assert.strictEqual(counts.find((c) => c.name === 'Household').model_count, 1);
  assert.strictEqual(counts.find((c) => c.name === 'Decor').model_count, 1);

  // --- What a model's own information points to ---
  list = categories.listCategories();
  const where = (model, options) => {
    const found = categories.freeMatches(model, list, options);
    return found ? `${found.category.name} > ${found.subcategory ? found.subcategory.name : '-'} (${found.source})` : null;
  };
  assert.strictEqual(
    where({ siteCategories: ['Construction Sets', 'Toys & Games'], filePath: '/l/Art/x.stl' }),
    'Toys & Games > Construction Sets (site)',
    "MakerWorld's own"
  );
  assert.strictEqual(where({ siteCategories: ['Costumes & Accessories'] }), 'Props & Cosplays > - (site)', "Printables' names map to the list");
  assert.strictEqual(where({ siteCategories: ['Test Models'] }), '3D Printer > Test Models (site)');
  assert.strictEqual(
    where({ filePath: '/library/Warhammer Minis/orc.stl', fileName: 'orc.stl' }),
    'Miniatures > Creatures (folder)',
    'the Category from the folder, its Subcategory from the name'
  );
  assert.strictEqual(where({ filePath: '/library/misc/a.stl', tags: ['Gridfinity'] }), 'Tools > Organizers (tag)');
  assert.strictEqual(where({ filePath: '/library/misc/Flower Vases.3mf', fileName: 'Flower Vases.3mf' }), 'Household > Decor (name)', 'plurals count');
  assert.strictEqual(
    where({ filePath: '/library/misc/Make My Sign - Garage.3mf', fileName: 'Make My Sign - Garage.3mf' }),
    'Generative 3D Model > Make My Sign (name)'
  );
  assert.strictEqual(
    where({ filePath: '/library/Bambu A1 Mini/part.stl', fileName: 'part.stl' }),
    '3D Printer > 3D Printer Parts (folder)',
    '"A1 Mini" is not a miniature'
  );
  assert.strictEqual(where({ filePath: '/library/Starship/propeller.stl', fileName: 'propeller.stl' }), null, 'whole words only');
  assert.strictEqual(where({ filePath: '/l/x/Benchy.stl', fileName: 'Benchy.stl' }, { words: false }), null, 'with the AI, words are not used');
  assert.ok(categories.hasPhrase('Dungeons & Dragons', 'dungeons and dragons'));

  // --- The AI's choices and answers ---
  const choices = categories.aiChoices(list);
  assert.ok(choices.includes('Toys & Games > Puzzles') && choices.includes('Generative 3D Model > Make My Lantern') && !choices.includes('Art'));
  assert.deepStrictEqual(
    categories.aiChoices(
      list,
      list.find((c) => c.name === '3D Printer')
    ),
    ['3D Printer > 3D Printer Accessories', '3D Printer > 3D Printer Parts', '3D Printer > Test Models']
  );
  const answer = (text) => (categories.matchAiCategory(text, list) || {}).name || null;
  assert.strictEqual(answer('Toys & Games > Puzzles'), 'Puzzles');
  assert.strictEqual(answer('toys games puzzles'), 'Puzzles', "AI Tagging's spelling");
  assert.strictEqual(answer('Puzzles'), 'Puzzles');
  assert.strictEqual(answer('Household › Other House Models'), 'Other House Models');
  assert.strictEqual(answer('Spaceships'), null);
  assert.strictEqual(aitagging.parseCategoryFromResponse('```json\n{"tags": ["Dragon"], "category": "Miniatures > Creatures"}\n```'), 'Miniatures > Creatures');
  assert.strictEqual(
    aitagging.parseCategoryFromResponse('{"tags": ["Dragon"], "category": "Miniatures > Creatures"'),
    'Miniatures > Creatures',
    'a cut-off answer'
  );
  assert.deepStrictEqual(
    aitagging.parseTagsFromResponse('{"tags": ["Dragon"], "category": "Miniatures > Creatures"}', true),
    ['dragon'],
    'the tags are the tags'
  );

  // Who the AI may place: not a person's choice, not the site's; a guess from words yes.
  const guessed = add('/l/Guess.stl');
  categories.setModelPlace(guessed, 'Decor', 'name');
  assert.ok(categories.aiCategoryChoices(guessed));
  assert.strictEqual(categories.aiCategoryChoices(vase), null, "a person's choice stays");
  categories.setModelPlace(guessed, 'Decor', 'ai');
  assert.strictEqual(categories.aiCategoryChoices(guessed), null, 'an AI pick stays');
  assert.ok(categories.aiCategoryChoices(guessed, { again: true }), '... unless again (retagging)');
  assert.strictEqual(categories.saveAiCategory(guessed, 'Tools > Hand Tools'), 'Hand Tools');
  assert.deepStrictEqual(categories.modelPlace(guessed), { category: 'Tools', subcategory: 'Hand Tools', source: 'ai' });
  assert.strictEqual(categories.saveAiCategory(guessed, 'nonsense'), null);
  database.db.prepare('DELETE FROM models WHERE id = ?').run(guessed);
  assert.strictEqual(database.db.prepare('SELECT COUNT(*) AS n FROM model_categories WHERE model_id = ?').get(guessed).n, 0, 'removed with the model');

  // --- Searching: by Category or Subcategory ---
  const found = (value) => {
    const { conditions, params } = buildModelFilterConditions({ searchTokens: [{ t: 'clause', field: 'category', value }] });
    return database.db
      .prepare(`SELECT fileName FROM models ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY fileName`)
      .all(...params)
      .map((r) => r.fileName);
  };
  assert.deepStrictEqual(found('Household'), ['Vase.stl']);
  assert.deepStrictEqual(found('Decor'), ['Vase.stl']);
  assert.deepStrictEqual(found('Art'), [], 'a full name matches only that one');

  // --- Categorize Library ---
  const scan = require('../src/server/category-scan');
  const picture = 'data:image/png;base64,iVBORw0KGgo=';
  const site = add('url::https://makerworld.com/en/models/1246678', { fileName: 'VOLTRON' });
  const folder = add('/l/Cosplay/helmet.stl');
  const tagged = add('/l/misc/thing.stl');
  database.db.prepare("INSERT INTO tags (id, name) VALUES (1, 'gridfinity')").run();
  database.db.prepare('INSERT INTO model_tags (model_id, tag_id) VALUES (?, 1)').run(tagged);
  const forAi = add('/l/misc/0042.stl', { thumbnail: picture });
  const noPicture = add('/l/misc/0043.stl');
  const onlyMain = add('/l/misc/Prop thing.stl');
  let fetched = 0;
  const fetchImpl = async (url) => {
    fetched++;
    assert.match(url, /design\/1246678/);
    return new Response(
      JSON.stringify({ id: 1246678, title: 'VOLTRON', categories: [{ name: 'Construction Sets' }, { name: 'Toys & Games' }], instances: [] })
    );
  };

  // Without the AI: the site's, then the list's words ("Other …" when only the Category is clear).
  scan.start({ useAi: false }, { fetchImpl });
  assert.strictEqual(scan.start({}), null, 'one run at a time');
  await scan._job().promise;
  let done = scan.snapshot();
  assert.deepStrictEqual(done.placed, { site: 1, folder: 1, tag: 1, name: 1 }, JSON.stringify(done.placed));
  assert.strictEqual(done.left, 2);
  assert.strictEqual(fetched, 1);
  assert.deepStrictEqual(categories.modelCategoryNames(site), ['Toys & Games', 'Construction Sets']);
  assert.deepStrictEqual(categories.modelCategoryNames(folder), ['Props & Cosplays', 'Masks & Helmets']);
  assert.deepStrictEqual(categories.modelCategoryNames(tagged), ['Tools', 'Organizers']);
  assert.deepStrictEqual(categories.modelCategoryNames(onlyMain), ['Props & Cosplays', 'Other Props & Cosplays'], 'only the Category is clear: "Other …"');
  assert.deepStrictEqual(categories.modelCategoryNames(forAi), []);
  scan.dismiss();

  // With the AI: the models left and the guesses from words; the site's and a person's stay.
  const asked = [];
  const ask = async (base64, options, filePath) => {
    asked.push(filePath);
    assert.ok(options.categoryChoices.includes('Miniatures > Creatures'));
    return Object.assign(['Dragon'], { category: filePath.endsWith('0042.stl') ? 'Miniatures > Creatures' : 'not a category' });
  };
  scan.start({ useAi: true }, { fetchImpl, ask });
  await scan._job().promise;
  done = scan.snapshot();
  assert.deepStrictEqual(asked.sort(), ['/l/misc/0042.stl'], 'only models with a picture are asked');
  assert.strictEqual(done.noPicture, 4, 'the others have no picture (guesses keep their place)');
  assert.deepStrictEqual(categories.modelCategoryNames(forAi), ['Miniatures', 'Creatures'], 'saved straight away');
  assert.strictEqual(categories.modelPlace(forAi).source, 'ai');
  assert.deepStrictEqual(done.aiPlaced, [{ filePath: '/l/misc/0042.stl', fileName: '0042.stl', category: 'Miniatures', subcategory: 'Creatures' }]);
  assert.deepStrictEqual(categories.modelCategoryNames(site), ['Toys & Games', 'Construction Sets'], "the site's stays");
  assert.deepStrictEqual(categories.modelCategoryNames(noPicture), []);
  assert.strictEqual(categories.uncategorizedCount(), 1);
  assert.strictEqual(scan.dismiss(), true);
  assert.strictEqual(scan.snapshot(), null);

  // A person's Category alone limits the AI to its Subcategories.
  categories.setModelPlace(noPicture, 'Tools');
  database.db.prepare('UPDATE models SET thumbnail = ? WHERE id = ?').run(picture, noPicture);
  const limited = [];
  scan.start(
    { useAi: true },
    { fetchImpl, ask: async (b, options) => (limited.push(options.categoryChoices), Object.assign([], { category: 'Tools > Hand Tools' })) }
  );
  await scan._job().promise;
  assert.ok(
    limited.some((c) => c.length === 7 && c.every((choice) => choice.startsWith('Tools > '))),
    JSON.stringify(limited)
  );
  assert.deepStrictEqual(categories.modelCategoryNames(noPicture), ['Tools', 'Hand Tools']);
  scan.dismiss();

  // The sort after an update runs once, without the AI.
  database.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('categoriesResort', '1')").run();
  assert.strictEqual(await scan.resortIfPending(), true);
  assert.strictEqual(await scan.resortIfPending(), false, 'once');
  scan.dismiss();

  database.db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('categories tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

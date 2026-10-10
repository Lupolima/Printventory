'use strict';

// The AI searches (src/server/ai-search.js, src/server/ai-ask.js) and More like this (geometry-job.js lookAlikes).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const database = require('../src/core/database');
const { askAi, parseList } = require('../src/server/ai-ask');
const search = require('../src/server/ai-search');
const { shapeDistance } = require('../src/core/geometry-signature');

/** An OpenAI-like client that records what it was asked and answers `reply`. */
function fakeClient(reply) {
  const asked = [];
  return {
    asked,
    chat: { completions: { create: async (body) => (asked.push(body), { choices: [{ message: { content: reply } }] }) } }
  };
}

/** A box from (0,0,0) to (x,y,z) as binary STL. */
function box(x, y, z) {
  const v = [
    [0, 0, 0],
    [x, 0, 0],
    [x, y, 0],
    [0, y, 0],
    [0, 0, z],
    [x, 0, z],
    [x, y, z],
    [0, y, z]
  ];
  const quads = [
    [0, 3, 2, 1],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7]
  ];
  const list = quads.flatMap(([a, b, c, d]) => [
    [v[a], v[b], v[c]],
    [v[a], v[c], v[d]]
  ]);
  const buf = Buffer.alloc(84 + list.length * 50);
  buf.writeUInt32LE(list.length, 80);
  list.forEach((tri, i) => tri.forEach((p, j) => p.forEach((n, k) => buf.writeFloatLE(n, 84 + i * 50 + 12 + j * 12 + k * 4))));
  return buf;
}

async function main() {
  // The geometry worker does not keep Node running (the server does); the test must, while it waits.
  const keepAlive = setInterval(() => {}, 1000);
  // --- Asking the AI service ---
  const openai = { aiService: 'openai', apiKey: 'k', aiModel: 'gpt-test' };
  const client = fakeClient('Sure: ["holder", "dock"]');
  assert.strictEqual(await askAi('hello', { aiSettings: openai, client, image: 'data:image/png;base64,AAAA' }), 'Sure: ["holder", "dock"]');
  assert.deepStrictEqual(client.asked[0].messages[0].content[1], { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } });
  assert.strictEqual(client.asked[0].model, 'gpt-test');
  await assert.rejects(askAi('x', { aiSettings: { aiService: 'openai' } }), /no API key/);
  await assert.rejects(askAi('x', { aiSettings: { aiService: 'puter' } }), /browser/);
  let puterAsked = null;
  const puterHandler = async (prompt, image) => ((puterAsked = { prompt, image }), { message: { content: '["a"]' } });
  assert.strictEqual(await askAi('p', { aiSettings: { aiService: 'puter' }, puterHandler, image: 'data:image/png;base64,B' }), '["a"]');
  assert.strictEqual(puterAsked.image, 'data:image/png;base64,B');
  assert.deepStrictEqual(parseList('```json\n["x", 2]\n```'), ['x', '2']);
  assert.throws(() => parseList('no list'), /did not answer with a list/);

  // --- Search by meaning: the search's own words first, then the AI's, cleaned ---
  const meaning = fakeClient('["Phone holder", "stand", "dock", "dock", "a", "\\"cradle\\"", "xxx"]');
  const words = await search.searchWordsForMeaning('  phone   stand ', { aiSettings: openai, client: meaning });
  assert.deepStrictEqual(words, ['phone stand', 'Phone holder', 'stand', 'dock', 'cradle', 'xxx']);
  assert.match(meaning.asked[0].messages[0].content, /"phone stand"/);
  await assert.rejects(search.searchWordsForMeaning('   ', { aiSettings: openai, client: meaning }), /Type what/);
  assert.strictEqual(search.cleanWords(Array.from({ length: 30 }, (_, i) => `w${i}`)).length, search.MAX_WORDS);

  // --- Search with a photo ---
  const photo = fakeClient('["knob", "drawer pull"]');
  assert.deepStrictEqual(await search.searchWordsForPhoto('data:image/jpeg;base64,/9j/AA==', { aiSettings: openai, client: photo }), ['knob', 'drawer pull']);
  assert.strictEqual(photo.asked[0].messages[0].content[1].image_url.url, 'data:image/jpeg;base64,/9j/AA==');
  await assert.rejects(search.searchWordsForPhoto('data:text/html;base64,AA==', { aiSettings: openai, client: photo }), /not a photo/);
  await assert.rejects(search.searchWordsForPhoto('data:image/png;base64,AA==', { aiSettings: openai, client: fakeClient('[]') }), /could not tell/);

  // --- More like this: the same shape at another size is close, another shape is not ---
  const cube = { spreads: [5, 5, 5], shape: [0.5, 0.5] };
  assert.strictEqual(shapeDistance(cube, { spreads: [10, 10, 10], shape: [0.5, 0.5] }), 0);
  assert.ok(shapeDistance(cube, { spreads: [20, 5, 5], shape: [0.2, 0.8] }) > 0.45);
  assert.strictEqual(shapeDistance(cube, null), Infinity);

  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-alike-')));
  database.db = new Database(path.join(tmp, 'test.db'));
  database.db.exec(
    'CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE models (id INTEGER PRIMARY KEY, filePath TEXT UNIQUE, fileName TEXT, thumbnail TEXT, size INTEGER, hash TEXT); CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT); CREATE TABLE model_tags (model_id INTEGER, tag_id INTEGER)'
  );
  const files = { 'cube.stl': box(10, 10, 10), 'big cube.stl': box(30, 30, 30), 'tall.stl': box(10, 10, 60) };
  for (const [name, data] of Object.entries(files)) {
    fs.writeFileSync(path.join(tmp, name), data);
    database.db.prepare('INSERT INTO models (filePath, fileName) VALUES (?, ?)').run(path.join(tmp, name), name);
  }
  database.db.prepare("INSERT INTO models (filePath, fileName) VALUES ('url::https://x', 'online')").run();
  const job = require('../src/server/geometry-job');
  // Nothing measured yet: this model is measured now, the others are counted as not compared.
  const first = await job.lookAlikes(path.join(tmp, 'cube.stl'));
  assert.deepStrictEqual(first.models, []);
  assert.strictEqual(first.unmeasured, 2);
  job.start();
  while (job.status().running) await new Promise((resolve) => setTimeout(resolve, 50));
  const found = await job.lookAlikes(path.join(tmp, 'cube.stl'));
  assert.deepStrictEqual(
    found.models.map((m) => m.fileName),
    ['big cube.stl'],
    'the bigger cube looks alike, the tall box does not'
  );
  assert.strictEqual(found.unmeasured, 0);
  assert.match((await job.lookAlikes('url::https://x')).reason, /online model/);
  await assert.rejects(job.lookAlikes('/nope.stl'), /not in the library/);

  job.stop();
  database.db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  clearInterval(keepAlive);
  console.log('ai-search tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

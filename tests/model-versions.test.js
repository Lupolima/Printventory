'use strict';

// Version history (src/server/model-versions.js): earlier file versions, and the changes to a model's details.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

async function main() {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-versions-')));
  process.env.JUSTTPRINT_DB_PATH = path.join(tmp, 'data', 'test.db');
  fs.mkdirSync(path.join(tmp, 'data'));
  const database = require('../src/core/database');
  database.db = new Database(process.env.JUSTTPRINT_DB_PATH);
  database.db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE models (id INTEGER PRIMARY KEY, filePath TEXT UNIQUE, fileName TEXT, designer TEXT, source TEXT, parentModel TEXT, license TEXT, notes TEXT,
      rating INTEGER DEFAULT 0, size INTEGER, modifiedDate TEXT, hash TEXT);
    CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT); CREATE TABLE model_tags (model_id INTEGER, tag_id INTEGER);
  `);
  const history = require('../src/server/model-versions');
  const lib = path.join(tmp, 'library');
  fs.mkdirSync(lib);
  const file = path.join(lib, 'Lion.stl');
  fs.writeFileSync(file, 'version one');
  const id = Number(
    database.db.prepare("INSERT INTO models (filePath, fileName, designer, size, hash) VALUES (?, 'Lion.stl', 'Ann', 11, 'h1')").run(file).lastInsertRowid
  );

  // --- Upload New Version ---
  const uploaded = path.join(lib, 'Lion (2).stl');
  fs.writeFileSync(uploaded, 'version two, longer');
  let list = history.replaceWithUpload(file, uploaded, { by: 'ace', note: 'thicker walls' });
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'version two, longer', 'the new file takes the place of the old one');
  assert.ok(!fs.existsSync(uploaded));
  assert.strictEqual(list.versions.length, 1);
  assert.deepStrictEqual(
    [list.versions[0].fileName, list.versions[0].size, list.versions[0].createdBy, list.versions[0].note],
    ['Lion.stl', 11, 'ace', 'thicker walls']
  );
  const row = database.db.prepare('SELECT size, hash FROM models WHERE id = ?').get(id);
  assert.deepStrictEqual(row, { size: 19, hash: null }, 'the size is new, the hash is worked out again');

  // Checked: same folder, same type, not another model.
  fs.writeFileSync(path.join(lib, 'other.3mf'), 'x');
  assert.throws(() => history.replaceWithUpload(file, path.join(lib, 'other.3mf')), /must be a \.stl file/);
  assert.ok(!fs.existsSync(path.join(lib, 'other.3mf')), 'an upload of the wrong type is removed');
  fs.mkdirSync(path.join(lib, 'sub'));
  fs.writeFileSync(path.join(lib, 'sub', 'x.stl'), 'x');
  assert.throws(() => history.replaceWithUpload(file, path.join(lib, 'sub', 'x.stl')), /model’s folder/);
  assert.throws(() => history.replaceWithUpload(file, file), /own file/);
  assert.throws(() => history.replaceWithUpload('url::https://x', uploaded), /not in the library/);

  // --- Download and put back ---
  const copy = history.versionDownload(list.versions[0].id).filePath;
  assert.match(path.basename(copy), /^justtprint-version-.+-Lion\.stl$/);
  assert.strictEqual(fs.readFileSync(copy, 'utf8'), 'version one');
  list = history.restoreVersion(list.versions[0].id, { by: 'ace' });
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'version one');
  assert.strictEqual(list.versions.length, 1, 'the file it replaced is kept instead');
  assert.match(list.versions[0].note, /Before putting back/);
  assert.deepStrictEqual(history.deleteVersion(list.versions[0].id), { deleted: true });
  assert.strictEqual(history.listVersions(file).versions.length, 0);

  // --- Changes to the details ---
  database.db.prepare("INSERT INTO tags (id, name) VALUES (1, 'lion')").run();
  await history.tracking([id], 'ace', async () => {
    database.db.prepare("UPDATE models SET designer = 'Bob', rating = 4 WHERE id = ?").run(id);
    database.db.prepare('INSERT INTO model_tags VALUES (?, 1)').run(id);
  });
  const changes = history.listVersions(file).changes.map((c) => [c.field, c.oldValue, c.newValue, c.changedBy]);
  assert.deepStrictEqual(changes.sort(), [
    ['designer', 'Ann', 'Bob', 'ace'],
    ['rating', '0', '4', 'ace'],
    ['tags', '', 'lion', 'ace']
  ]);
  const designerChange = history.listVersions(file).changes.find((c) => c.field === 'designer');
  assert.deepStrictEqual(history.changeToUndo(designerChange.id), { modelId: id, filePath: file, field: 'designer', value: 'Ann' });
  await history.tracking([id], null, async () => {}); // nothing changed: nothing written
  assert.strictEqual(history.listVersions(file).changes.length, 3);

  // --- Every model's history (the History page) ---
  fs.writeFileSync(uploaded, 'version three');
  history.replaceWithUpload(file, uploaded, { by: 'ace' });
  const all = history.listAll();
  assert.strictEqual(all.entries.length, 4, 'three changes and one earlier file');
  assert.strictEqual(all.entries[0].kind, 'version', 'newest first');
  assert.deepStrictEqual(all.entries[0].model, { id, filePath: file, fileName: path.basename(file) });
  assert.strictEqual(all.more, false);
  const page = history.listAll({ limit: 2 });
  assert.strictEqual(page.entries.length, 2);
  assert.strictEqual(page.more, true);
  assert.strictEqual(
    history.listAll({ before: page.entries[1].at, limit: 10 }).entries.every((e) => e.at < page.entries[1].at),
    true,
    'older pages'
  );
  assert.deepStrictEqual(
    history.listAll({ search: 'bob' }).entries.map((e) => e.field),
    ['designer'],
    'searched'
  );

  // --- The space versions take, and keeping only the last few (Settings → Backup) ---
  for (const text of ['v4', 'v5', 'v6']) {
    fs.writeFileSync(uploaded, text);
    history.replaceWithUpload(file, uploaded);
  }
  let usage = history.versionsUsage();
  assert.deepStrictEqual([usage.files, usage.models, usage.keep], [4, 1, 0], 'all kept by default');
  assert.ok(usage.bytes > 0);
  const pruned = history.pruneAll(2);
  assert.strictEqual(pruned.deleted, 2);
  assert.strictEqual(history.versionsUsage().files, 2);
  assert.strictEqual(fs.readdirSync(history.versionsDir(id)).length, 2, 'their files are deleted too');
  database.db.prepare("INSERT OR REPLACE INTO settings VALUES ('versionsKeep', '1')").run();
  fs.writeFileSync(uploaded, 'v7');
  history.replaceWithUpload(file, uploaded);
  usage = history.versionsUsage();
  assert.deepStrictEqual([usage.files, usage.keep], [1, 1], 'a new version keeps only the last one');
  assert.strictEqual(fs.readdirSync(history.versionsDir(id)).length, 1, 'the older kept files are deleted');
  database.db.prepare("DELETE FROM settings WHERE key = 'versionsKeep'").run();

  // --- Folder notes and site details: written down by folder or link, listed with the rest ---
  assert.strictEqual(history.recordDetailChanges('folder', '/lib/Robot', 'Robot', { notes: 'old' }, { notes: 'old' }), 0, 'nothing changed');
  assert.strictEqual(history.recordDetailChanges('folder', '/lib/Robot', 'Robot', { notes: 'old' }, { notes: 'glue the head last' }, 'ace'), 1);
  assert.strictEqual(
    history.recordDetailChanges('site', 'https://makerworld.com/en/models/7', 'Cart', { title: 'Cart', tags: 'a' }, { title: 'AMS Cart', tags: 'a' }),
    1
  );
  const details = history.listAll({ search: 'robot' }).entries.filter((e) => e.kind === 'detail');
  assert.deepStrictEqual(
    details.map((e) => [e.scope, e.target, e.label, e.field, e.oldValue, e.newValue, e.by]),
    [['folder', '/lib/Robot', 'Robot', 'notes', 'old', 'glue the head last', 'ace']]
  );
  const siteChange = history.listAll({ search: 'ams cart' }).entries.find((e) => e.kind === 'detail');
  assert.deepStrictEqual(history.detailChangeToUndo(siteChange.id), {
    scope: 'site',
    target: 'https://makerworld.com/en/models/7',
    label: 'Cart',
    field: 'title',
    value: 'Cart'
  });
  assert.throws(() => history.detailChangeToUndo(99999), /gone/);

  // --- A model leaves the library: its history goes too ---
  fs.writeFileSync(uploaded, 'again');
  history.replaceWithUpload(file, uploaded);
  const dir = history.versionsDir(id);
  assert.ok(fs.readdirSync(dir).length);
  database.db.prepare('DELETE FROM models WHERE id = ?').run(id);
  assert.strictEqual(database.db.prepare('SELECT COUNT(*) AS n FROM model_changes').get().n, 0);
  assert.strictEqual(database.db.prepare('SELECT COUNT(*) AS n FROM model_versions').get().n, 0);

  database.db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('model-versions tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

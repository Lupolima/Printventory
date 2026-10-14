#!/usr/bin/env node
'use strict';

// Files moved outside JusttPrint keep their model (src/server/relink-moved.js).

const assert = require('assert');
const Database = require('better-sqlite3');
const { fileIsThere, findMovedModel, moveModel, sharedTail } = require('../src/server/relink-moved');

function test(name, fn) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err.message);
    process.exitCode = 1;
  }
}

function library(rows) {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE models (id INTEGER PRIMARY KEY, filePath TEXT UNIQUE, fileName TEXT, size INTEGER)');
  db.exec('CREATE TABLE site_files (file_path TEXT PRIMARY KEY, key TEXT)');
  for (const [id, filePath, size] of rows) db.prepare('INSERT INTO models VALUES (?, ?, ?, ?)').run(id, filePath, filePath.split(/::|\//).pop(), size);
  return db;
}
const onDisk =
  (...paths) =>
  (p) =>
    paths.includes(p);

test('a file in a new place takes the model whose file is gone', () => {
  const db = library([[1, '/mnt/models/Robots/arm.stl', 100]]);
  const file = { filePath: '/mnt/user/models/Robots/arm.stl', fileName: 'arm.stl', size: 100 };
  assert.deepStrictEqual(findMovedModel(db, file, onDisk(file.filePath)), { id: 1, filePath: '/mnt/models/Robots/arm.stl' });
});

test('not when the old file is still there, the size differs, or the size is unknown', () => {
  const db = library([[1, '/mnt/models/arm.stl', 100]]);
  assert.strictEqual(findMovedModel(db, { filePath: '/b/arm.stl', fileName: 'arm.stl', size: 100 }, onDisk('/mnt/models/arm.stl')), null, 'a copy');
  assert.strictEqual(findMovedModel(db, { filePath: '/b/arm.stl', fileName: 'arm.stl', size: 99 }, onDisk()), null);
  assert.strictEqual(findMovedModel(db, { filePath: '/b/arm.stl', fileName: 'arm.stl', size: null }, onDisk()), null);
});

test('of several, the one whose path ends the same way; a tie is left alone', () => {
  const db = library([
    [1, '/old/Robots/arm.stl', 100],
    [2, '/old/Cars/arm.stl', 100]
  ]);
  assert.strictEqual(findMovedModel(db, { filePath: '/new/Robots/arm.stl', fileName: 'arm.stl', size: 100 }, onDisk())?.id, 1);
  assert.strictEqual(findMovedModel(db, { filePath: '/new/Boats/arm.stl', fileName: 'arm.stl', size: 100 }, onDisk()), null);
});

test('ZIP entries follow their archive', () => {
  const db = library([[1, '/old/pack.zip::parts/arm.stl', 100]]);
  const file = { filePath: '/new/pack.zip::parts/arm.stl', fileName: 'arm.stl', size: 100 };
  assert.strictEqual(findMovedModel(db, file, onDisk('/new/pack.zip'))?.id, 1);
  assert.ok(fileIsThere('/old/pack.zip::parts/arm.stl', onDisk('/old/pack.zip')));
  assert.strictEqual(sharedTail('/old/pack.zip::parts/arm.stl', '/new/pack.zip::parts/arm.stl'), 3);
});

test('moving keeps the id and moves the site files', () => {
  const db = library([[7, '/old/arm.stl', 100]]);
  db.prepare("INSERT INTO site_files VALUES ('/old/arm.stl', 'mw:1')").run();
  moveModel(db, 7, '/old/arm.stl', '/new/arm.stl');
  assert.deepStrictEqual(db.prepare('SELECT id, filePath, fileName FROM models').get(), { id: 7, filePath: '/new/arm.stl', fileName: 'arm.stl' });
  assert.strictEqual(db.prepare('SELECT file_path FROM site_files').get().file_path, '/new/arm.stl');
});

#!/usr/bin/env node
'use strict';

// STL_HOME and the STL Home list (src/core/env-settings-apply.js applyStlHomeEnvIfNeeded).

const assert = require('assert');
const Database = require('better-sqlite3');
const database = require('../src/core/database');
const { applyStlHomeEnvIfNeeded } = require('../src/core/env-settings-apply');
const { readStlHomeDirectories } = require('../src/core/library-paths');

function test(name, fn) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err.message);
    process.exitCode = 1;
  }
}

function fresh(settings = {}) {
  database.db = new Database(':memory:');
  database.db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
  for (const [key, value] of Object.entries(settings)) database.db.prepare('INSERT INTO settings VALUES (?, ?)').run(key, value);
}
const setUi = (paths) => database.db.prepare("INSERT OR REPLACE INTO settings VALUES ('stlHomeDirectories', ?)").run(JSON.stringify(paths));
const setting = (key) => database.db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;

test('the first start fills the list from STL_HOME', () => {
  fresh();
  applyStlHomeEnvIfNeeded('/mnt/models,/mnt/archive');
  assert.deepStrictEqual(readStlHomeDirectories(), ['/mnt/models', '/mnt/archive']);
  assert.strictEqual(setting('stlHome'), '/mnt/models');
});

test('no STL_HOME leaves an empty list empty (the setup step asks)', () => {
  fresh();
  applyStlHomeEnvIfNeeded('');
  assert.deepStrictEqual(readStlHomeDirectories(), []);
});

test('later changes to STL_HOME are followed, and folders chosen in the web UI stay', () => {
  fresh();
  applyStlHomeEnvIfNeeded('/mnt/models');
  setUi(['/mnt/models', '/mnt/user/prints']);
  applyStlHomeEnvIfNeeded('/mnt/models');
  assert.deepStrictEqual(readStlHomeDirectories(), ['/mnt/models', '/mnt/user/prints'], 'nothing changed: nothing happens');
  applyStlHomeEnvIfNeeded('/mnt/models,/mnt/archive');
  assert.deepStrictEqual(readStlHomeDirectories(), ['/mnt/models', '/mnt/user/prints', '/mnt/archive'], 'a folder added to STL_HOME is added');
  applyStlHomeEnvIfNeeded('/mnt/archive');
  assert.deepStrictEqual(readStlHomeDirectories(), ['/mnt/user/prints', '/mnt/archive'], 'a folder taken out of STL_HOME is removed');
  applyStlHomeEnvIfNeeded('');
  assert.deepStrictEqual(readStlHomeDirectories(), ['/mnt/user/prints'], 'STL_HOME emptied: only the web UI folders are left');
});

test('a folder removed in the web UI does not come back while STL_HOME is unchanged', () => {
  fresh();
  applyStlHomeEnvIfNeeded('/mnt/models');
  setUi(['/mnt/user/prints']);
  applyStlHomeEnvIfNeeded('/mnt/models');
  assert.deepStrictEqual(readStlHomeDirectories(), ['/mnt/user/prints']);
});

test('an install from before 7.23.0 only records STL_HOME the first time', () => {
  fresh({ stlHomeDirectories: JSON.stringify(['/mnt/user/prints']) });
  applyStlHomeEnvIfNeeded('/mnt/models');
  assert.deepStrictEqual(readStlHomeDirectories(), ['/mnt/user/prints']);
  assert.strictEqual(setting('stlHomeFromEnv'), '["/mnt/models"]');
  applyStlHomeEnvIfNeeded('/mnt/models,/mnt/archive');
  assert.deepStrictEqual(readStlHomeDirectories(), ['/mnt/user/prints', '/mnt/archive']);
});

test('JUSTTPRINT_ENV_OVERRIDES_SETTINGS makes STL_HOME the whole list', () => {
  fresh({ stlHomeDirectories: JSON.stringify(['/mnt/user/prints']) });
  process.env.JUSTTPRINT_ENV_OVERRIDES_SETTINGS = '1';
  try {
    applyStlHomeEnvIfNeeded('/mnt/models');
  } finally {
    delete process.env.JUSTTPRINT_ENV_OVERRIDES_SETTINGS;
  }
  assert.deepStrictEqual(readStlHomeDirectories(), ['/mnt/models']);
});

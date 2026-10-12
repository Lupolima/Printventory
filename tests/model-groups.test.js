'use strict';

// Groups (src/server/model-groups.js): named groups of models, groups inside groups, kept in step with Parent Model.

const assert = require('assert');
const Database = require('better-sqlite3');

const database = require('../src/core/database');
database.db = new Database(':memory:');
database.db.exec(`
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE models (id INTEGER PRIMARY KEY, filePath TEXT UNIQUE, fileName TEXT, designer TEXT, source TEXT, notes TEXT, printed INTEGER DEFAULT 0,
    print_status TEXT, print_count INTEGER DEFAULT 0, last_printed_at TEXT, parentModel TEXT, hash TEXT, size INTEGER, license TEXT, modifiedDate TEXT,
    dateAdded TEXT, isNew INTEGER, rating INTEGER DEFAULT 0, favorite INTEGER DEFAULT 0, bundleKey TEXT, bundleLabel TEXT, bundleKind TEXT, thumbnail TEXT);
  CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT); CREATE TABLE model_tags (model_id INTEGER, tag_id INTEGER);
  CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT, parent_id INTEGER);
  CREATE TABLE model_categories (model_id INTEGER, category_id INTEGER);
`);
const groups = require('../src/server/model-groups');

const add = (fileName, extra = {}) =>
  Number(
    database.db
      .prepare('INSERT INTO models (filePath, fileName, designer, parentModel, size, print_status) VALUES (?, ?, ?, ?, ?, ?)')
      .run(`/lib/robot/${fileName}`, fileName, extra.designer || null, extra.parentModel || null, extra.size || 10, extra.status || null).lastInsertRowid
  );
const parentOf = (id) => database.db.prepare('SELECT parentModel FROM models WHERE id = ?').get(id).parentModel;

const head = add('Robot Head.stl', { designer: 'Ann', status: 'printed' });
const arm = add('Robot Arm.stl', { designer: 'Ann' });
const leg = add('Robot Leg.stl', { designer: 'Ann' });
const loose = add('Vase.stl');
const benchyA = add('Benchy A.stl', { parentModel: 'Benchy' });
const benchyB = add('Benchy B.stl', { parentModel: 'benchy ' });

// Models that already share a Parent Model are a group.
let found = groups.getGroup('Benchy');
assert.ok(found, 'a Parent Model is a group');
assert.deepStrictEqual(
  found.models.map((m) => m.id),
  [benchyA, benchyB],
  'the same name in any case and spacing'
);

// Name suggestions: the words the names share, the folder, the designer.
const names = groups.suggestNames([head, arm, leg]);
assert.strictEqual(names[0], 'Robot', 'the shared words come first');
assert.ok(names.includes('Ann set'), names.join(', '));

// Create Group: the models get its name as Parent Model.
const robot = groups.createGroup({ name: 'Robot Kit', modelIds: [head, arm, leg] });
assert.strictEqual(robot.name, 'Robot Kit');
assert.deepStrictEqual([head, arm, leg].map(parentOf), ['Robot Kit', 'Robot Kit', 'Robot Kit']);
assert.deepStrictEqual(robot.totals, { models: 3, size: 30, printed: 1 });
assert.strictEqual(robot.designer, 'Ann');
assert.throws(() => groups.createGroup({ name: 'robot kit', modelIds: [loose] }), /already a group named/);
assert.throws(() => groups.createGroup({ name: '  ', modelIds: [loose] }), /name/);

// A group inside a group: its models keep the top group's name.
const limbs = groups.createGroup({ name: 'Limbs', modelIds: [arm, leg], parentId: robot.id });
assert.deepStrictEqual(
  limbs.crumbs.map((c) => c.name),
  ['Robot Kit', 'Limbs']
);
assert.deepStrictEqual([parentOf(arm), parentOf(leg)], ['Robot Kit', 'Robot Kit']);
found = groups.getGroup(robot.id);
assert.deepStrictEqual(
  found.models.map((m) => m.id),
  [head],
  'its own models'
);
assert.deepStrictEqual(
  found.subgroups.map((g) => [g.name, g.modelCount]),
  [['Limbs', 2]]
);
assert.strictEqual(found.totals.models, 3, 'the totals count everything under it');
assert.deepStrictEqual(
  groups.groupOfModel(arm).crumbs.map((c) => c.name),
  ['Robot Kit', 'Limbs']
);

// Every group, with where it is.
assert.deepStrictEqual(
  groups.listGroups().map((g) => [g.path, g.modelCount]),
  [
    ['Benchy', 2],
    ['Robot Kit', 3],
    ['Robot Kit › Limbs', 2]
  ]
);

// A group cannot go inside itself.
assert.throws(() => groups.addToGroup(limbs.id, { groupIds: [robot.id] }), /inside itself/);

// Renaming a top group renames its models' Parent Model.
groups.updateGroup(robot.id, { name: 'Robot', description: 'A walking robot' });
assert.deepStrictEqual([head, arm, leg].map(parentOf), ['Robot', 'Robot', 'Robot']);
assert.strictEqual(groups.getGroup(robot.id).description, 'A walking robot');
assert.throws(() => groups.updateGroup(robot.id, { name: 'BENCHY' }), /already a group named/);

// Add and remove.
groups.addToGroup(robot.id, { modelIds: [loose] });
assert.strictEqual(parentOf(loose), 'Robot');
groups.removeFromGroup(limbs.id, [leg]);
assert.strictEqual(groups.groupOfModel(leg).id, robot.id, 'out of a group inside a group: into the group above');
groups.removeFromGroup(robot.id, [loose]);
assert.strictEqual(parentOf(loose), null, 'out of a top group: a single model again');
assert.strictEqual(groups.groupOfModel(loose), null);

// A Parent Model changed elsewhere (Edit, a 3MF) moves the model.
database.db.prepare('UPDATE models SET parentModel = ? WHERE id = ?').run('Benchy', head);
groups.reconcile();
assert.strictEqual(groups.groupOfModel(head).crumbs[0].name, 'Benchy');
database.db.prepare('UPDATE models SET parentModel = NULL WHERE id = ?').run(head);
groups.reconcile();
assert.strictEqual(groups.groupOfModel(head), null, 'a cleared Parent Model leaves the group');

// A whole group into another, then Ungroup: the groups inside move up.
const benchy = groups.findGroup('Benchy');
groups.addToGroup(robot.id, { groupIds: [benchy] });
assert.deepStrictEqual([benchyA, benchyB].map(parentOf), ['Robot', 'Robot'], 'a group moved in takes the top group name');
groups.ungroup(robot.id);
assert.strictEqual(groups.findGroup('Robot'), null);
assert.ok(groups.findGroup('Benchy'), 'the groups inside become top groups');
assert.ok(groups.findGroup('Limbs'));
assert.deepStrictEqual([benchyA, benchyB].map(parentOf), ['Benchy', 'Benchy']);
assert.deepStrictEqual([arm].map(parentOf), ['Limbs']);
assert.strictEqual(parentOf(leg), null, "the top group's own models are single models again");

// Empty groups go.
groups.removeFromGroup(groups.findGroup('Limbs'), [arm]);
assert.strictEqual(groups.findGroup('Limbs'), null);

console.log('model-groups: ok');

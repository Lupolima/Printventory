'use strict';

/**
 * Groups: models kept together under a name (a set, a multi-part print), with groups inside
 * groups. Made in Multi-edit (Create Group).
 *
 * `model_groups` holds the groups (name, description, the group each is in) and
 * `model_group_members` the group each model is in (one per model: the innermost). A top group's
 * name is kept on every model under it, in models.parentModel: the grid groups cards by it. Only
 * this module writes it (since 8.0 it is not a field people see or edit: the Title replaced it), and
 * reconcile() keeps the two in step.
 */

const path = require('path');
const database = require('../core/database');
const { MODEL_LIST_COLUMNS } = require('../core/models');
const { PLACE_COLUMNS } = require('../core/categories');

const MAX_NAME = 200;
/** At most this many models listed on a group page. */
const MAX_MODELS = 1000;
/** At most this many pictures in a group's gallery. */
const MAX_IMAGES = 24;

let readyFor = null;
function db() {
  const current = database.db;
  if (readyFor !== current) {
    current.exec(`
      CREATE TABLE IF NOT EXISTS model_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        parent_id INTEGER,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_model_groups_parent ON model_groups(parent_id);
      CREATE TABLE IF NOT EXISTS model_group_members (
        model_id INTEGER PRIMARY KEY,
        group_id INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_model_group_members_group ON model_group_members(group_id);
    `);
    readyFor = current;
  }
  return current;
}

const now = () => new Date().toISOString();
const clean = (name) =>
  String(name || '')
    .replace(/\s+/g, ' ')
    .trim();
const keyOf = (name) => clean(name).toLocaleLowerCase();
const ids = (list) => [...new Set((Array.isArray(list) ? list : []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];

/** The ids of the models at these paths (the library's cards know their paths). */
function idsOfPaths(filePaths) {
  const list = [...new Set((Array.isArray(filePaths) ? filePaths : []).filter((p) => typeof p === 'string' && p))];
  const out = [];
  for (let i = 0; i < list.length; i += 500) {
    const part = list.slice(i, i + 500);
    out.push(
      ...db()
        .prepare(`SELECT id FROM models WHERE filePath IN (${part.map(() => '?').join(',')})`)
        .all(...part)
        .map((row) => row.id)
    );
  }
  return out;
}

/** Model ids from `modelIds` and `filePaths` together. */
const modelsOf = (details) => ids([...(Array.isArray(details.modelIds) ? details.modelIds : []), ...idsOfPaths(details.filePaths)]);

function checkName(name) {
  const text = clean(name);
  if (!text) throw new Error('Give the group a name');
  if (text.length > MAX_NAME) throw new Error(`Group names are at most ${MAX_NAME} characters`);
  return text;
}

/** Every group, with lookups: by id, the groups in each, a group's top group and everything under it. */
function index() {
  const groups = db().prepare('SELECT id, name, parent_id AS parentId, description, created_at AS createdAt, updated_at AS updatedAt FROM model_groups').all();
  const byId = new Map(groups.map((group) => [group.id, group]));
  const children = new Map();
  for (const group of groups) {
    if (group.parentId == null) continue;
    if (!children.has(group.parentId)) children.set(group.parentId, []);
    children.get(group.parentId).push(group);
  }
  /** The groups from the top group down to this one. */
  const chain = (id) => {
    const out = [];
    const seen = new Set();
    for (let group = byId.get(id); group && !seen.has(group.id); group = group.parentId == null ? null : byId.get(group.parentId)) {
      seen.add(group.id);
      out.unshift(group);
    }
    return out;
  };
  const rootOf = (id) => chain(id)[0] || null;
  /** This group's id and the ids of every group inside it. */
  const subtree = (id) => {
    const out = [];
    const stack = [id];
    const seen = new Set();
    while (stack.length) {
      const next = stack.pop();
      if (seen.has(next)) continue;
      seen.add(next);
      out.push(next);
      for (const child of children.get(next) || []) stack.push(child.id);
    }
    return out;
  };
  const rootByName = (name) => groups.find((group) => group.parentId == null && keyOf(group.name) === keyOf(name)) || null;
  return { groups, byId, children, chain, rootOf, subtree, rootByName };
}

function insertGroup(name, parentId) {
  const at = now();
  const info = db().prepare('INSERT INTO model_groups (name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?)').run(name, parentId, at, at);
  return Number(info.lastInsertRowid);
}

const setMember = (modelId, groupId) =>
  db()
    .prepare('INSERT INTO model_group_members (model_id, group_id) VALUES (?, ?) ON CONFLICT(model_id) DO UPDATE SET group_id = excluded.group_id')
    .run(modelId, groupId);
const removeMember = (modelId) => db().prepare('DELETE FROM model_group_members WHERE model_id = ?').run(modelId);

function membersOf(groupIds) {
  if (!groupIds.length) return [];
  return db()
    .prepare(`SELECT model_id AS id FROM model_group_members WHERE group_id IN (${groupIds.map(() => '?').join(',')})`)
    .all(...groupIds)
    .map((row) => row.id);
}

/** Set the Parent Model of these models (their top group's name, or none). */
function setParentModel(modelIds, name) {
  const update = db().prepare('UPDATE models SET parentModel = ? WHERE id = ?');
  for (const id of modelIds) update.run(name || null, id);
}

/** Groups with no model in them or in any group inside them go. */
function pruneEmpty() {
  for (;;) {
    const idx = index();
    const counts = new Map(
      db()
        .prepare('SELECT group_id AS id, COUNT(*) AS n FROM model_group_members GROUP BY group_id')
        .all()
        .map((row) => [row.id, row.n])
    );
    const empty = idx.groups.filter((group) => idx.subtree(group.id).every((id) => !counts.get(id)));
    if (!empty.length) return;
    const remove = db().prepare('DELETE FROM model_groups WHERE id = ?');
    for (const group of empty) remove.run(group.id);
  }
}

/**
 * Bring the groups in step with the Parent Model of each model: a model with a Parent Model is
 * under the top group of that name (made when missing; a group inside it counts too), a model
 * without one is in no group. Groups left empty go.
 */
function reconcile() {
  const store = db();
  store.transaction(() => {
    store.prepare('DELETE FROM model_group_members WHERE model_id NOT IN (SELECT id FROM models)').run();
    store.prepare('DELETE FROM model_group_members WHERE group_id NOT IN (SELECT id FROM model_groups)').run();
    store.prepare('UPDATE model_groups SET parent_id = NULL WHERE parent_id IS NOT NULL AND parent_id NOT IN (SELECT id FROM model_groups)').run();
    const idx = index();
    const roots = new Map();
    for (const group of idx.groups) if (group.parentId == null && !roots.has(keyOf(group.name))) roots.set(keyOf(group.name), group.id);
    const rootFor = (name) => {
      let id = roots.get(keyOf(name));
      if (!id) {
        id = insertGroup(clean(name).slice(0, MAX_NAME), null);
        roots.set(keyOf(name), id);
      }
      return id;
    };
    const rows = store
      .prepare(
        `SELECT m.id, m.parentModel, gm.group_id AS groupId FROM models m
         LEFT JOIN model_group_members gm ON gm.model_id = m.id
         WHERE (m.parentModel IS NOT NULL AND TRIM(m.parentModel) != '') OR gm.group_id IS NOT NULL`
      )
      .all();
    for (const row of rows) {
      const wanted = clean(row.parentModel);
      if (!wanted) {
        removeMember(row.id);
        continue;
      }
      const root = row.groupId == null ? null : idx.rootOf(row.groupId);
      if (root && keyOf(root.name) === keyOf(wanted)) continue;
      setMember(row.id, rootFor(wanted));
    }
    pruneEmpty();
  })();
}

const tagsOf = (modelIds) => {
  if (!modelIds.length) return [];
  const names = new Map();
  for (let i = 0; i < modelIds.length; i += 500) {
    const part = modelIds.slice(i, i + 500);
    for (const row of db()
      .prepare(`SELECT DISTINCT t.name FROM model_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.model_id IN (${part.map(() => '?').join(',')})`)
      .all(...part)) {
      if (!names.has(row.name.toLowerCase())) names.set(row.name.toLowerCase(), row.name);
    }
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
};

/** A model's picture for a list: its card's (the cover, else its first picture). */
function imageOf(filePath) {
  try {
    const { loadThumbnailForModel } = require('../core/thumbnails');
    return require('./grid-thumbnails').gridImage(filePath, () => loadThumbnailForModel(filePath));
  } catch (_) {
    return null;
  }
}

/** A model's main picture at full size (the group's gallery). */
function fullImageOf(filePath) {
  try {
    const stored = require('../core/thumbnails').loadThumbnailForModel(filePath);
    const first = String(stored || '').split('::')[0];
    return first && first !== '3d.png' ? first : null;
  } catch (_) {
    return null;
  }
}

function modelRows(modelIds) {
  const out = [];
  for (let i = 0; i < modelIds.length && out.length < MAX_MODELS; i += 500) {
    const part = modelIds.slice(i, i + 500);
    out.push(
      ...db()
        .prepare(`SELECT ${MODEL_LIST_COLUMNS}, ${PLACE_COLUMNS} FROM models WHERE id IN (${part.map(() => '?').join(',')})`)
        .all(...part)
    );
  }
  return out
    .slice(0, MAX_MODELS)
    .sort((a, b) => String(a.fileName || '').localeCompare(String(b.fileName || ''), undefined, { numeric: true, sensitivity: 'base' }));
}

/** The value most of the models share ('' counts as none). */
function mostCommon(values) {
  const counts = new Map();
  for (const value of values) if (value) counts.set(value, (counts.get(value) || 0) + 1);
  /** @type {[any, number] | null} */
  let best = null;
  for (const [value, count] of counts) if (!best || count > best[1]) best = [value, count];
  return best ? best[0] : null;
}

const isPrinted = (row) => row.print_status === 'printed' || (!row.print_status && !!row.printed) || Number(row.print_count) > 0;

/**
 * A group's page (get-group): its name, description, where it is (the groups above it), the
 * groups inside it, its own models, and for everything under it the pictures, tags, totals and the
 * Category and Subcategory most of its models have. `ref` is a group id, or a top group's name.
 */
function getGroup(ref) {
  reconcile();
  const idx = index();
  const group = typeof ref === 'number' || /^\d+$/.test(String(ref)) ? idx.byId.get(Number(ref)) : idx.rootByName(String(ref || ''));
  if (!group) return null;
  const allIds = idx.subtree(group.id);
  const everyModel = membersOf(allIds);
  const own = new Set(membersOf([group.id]));
  const rows = modelRows(everyModel);
  const models = rows
    .filter((row) => own.has(row.id))
    .map((row) => ({
      ...row,
      image: row.filePath.startsWith('url::') ? null : imageOf(row.filePath)
    }));
  const images = [];
  for (const row of rows) {
    if (images.length >= MAX_IMAGES) break;
    const image = row.filePath.startsWith('url::') ? null : fullImageOf(row.filePath);
    if (image && !images.includes(image)) images.push(image);
  }
  const subgroups = (idx.children.get(group.id) || [])
    .map((child) => {
      const inside = membersOf(idx.subtree(child.id));
      const first = modelRows(inside.slice(0, 1))[0];
      return {
        id: child.id,
        name: child.name,
        modelCount: inside.length,
        image: first && !first.filePath.startsWith('url::') ? imageOf(first.filePath) : null
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const designers = [...new Set(rows.map((row) => clean(row.designer)).filter(Boolean))];
  const added = rows
    .map((row) => row.dateAdded)
    .filter(Boolean)
    .sort();
  return {
    id: group.id,
    name: group.name,
    description: group.description || null,
    parentId: group.parentId,
    crumbs: idx.chain(group.id).map((item) => ({ id: item.id, name: item.name })),
    subgroups,
    models,
    images,
    tags: tagsOf(everyModel),
    category: mostCommon(rows.map((row) => row.category)),
    subcategory: mostCommon(rows.map((row) => row.subcategory)),
    designer: designers.length === 1 ? designers[0] : null,
    dateAdded: added[0] || null,
    totals: {
      models: everyModel.length,
      size: rows.reduce((sum, row) => sum + (Number(row.size) || 0), 0),
      printed: rows.filter(isPrinted).length
    }
  };
}

/** Every group, with the groups above it ("Robot › Arms") and how many models are under it (Add to Group). */
function listGroups() {
  reconcile();
  const idx = index();
  const counts = new Map(
    db()
      .prepare('SELECT group_id AS id, COUNT(*) AS n FROM model_group_members GROUP BY group_id')
      .all()
      .map((row) => [row.id, row.n])
  );
  return idx.groups
    .map((group) => ({
      id: group.id,
      name: group.name,
      path: idx
        .chain(group.id)
        .map((item) => item.name)
        .join(' › '),
      modelCount: idx.subtree(group.id).reduce((sum, id) => sum + (counts.get(id) || 0), 0)
    }))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }));
}

/** A top group's id by its name (the grid's group cards know the name), or null. */
function findGroup(name) {
  reconcile();
  const group = index().rootByName(name);
  return group ? group.id : null;
}

function assertMovable(idx, groupIds, targetId) {
  for (const id of groupIds) {
    if (!idx.byId.has(id)) throw new Error('That group no longer exists');
    if (targetId != null && idx.subtree(id).includes(targetId)) throw new Error('A group cannot go inside itself or a group inside it');
  }
}

/** Put groups inside a group and give everything under them its top group's name. */
function moveGroupsInto(groupIds, targetId) {
  const move = db().prepare('UPDATE model_groups SET parent_id = ?, updated_at = ? WHERE id = ?');
  for (const id of groupIds) move.run(targetId, now(), id);
}

/** Give every model under a top group its name as Parent Model. */
function nameModelsUnder(rootId) {
  const idx = index();
  const root = idx.byId.get(rootId);
  if (!root) return;
  setParentModel(membersOf(idx.subtree(rootId)), root.name);
}

/**
 * Create Group (Multi-edit): a new group of these models and groups. With `parentId` it goes
 * inside that group; else it is a top group, and its name must not be another top group's.
 * @param {{ name?: string, modelIds?: number[], filePaths?: string[], groupIds?: number[], parentId?: number | null }} [details]
 */
function createGroup(details = {}) {
  const { name, groupIds, parentId } = details;
  reconcile();
  const text = checkName(name);
  const models = modelsOf(details);
  const groups = ids(groupIds);
  if (!models.length && !groups.length) throw new Error('Choose the models to group');
  let id;
  db().transaction(() => {
    const idx = index();
    const parent = parentId == null ? null : idx.byId.get(Number(parentId));
    if (parentId != null && !parent) throw new Error('That group no longer exists');
    if (!parent && idx.rootByName(text)) throw new Error(`There is already a group named ${text}. Add the models to it instead.`);
    assertMovable(idx, groups, parent ? parent.id : null);
    id = insertGroup(text, parent ? parent.id : null);
    for (const modelId of models) setMember(modelId, id);
    moveGroupsInto(groups, id);
    nameModelsUnder(index().rootOf(id).id);
    pruneEmpty();
  })();
  return getGroup(id);
}

/**
 * Change a group's name and/or description; a top group's new name becomes its models' Parent Model.
 * @param {number} id
 * @param {{ name?: string, description?: string | null }} [changes]
 */
function updateGroup(id, { name, description } = {}) {
  reconcile();
  db().transaction(() => {
    const idx = index();
    const group = idx.byId.get(Number(id));
    if (!group) throw new Error('That group no longer exists');
    if (name !== undefined) {
      const text = checkName(name);
      const other = group.parentId == null ? idx.rootByName(text) : null;
      if (other && other.id !== group.id) throw new Error(`There is already a group named ${text}`);
      db().prepare('UPDATE model_groups SET name = ?, updated_at = ? WHERE id = ?').run(text, now(), group.id);
      if (group.parentId == null) nameModelsUnder(group.id);
    }
    if (description !== undefined) {
      const text = String(description || '').trim();
      db()
        .prepare('UPDATE model_groups SET description = ?, updated_at = ? WHERE id = ?')
        .run(text || null, now(), group.id);
    }
  })();
  return getGroup(Number(id));
}

/**
 * Add models (from wherever they were) and groups to a group.
 * @param {number} id
 * @param {{ modelIds?: number[], filePaths?: string[], groupIds?: number[] }} [what]
 */
function addToGroup(id, what = {}) {
  const { groupIds } = what;
  reconcile();
  db().transaction(() => {
    const idx = index();
    const group = idx.byId.get(Number(id));
    if (!group) throw new Error('That group no longer exists');
    const groups = ids(groupIds);
    assertMovable(idx, groups, group.id);
    for (const modelId of modelsOf(what)) setMember(modelId, group.id);
    moveGroupsInto(groups, group.id);
    nameModelsUnder(idx.rootOf(group.id).id);
    pruneEmpty();
  })();
  return getGroup(Number(id));
}

/** Take models out of a group: into the group it is in, or (a top group) out of every group. */
function removeFromGroup(id, modelIds) {
  reconcile();
  let parentId = null;
  db().transaction(() => {
    const idx = index();
    const group = idx.byId.get(Number(id));
    if (!group) throw new Error('That group no longer exists');
    parentId = group.parentId;
    const own = new Set(membersOf([group.id]));
    const models = ids(modelIds).filter((modelId) => own.has(modelId));
    for (const modelId of models) {
      if (group.parentId != null) setMember(modelId, group.parentId);
      else removeMember(modelId);
    }
    if (group.parentId == null) setParentModel(models, null);
    pruneEmpty();
  })();
  return getGroup(Number(id)) || (parentId != null ? getGroup(parentId) : null);
}

/**
 * Ungroup: the group goes; its models and the groups inside it move up to the group it was in. A
 * top group's models become single models again and the groups inside it top groups (joining a
 * top group of the same name).
 */
function ungroup(id) {
  reconcile();
  let parentId = null;
  db().transaction(() => {
    const idx = index();
    const group = idx.byId.get(Number(id));
    if (!group) throw new Error('That group no longer exists');
    parentId = group.parentId;
    const own = membersOf([group.id]);
    const inside = idx.children.get(group.id) || [];
    if (group.parentId != null) {
      for (const modelId of own) setMember(modelId, group.parentId);
      moveGroupsInto(
        inside.map((child) => child.id),
        group.parentId
      );
    } else {
      for (const modelId of own) removeMember(modelId);
      setParentModel(own, null);
      for (const child of inside) {
        const same = idx.groups.find((other) => other.parentId == null && other.id !== group.id && keyOf(other.name) === keyOf(child.name));
        if (same) {
          for (const modelId of membersOf([child.id])) setMember(modelId, same.id);
          moveGroupsInto(
            (idx.children.get(child.id) || []).map((g) => g.id),
            same.id
          );
          db().prepare('DELETE FROM model_groups WHERE id = ?').run(child.id);
          nameModelsUnder(same.id);
        } else {
          moveGroupsInto([child.id], null);
          nameModelsUnder(child.id);
        }
      }
    }
    db().prepare('DELETE FROM model_groups WHERE id = ?').run(group.id);
    pruneEmpty();
  })();
  return { parentId: parentId != null && index().byId.has(parentId) ? parentId : null };
}

/** The group a model is in (innermost) and the groups above it, or null. */
function groupOfModel(modelId) {
  const row = db().prepare('SELECT group_id AS id FROM model_group_members WHERE model_id = ?').get(Number(modelId));
  if (!row) return null;
  const chain = index().chain(row.id);
  return chain.length ? { id: row.id, crumbs: chain.map((group) => ({ id: group.id, name: group.name })) } : null;
}

const stripType = (name) => String(name || '').replace(/\.[a-z0-9]{2,6}$/i, '');
const words = (text) =>
  stripType(text)
    .split(/[\s_.\-()[\]]+/)
    .filter(Boolean);

/** Name suggestions for a new group of these models (Create Group): what their names, folder, site or designer share. */
function suggestNames(modelIdsOrPaths) {
  const given = Array.isArray(modelIdsOrPaths) ? modelIdsOrPaths : [];
  const list = ids([...given.filter((v) => typeof v === 'number'), ...idsOfPaths(given.filter((v) => typeof v === 'string'))]);
  if (!list.length) return [];
  const rows = db()
    .prepare(`SELECT id, filePath, fileName, designer, source, parentModel FROM models WHERE id IN (${list.map(() => '?').join(',')})`)
    .all(...list);
  if (!rows.length) return [];
  const out = [];
  const add = (name) => {
    const text = clean(name).slice(0, MAX_NAME);
    if (text && text.length >= 2 && !out.some((other) => keyOf(other) === keyOf(text))) out.push(text);
  };
  // The words the names start with.
  const named = rows.map((row) => words(row.fileName || path.basename(row.filePath)));
  if (named.length > 1) {
    const first = named[0];
    let shared = 0;
    while (shared < first.length && named.every((w) => w[shared] && w[shared].toLowerCase() === first[shared].toLowerCase())) shared++;
    const prefix = first.slice(0, shared).join(' ');
    if (prefix.replace(/[^a-z]/gi, '').length >= 3) add(prefix);
  }
  // The site's title.
  try {
    const { siteTitleOf } = require('./site-details');
    for (const row of rows) {
      const title = siteTitleOf(row);
      if (title) {
        add(title);
        break;
      }
    }
  } catch (_) {
    /* no site details */
  }
  // The folder they share.
  const folders = rows.filter((row) => !row.filePath.startsWith('url::')).map((row) => path.dirname(row.filePath.split('::')[0]));
  if (folders.length === rows.length && new Set(folders).size === 1) add(path.basename(folders[0]));
  // A Parent Model most of them have.
  add(mostCommon(rows.map((row) => clean(row.parentModel))) || '');
  // The designer.
  const designers = [...new Set(rows.map((row) => clean(row.designer)).filter(Boolean))];
  if (designers.length === 1) add(`${designers[0]} set`);
  if (named.length === 1) add(named[0].join(' '));
  // Nothing shared: the names themselves.
  if (named.length === 2) add(`${named[0].join(' ')} and ${named[1].join(' ')}`);
  if (named.length > 2) add(`${named[0].join(' ')} and more`);
  return out.slice(0, 5);
}

module.exports = {
  reconcile,
  getGroup,
  listGroups,
  findGroup,
  createGroup,
  updateGroup,
  addToGroup,
  removeFromGroup,
  ungroup,
  groupOfModel,
  suggestNames
};

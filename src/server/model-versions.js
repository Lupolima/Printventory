'use strict';

/**
 * Version history of a model: earlier versions of its file, and the changes made to its details.
 *
 * File versions: Upload New Version puts a new file in the model's place (same path, so links,
 * collections, kits and print history stay) and keeps the one it replaces in versions/ next to
 * the database, by model. An earlier version can be downloaded, put back (the current file is
 * kept in its place) or deleted.
 *
 * Changes: each edit of a model's details (name, designer, source, parent model, license, notes,
 * tags, rating, categories) is written down with who made it and when; an old value can be put back.
 * So are changes that belong to a folder or a site link rather than one model (detail_changes):
 * a folder's notes (scope 'folder'), and the site details changed in the Edit dialog (scope 'site',
 * by the model's link, which models sharing the link share).
 */

const fs = require('fs');
const path = require('path');
const database = require('../core/database');
const { getDatabasePath } = require('../core/db-path');

/** The details whose changes are written down, and how each reads. */
const TRACKED = ['fileName', 'designer', 'source', 'parentModel', 'license', 'notes', 'description', 'tags', 'rating', 'categories'];
const MAX_VALUE = 20000;
const MAX_CHANGES_SHOWN = 200;

let readyFor = null;
function table() {
  const db = database.db;
  if (readyFor !== db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS model_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model_id INTEGER NOT NULL,
        stored_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        size INTEGER,
        created_at TEXT NOT NULL,
        created_by TEXT,
        note TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_model_versions_model ON model_versions(model_id);
      CREATE TABLE IF NOT EXISTS model_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model_id INTEGER NOT NULL,
        field TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        changed_at TEXT NOT NULL,
        changed_by TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_model_changes_model ON model_changes(model_id);
      CREATE TABLE IF NOT EXISTS detail_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        target TEXT NOT NULL,
        label TEXT,
        field TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        changed_at TEXT NOT NULL,
        changed_by TEXT
      );
      CREATE TRIGGER IF NOT EXISTS model_history_removed AFTER DELETE ON models BEGIN
        DELETE FROM model_changes WHERE model_id = OLD.id; DELETE FROM model_versions WHERE model_id = OLD.id; END;
    `);
    readyFor = db;
    sweepOrphans();
  }
  return db;
}

/** Kept files of models no longer in the library (their rows went with the model). */
function sweepOrphans() {
  try {
    const root = path.join(path.dirname(getDatabasePath()), 'versions');
    if (!fs.existsSync(root)) return;
    const known = new Set(
      database.db
        .prepare('SELECT DISTINCT model_id FROM model_versions')
        .all()
        .map((row) => String(row.model_id))
    );
    for (const name of fs.readdirSync(root)) {
      if (/^\d+$/.test(name) && !known.has(name)) fs.rmSync(path.join(root, name), { recursive: true, force: true });
    }
  } catch (error) {
    console.warn('[History] Could not tidy the kept versions:', error.message);
  }
}

/** Where a model's earlier versions are kept. */
function versionsDir(modelId) {
  return path.join(path.dirname(getDatabasePath()), 'versions', String(Number(modelId)));
}

function modelFor(filePath) {
  const model = table()
    .prepare('SELECT id, filePath, fileName FROM models WHERE filePath = ?')
    .get(String(filePath || ''));
  if (!model) throw new Error('This model is not in the library');
  if (model.filePath.startsWith('url::')) throw new Error('An online model has no file to keep versions of');
  if (model.filePath.includes('::')) throw new Error('Files inside a zip file have no versions');
  return model;
}

/** Copy a file, then rename it into place: a half-written copy never has the final name. */
function copyInto(from, to) {
  const temp = path.join(path.dirname(to), `.justtprint-${process.pid}-${Date.now()}.part`);
  fs.copyFileSync(from, temp);
  fs.renameSync(temp, to);
}

/** Keep the model's current file as a version; answers its row id. */
function keepCurrent(model, by, note) {
  const dir = versionsDir(model.id);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  // Unique even for two versions in the same millisecond (one file would replace the other).
  const unique = require('crypto').randomBytes(3).toString('hex');
  const stored = path.join(dir, `${stamp}-${unique}-${path.basename(model.filePath)}`);
  copyInto(model.filePath, stored);
  return Number(
    table()
      .prepare('INSERT INTO model_versions (model_id, stored_path, file_name, size, created_at, created_by, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(model.id, stored, path.basename(model.filePath), fs.statSync(stored).size, new Date().toISOString(), by, note ? String(note).slice(0, 500) : null)
      .lastInsertRowid
  );
}

/** The model's file changed: its size and date, and what is worked out from its contents is read again. */
function fileChanged(model) {
  const stat = fs.statSync(model.filePath);
  table().prepare('UPDATE models SET size = ?, modifiedDate = ?, hash = NULL WHERE id = ?').run(stat.size, stat.mtime.toISOString(), model.id);
}

/**
 * Upload New Version: the uploaded file (in the model's folder, not yet in the library) takes the
 * model's place; the file it replaces is kept. Answers the model's versions.
 * @param {string} filePath
 * @param {string} uploadedPath
 * @param {{ by?: string | null, note?: string | null }} [options]
 */
function replaceWithUpload(filePath, uploadedPath, { by = null, note = null } = {}) {
  const model = modelFor(filePath);
  const uploaded = path.resolve(String(uploadedPath || ''));
  if (path.dirname(uploaded) !== path.dirname(model.filePath)) throw new Error('The new version must be uploaded into the model’s folder');
  if (uploaded === model.filePath) throw new Error('That is the model’s own file');
  if (table().prepare('SELECT 1 FROM models WHERE filePath = ?').get(uploaded)) throw new Error('That file is another model in the library');
  if (!fs.existsSync(uploaded) || !fs.statSync(uploaded).isFile()) throw new Error('The uploaded file is not there');
  if (path.extname(uploaded).toLowerCase() !== path.extname(model.filePath).toLowerCase()) {
    fs.rmSync(uploaded, { force: true });
    throw new Error(`The new version must be a ${path.extname(model.filePath)} file, like the current one`);
  }
  if (!fs.existsSync(model.filePath)) throw new Error('The model’s file is not in its folder any more');
  keepCurrent(model, by, note || 'Replaced by a new version');
  fs.renameSync(uploaded, model.filePath);
  fileChanged(model);
  pruneModel(model.id);
  return listVersions(model.filePath);
}

/**
 * Put an earlier version back; the current file is kept as a version.
 * @param {number} versionId
 * @param {{ by?: string | null }} [options]
 */
function restoreVersion(versionId, { by = null } = {}) {
  const version = table().prepare('SELECT * FROM model_versions WHERE id = ?').get(Number(versionId));
  if (!version) throw new Error('This version is gone');
  const model = table().prepare('SELECT id, filePath, fileName FROM models WHERE id = ?').get(version.model_id);
  if (!model) throw new Error('The model is not in the library any more');
  if (!fs.existsSync(version.stored_path)) throw new Error('The kept file of this version is missing');
  keepCurrent(model, by, `Before putting back the version of ${version.created_at.slice(0, 10)}`);
  copyInto(version.stored_path, model.filePath);
  table().prepare('DELETE FROM model_versions WHERE id = ?').run(version.id);
  fs.rmSync(version.stored_path, { force: true });
  fileChanged(model);
  pruneModel(model.id);
  return listVersions(model.filePath);
}

function deleteVersion(versionId) {
  const version = table().prepare('SELECT * FROM model_versions WHERE id = ?').get(Number(versionId));
  if (!version) return { deleted: false };
  fs.rmSync(version.stored_path, { force: true });
  table().prepare('DELETE FROM model_versions WHERE id = ?').run(version.id);
  return { deleted: true };
}

/** How many earlier versions each model keeps (Settings → Backup): a number, or 0 for all. */
function keepLimit() {
  const n = Number(require('../core/settings').getSettingValueOr('versionsKeep', '0'));
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** Delete a model's versions beyond the newest `keep` (0 keeps all). Answers { deleted, freedBytes }. */
function pruneModel(modelId, keep = keepLimit()) {
  const out = { deleted: 0, freedBytes: 0 };
  if (!keep) return out;
  const older = table()
    .prepare('SELECT id, stored_path, size FROM model_versions WHERE model_id = ? ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?')
    .all(Number(modelId), keep);
  for (const version of older) {
    fs.rmSync(version.stored_path, { force: true });
    table().prepare('DELETE FROM model_versions WHERE id = ?').run(version.id);
    out.deleted++;
    out.freedBytes += Number(version.size) || 0;
  }
  return out;
}

/** Keep only the newest `keep` versions of every model (0: all). Answers { deleted, freedBytes }. */
function pruneAll(keep = keepLimit()) {
  const out = { deleted: 0, freedBytes: 0 };
  if (!keep) return out;
  for (const { model_id: modelId } of table().prepare('SELECT DISTINCT model_id FROM model_versions').all()) {
    const done = pruneModel(modelId, keep);
    out.deleted += done.deleted;
    out.freedBytes += done.freedBytes;
  }
  return out;
}

/** The space the kept versions take: { bytes, files, models, keep } (Settings → Backup). */
function versionsUsage() {
  const row = table().prepare('SELECT COUNT(*) AS files, COUNT(DISTINCT model_id) AS models, COALESCE(SUM(size), 0) AS bytes FROM model_versions').get();
  return { bytes: Number(row.bytes) || 0, files: Number(row.files) || 0, models: Number(row.models) || 0, keep: keepLimit() };
}

/** A copy of a version to download (downloads/, deleted after an hour): its path. */
function versionDownload(versionId) {
  const version = table().prepare('SELECT * FROM model_versions WHERE id = ?').get(Number(versionId));
  if (!version || !fs.existsSync(version.stored_path)) throw new Error('This version is gone');
  const extension = (path.extname(version.file_name).slice(1) || 'bin').toLowerCase();
  const target = require('./download-files').newDownloadPath('version', extension);
  const named = target.replace(
    /\.[^.]+$/,
    `-${path
      .basename(version.file_name, path.extname(version.file_name))
      .replace(/[^\w.-]+/g, '-')
      .slice(0, 80)}.${extension}`
  );
  fs.copyFileSync(version.stored_path, named);
  return { filePath: named };
}

/** A model's earlier file versions (newest first) and the changes to its details (newest first). */
function listVersions(filePath) {
  const model = table()
    .prepare('SELECT id FROM models WHERE filePath = ?')
    .get(String(filePath || ''));
  if (!model) return { versions: [], changes: [] };
  const versions = table()
    .prepare(
      'SELECT id, file_name AS fileName, size, created_at AS createdAt, created_by AS createdBy, note FROM model_versions WHERE model_id = ? ORDER BY id DESC'
    )
    .all(model.id);
  const changes = table()
    .prepare(
      `SELECT id, field, old_value AS oldValue, new_value AS newValue, changed_at AS changedAt, changed_by AS changedBy
    FROM model_changes WHERE model_id = ? ORDER BY id DESC LIMIT ${MAX_CHANGES_SHOWN}`
    )
    .all(model.id);
  return { versions, changes };
}

/**
 * Every model's history, newest first (the History page): the changes to their details and the
 * earlier files kept, each with its model ({ id, filePath, fileName }). `before` (an ISO time)
 * pages back; `search` keeps entries whose model's name or path, field or values contain it.
 * Answers { entries: [{ kind: 'change' | 'version', id, at, by, model, ... }], more }.
 * @param {{ before?: string | null, limit?: number, search?: string | null }} [options]
 */
function listAll({ before = null, limit = 100, search = null } = {}) {
  const db = table();
  const max = Math.max(1, Math.min(Number(limit) || 100, 500));
  const term = search ? `%${String(search).toLowerCase()}%` : null;
  const when = before ? String(before) : '9999';
  const changes = db
    .prepare(
      `SELECT c.id, c.field, c.old_value AS oldValue, c.new_value AS newValue, c.changed_at AS at, c.changed_by AS by,
        m.id AS modelId, m.filePath, m.fileName
      FROM model_changes c JOIN models m ON m.id = c.model_id
      WHERE c.changed_at < ? ${
        term
          ? "AND (LOWER(m.fileName) LIKE ? OR LOWER(m.filePath) LIKE ? OR LOWER(c.field) LIKE ? OR LOWER(COALESCE(c.old_value, '')) LIKE ? OR LOWER(COALESCE(c.new_value, '')) LIKE ?)"
          : ''
      }
      ORDER BY c.changed_at DESC, c.id DESC LIMIT ?`
    )
    .all(when, ...(term ? [term, term, term, term, term] : []), max + 1);
  const versions = db
    .prepare(
      `SELECT v.id, v.file_name AS fileName, v.size, v.created_at AS at, v.created_by AS by, v.note,
        m.id AS modelId, m.filePath, m.fileName AS modelFileName
      FROM model_versions v JOIN models m ON m.id = v.model_id
      WHERE v.created_at < ? ${term ? 'AND (LOWER(m.fileName) LIKE ? OR LOWER(m.filePath) LIKE ? OR LOWER(v.file_name) LIKE ?)' : ''}
      ORDER BY v.created_at DESC, v.id DESC LIMIT ?`
    )
    .all(when, ...(term ? [term, term, term] : []), max + 1);
  const details = db
    .prepare(
      `SELECT id, scope, target, label, field, old_value AS oldValue, new_value AS newValue, changed_at AS at, changed_by AS by
      FROM detail_changes
      WHERE changed_at < ? ${
        term
          ? "AND (LOWER(COALESCE(label, '')) LIKE ? OR LOWER(target) LIKE ? OR LOWER(field) LIKE ? OR LOWER(COALESCE(old_value, '')) LIKE ? OR LOWER(COALESCE(new_value, '')) LIKE ?)"
          : ''
      }
      ORDER BY changed_at DESC, id DESC LIMIT ?`
    )
    .all(when, ...(term ? [term, term, term, term, term] : []), max + 1);
  const entries = [
    ...details.map((row) => ({
      kind: 'detail',
      id: row.id,
      at: row.at,
      by: row.by,
      scope: row.scope,
      target: row.target,
      label: row.label,
      field: row.field,
      oldValue: row.oldValue,
      newValue: row.newValue
    })),
    ...changes.map((row) => ({
      kind: 'change',
      id: row.id,
      at: row.at,
      by: row.by,
      field: row.field,
      oldValue: row.oldValue,
      newValue: row.newValue,
      model: { id: row.modelId, filePath: row.filePath, fileName: row.fileName }
    })),
    ...versions.map((row) => ({
      kind: 'version',
      id: row.id,
      at: row.at,
      by: row.by,
      fileName: row.fileName,
      size: row.size,
      note: row.note,
      model: { id: row.modelId, filePath: row.filePath, fileName: row.modelFileName }
    }))
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)) || b.id - a.id);
  return { entries: entries.slice(0, max), more: entries.length > max };
}

// ---- Changes to the details ----

const tagList = (tags) =>
  (Array.isArray(tags) ? tags : [])
    .map((tag) => String(typeof tag === 'string' ? tag : (tag && tag.name) || '').trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

/** A detail as text, for comparing and keeping (lists joined with ", "). */
function valueOf(field, value) {
  if (field === 'tags' || field === 'categories') return tagList(value).join(', ');
  if (field === 'rating') return String(Number(value) || 0);
  return value == null ? '' : String(value).trim();
}

/** What a model's tracked details are now: { field: text }. */
function snapshot(modelId) {
  const db = table();
  const row = db.prepare('SELECT * FROM models WHERE id = ?').get(modelId);
  if (!row) return null;
  const out = {};
  for (const field of TRACKED) {
    if (field === 'tags') {
      out.tags = valueOf('tags', db.prepare('SELECT t.name FROM model_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.model_id = ?').all(modelId));
    } else if (field === 'categories') {
      /** @type {{ name: string }[]} */
      let names;
      try {
        names = db.prepare('SELECT c.name FROM model_categories mc JOIN categories c ON c.id = mc.category_id WHERE mc.model_id = ?').all(modelId);
      } catch (_) {
        // No categories yet.
        names = [];
      }
      out.categories = valueOf('categories', names);
    } else {
      out[field] = valueOf(field, row[field]);
    }
  }
  return out;
}

/** Write down what changed between two snapshots of a model. */
function recordChanges(modelId, before, after, by = null) {
  if (!before || !after) return 0;
  const insert = table().prepare('INSERT INTO model_changes (model_id, field, old_value, new_value, changed_at, changed_by) VALUES (?, ?, ?, ?, ?, ?)');
  const at = new Date().toISOString();
  let count = 0;
  for (const field of TRACKED) {
    if (before[field] === after[field]) continue;
    insert.run(modelId, field, String(before[field]).slice(0, MAX_VALUE), String(after[field]).slice(0, MAX_VALUE), at, by);
    count++;
  }
  return count;
}

/**
 * Run a change to models and write down what it changed: `ids` the models it touches, `run` the
 * change. Answers what `run` answers. Never fails because of the history.
 */
async function tracking(ids, by, run) {
  let before = new Map();
  try {
    before = new Map(ids.map((id) => [id, snapshot(id)]));
  } catch (error) {
    console.warn('[History] Could not read the details before a change:', error.message);
  }
  const result = await run();
  try {
    for (const id of ids) recordChanges(id, before.get(id), snapshot(id), by);
  } catch (error) {
    console.warn('[History] Could not write down a change:', error.message);
  }
  return result;
}

/**
 * Write down changes to a folder's or a site link's details: `before` and `after` are
 * { field: text }. Answers how many fields changed.
 * @param {'folder' | 'site'} scope
 * @param {string} target the folder, or the site link
 * @param {string} label what the History page calls it
 */
function recordDetailChanges(scope, target, label, before, after, by = null) {
  if (!before || !after) return 0;
  const insert = table().prepare(
    'INSERT INTO detail_changes (scope, target, label, field, old_value, new_value, changed_at, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const at = new Date().toISOString();
  let count = 0;
  for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const was = String(before[field] ?? '');
    const now = String(after[field] ?? '');
    if (was === now) continue;
    insert.run(scope, String(target), label ? String(label).slice(0, 300) : null, field, was.slice(0, MAX_VALUE), now.slice(0, MAX_VALUE), at, by);
    count++;
  }
  return count;
}

/** A folder or site change, to put its old value back: { scope, target, field, value }. */
function detailChangeToUndo(changeId) {
  const change = table().prepare('SELECT * FROM detail_changes WHERE id = ?').get(Number(changeId));
  if (!change) throw new Error('This change is gone');
  return { scope: change.scope, target: change.target, label: change.label, field: change.field, value: change.old_value };
}

/** The model ids behind file paths. */
function idsFor(filePaths) {
  const find = table().prepare('SELECT id FROM models WHERE filePath = ?');
  return [
    ...new Set(
      (filePaths || [])
        .map((p) => (typeof p === 'string' ? find.get(p) : null))
        .filter(Boolean)
        .map((row) => row.id)
    )
  ];
}

/** The change, to put its old value back: { modelId, filePath, field, value }. */
function changeToUndo(changeId) {
  const change = table().prepare('SELECT * FROM model_changes WHERE id = ?').get(Number(changeId));
  if (!change) throw new Error('This change is gone');
  const model = table().prepare('SELECT id, filePath FROM models WHERE id = ?').get(change.model_id);
  if (!model) throw new Error('The model is not in the library any more');
  return { modelId: model.id, filePath: model.filePath, field: change.field, value: change.old_value };
}

module.exports = {
  listAll,
  TRACKED,
  changeToUndo,
  detailChangeToUndo,
  recordDetailChanges,
  deleteVersion,
  idsFor,
  listVersions,
  recordChanges,
  pruneAll,
  pruneModel,
  replaceWithUpload,
  restoreVersion,
  snapshot,
  tracking,
  valueOf,
  versionDownload,
  versionsDir,
  versionsUsage
};

'use strict';

/**
 * Folders as models: a folder of model files read as one model (its page). Its files keep their
 * own details; the folder adds what they share (designers, tags, categories) and notes of its own.
 */

const path = require('path');

const MAX_NOTES = 20000;
const MAX_FILES = 500;

const readyFor = new WeakSet();
function ensureTables(db) {
  if (readyFor.has(db)) return;
  db.prepare(
    `CREATE TABLE IF NOT EXISTS folder_info (
    path TEXT PRIMARY KEY,
    notes TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  )`
  ).run();
  // Assembly view: how the folder's parts were laid out ({ layout, poses: { modelId: pose } }).
  db.prepare(
    `CREATE TABLE IF NOT EXISTS folder_assembly (
    path TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`
  ).run();
  readyFor.add(db);
}

/** A folder path as kept: no trailing separator. */
const folderKey = (dir) => String(dir || '').replace(/[\\/]+$/, '') || String(dir || '');

const escapeLike = (value) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/** The library files directly in a folder (not in its subfolders or inside ZIP files), by name. */
function folderFiles(db, dir) {
  const folder = folderKey(dir);
  const sep = folder.includes('\\') && !folder.includes('/') ? '\\' : '/';
  return db
    .prepare(
      `SELECT id, filePath, fileName, size, designer, license, source, parentModel, rating, favorite, print_status, print_count, printed, dateAdded
    FROM models WHERE filePath LIKE ? ESCAPE '\\' AND filePath NOT LIKE '%::%'`
    )
    .all(`${escapeLike(folder)}${sep}%`)
    .filter((row) => path.dirname(row.filePath) === folder || row.filePath.slice(0, row.filePath.length - path.basename(row.filePath).length - 1) === folder)
    .sort((a, b) => String(a.fileName || '').localeCompare(String(b.fileName || ''), undefined, { numeric: true, sensitivity: 'base' }))
    .slice(0, MAX_FILES);
}

const tableExists = (db, name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

/**
 * A folder as a model: { path, name, files, notes, designers, licenses, tags, categories, size, added }
 * (files as in the models table), or null when no library file is in it.
 */
function getFolder(db, dir) {
  ensureTables(db);
  const folder = folderKey(dir);
  const files = folderFiles(db, folder);
  if (!files.length) return null;
  const ids = files.map((file) => file.id);
  const marks = ids.map(() => '?').join(',');
  const names = (sql) =>
    [
      ...new Set(
        db
          .prepare(sql)
          .all(...ids)
          .map((row) => row.name)
      )
    ].sort((a, b) => a.localeCompare(b));
  const tags = tableExists(db, 'model_tags') ? names(`SELECT t.name FROM model_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.model_id IN (${marks})`) : [];
  const categories = tableExists(db, 'model_categories')
    ? names(`SELECT c.name FROM model_categories mc JOIN categories c ON c.id = mc.category_id WHERE mc.model_id IN (${marks})`)
    : [];
  const unique = (key) => [...new Set(files.map((file) => String(file[key] || '').trim()).filter(Boolean))];
  const info = db.prepare('SELECT notes FROM folder_info WHERE path = ?').get(folder);
  const added = files
    .map((file) => file.dateAdded)
    .filter(Boolean)
    .sort();
  return {
    path: folder,
    name: path.basename(folder) || folder,
    files,
    notes: info ? info.notes : '',
    designers: unique('designer'),
    licenses: unique('license'),
    sources: unique('source'),
    tags,
    categories,
    size: files.reduce((sum, file) => sum + (Number(file.size) || 0), 0),
    added: added[0] || null
  };
}

function saveFolderNotes(db, dir, notes) {
  ensureTables(db);
  const text = String(notes ?? '').slice(0, MAX_NOTES);
  db.prepare('INSERT OR REPLACE INTO folder_info (path, notes, updated_at) VALUES (?, ?, ?)').run(folderKey(dir), text, new Date().toISOString());
  return { notes: text };
}

const MAX_PARTS = 200;
const finite = (list, length) => Array.isArray(list) && list.length === length && list.every((n) => typeof n === 'number' && Number.isFinite(n));

/** A folder's saved assembly: { layout: 'designed' | 'laid-out', poses: { [modelId]: { position, quaternion } } }, or null. */
function getAssembly(db, dir) {
  ensureTables(db);
  const row = db.prepare('SELECT data FROM folder_assembly WHERE path = ?').get(folderKey(dir));
  if (!row) return null;
  try {
    return JSON.parse(row.data);
  } catch (_) {
    return null;
  }
}

/** Keep a folder's assembly (checked: a known layout, at most 200 parts, numbers only). Null forgets it. */
function saveAssembly(db, dir, assembly) {
  ensureTables(db);
  const key = folderKey(dir);
  if (!assembly) {
    db.prepare('DELETE FROM folder_assembly WHERE path = ?').run(key);
    return null;
  }
  const layout = assembly.layout === 'laid-out' ? 'laid-out' : 'designed';
  const poses = {};
  for (const [id, pose] of Object.entries(assembly.poses && typeof assembly.poses === 'object' ? assembly.poses : {}).slice(0, MAX_PARTS)) {
    if (!/^\d+$/.test(id) || !pose || !finite(pose.position, 3) || !finite(pose.quaternion, 4)) continue;
    poses[id] = { position: pose.position, quaternion: pose.quaternion };
  }
  const data = { layout, poses };
  db.prepare('INSERT OR REPLACE INTO folder_assembly (path, data, updated_at) VALUES (?, ?, ?)').run(key, JSON.stringify(data), new Date().toISOString());
  return data;
}

module.exports = { folderFiles, folderKey, getAssembly, getFolder, saveAssembly, saveFolderNotes };

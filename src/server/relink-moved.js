'use strict';

/**
 * Files moved outside JusttPrint (to another folder, another share, or with their folder renamed) keep their model: when a scan finds a file that is not
 * in the library, a model whose file is gone, with the same name and size, is taken to be the same
 * file and moved to the new path (its id stays, so tags, notes, print history, collections, groups,
 * kits and versions follow). Of several such models, the one whose path ends the same way wins
 * (Robots/arm.stl before arm.stl); a tie is left alone and the file is added as new.
 */

const fs = require('fs');

/**
 * Whether a model's file is still there; for a ZIP entry, whether its archive is.
 * @param {(p: string) => boolean} [existsSync]
 */
function fileIsThere(filePath, existsSync = fs.existsSync) {
  const text = String(filePath || '');
  if (text.startsWith('url::')) return true;
  return existsSync(text.includes('::') ? text.split('::')[0] : text);
}

/** How many path parts two paths share at the end (archive::entry counts as parts too). */
function sharedTail(a, b) {
  const parts = (p) =>
    String(p)
      .split(/::|[\\/]+/)
      .filter(Boolean);
  const x = parts(a);
  const y = parts(b);
  let n = 0;
  while (n < x.length && n < y.length && x[x.length - 1 - n].toLowerCase() === y[y.length - 1 - n].toLowerCase()) n++;
  return n;
}

/**
 * The model a new file was moved from, or null.
 * @param {any} db better-sqlite3 database
 * @param {{ filePath: string, fileName: string, size: number | null }} file
 * @param {(p: string) => boolean} [existsSync]
 * @returns {{ id: number, filePath: string } | null}
 */
function findMovedModel(db, file, existsSync = fs.existsSync) {
  const size = Number(file.size);
  if (!file.fileName || !Number.isFinite(size) || size <= 0) return null;
  // A model inside a ZIP is named by its path in the archive ("arm/upper.stl"): the same file once unpacked.
  const name = String(file.fileName).split(/[\\/]/).pop() || '';
  const inFolder = `%/${name.replace(/[\\%_]/g, (c) => `\\${c}`)}`;
  const gone = db
    .prepare("SELECT id, filePath FROM models WHERE (fileName = ? OR fileName LIKE ? ESCAPE '\\') AND size = ? AND filePath != ? LIMIT 50")
    .all(name, inFolder, size, file.filePath)
    .filter((row) => !fileIsThere(row.filePath, existsSync));
  if (!gone.length) return null;
  const scored = gone.map((row) => ({ row, score: sharedTail(row.filePath, file.filePath) })).sort((a, b) => b.score - a.score);
  if (scored.length > 1 && scored[0].score === scored[1].score) return null;
  return scored[0].row;
}

/** Move a model to its new path, with the records kept by path (site files). */
function moveModel(db, id, from, to) {
  // Its name as the scan names it: the path inside a ZIP, else the file's name.
  const text = String(to);
  const fileName = text.includes('::') ? text.split('::').pop() : text.split(/[\\/]/).pop();
  db.prepare('UPDATE models SET filePath = ?, fileName = ? WHERE id = ?').run(to, fileName, id);
  try {
    db.prepare('UPDATE site_files SET file_path = ? WHERE file_path = ?').run(to, from);
  } catch (_) {
    /* no site files table yet */
  }
}

module.exports = { fileIsThere, findMovedModel, moveModel, sharedTail };

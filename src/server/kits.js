'use strict';

/**
 * Kit progress: which parts of a model are printed. A part is a plate of a 3MF project with
 * several plates, else the file itself; a folder (Folders as models) is a kit of its files' parts.
 * Parts are ticked by hand, and a print logged as Printed ticks every part of that file.
 *
 * Plates are read from the 3MF once per version of the file (model_plates); ticks are kept per
 * model (kit_done), so they follow a file that is renamed or moved.
 */

const fs = require('fs');
const path = require('path');
const database = require('../core/database');
const { folderFiles } = require('../core/folder-models');
const { readPlates } = require('./threemf-plates');

let readyFor = null;
function table() {
  const db = database.db;
  if (readyFor !== db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS model_plates (
        model_id INTEGER PRIMARY KEY,
        file_key TEXT NOT NULL,
        plates TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kit_done (
        model_id INTEGER NOT NULL,
        plate INTEGER NOT NULL DEFAULT 0,
        done_at TEXT NOT NULL,
        done_by TEXT,
        PRIMARY KEY (model_id, plate)
      );
    `);
    db.exec(`CREATE TRIGGER IF NOT EXISTS kit_removed AFTER DELETE ON models BEGIN
      DELETE FROM kit_done WHERE model_id = OLD.id; DELETE FROM model_plates WHERE model_id = OLD.id; END;`);
    readyFor = db;
  }
  return database.db;
}

/** The file's version: size and modification time (null when it cannot be read). */
function fileKey(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() ? `${stat.size}:${Math.round(stat.mtimeMs)}` : null;
  } catch (_) {
    return null;
  }
}

/** A model's plates (several, or none), read once per version of its file. */
async function platesOf(model) {
  if (!/\.3mf$/i.test(model.filePath) || model.filePath.includes('::')) return [];
  const key = fileKey(model.filePath);
  if (!key) return [];
  const kept = table().prepare('SELECT file_key, plates FROM model_plates WHERE model_id = ?').get(model.id);
  if (kept && kept.file_key === key) return JSON.parse(kept.plates);
  let plates = [];
  try {
    plates = await readPlates(model.filePath);
  } catch (error) {
    console.warn(`[Kits] Could not read the plates of ${model.filePath}: ${error.message}`);
  }
  table().prepare('INSERT OR REPLACE INTO model_plates (model_id, file_key, plates) VALUES (?, ?, ?)').run(model.id, key, JSON.stringify(plates));
  return plates;
}

const title = (model) => String(model.fileName || path.basename(model.filePath)).replace(/\.[a-z0-9]{2,6}$/i, '');

/** The models of a kit: a folder's files, or one file. */
function kitModels(target) {
  const text = String(target || '');
  const one = table().prepare('SELECT id, filePath, fileName FROM models WHERE filePath = ?').get(text);
  if (one) return { kind: 'file', models: [one] };
  return { kind: 'folder', models: folderFiles(database.db, text) };
}

/**
 * The parts of a kit: { kind, parts: [{ modelId, plate, filePath, label, seconds, grams, done, doneAt, doneBy }], done, total }.
 * `target` is a library file or a folder.
 */
async function getKit(target) {
  const { kind, models } = kitModels(target);
  const doneRows = models.length
    ? table()
        .prepare(`SELECT model_id, plate, done_at, done_by FROM kit_done WHERE model_id IN (${models.map(() => '?').join(',')})`)
        .all(...models.map((m) => m.id))
    : [];
  const done = new Map(doneRows.map((row) => [`${row.model_id}:${row.plate}`, row]));
  const parts = [];
  for (const model of models) {
    const plates = await platesOf(model);
    const name = title(model);
    if (plates.length) {
      for (const plate of plates) {
        const row = done.get(`${model.id}:${plate.index}`);
        parts.push({
          modelId: model.id,
          plate: plate.index,
          filePath: model.filePath,
          label: `${kind === 'folder' ? `${name} · ` : ''}${plate.name || `Plate ${plate.index}`}`,
          seconds: plate.seconds,
          grams: plate.grams,
          done: !!row,
          doneAt: row ? row.done_at : null,
          doneBy: row ? row.done_by : null
        });
      }
    } else {
      const row = done.get(`${model.id}:0`);
      parts.push({
        modelId: model.id,
        plate: 0,
        filePath: model.filePath,
        label: name,
        seconds: null,
        grams: null,
        done: !!row,
        doneAt: row ? row.done_at : null,
        doneBy: row ? row.done_by : null
      });
    }
  }
  return { kind, parts, done: parts.filter((p) => p.done).length, total: parts.length };
}

/** Tick a part, or untick it. */
function setPart(filePath, plate, isDone, by = null) {
  const model = table()
    .prepare('SELECT id FROM models WHERE filePath = ?')
    .get(String(filePath || ''));
  if (!model) throw new Error('This model is not in the library');
  const index = Math.max(0, Math.floor(Number(plate) || 0));
  if (isDone) {
    table()
      .prepare('INSERT OR REPLACE INTO kit_done (model_id, plate, done_at, done_by) VALUES (?, ?, ?, ?)')
      .run(model.id, index, new Date().toISOString(), by);
  } else {
    table().prepare('DELETE FROM kit_done WHERE model_id = ? AND plate = ?').run(model.id, index);
  }
  return { done: !!isDone };
}

/** A print logged as Printed: every part of these models is ticked. */
async function markPrinted(modelIds, by = null) {
  const insert = table().prepare('INSERT OR IGNORE INTO kit_done (model_id, plate, done_at, done_by) VALUES (?, ?, ?, ?)');
  const at = new Date().toISOString();
  for (const id of modelIds) {
    const model = table().prepare('SELECT id, filePath, fileName FROM models WHERE id = ?').get(id);
    if (!model) continue;
    const plates = await platesOf(model);
    for (const index of plates.length ? plates.map((p) => p.index) : [0]) insert.run(model.id, index, at, by);
  }
}

/**
 * A print of some plates of one file logged as Printed (Log Print's plate choice): those plates are
 * ticked, the others left as they are. Plates the file does not have are skipped. Answers how many.
 */
async function markPlates(filePath, plates, by = null) {
  const model = table()
    .prepare('SELECT id, filePath, fileName FROM models WHERE filePath = ?')
    .get(String(filePath || ''));
  if (!model) throw new Error('This model is not in the library');
  const known = new Set((await platesOf(model)).map((p) => p.index));
  let ticked = 0;
  for (const plate of new Set((Array.isArray(plates) ? plates : []).map(Number))) {
    if (!known.has(plate)) continue;
    setPart(model.filePath, plate, true, by);
    ticked++;
  }
  return ticked;
}

/** Progress of several folders at once (folder cards): { [folder]: { done, total } } for kits of two parts or more. */
async function summaries(folders) {
  const out = {};
  for (const folder of (Array.isArray(folders) ? folders : []).slice(0, 100)) {
    if (typeof folder !== 'string') continue;
    const kit = await getKit(folder);
    if (kit.kind === 'folder' && kit.total > 1) out[folder] = { done: kit.done, total: kit.total };
  }
  return out;
}

/**
 * Kits started but not finished (Home's Continue your kits), the last ticked first:
 * [{ kind, target, name, coverPath, done, total, lastDoneAt }]. With `folders` (Folders as models),
 * a folder of two files or more is one kit; otherwise only files with several plates are kits.
 * @param {{ folders?: boolean, limit?: number }} [options]
 */
async function inProgress({ folders = false, limit = 6 } = {}) {
  const max = Math.max(1, Math.min(24, Math.floor(Number(limit) || 6)));
  const ticked = table()
    .prepare(
      `SELECT m.id, m.filePath, m.fileName, MAX(k.done_at) AS lastDoneAt
    FROM kit_done k INNER JOIN models m ON m.id = k.model_id
    WHERE instr(m.filePath, '::') = 0
    GROUP BY m.id ORDER BY lastDoneAt DESC LIMIT 500`
    )
    .all();
  const out = [];
  const seenFolders = new Set();
  for (const model of ticked) {
    if (out.length >= max) break;
    const dir = path.dirname(model.filePath);
    if (seenFolders.has(dir)) continue;
    if (folders) {
      const kit = await getKit(dir);
      if (kit.kind === 'folder' && new Set(kit.parts.map((p) => p.modelId)).size > 1) {
        seenFolders.add(dir);
        if (kit.done > 0 && kit.done < kit.total) {
          out.push({
            kind: 'folder',
            target: dir,
            name: path.basename(dir),
            coverPath: model.filePath,
            done: kit.done,
            total: kit.total,
            lastDoneAt: model.lastDoneAt
          });
        }
        continue;
      }
    }
    const kit = await getKit(model.filePath);
    if (kit.total > 1 && kit.done < kit.total) {
      out.push({
        kind: 'file',
        target: model.filePath,
        name: title(model),
        coverPath: model.filePath,
        done: kit.done,
        total: kit.total,
        lastDoneAt: model.lastDoneAt
      });
    }
  }
  return out;
}

module.exports = { getKit, inProgress, markPlates, markPrinted, platesOf, setPart, summaries };

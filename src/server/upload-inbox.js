'use strict';

/**
 * The Upload folder and Organize Uploads. Uploads wait in the Upload folder (a folder chosen in
 * Settings → Scanning → Upload Folder), in the library with a "Not organized" badge. Organize
 * Uploads then puts each of them where it belongs, without asking:
 *
 * 1. Every top-level item is one model: a folder with everything in it, or a model file (or an
 *    archive) on its own, which gets a folder named after it.
 * 2. Its archives are unpacked and its loose pictures and documents go into image/ and
 *    document/ (unpack-archives.js); the folder is scanned and gets a cover.
 * 3. Its Category and Subcategory: the site's, else the AI's (when an AI service is set up,
 *    category-scan.js), else words in its names, else "Uncategorized › Other".
 * 4. It moves to <destination>/<Category>/<Subcategory>/<model name>/ ("Name (2)" when taken),
 *    with its tags, notes, history and pictures (model-folders.js pathsMoved).
 * 5. The AI tags its models (when an AI service is set up), applied at once with "AI Tagged".
 *
 * The destination is a folder chosen in Settings, else the first STL Home folder. One run at a
 * time; every open page follows it ('organize-uploads' events). What fails stays in the Upload
 * folder and is listed.
 */

const fs = require('fs');
const path = require('path');
const database = require('../core/database');
const events = require('./events');

const UPLOAD_SETTING = 'uploadFolder';
const DESTINATION_SETTING = 'organizeDestination';
const UNCATEGORIZED = ['Uncategorized', 'Other'];
/** At most this many moved models are listed in the result (the count is complete). */
const MAX_LISTED = 200;

const setting = (key) => {
  try {
    const row = database.db && database.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row && row.value
      ? String(row.value)
          .trim()
          .replace(/[\\/]+$/, '')
      : '';
  } catch (_) {
    return '';
  }
};
const escapeLike = (text) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/** The Upload folder, or '' when none is set. */
const uploadFolder = () => setting(UPLOAD_SETTING);

/** Where Organize Uploads puts models: the folder chosen, else the first STL Home folder (or ''). */
function destination() {
  const chosen = setting(DESTINATION_SETTING);
  if (chosen) return chosen;
  const homes = require('../core/library-paths').readStlHomeDirectories();
  return homes.length ? String(homes[0]).replace(/[\\/]+$/, '') : '';
}

/** Whether a model's file is waiting in the Upload folder. */
function isWaiting(filePath, inbox = uploadFolder()) {
  if (!inbox || !filePath || String(filePath).startsWith('url::')) return false;
  return require('./server-paths').isInsideOrSame(String(filePath).split('::')[0], inbox);
}

/** How many models are waiting in the Upload folder. */
function waitingCount(inbox = uploadFolder()) {
  if (!inbox || !database.db) return 0;
  return Number(database.db.prepare("SELECT COUNT(*) AS n FROM models WHERE filePath LIKE ? ESCAPE '\\'").get(`${escapeLike(inbox)}${path.sep}%`).n) || 0;
}

/** The settings page's and the library's view: { uploadFolder, destination, chosenDestination, waiting }. */
function info() {
  const inbox = uploadFolder();
  return { uploadFolder: inbox, destination: destination(), chosenDestination: setting(DESTINATION_SETTING), waiting: waitingCount(inbox) };
}

/**
 * Save the Upload folder and the destination ('' for none, or the first STL Home folder). The
 * Upload folder is made when missing; the destination may not be inside it.
 */
function saveFolders(upload, dest) {
  const { isInsideOrSame } = require('./server-paths');
  const inbox = String(upload || '')
    .trim()
    .replace(/[\\/]+$/, '');
  const target = String(dest || '')
    .trim()
    .replace(/[\\/]+$/, '');
  for (const dir of [inbox, target]) if (dir && !path.isAbsolute(dir)) throw new Error(`Give the whole path of the folder: ${dir}`);
  if (inbox) {
    fs.mkdirSync(inbox, { recursive: true });
    if (!fs.statSync(inbox).isDirectory()) throw new Error(`Not a folder: ${inbox}`);
    const homes = require('../core/library-paths').readStlHomeDirectories();
    if (homes.some((home) => isInsideOrSame(home, inbox))) throw new Error('The Upload folder cannot hold an STL Home folder: choose a folder of its own');
    const into = target || destination();
    if (into && isInsideOrSame(into, inbox)) throw new Error('Organize Uploads cannot put models inside the Upload folder: choose another destination');
  }
  const save = database.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  save.run(UPLOAD_SETTING, inbox);
  save.run(DESTINATION_SETTING, target);
  // The Upload folder is scanned and watched with STL Home (stl-home.js scanRoots).
  require('./stl-home').settingChanged(UPLOAD_SETTING);
  events.broadcast('upload-folder-changed', info());
  return info();
}

/** The top-level items of the Upload folder that are models: folders, and model files or archives. */
function itemsIn(inbox) {
  const { allowedUploadExtensions } = require('./uploads');
  const modelFolders = require('./model-folders');
  const skipped = new Set([...modelFolders.KIND_NAMES.map((kind) => modelFolders.KINDS[kind].dir), require('./unpack-archives').ARCHIVES_DIR]);
  const extensions = new Set(allowedUploadExtensions());
  for (const ext of require('./unpack-archives').ARCHIVE_EXTENSIONS) extensions.add(ext);
  return fs
    .readdirSync(inbox, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.') && !skipped.has(entry.name))
    .filter((entry) => entry.isDirectory() || (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())))
    .map((entry) => ({ name: entry.name, path: path.join(inbox, entry.name), isFile: entry.isFile() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The models in a folder and its subfolders (files, not links). */
function modelsUnder(folder) {
  return database.db
    .prepare("SELECT id, filePath, fileName FROM models WHERE filePath LIKE ? ESCAPE '\\'")
    .all(`${escapeLike(folder)}${path.sep}%`)
    .filter((row) => !String(row.filePath).startsWith('url::'));
}

/** The place most of a folder's models have: [Category, Subcategory], else Uncategorized › Other. */
function placeOf(models) {
  const categories = require('../core/categories');
  const counts = new Map();
  for (const model of models) {
    const place = categories.modelPlace(model.id);
    if (!place.category || !place.subcategory) continue;
    const key = `${place.category}\u0000${place.subcategory}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const best = [...counts].sort((a, b) => b[1] - a[1])[0];
  return best ? best[0].split('\u0000') : UNCATEGORIZED;
}

/** A folder name made safe ("Hobby & DIY" stays, "a/b" becomes "a b"). */
const safeName = (name, fallback) => require('../core/makerworld').folderName(String(name || '')) || fallback;

/** "name", else "name (2)", … : a folder in `parent` that is not taken. */
function freeFolder(parent, name) {
  for (let n = 1; n < 1000; n++) {
    const candidate = path.join(parent, n === 1 ? name : `${name} (${n})`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`No free folder name for ${name} in ${parent}`);
}

/**
 * Move a folder to `target` (which must not exist), and every record of its files with it.
 * Across drives or shares it is copied into a hidden folder first (scans skip those), so the
 * destination never shows half a model, then the original is removed.
 */
function moveFolder(from, target, deps = {}) {
  const rename = deps.rename || fs.renameSync;
  const modelFolders = require('./model-folders');
  try {
    rename(from, target);
  } catch (error) {
    if (!error || error.code !== 'EXDEV') throw error;
    const staging = path.join(path.dirname(target), `.justtprint-moving-${process.pid}-${Date.now()}`);
    try {
      fs.cpSync(from, staging, { recursive: true, errorOnExist: true, preserveTimestamps: true });
      fs.renameSync(staging, target);
    } catch (copyError) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw copyError;
    }
    modelFolders.pathsMoved(from, target);
    fs.rmSync(from, { recursive: true, force: true });
    return target;
  }
  modelFolders.pathsMoved(from, target);
  return target;
}

/** @type {any} */
let job = null;
let nextId = 1;

function summary() {
  if (!job) return null;
  const { promise, ...rest } = job;
  return { ...rest, moved: job.moved.slice(0, MAX_LISTED), failed: [...job.failed] };
}

const announce = () => events.broadcast('organize-uploads', summary());
const running = () => !!(job && job.running);

/** Wait until no Categorize Library run is going, then run one over `ids` and wait for it. */
async function categorize(ids, { useAi, by, event }) {
  const scan = require('./category-scan');
  for (;;) {
    while (scan.running()) await new Promise((resolve) => setTimeout(resolve, 500));
    if (scan.start({ by, useAi, only: ids, event })) break;
  }
  const started = scan._job();
  await started.promise;
  const error = started.error;
  scan.dismiss();
  return error;
}

/** The AI's tags for each model, added at once (with "AI Tagged"), as the MCP's generate_tags with apply does. */
async function tagModels(models, event) {
  const { generateTagsHandler } = require('./ipc/tags');
  const { saveModel } = require('./ipc/models');
  const tagsOf = database.db.prepare('SELECT t.name FROM model_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.model_id = ?');
  const settings = require('./ipc/ai').getAISettings();
  const concurrency = Math.max(1, Math.min(Number(settings.aiTagConcurrency) || 3, 10));
  let next = 0;
  let tagged = 0;
  /** @type {string | null} */
  let stopped = null;
  const worker = async () => {
    while (next < models.length && !stopped && !job.stopping) {
      const model = models[next++];
      try {
        const suggested = (await generateTagsHandler(event || {}, model.filePath)) || [];
        const names = (Array.isArray(suggested) ? suggested : []).map((t) => String(t).trim()).filter(Boolean);
        if (names.length) {
          const current = tagsOf.all(model.id).map((row) => row.name);
          const have = new Set(current.map((name) => name.toLowerCase()));
          const all = [...current];
          for (const name of [...names, 'AI Tagged']) {
            if (have.has(name.toLowerCase())) continue;
            have.add(name.toLowerCase());
            all.push(name);
          }
          await saveModel({ id: model.id, filePath: model.filePath, fileName: model.fileName, tags: all });
          tagged++;
        }
      } catch (error) {
        // A rate limit or a failed sign-in stops the tagging; the moves stay.
        if (/rate limit|authentication|api key/i.test(error.message || '') || require('../core/aitagging').PUTER_STOP.test(error.message || '')) {
          stopped = error.message;
        } else {
          console.warn(`[Organize Uploads] Could not tag ${model.filePath}: ${error.message}`);
        }
      }
      job.tagged = tagged;
      job.done++;
      announce();
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, models.length) }, worker));
  return { tagged, stopped };
}

/** Get one item ready: its own model folder, archives unpacked, scanned. Answers the folder. */
async function prepare(item, inbox) {
  const modelFolders = require('./model-folders');
  let folder = item.path;
  if (item.isFile) {
    const archives = require('./unpack-archives');
    // "Gear Box.stl" → "Gear Box/", "Kit.part1.rar" → "Kit/".
    const name = archives.isArchive(item.name) ? archives.folderNameFor(item.name) : path.basename(item.name, path.extname(item.name));
    folder = modelFolders.makeFolder(inbox, name || 'Model');
    const moved = path.join(folder, item.name);
    // A model already in the library keeps its records.
    await require('./stl-home').withoutScans(async () => {
      fs.renameSync(item.path, moved);
      const known = database.db.prepare('SELECT id FROM models WHERE filePath = ?').get(item.path);
      if (known) require('./relink-moved').moveModel(database.db, known.id, item.path, moved);
      database.db
        .prepare("UPDATE models SET filePath = ? || substr(filePath, ?) WHERE filePath LIKE ? ESCAPE '\\'")
        .run(moved, item.path.length + 1, `${escapeLike(item.path)}::%`);
    });
  } else {
    modelFolders.register(folder);
  }
  const unpack = await require('./unpack-archives').unpackFolder(folder);
  const { rootFor } = require('./uploads');
  const { networkPathContext } = require('./path-context');
  const { isInsideOrSame } = require('./server-paths');
  const isStlHomeScan = require('../core/library-paths')
    .readStlHomeDirectories()
    .some((home) => isInsideOrSame(folder, home));
  await require('./stl-home').scanUploadedFolder(folder, rootFor(folder, networkPathContext().roots), { isStlHomeScan });
  await modelFolders.coverIfNone(folder).catch(() => {});
  return { folder, unpackFailed: unpack.failed };
}

/**
 * Start Organize Uploads. Answers the run, or null while one is going. Throws when there is no
 * Upload folder or destination. Puter runs in the browser: `puterSignedIn` says whether the page
 * that asked is signed in to it (without, the AI would wait for a sign-in, so it is left out).
 * @param {{ by?: string | null, event?: any, puterSignedIn?: boolean }} [options]
 */
function start({ by = null, event = null, puterSignedIn = false } = {}) {
  if (running()) return null;
  const inbox = uploadFolder();
  const dest = destination();
  if (!inbox) throw new Error('Choose the Upload folder first (Settings → Scanning → Upload Folder)');
  if (!fs.existsSync(inbox)) throw new Error(`The Upload folder is not there: ${inbox}`);
  if (!dest) throw new Error('Choose where Organize Uploads puts models (Settings → Scanning → Upload Folder), or set up STL Home');
  if (require('./server-paths').isInsideOrSame(dest, inbox)) throw new Error('The destination is inside the Upload folder: choose another one');
  const items = itemsIn(inbox);
  const service = require('./ipc/ai').getAISettings().aiService;
  const puterMissing = service === 'puter' && !puterSignedIn;
  const aiReady = require('./category-scan').aiReady() && !puterMissing;
  job = {
    id: nextId++,
    by,
    running: true,
    stopping: false,
    phase: 'prepare',
    total: items.length,
    done: 0,
    useAi: aiReady,
    destination: dest,
    moved: /** @type {{ name: string, to: string, category: string, subcategory: string, models: number }[]} */ ([]),
    movedCount: 0,
    movedModels: 0,
    tagged: 0,
    failed: /** @type {{ name: string, error: string }[]} */ ([]),
    warning: /** @type {string | null} */ (puterMissing ? 'The AI was left out: sign in to Puter in this browser first (Settings → AI Tagging).' : null)
  };
  const current = job;
  current.promise = (async () => {
    try {
      // 1–2: each item its own model folder, unpacked and scanned.
      const ready = [];
      for (const item of items) {
        if (current.stopping) break;
        try {
          const { folder, unpackFailed } = await prepare(item, inbox);
          for (const failed of unpackFailed) current.failed.push({ name: `${path.basename(folder)}/${failed.name}`, error: failed.error });
          if (modelsUnder(folder).length) ready.push({ name: item.name, folder });
          else current.failed.push({ name: item.name, error: 'no model files in it (it stays in the Upload folder)' });
        } catch (error) {
          current.failed.push({ name: item.name, error: error.message });
        }
        current.done++;
        announce();
      }
      // 3: their places (the AI's first, then words in their names).
      const ids = ready.flatMap((r) => modelsUnder(r.folder).map((m) => m.id));
      if (ids.length && !current.stopping) {
        current.phase = 'categorize';
        announce();
        if (aiReady) {
          const error = await categorize(ids, { useAi: true, by, event });
          if (error) current.warning = `The AI could not sort every model (${error}); the rest went by the words in their names.`;
        }
        await categorize(ids, { useAi: false, by, event });
      }
      // 4: the moves.
      current.phase = 'move';
      current.done = 0;
      current.total = ready.length;
      announce();
      const movedModels = [];
      for (const { name, folder } of ready) {
        if (current.stopping) break;
        try {
          const models = modelsUnder(folder);
          const [category, subcategory] = placeOf(models);
          const parent = path.join(dest, safeName(category, UNCATEGORIZED[0]), safeName(subcategory, UNCATEGORIZED[1]));
          const to = await require('./stl-home').withoutScans(async () => {
            fs.mkdirSync(parent, { recursive: true });
            return moveFolder(folder, freeFolder(parent, safeName(path.basename(folder), 'Model')));
          });
          current.movedCount++;
          current.movedModels += models.length;
          if (current.moved.length < MAX_LISTED) current.moved.push({ name, to, category, subcategory, models: models.length });
          movedModels.push(...modelsUnder(to));
        } catch (error) {
          current.failed.push({ name, error: error.message });
        }
        current.done++;
        announce();
      }
      events.broadcast('refresh-grid');
      events.broadcast('categories-changed');
      // 5: tags.
      if (aiReady && movedModels.length && !current.stopping) {
        current.phase = 'tag';
        current.done = 0;
        current.total = movedModels.length;
        announce();
        const { stopped } = await tagModels(movedModels, event);
        if (stopped) current.warning = `AI tagging stopped: ${stopped}. The models are moved; tag the rest with Generate Tags.`;
        events.broadcast('refresh-grid');
      }
    } catch (error) {
      console.error('[Organize Uploads] failed:', error);
      current.failed.push({ name: 'Organize Uploads', error: error.message });
    } finally {
      current.running = false;
      current.phase = 'done';
      announce();
      const { plural } = require('./notifications');
      console.log(
        `[Organize Uploads] Moved ${current.movedCount} folder(s) (${current.movedModels} models) into ${dest}; tagged ${current.tagged}; ${current.failed.length} not organized`
      );
      require('./notifications').notify({
        title: `Organize Uploads finished: ${plural(current.movedCount, 'model folder')} moved`,
        body:
          `${plural(current.movedModels, 'model')} into ${dest}` +
          (current.tagged ? `, ${plural(current.tagged, 'model')} tagged` : '') +
          (current.failed.length ? `. Not organized: ${current.failed.map((f) => `${f.name} (${f.error})`).join('; ')}` : '') +
          (current.warning ? `. ${current.warning}` : ''),
        level: current.failed.length ? 'warning' : 'success',
        minRole: 'editor',
        link: '#/library'
      });
    }
  })();
  announce();
  return summary();
}

function stop() {
  if (!running()) return false;
  job.stopping = true;
  // Its Categorize run stops too (what it placed stays).
  if (job.phase === 'categorize') require('./category-scan').stop();
  announce();
  return true;
}

module.exports = {
  destination,
  info,
  isWaiting,
  itemsIn,
  moveFolder,
  placeOf,
  running,
  saveFolders,
  start,
  stop,
  summary,
  uploadFolder,
  waitingCount,
  _job: () => job
};

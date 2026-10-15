'use strict';

// Folders as models (src/core/folder-models.js): a folder's page.
const database = require('../../core/database');
const folders = require('../../core/folder-models');
const events = require('../events');
const { ipcMain } = require('../runtime');

/** A folder as a model, with its files' grid pictures; null when no library file is in it. */
ipcMain.handle('get-folder', async (event, dir) => {
  const folder = folders.getFolder(database.db, dir);
  if (!folder) return null;
  const gridThumbnails = require('../grid-thumbnails');
  const { loadThumbnailForModel } = require('../../core/thumbnails');
  return {
    ...folder,
    files: folder.files.map((file) => ({ ...file, image: gridThumbnails.gridImage(file.filePath, () => loadThumbnailForModel(file.filePath)) }))
  };
});

ipcMain.handle('save-folder-notes', async (event, dir, notes) => {
  const before = (folders.getFolder(database.db, dir) || {}).notes || '';
  const result = folders.saveFolderNotes(database.db, dir, notes);
  // Written down for the History page (model-versions.js detail_changes).
  try {
    const key = folders.folderKey(dir);
    require('../model-versions').recordDetailChanges(
      'folder',
      key,
      require('path').basename(key),
      { notes: before },
      { notes: result.notes },
      event && event.user ? event.user.username : null
    );
    events.broadcast('model-history-changed', {});
  } catch (error) {
    console.warn('[History] Could not write down a folder notes change:', error.message);
  }
  events.broadcast('folder-changed', { path: folders.folderKey(dir) });
  return result;
});

// Archives in a folder (unpack-archives.js): which there are, and unpacking them into the folder.
ipcMain.handle('get-folder-archives', async (event, dir) => ({ archives: require('../unpack-archives').archivesIn(folders.folderKey(dir)) }));
ipcMain.handle('unpack-folder-archives', async (event, dir) => {
  const key = folders.folderKey(dir);
  const { readStlHomeDirectories } = require('../../core/library-paths');
  const { isInsideOrSame } = require('../server-paths');
  // The folder becomes one model: never a whole STL Home folder.
  if (readStlHomeDirectories().some((home) => folders.folderKey(home) === key)) {
    throw new Error('Unpack Archives is for one model’s folder, not a whole STL Home folder: move the archives into a folder of their own first');
  }
  const result = await require('../unpack-archives').unpackFolder(key);
  const { rootFor } = require('../uploads');
  const { networkPathContext } = require('../path-context');
  const isStlHomeScan = readStlHomeDirectories().some((home) => isInsideOrSame(key, home));
  const newModels = await require('../stl-home').scanUploadedFolder(key, rootFor(key, networkPathContext().roots), { isStlHomeScan });
  await require('../model-folders')
    .coverIfNone(key)
    .catch(() => {});
  events.broadcast('folder-changed', { path: key });
  events.broadcast('refresh-grid');
  // How many models the folder holds now (models from its archives that were in the library moved, not new).
  const escapeLike = (text) => text.replace(/[\\%_]/g, (c) => `\\${c}`);
  const models = database.db
    .prepare("SELECT COUNT(*) AS n FROM models WHERE filePath LIKE ? ESCAPE '\\' AND instr(filePath, '::') = 0")
    .get(`${escapeLike(key)}${require('path').sep}%`).n;
  return { ...result, newModels, models };
});

// Kit progress (src/server/kits.js): a file's or a folder's parts, ticking them, and folder cards' progress.
const kits = require('../kits');
ipcMain.handle('get-kit', async (event, target) => kits.getKit(target));
ipcMain.handle('set-kit-part', async (event, filePath, plate, done) => {
  const result = kits.setPart(filePath, plate, done, event && event.user ? event.user.username : null);
  events.broadcast('kit-changed', { filePath });
  return result;
});
ipcMain.handle('get-kit-summaries', async (event, folders) => kits.summaries(folders));
// Home's Continue your kits.
ipcMain.handle('get-kits-in-progress', async (event, options) => kits.inProgress(options || {}));

// Assembly view: a folder's parts in one scene, as they were laid out.
ipcMain.handle('get-assembly', async (event, dir) => folders.getAssembly(database.db, dir));
ipcMain.handle('save-assembly', async (event, dir, assembly) => folders.saveAssembly(database.db, dir, assembly || null));

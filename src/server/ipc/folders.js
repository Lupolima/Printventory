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
  const result = folders.saveFolderNotes(database.db, dir, notes);
  events.broadcast('folder-changed', { path: folders.folderKey(dir) });
  return result;
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

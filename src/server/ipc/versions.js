'use strict';

// Version history of a model (src/server/model-versions.js): earlier file versions and changes to its details.
const events = require('../events');
const { ipcMain } = require('../runtime');
const history = require('../model-versions');

const who = (event) => (event && event.user ? event.user.username : null);
const changed = (filePath) => {
  events.broadcast('refresh-grid');
  events.broadcast('model-history-changed', { filePath });
};

/** { versions, changes } of a model. */
ipcMain.handle('get-model-history', async (event, filePath) => history.listVersions(filePath));

/** The History page: every model's changes and earlier files, newest first ({ before, limit, search }). */
ipcMain.handle('get-all-history', async (event, options) => history.listAll(options || {}));

/** Upload New Version: the uploaded file (in the model's folder) takes its place; the old one is kept. */
ipcMain.handle('replace-model-file', async (event, filePath, uploadedPath, note) => {
  const result = history.replaceWithUpload(filePath, uploadedPath, { by: who(event), note: typeof note === 'string' ? note : null });
  changed(filePath);
  return result;
});

ipcMain.handle('restore-model-version', async (event, versionId) => {
  const result = history.restoreVersion(versionId, { by: who(event) });
  changed(null);
  return result;
});

ipcMain.handle('delete-model-version', async (event, versionId) => {
  const result = history.deleteVersion(versionId);
  events.broadcast('model-history-changed', {});
  return result;
});

/** Settings → Backup: the space the kept versions take, and how many each model keeps. */
ipcMain.handle('get-versions-usage', async () => history.versionsUsage());
/** Keep only the newest `keep` versions of each model (0: all), from now on and right away. */
ipcMain.handle('set-versions-keep', async (event, keep) => {
  const n = Math.max(0, Math.min(1000, Math.floor(Number(keep) || 0)));
  require('../../core/settings').persistSetting('versionsKeep', String(n));
  const pruned = history.pruneAll(n);
  events.broadcast('model-history-changed', {});
  return { ...history.versionsUsage(), pruned };
});

/** Put a folder's notes or a site detail back to what it was before a change (History page). */
ipcMain.handle('undo-detail-change', async (event, changeId) => {
  const { scope, target, field, value } = history.detailChangeToUndo(changeId);
  const by = who(event);
  if (scope === 'folder' && field === 'notes') {
    const database = require('../../core/database');
    const folders = require('../../core/folder-models');
    const before = (folders.getFolder(database.db, target) || {}).notes || '';
    const result = folders.saveFolderNotes(database.db, target, value || '');
    history.recordDetailChanges(
      'folder',
      folders.folderKey(target),
      require('path').basename(folders.folderKey(target)),
      { notes: before },
      { notes: result.notes },
      by
    );
    events.broadcast('folder-changed', { path: folders.folderKey(target) });
  } else if (scope === 'site') {
    const siteDetails = require('../site-details');
    const list = (text) =>
      String(text || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    const changes = field.startsWith('profile:')
      ? { profiles: { [field.slice('profile:'.length)]: value || '' } }
      : { [field]: field === 'categories' || field === 'tags' ? list(value) : value || '' };
    const before = siteDetails.editableValues(target);
    await siteDetails.saveSiteEdits(target, changes, { event });
    const after = siteDetails.editableValues(target);
    history.recordDetailChanges('site', target, after.title || target, before, after, by);
    events.broadcast('site-details-changed', { url: target });
  } else {
    throw new Error('This change cannot be put back');
  }
  events.broadcast('model-history-changed', {});
  return { success: true };
});

/** A copy of an earlier version to download: { filePath } (in downloads/, gone after an hour). */
ipcMain.handle('download-model-version', async (event, versionId) => history.versionDownload(versionId));

/** Put a detail back to what it was before a change (the putting back is a change too). */
ipcMain.handle('undo-model-change', async (event, changeId) => {
  const { modelId, filePath, field, value } = history.changeToUndo(changeId);
  const by = who(event);
  let result;
  if (field === 'fileName') {
    result = await history.tracking([modelId], by, async () => require('../model-rename').renameModel(filePath, value || ''));
  } else if (field === 'categories') {
    const names = String(value || '')
      .split(', ')
      .filter(Boolean);
    result = await history.tracking([modelId], by, async () => require('../../core/categories').setModelCategories(modelId, names, 'manual'));
    events.broadcast('categories-changed');
  } else {
    const { saveModel } = require('./model-save');
    const fieldValue =
      field === 'tags'
        ? String(value || '')
            .split(', ')
            .filter(Boolean)
        : field === 'rating'
          ? Number(value) || 0
          : value || '';
    result = await history.tracking([modelId], by, () => saveModel({ filePath, [field]: fieldValue }));
  }
  changed(filePath);
  return result;
});

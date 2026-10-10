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

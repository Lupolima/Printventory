'use strict';

// Groups (src/server/model-groups.js): models kept together under a name, with groups inside groups.
const groups = require('../model-groups');
const events = require('../events');
const { ipcMain } = require('../runtime');

/** Every browser redraws its grid and group pages. */
function changed() {
  events.broadcast('refresh-grid');
  events.broadcast('groups-changed');
}

/** A group's page: a group id, or a top group's name. */
ipcMain.handle('get-group', async (event, ref) => groups.getGroup(ref));
ipcMain.handle('list-groups', async () => groups.listGroups());
ipcMain.handle('find-group', async (event, name) => groups.findGroup(name));
ipcMain.handle('get-model-group', async (event, modelId) => groups.groupOfModel(modelId));
ipcMain.handle('suggest-group-names', async (event, modelIds) => groups.suggestNames(modelIds));

/** Create Group: { name, modelIds, groupIds, parentId }. */
ipcMain.handle('create-group', async (event, details) => {
  const made = groups.createGroup(details || {});
  changed();
  return made;
});

ipcMain.handle('update-group', async (event, id, changes) => {
  const group = groups.updateGroup(id, changes || {});
  changed();
  return group;
});

ipcMain.handle('add-to-group', async (event, id, what) => {
  const group = groups.addToGroup(id, what || {});
  changed();
  return group;
});

ipcMain.handle('remove-from-group', async (event, id, modelIds) => {
  const group = groups.removeFromGroup(id, modelIds);
  changed();
  return group;
});

ipcMain.handle('ungroup', async (event, id) => {
  const result = groups.ungroup(id);
  changed();
  return result;
});

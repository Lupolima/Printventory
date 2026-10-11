'use strict';

// Categories (src/core/categories.js) and Categorize Library (src/server/category-scan.js).
const events = require('../events');
const { ipcMain } = require('../runtime');
const categories = require('../../core/categories');
const scan = require('../category-scan');
const database = require('../../core/database');

const changed = () => events.broadcast('categories-changed');

/** The Categories and Subcategories (flat, in order; parent_id ties a Subcategory to its Category) with their model counts, and how many models have no Subcategory. */
ipcMain.handle('get-categories', async () => ({ categories: categories.listCategories(), uncategorized: categories.uncategorizedCount() }));

/** { keywords } (words separated by commas); the list's names are fixed. */
ipcMain.handle('update-category', async (event, id, changes) => {
  const result = categories.updateCategory(id, changes || {});
  changed();
  events.broadcast('refresh-grid');
  return result;
});

/** Give a model its place (the Edit dialog): names, the Subcategory deciding. Answers [Category, Subcategory]. */
ipcMain.handle('set-model-categories', async (event, filePath, names) => {
  const model = database.db.prepare('SELECT id FROM models WHERE filePath = ?').get(filePath);
  if (!model) throw new Error('This model is not in the library');
  const history = require('../model-versions');
  const result = await history.tracking([model.id], event && event.user ? event.user.username : null, async () =>
    categories.setModelCategories(model.id, names, 'manual')
  );
  changed();
  return result;
});

/** Categorize Library: { useAi, again }. Answers the run, or { busy: true } while one is going. */
ipcMain.handle('start-category-scan', async (event, options) => {
  const useAi = !!(options && options.useAi);
  if (useAi && !scan.aiReady()) throw new Error('Set up the AI service first (Settings → AI Tagging)');
  const started = scan.start({ by: event && event.user ? event.user.username : null, useAi, again: !!(options && options.again), event });
  return started || { busy: true };
});

ipcMain.handle('get-category-scan', async () => ({ job: scan.snapshot(), aiReady: scan.aiReady() }));
ipcMain.handle('stop-category-scan', async () => ({ success: scan.stop() }));

ipcMain.handle('dismiss-category-scan', async () => ({ success: scan.dismiss() }));

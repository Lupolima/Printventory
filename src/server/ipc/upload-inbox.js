'use strict';

// The Upload folder and Organize Uploads (src/server/upload-inbox.js).
const { ipcMain } = require('../runtime');
const inbox = require('../upload-inbox');

/** { uploadFolder, destination, chosenDestination, waiting }: the library's badge and filter, and Settings. */
ipcMain.handle('get-upload-folder', async () => inbox.info());
/** Settings → Scanning → Upload Folder: the Upload folder and where Organize Uploads puts models ('' for the first STL Home folder). */
ipcMain.handle('save-upload-folder', async (event, upload, destination) => inbox.saveFolders(upload, destination));
/** Organize Uploads ({ puterSignedIn }: this browser's Puter sign-in): answers the run, or { busy: true } while one is going. */
function organizeUploads(event, options) {
  const by = event && event.user ? event.user.username : null;
  return inbox.start({ by, event, puterSignedIn: !!(options && options.puterSignedIn) }) || { busy: true };
}
ipcMain.handle('organize-uploads', async (event, options) => organizeUploads(event, options));
ipcMain.handle('get-organize-uploads', async () => inbox.summary());
ipcMain.handle('stop-organize-uploads', async () => ({ success: inbox.stop() }));

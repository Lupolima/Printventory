'use strict';

// Uploads from the browser (src/server/uploads.js has the upload route itself).
const path = require('path');
const database = require('../../core/database');
const { ipcMain } = require('../runtime');
const { readStlHomeDirectories } = require('../../core/library-paths');
const { networkPathContext } = require('../path-context');
const { isInsideOrSame } = require('../server-paths');
const { allowedUploadExtensions, checkFolder, maxUploadBytes, rootFor, unpackOnUpload, uploadChunkBytes } = require('../uploads');

/** What the upload dialog checks before sending: the file types, the size limits, and the size of the pieces it sends. */
ipcMain.handle('get-upload-info', async () => ({
  extensions: allowedUploadExtensions(),
  maxBytes: maxUploadBytes(),
  chunkBytes: uploadChunkBytes(),
  scanMaxBytes: scanMaxBytes(),
  // Pictures, videos and documents a model folder takes (model-folders.js).
  mediaExtensions: require('../model-folders').mediaExtensions()
}));

/** Scans skip files larger than this (Settings → General → Performance; 50 MB unless changed). */
function scanMaxBytes() {
  const row = database.db && database.db.prepare('SELECT value FROM settings WHERE key = ?').get('maxFileSizeMB');
  const mb = row ? parseInt(row.value, 10) : NaN;
  return (Number.isFinite(mb) && mb > 0 ? mb : 50) * 1024 * 1024;
}

/**
 * Where uploaded archives are unpacked: in the folder they were uploaded into when it is a model
 * folder or holds only this upload (Upload made it for them); else each in a new folder of its own
 * named after it, so a folder of other models does not become one model.
 * @returns {{ folder: string, archives: string[] }[]}
 */
function unpackPlaces(dir, archives, uploaded) {
  if (!archives.length) return [];
  const fs = require('fs');
  const modelFolders = require('../model-folders');
  const unpack = require('../unpack-archives');
  const mine = new Set(uploaded.map((p) => path.basename(p)));
  const skipped = new Set([...modelFolders.KIND_NAMES.map((kind) => modelFolders.KINDS[kind].dir), unpack.ARCHIVES_DIR]);
  const others = fs.readdirSync(dir).filter((name) => !mine.has(name) && !skipped.has(name) && !name.startsWith('.'));
  if (modelFolders.isModelFolder(dir) || !others.length) return [{ folder: dir, archives }];
  return archives.map((archive) => {
    const folder = modelFolders.makeFolder(dir, unpack.folderNameFor(archive));
    const moved = path.join(folder, path.basename(archive));
    fs.renameSync(archive, moved);
    return { folder, archives: [moved] };
  });
}

/**
 * After a batch of uploads: scan the folder so the new models show up. `filePaths` (the files
 * just uploaded) are counted in `inLibrary`: folder watching may have added them already.
 */
ipcMain.handle('add-uploaded-files', async (event, folder, filePaths) => {
  const ctx = networkPathContext();
  const modelFolders = require('../model-folders');
  // Into a model folder's image, video or document folder: the model folder is scanned.
  const dir = checkFolder(modelFolders.isMediaFolder(folder) ? path.dirname(modelFolders.folderKey(folder)) : folder, ctx);
  const { scanUploadedFolder } = require('../stl-home');
  const isStlHomeScan = readStlHomeDirectories().some((home) => isInsideOrSame(dir, home));
  let paths = (Array.isArray(filePaths) ? filePaths : []).filter((p) => typeof p === 'string' && isInsideOrSame(p, dir));
  // Archives (ZIP, RAR, 7Z) are unpacked into their model's folder first (unpack-archives.js).
  const unpacked = { done: /** @type {string[]} */ ([]), failed: /** @type {{ name: string, error: string }[]} */ ([]), folders: /** @type {string[]} */ ([]) };
  if (unpackOnUpload()) {
    const unpack = require('../unpack-archives');
    const archives = paths.filter((p) => unpack.isArchive(p) && path.dirname(p) === dir);
    for (const { folder, archives: these } of unpackPlaces(dir, archives, paths)) {
      const result = await unpack.unpackFolder(folder, { only: these });
      unpacked.done.push(...result.unpacked);
      unpacked.failed.push(...result.failed);
      unpacked.folders.push(folder);
    }
    // What was unpacked is not the upload's own file any more.
    paths = paths.filter((p) => !unpack.isArchive(p) || !unpacked.done.includes(path.basename(p)));
  }
  let newModels = await scanUploadedFolder(dir, rootFor(dir, ctx.roots), { isStlHomeScan });
  for (const folder of unpacked.folders) {
    if (folder !== dir) newModels += await scanUploadedFolder(folder, rootFor(folder, ctx.roots), { isStlHomeScan });
    await modelFolders.coverIfNone(folder).catch(() => {});
  }
  const known = database.db.prepare('SELECT 1 FROM models WHERE filePath = ?');
  // A ZIP is in the library as the models inside it ("archive.zip::part.stl").
  const inZip = database.db.prepare("SELECT 1 FROM models WHERE filePath LIKE ? ESCAPE '\\' LIMIT 1");
  const escapeLike = (text) => text.replace(/[\\%_]/g, (c) => `\\${c}`);
  const isKnown = (p) => !!known.get(p) || (/\.zip$/i.test(p) && !!inZip.get(`${escapeLike(p)}::%`));
  // A model folder's first picture becomes its cover; a cover goes on new files too.
  if (modelFolders.isModelFolder(dir)) await modelFolders.coverIfNone(dir).catch((error) => console.warn(`[Upload] cover: ${error.message}`));
  const media = paths.filter((p) => modelFolders.kindOf(p) && modelFolders.isMediaFolder(path.dirname(p))).length;
  // Files that did not become models, and why (the upload's summary lists them).
  const max = scanMaxBytes();
  const notAdded = paths
    .filter((p) => !isKnown(p) && !(modelFolders.kindOf(p) && modelFolders.isMediaFolder(path.dirname(p))))
    .map((p) => {
      let size = 0;
      try {
        size = require('fs').statSync(p).size;
      } catch (_) {
        /* gone */
      }
      const zip = /\.zip$/i.test(p);
      const reason = zip
        ? 'no model files inside it (or all larger than the Max File Size, Settings → General → Performance)'
        : size > max
          ? `larger than the Max File Size (${Math.round(max / 1024 / 1024)} MB, Settings → General → Performance)`
          : 'not added by the scan';
      return { name: path.basename(p), reason };
    });
  return { newModels, inLibrary: paths.filter(isKnown).length + media, media, notAdded, unpacked: unpacked.done, unpackFailed: unpacked.failed };
});

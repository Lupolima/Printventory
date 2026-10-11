'use strict';

const database = require('../core/database');
const { app } = require('./runtime');
const fs = require('fs');
const path = require('path');
const { getLibraryRootPaths, readScannedDirectorySetting } = require('../core/library-paths');
const { isJusttPrintExtractTempPath } = require('../core/extract-temp');
const { isLibraryPathAllowed } = require('./server-paths');
const { getDatabasePath } = require('../core/db-path');

/** Library roots and folders that network callers (browser, MCP) are checked against. */
function networkPathContext() {
  let generatedDir = '';
  try {
    generatedDir = path.dirname(getDatabasePath());
  } catch (_) {
    /* db not ready */
  }
  let dataDir = '';
  try {
    dataDir = app.getPath('userData');
  } catch (_) {
    /* app not ready */
  }
  return {
    roots: [...getLibraryRootPaths(), ...readScannedDirectorySetting()],
    generatedDir,
    autoBackupDir: require('./auto-backup').downloadFolder(),
    downloadsDir: generatedDir ? path.join(generatedDir, 'downloads') : '',
    appDir: path.join(__dirname, '..', '..'),
    dataDir,
    isExtractTemp: (candidate) => isJusttPrintExtractTempPath(candidate),
    realpath: (candidate) => fs.realpathSync.native(candidate),
    isKnownModel: (candidate) => !!(database.db && database.db.prepare('SELECT 1 FROM models WHERE filePath = ? LIMIT 1').get(candidate)),
    hasModelsIn: (dir) => {
      const folder = String(dir || '').replace(/[\\/]+$/, '');
      if (!database.db || !folder) return false;
      const like = `${folder.replace(/[\\%_]/g, (c) => `\\${c}`)}${path.sep}%`;
      // A model folder (model-folders.js) counts too: one may hold only pictures for a while.
      return (
        !!database.db.prepare("SELECT 1 FROM models WHERE filePath LIKE ? ESCAPE '\\' LIMIT 1").get(like) || require('./model-folders').isModelFolder(folder)
      );
    }
  };
}

/** /api/file and /api/download only serve library files, plus backups and exports. */
function libraryPathAllowed(filePath) {
  return isLibraryPathAllowed(filePath, networkPathContext());
}

module.exports = { libraryPathAllowed, networkPathContext };

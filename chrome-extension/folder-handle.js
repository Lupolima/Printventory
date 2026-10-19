/**
 * Optional silent inbox folder (File System Access) + write helper.
 * Default install path (AppData/Library) is blocked by Chrome — use Downloads.
 */
(function (root) {
  'use strict';

  const DB_NAME = 'printventory-watcher';
  const STORE = 'handles';
  const KEY = 'printventoryDir';

  function openDb() {
    return new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE);
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function getDirectoryHandle() {
    const db = await openDb();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function setDirectoryHandle(handle) {
    const db = await openDb();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(handle, KEY);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  async function clearDirectoryHandle() {
    const db = await openDb();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  async function ensureWritePermission(handle) {
    const opts = { mode: 'readwrite' };
    if (typeof handle.queryPermission === 'function') {
      const current = await handle.queryPermission(opts);
      if (current === 'granted') return true;
    }
    if (typeof handle.requestPermission === 'function') {
      return (await handle.requestPermission(opts)) === 'granted';
    }
    return true;
  }

  /**
   * Create Downloads/Printventory (via background), then let the user select it
   * for silent writes. Chrome blocks AppData/Library — do not use those paths.
   */
  async function chooseSilentInboxFolder() {
    if (typeof window.showDirectoryPicker !== 'function') {
      const err = new Error('This browser cannot pick a folder. Use Chrome or Edge.');
      err.code = 'no-picker';
      throw err;
    }

    await new Promise(function (resolve) {
      chrome.runtime.sendMessage({ action: 'ensurePickableFolder' }, function () {
        void chrome.runtime.lastError;
        resolve();
      });
    });

    const dirHandle = await window.showDirectoryPicker({
      id: 'pv-printventory-dir',
      mode: 'readwrite',
      startIn: 'downloads'
    });

    if (!(await ensureWritePermission(dirHandle))) {
      const err = new Error('Folder permission was not granted.');
      err.code = 'permission';
      throw err;
    }

    // Prefer the Printventory folder; if they picked something else, still accept it.
    await setDirectoryHandle(dirHandle);
    return {
      ok: true,
      folderName: dirHandle.name,
      hasDb: false
    };
  }

  async function writePayloadToFolder(payload) {
    const handle = await getDirectoryHandle();
    if (!handle) return { ok: false, reason: 'no-folder' };
    if (!(await ensureWritePermission(handle))) return { ok: false, reason: 'permission' };
    const inbox = await handle.getDirectoryHandle('PrintventoryInbox', { create: true });
    const name = String((payload && payload.id) || 'item') + '.pvimport';
    const file = await inbox.getFileHandle(name, { create: true });
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(payload, null, 2));
    await writable.close();
    return { ok: true, via: 'folder', filename: name, folderName: handle.name };
  }

  root.PrintventoryFolder = {
    getDirectoryHandle: getDirectoryHandle,
    setDirectoryHandle: setDirectoryHandle,
    clearDirectoryHandle: clearDirectoryHandle,
    ensureWritePermission: ensureWritePermission,
    chooseSilentInboxFolder: chooseSilentInboxFolder,
    /** @deprecated use chooseSilentInboxFolder */
    choosePrintventoryDatabase: chooseSilentInboxFolder,
    writePayloadToFolder: writePayloadToFolder
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

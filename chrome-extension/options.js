'use strict';

let cachedPaths = null;

function setFolderStatus(kind, text) {
  const el = document.getElementById('folderStatus');
  el.className = 'folder-status' + (kind ? ' ' + kind : '');
  el.textContent = text;
}

function refreshPathLabels() {
  return PrintventoryPaths.resolvePaths().then((paths) => {
    cachedPaths = paths;
    document.getElementById('downloadsInbox').textContent = paths.downloadsInbox;
    document.getElementById('dataDir').textContent = paths.dataDirectory;
    return paths;
  });
}

function refreshFolderStatus() {
  chrome.storage.local.get(
    { printventoryFolderConfigured: false, printventoryFolderName: '' },
    (items) => {
      if (!items.printventoryFolderConfigured) {
        setFolderStatus(
          'ok',
          'Using default inbox (Downloads/PrintventoryInbox). No link required.'
        );
        return;
      }
      const name = items.printventoryFolderName || 'selected folder';
      setFolderStatus('ok', 'Silent writes to “' + name + '”/PrintventoryInbox');
    }
  );
}

async function chooseFolder() {
  setFolderStatus('', 'Creating Downloads/Printventory, then select that folder…');
  try {
    const result = await PrintventoryFolder.chooseSilentInboxFolder();
    chrome.storage.local.set({
      printventoryFolderConfigured: true,
      printventoryFolderName: result.folderName,
      printventoryFolderHasDb: false
    }, refreshFolderStatus);
  } catch (err) {
    if (err && err.name === 'AbortError') {
      refreshFolderStatus();
      return;
    }
    setFolderStatus('err', err && err.message ? err.message : String(err));
  }
}

document.getElementById('chooseFolder').addEventListener('click', chooseFolder);

document.getElementById('clearFolder').addEventListener('click', async () => {
  await PrintventoryFolder.clearDirectoryHandle();
  chrome.storage.local.set({
    printventoryFolderConfigured: false,
    printventoryFolderName: '',
    printventoryFolderHasDb: false
  }, refreshFolderStatus);
});

document.getElementById('extensionDebug').addEventListener('change', () => {
  const debug = document.getElementById('extensionDebug').checked;
  if (typeof pvSetDebug === 'function') pvSetDebug(debug);
  chrome.storage.sync.set({ extensionDebug: debug });
});

chrome.storage.sync.get({ extensionDebug: false }, (items) => {
  document.getElementById('extensionDebug').checked = !!items.extensionDebug;
  if (typeof pvSetDebug === 'function') pvSetDebug(!!items.extensionDebug);
});

refreshPathLabels().then(refreshFolderStatus);

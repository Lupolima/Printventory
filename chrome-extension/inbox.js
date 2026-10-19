/**
 * Queue a Printventory inbox JSON into Downloads/PrintventoryInbox.
 * Service-worker safe (data: URL, no Blob).
 */
(function (root) {
  'use strict';

  const INBOX_PREFIX = 'PrintventoryInbox/';
  /** Parent folder users pick once (created under the browser Downloads dir). */
  const PICKABLE_PREFIX = 'Printventory/';
  const PICKABLE_KEEP = PICKABLE_PREFIX + 'PrintventoryInbox/.printventory-keep';

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function buildPayload(fields) {
    const source = (fields && (fields.source || fields.url)) || null;
    return {
      version: 1,
      id: (fields && fields.id) || uuid(),
      createdAt: new Date().toISOString(),
      filePath: fields && fields.filePath ? fields.filePath : null,
      fileName: (fields && (fields.fileName || fields.parentModel)) || null,
      designer: (fields && fields.designer) || null,
      parentModel: (fields && fields.parentModel) || null,
      source: source,
      notes: (fields && fields.notes) || null,
      license: (fields && fields.license) || null
    };
  }

  function toDataUrl(obj) {
    const json = JSON.stringify(obj, null, 2);
    const bytes = unescape(encodeURIComponent(json));
    let b64;
    if (typeof btoa === 'function') {
      b64 = btoa(bytes);
    } else {
      b64 = Buffer.from(json, 'utf8').toString('base64');
    }
    // octet-stream: Edge often prompts Open/Save for application/json + *.json
    return 'data:application/octet-stream;base64,' + b64;
  }

  function writeViaDownloads(payload) {
    // .pvimport (not .pvimport.json): Edge treats *.json as "ask what to do with file"
    const filename = INBOX_PREFIX + payload.id + '.pvimport';
    return new Promise(function (resolve, reject) {
      chrome.downloads.download(
        {
          url: toDataUrl(payload),
          filename: filename,
          saveAs: false,
          conflictAction: 'uniquify'
        },
        function (downloadId) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve({ downloadId: downloadId, payload: payload, filename: filename, via: 'downloads' });
        }
      );
    });
  }

  async function ensureOffscreen() {
    if (!chrome.offscreen) return false;
    try {
      if (chrome.offscreen.hasDocument && await chrome.offscreen.hasDocument()) return true;
    } catch (e) { /* create below */ }
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Write inbox files into the Printventory folder you selected.'
    });
    await new Promise(function (resolve) { setTimeout(resolve, 50); });
    return true;
  }

  async function writeViaFolder(payload) {
    if (!chrome.offscreen) return { ok: false, reason: 'no-offscreen' };
    await ensureOffscreen();
    return await chrome.runtime.sendMessage({ action: 'writeInboxToFolder', payload: payload });
  }

  async function writeInbox(fields) {
    const payload = buildPayload(fields);
    try {
      const folder = await writeViaFolder(payload);
      if (folder && folder.ok) return Object.assign({ payload: payload }, folder);
    } catch (e) { /* fall back */ }
    return writeViaDownloads(payload);
  }

  /** Create Downloads/Printventory so it appears in the folder picker. */
  function ensurePickableFolder() {
    return new Promise(function (resolve) {
      chrome.downloads.download(
        {
          url: 'data:application/octet-stream;base64,' + btoa('printventory-folder'),
          filename: PICKABLE_KEEP,
          saveAs: false,
          conflictAction: 'overwrite'
        },
        function (downloadId) {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          const finish = function () {
            try {
              chrome.downloads.erase({ id: downloadId }, function () { void chrome.runtime.lastError; });
            } catch (e) { /* ignore */ }
            resolve({ ok: true, downloadId: downloadId, folder: 'Printventory' });
          };
          if (!chrome.downloads.onChanged) {
            setTimeout(finish, 400);
            return;
          }
          const onChanged = function (delta) {
            if (!delta || delta.id !== downloadId || !delta.state) return;
            if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
              chrome.downloads.onChanged.removeListener(onChanged);
              finish();
            }
          };
          chrome.downloads.onChanged.addListener(onChanged);
          setTimeout(function () {
            chrome.downloads.onChanged.removeListener(onChanged);
            finish();
          }, 2500);
        }
      );
    });
  }

  root.PrintventoryInbox = {
    INBOX_PREFIX: INBOX_PREFIX,
    PICKABLE_PREFIX: PICKABLE_PREFIX,
    buildPayload: buildPayload,
    writeInbox: writeInbox,
    ensurePickableFolder: ensurePickableFolder
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

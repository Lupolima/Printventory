/**
 * OS-specific Printventory paths for the extension UI.
 *
 * Chromium blocks AppData/Library (where printventory.db lives) in the folder
 * picker. The pickable default is Downloads/Printventory — the extension can
 * create it, then you select it once for silent writes.
 */
(function (root) {
  'use strict';

  const DOWNLOADS_INBOX = 'Downloads/PrintventoryInbox';
  const PICKABLE_FOLDER = 'Downloads/Printventory';

  function platformFromOs(os) {
    const value = String(os || '').toLowerCase();
    if (value === 'mac' || value === 'darwin') return 'mac';
    if (value === 'linux' || value === 'openbsd' || value === 'freebsd' || value === 'cros') return 'linux';
    return 'win';
  }

  /** App root (Windows: %LOCALAPPDATA%\Printventory). */
  function defaultAppDirectory(os) {
    switch (platformFromOs(os)) {
      case 'mac':
        return '~/Library/Application Support/printventory';
      case 'linux':
        return '~/.config/printventory';
      default:
        return '%LOCALAPPDATA%\\Printventory';
    }
  }

  /** Where printventory.db lives (main.js getDatabasePath). */
  function defaultDataDirectory(os) {
    const sep = platformFromOs(os) === 'win' ? '\\' : '/';
    return defaultAppDirectory(os) + sep + 'data';
  }

  /** Path to paste into the file dialog address bar (Windows expands %LOCALAPPDATA%). */
  function pickerNavigatePath(os) {
    return defaultDataDirectory(os);
  }

  /** Recommended folder to pick once (extension can create this under Downloads). */
  function defaultExtensionDirectory(os) {
    switch (platformFromOs(os)) {
      case 'mac':
      case 'linux':
        return '~/Downloads/Printventory';
      default:
        return '%USERPROFILE%\\Downloads\\Printventory';
    }
  }

  function defaultExtensionInboxDirectory(os) {
    const base = defaultExtensionDirectory(os);
    const sep = platformFromOs(os) === 'win' ? '\\' : '/';
    return base + sep + 'PrintventoryInbox';
  }

  function getPlatformInfo() {
    return new Promise(function (resolve) {
      if (!chrome.runtime || !chrome.runtime.getPlatformInfo) {
        resolve({ os: 'win' });
        return;
      }
      chrome.runtime.getPlatformInfo(function (info) {
        resolve(info || { os: 'win' });
      });
    });
  }

  async function resolvePaths() {
    const info = await getPlatformInfo();
    const os = info.os || 'win';
    const platform = platformFromOs(os);
    const appDirectory = defaultAppDirectory(os);
    const dataDirectory = defaultDataDirectory(os);
    const sep = platform === 'win' ? '\\' : '/';
    return {
      os: os,
      platform: platform,
      appDirectory: appDirectory,
      dataDirectory: dataDirectory,
      databaseFile: dataDirectory + sep + 'printventory.db',
      pickerNavigatePath: pickerNavigatePath(os),
      extensionDirectory: defaultExtensionDirectory(os),
      extensionInboxDirectory: defaultExtensionInboxDirectory(os),
      downloadsInbox: DOWNLOADS_INBOX,
      pickableFolder: PICKABLE_FOLDER
    };
  }

  /** Copy OS path so the user can paste it into the open-file dialog address bar. */
  async function copyPickerNavigatePath() {
    const paths = await resolvePaths();
    const text = paths.pickerNavigatePath;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return { ok: true, path: text, paths: paths };
      }
    } catch (e) { /* fall through */ }
    return { ok: false, path: text, paths: paths };
  }

  root.PrintventoryPaths = {
    DOWNLOADS_INBOX: DOWNLOADS_INBOX,
    PICKABLE_FOLDER: PICKABLE_FOLDER,
    platformFromOs: platformFromOs,
    defaultAppDirectory: defaultAppDirectory,
    defaultDataDirectory: defaultDataDirectory,
    pickerNavigatePath: pickerNavigatePath,
    defaultExtensionDirectory: defaultExtensionDirectory,
    defaultExtensionInboxDirectory: defaultExtensionInboxDirectory,
    resolvePaths: resolvePaths,
    copyPickerNavigatePath: copyPickerNavigatePath
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

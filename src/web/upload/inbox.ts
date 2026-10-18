import { useSyncExternalStore } from 'react';
import { currentToken } from '../ai/puterAuth';
import { callAction } from '../api';
import { applyFilterChange } from '../filters/search';
import { filterActions } from '../filters/store';
import { onServerEvent, showMessage } from '../page';
import { navigate } from '../shell/routes';

/**
 * The Upload folder and Organize Uploads (src/server/upload-inbox.js): where uploads wait, how
 * many models are waiting ("Not organized"), and the run that puts them where they belong.
 */

export interface UploadFolderInfo {
  uploadFolder: string;
  /** Where Organize Uploads puts models (the folder chosen, else the first STL Home folder). */
  destination: string;
  /** The folder chosen in Settings ('' for the first STL Home folder). */
  chosenDestination: string;
  waiting: number;
}

export interface OrganizeRun {
  id: number;
  by: string | null;
  running: boolean;
  stopping: boolean;
  phase: 'prepare' | 'categorize' | 'move' | 'tag' | 'done';
  total: number;
  done: number;
  useAi: boolean;
  destination: string;
  moved: { name: string; to: string; category: string; subcategory: string; models: number }[];
  movedCount: number;
  movedModels: number;
  tagged: number;
  failed: { name: string; error: string }[];
  warning: string | null;
}

interface State {
  info: UploadFolderInfo | null;
  run: OrganizeRun | null;
}

let state: State = { info: null, run: null };
const listeners = new Set<() => void>();
let started = false;
let reloadTimer = 0;

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export async function reloadUploadFolder() {
  try {
    setInfo(await callAction<UploadFolderInfo>('get-upload-folder'));
  } catch {
    /* logged out, or an older server */
  }
}

/** New info; the cards are drawn again when the Upload folder changed (their Not organized flag). */
function setInfo(info: UploadFolderInfo) {
  const before = state.info?.uploadFolder;
  set({ info });
  if (before !== info.uploadFolder) (window as unknown as { gridHost?: { rebuild?: () => void } }).gridHost?.rebuild?.();
}

/** Load once, then follow the server: settings saved, scans and moves (the count), and the run. */
function startFollowing() {
  if (started) return;
  started = true;
  void reloadUploadFolder();
  void callAction<OrganizeRun | null>('get-organize-uploads')
    .then((run) => set({ run }))
    .catch(() => {});
  const soon = () => {
    window.clearTimeout(reloadTimer);
    reloadTimer = window.setTimeout(() => void reloadUploadFolder(), 600);
  };
  onServerEvent('upload-folder-changed', (info: UploadFolderInfo) => setInfo(info));
  onServerEvent('refresh-grid', soon);
  onServerEvent('organize-uploads', (run: OrganizeRun | null) => {
    set({ run });
    if (run && !run.running) soon();
  });
}

const subscribe = (listener: () => void) => {
  startFollowing();
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useUploadFolder = () => useSyncExternalStore(subscribe, () => state.info);
export const useOrganizeRun = () => useSyncExternalStore(subscribe, () => state.run);
export const uploadFolderInfo = () => state.info;

/** A folder or file path compared loosely (either slash, no trailing one). */
const key = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '');

/** Whether a file waits in the Upload folder (its card says "Not organized"). */
export function isUnorganized(filePath: string, info: UploadFolderInfo | null = state.info): boolean {
  if (!info?.uploadFolder || !filePath || filePath.startsWith('url::')) return false;
  return key(filePath.split('::')[0]).startsWith(`${key(info.uploadFolder)}/`);
}

/** Whether the library shows the Upload folder (the Not organized filter). */
export function showsUnorganized(directory: string, info: UploadFolderInfo | null = state.info): boolean {
  return !!info?.uploadFolder && !!directory && key(directory) === key(info.uploadFolder);
}

/** The library with only the models waiting in the Upload folder. */
export function showUnorganized() {
  const folder = state.info?.uploadFolder;
  if (!folder) return;
  navigate('library');
  applyFilterChange(() => {
    filterActions.clearAll();
    filterActions.setDirectory(folder);
  });
}

/** Back to the whole library. */
export function hideUnorganized() {
  applyFilterChange(() => filterActions.setDirectory(''));
}

/** Start Organize Uploads (it runs on the server; useOrganizeRun follows it). */
export async function organizeUploads() {
  try {
    // Puter answers through this browser: without its sign-in here the server leaves the AI out.
    const result = await callAction<OrganizeRun | { busy: true }>('organize-uploads', { puterSignedIn: !!currentToken() });
    if ('busy' in result) await showMessage('Organize Uploads', 'Organize Uploads is already running.');
    else set({ run: result });
  } catch (error) {
    await showMessage('Organize Uploads', error instanceof Error ? error.message : String(error));
  }
}

export const stopOrganizing = () => callAction('stop-organize-uploads').catch(() => {});

/** Forget a finished run (its notice closes). */
export function dismissOrganizeRun() {
  if (state.run && !state.run.running) set({ run: null });
}

const plural = (n: number, one: string) => `${n.toLocaleString()} ${n === 1 ? one : `${one}s`}`;

/** What a run is doing, or how it ended. */
export function organizeText(run: OrganizeRun): string {
  if (run.running) {
    if (run.stopping) return 'Stopping Organize Uploads…';
    switch (run.phase) {
      case 'prepare':
        return `Organizing uploads: unpacking and scanning ${run.done} of ${run.total}…`;
      case 'categorize':
        return run.useAi ? 'Organizing uploads: the AI is choosing their categories…' : 'Organizing uploads: choosing their categories…';
      case 'move':
        return `Organizing uploads: moving ${run.done} of ${run.total}…`;
      case 'tag':
        return `Organizing uploads: AI tagging ${run.done} of ${run.total}…`;
      default:
        return 'Organizing uploads…';
    }
  }
  const parts = [`Organize Uploads finished: ${plural(run.movedCount, 'model folder')} moved (${plural(run.movedModels, 'model')})`];
  if (run.tagged) parts.push(`${plural(run.tagged, 'model')} tagged`);
  if (run.failed.length) parts.push(`${run.failed.length} not organized: ${run.failed.map((f) => `${f.name} (${f.error})`).join('; ')}`);
  return `${parts.join(', ')}.${run.warning ? ` ${run.warning}` : ''}`;
}

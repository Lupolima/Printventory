/**
 * Folders as models (the library toolbar's switch), kept per person (`folderModels`): each folder
 * holding model files shows as one card that opens the folder's page. Nothing on disk changes.
 */
import { useSyncExternalStore } from 'react';
import { settings } from '../api';

const KEY = 'folderModels';
let on = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

export const foldersAsModels = () => on;

export function setFoldersAsModels(value: boolean) {
  if (value === on) return;
  on = value;
  changed();
  settings.save(KEY, on ? '1' : '0').catch((error) => console.error('Error saving Folders as models:', error));
}

/** Read the saved choice (once, at startup). */
export async function loadFolderMode() {
  try {
    on = (await settings.get<string | null>(KEY)) === '1';
  } catch (_) {
    on = false;
  }
  changed();
}

export function subscribeFolderMode(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFoldersAsModels(): boolean {
  return useSyncExternalStore(subscribeFolderMode, () => on);
}

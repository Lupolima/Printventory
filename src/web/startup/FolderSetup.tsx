import { useEffect, useState, useSyncExternalStore } from 'react';
import { Folder, FolderPlus, ScanSearch } from 'lucide-react';
import { callAction, settings } from '../api';
import { Button } from '../components/Button';
import { pickFolder } from '../components/FolderPicker';
import { Modal } from '../components/Overlay';
import { showMessage } from '../page';
import { scanFolders } from '../scan/scan';
import { stlHomeDirectories } from '../scan/stlHome';
import { getCurrentUser } from '../session';
import { suggestedFolders, type Listing } from './folderSuggestions';

/**
 * Choose your model folders: the first thing an admin sees while no STL Home folder is set (after
 * the welcome on a first run). It suggests the folders mounted into the container (on Unraid,
 * the shares in /mnt/user), adds others with Choose Folder, saves them as STL Home and scans
 * them. "Not now" is remembered (folderSetupDismissed); Home's empty library opens it again.
 */

declare global {
  interface Window {
    openFolderSetup?: () => void;
  }
}

const DISMISSED = 'folderSetupDismissed';

let isOpen = false;
const listeners = new Set<() => void>();
function setOpen(value: boolean) {
  isOpen = value;
  listeners.forEach((listener) => listener());
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function openFolderSetup() {
  setOpen(true);
}

if (typeof window !== 'undefined') window.openFolderSetup = openFolderSetup;

/** An admin, no STL Home folder, and not put off with "Not now". */
export async function needsFolderSetup(): Promise<boolean> {
  if (getCurrentUser()?.role !== 'admin') return false;
  try {
    if ((await stlHomeDirectories()).length) return false;
    return (await settings.get<string | null>(DISMISSED)) !== '1';
  } catch {
    return false;
  }
}

export function FolderSetup() {
  const open = useSyncExternalStore(subscribe, () => isOpen);
  const [folders, setFolders] = useState<string[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFolders(null);
    setChosen(new Set());
    suggestedFolders((dir) => callAction<Listing>('browse-folders', dir)).then(
      (found) => {
        setFolders(found);
        // A single mounted folder (a /mnt/models volume) is what to scan: tick it.
        if (found.length === 1 && found[0].startsWith('/mnt/')) setChosen(new Set(found));
      },
      () => setFolders([])
    );
  }, [open]);

  const toggle = (dir: string) =>
    setChosen((previous) => {
      const next = new Set(previous);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });

  async function addOther() {
    const dir = await pickFolder({ title: 'Add a Model Folder', confirmLabel: 'Add This Folder' });
    if (!dir) return;
    setFolders((previous) => (previous?.includes(dir) ? previous : [...(previous || []), dir]));
    setChosen((previous) => new Set(previous).add(dir));
  }

  async function notNow() {
    setOpen(false);
    await settings.save(DISMISSED, '1').catch(() => {});
  }

  async function save() {
    const homes = (folders || []).filter((dir) => chosen.has(dir));
    if (!homes.length || saving) return;
    setSaving(true);
    try {
      await settings.save('stlHomeDirectories', JSON.stringify(homes));
      await settings.save('stlHome', homes[0]);
      setOpen(false);
      scanFolders(homes, { stlHome: true }).catch((error) => console.error('Folder setup scan:', error));
    } catch (error) {
      await showMessage('Choose Your Model Folders', `Could not save the folders: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => void notNow()}
      title="Choose your model folders"
      className="jp-folder-setup"
      footer={
        <>
          <Button onClick={() => void notNow()}>Not now</Button>
          <Button variant="primary" icon={ScanSearch} disabled={!chosen.size || saving} onClick={() => void save()} id="jp-folder-setup-save">
            Scan {chosen.size > 1 ? `${chosen.size} Folders` : 'Folder'}
          </Button>
        </>
      }
    >
      <p className="jp-meta">
        JusttPrint finds your models in these folders and checks them again every hour. Change them later under Settings → Scanning → STL Home.
      </p>
      {!folders ? (
        <p className="jp-meta">Looking for folders…</p>
      ) : (
        <ul className="jp-folder-setup__list" id="jp-folder-setup-list">
          {folders.length === 0 && <li className="jp-meta">No folders were found. Add the folder that holds your models.</li>}
          {folders.map((dir) => (
            <li key={dir}>
              <label className="jp-folder-setup__row">
                <input type="checkbox" checked={chosen.has(dir)} onChange={() => toggle(dir)} />
                <Folder size={18} aria-hidden="true" />
                <span title={dir}>{dir}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <Button icon={FolderPlus} onClick={() => void addOther()} id="jp-folder-setup-add">
        Add another folder…
      </Button>
    </Modal>
  );
}

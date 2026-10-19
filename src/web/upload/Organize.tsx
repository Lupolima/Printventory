import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, FolderInput, Loader2, Wand2 } from 'lucide-react';
import { callAction } from '../api';
import { Button } from '../components/Button';
import { pickFolder } from '../components/FolderPicker';
import { ModalDialog } from '../components/ModalDialog';
import { useCan } from '../session';
import { exposeGlobal, showMessage } from '../page';
import {
  dismissOrganizeRun,
  hideUnorganized,
  organizeText,
  organizeUploads,
  reloadUploadFolder,
  showUnorganized,
  showsUnorganized,
  stopOrganizing,
  useOrganizeRun,
  useUploadFolder,
  type UploadFolderInfo
} from './inbox';

declare global {
  interface Window {
    /** Settings → Scanning → Upload Folder. */
    openUploadFolderSettings?: () => void;
  }
}

/** How long "Organize Uploads finished" stays. */
const SHOW_MS = 20_000;

/** The notice for Organize Uploads, on every page: how far it is, then how it ended. */
export function OrganizeToast() {
  const run = useOrganizeRun();
  const canEdit = useCan('editor');
  const finished = !!run && !run.running;

  useEffect(() => {
    if (!finished) return undefined;
    const timer = window.setTimeout(dismissOrganizeRun, SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [finished, run?.id]);

  if (!run || !canEdit) return null;
  return (
    <div className="jp-undo-toast-region jp-organize-toast-region" role="status" aria-live="polite">
      <div className="jp-undo-toast jp-scan-toast" id="jp-organize-toast" data-state={run.running ? 'running' : 'done'}>
        {run.running ? (
          <Loader2 className="jp-spin" size={16} aria-hidden="true" />
        ) : (
          <CheckCircle2 className="jp-scan-toast__done" size={16} aria-hidden="true" />
        )}
        <span className="jp-undo-toast__text">{organizeText(run)}</span>
        {run.running ? (
          !run.stopping && (
            <button type="button" className="jp-undo-toast__button" onClick={() => void stopOrganizing()}>
              Stop
            </button>
          )
        ) : (
          <button type="button" className="jp-undo-toast__close" aria-label="Dismiss" onClick={dismissOrganizeRun}>
            ×
          </button>
        )}
      </div>
    </div>
  );
}

/** The library's Not organized filter: the models waiting in the Upload folder. */
export function UnorganizedButton({ directory }: { directory: string }) {
  const info = useUploadFolder();
  const canEdit = useCan('editor');
  const showing = showsUnorganized(directory, info);
  if (!canEdit || !info?.uploadFolder || (!info.waiting && !showing)) return null;
  return (
    <button
      type="button"
      id="jp-unorganized-button"
      className={`jp-btn jp-btn--${showing ? 'primary' : 'secondary'} jp-btn--md`}
      aria-pressed={showing}
      title={showing ? 'Show the whole library' : 'Show the models waiting in the Upload folder'}
      onClick={() => (showing ? hideUnorganized() : showUnorganized())}
    >
      <FolderInput size={16} aria-hidden="true" />
      <span>Not organized</span>
      {info.waiting > 0 && (
        <span className="jp-library-header__filter-count" aria-label={`${info.waiting} models`}>
          {info.waiting.toLocaleString()}
        </span>
      )}
    </button>
  );
}

/** Under the library's header while it shows the Upload folder: what Organize does, and the button. */
export function OrganizeNotice({ directory }: { directory: string }) {
  const info = useUploadFolder();
  const run = useOrganizeRun();
  const canEdit = useCan('editor');
  if (!canEdit || !info || !showsUnorganized(directory, info)) return null;
  const busy = !!run?.running;
  return (
    <div className="jp-upload-organize" id="jp-organize-uploads" role="region" aria-label="Organize Uploads">
      <p className="jp-upload-organize__text">
        {info.waiting
          ? `${info.waiting.toLocaleString()} ${info.waiting === 1 ? 'model is' : 'models are'} waiting in the Upload folder. `
          : 'Nothing is waiting in the Upload folder. '}
        Organize gives each folder (or model file) its category and moves it to{' '}
        <code>{info.destination ? `${info.destination}/Category/Subcategory/Model name` : 'Category/Subcategory/Model name'}</code>, archives unpacked and
        pictures and documents in their folders, then the AI tags it.
      </p>
      <Button
        variant="primary"
        icon={busy ? Loader2 : Wand2}
        id="jp-organize-button"
        disabled={busy || !info.waiting || !info.destination}
        title={info.destination ? undefined : 'Choose a destination in Settings → Scanning → Upload Folder'}
        onClick={() => void organizeUploads()}
      >
        {busy ? 'Organizing…' : 'Organize'}
      </Button>
    </div>
  );
}

/**
 * Settings → Scanning → Upload Folder: where uploads wait ("Not organized"), and where Organize
 * Uploads puts them (empty: the first STL Home folder). Registers window.openUploadFolderSettings.
 */
export function UploadFolderDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [upload, setUpload] = useState('');
  const [destination, setDestination] = useState('');
  const [fallback, setFallback] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(
    () =>
      exposeGlobal('openUploadFolderSettings', () => {
        void callAction<UploadFolderInfo>('get-upload-folder')
          .then((info) => {
            setUpload(info.uploadFolder);
            setDestination(info.chosenDestination);
            setFallback(info.chosenDestination ? '' : info.destination);
          })
          .catch(() => {})
          .finally(() => {
            if (!dialogRef.current?.open) dialogRef.current?.showModal();
          });
      }),
    []
  );

  async function choose(current: string, title: string, apply: (dir: string) => void) {
    const picked = await pickFolder({ title, initial: current || undefined, confirmLabel: 'Choose' });
    if (picked) apply(picked);
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      await callAction('save-upload-folder', upload.trim(), destination.trim());
      await reloadUploadFolder();
      dialogRef.current?.close();
    } catch (error) {
      await showMessage('Upload Folder', error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalDialog
      id="upload-folder-dialog"
      title="Upload Folder"
      dialogRef={dialogRef}
      description={
        <p className="setting-description">
          Uploads go to the Upload folder first and show in the library as <strong>Not organized</strong>. <strong>Organize</strong> (in the library&apos;s Not
          organized filter and on Home) then moves each folder or model file to its place: <code>Destination/Category/Subcategory/Model name</code>.
        </p>
      }
      footer={
        <>
          <button type="button" id="save-upload-folder" className="is-primary" disabled={saving} onClick={() => void save()}>
            Save
          </button>
          <button type="button" id="cancel-upload-folder" onClick={() => dialogRef.current?.close()}>
            Cancel
          </button>
        </>
      }
    >
      <div className="settings-group">
        <div className="form-group">
          <label htmlFor="upload-folder-path">Upload folder</label>
          <div className="jp-folder-field">
            <input
              type="text"
              id="upload-folder-path"
              value={upload}
              placeholder="No Upload folder: uploads go where you choose"
              onChange={(event) => setUpload(event.target.value)}
            />
            <button type="button" id="choose-upload-folder" onClick={() => void choose(upload, 'Upload Folder', setUpload)}>
              Choose…
            </button>
          </div>
        </div>
        <p className="setting-description">
          The Upload dialog starts here (you can still choose another folder). Made when it does not exist yet. Empty turns the Upload folder off.
        </p>
        <div className="form-group">
          <label htmlFor="organize-destination-path">Organize into</label>
          <div className="jp-folder-field">
            <input
              type="text"
              id="organize-destination-path"
              value={destination}
              placeholder={fallback ? `${fallback} (the first STL Home folder)` : 'The first STL Home folder'}
              onChange={(event) => setDestination(event.target.value)}
            />
            <button type="button" id="choose-organize-destination" onClick={() => void choose(destination || fallback, 'Organize Into', setDestination)}>
              Choose…
            </button>
          </div>
        </div>
        <p className="setting-description">
          Where Organize puts the models. Each gets a Category and Subcategory: the site&apos;s, else the AI&apos;s (Settings → AI Tagging), else from the words
          in its names, else Uncategorized/Other. A name already taken gets a number: <code>Name (2)</code>.
        </p>
      </div>
    </ModalDialog>
  );
}

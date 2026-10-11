import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { ImagePlus } from 'lucide-react';
import { ModalDialog } from '../components/ModalDialog';
import { exposeGlobal } from '../page';
import { searchByPhoto, shrinkPhoto } from './aiSearch';

declare global {
  interface Window {
    /** Search with a photo (the top bar's camera button). */
    openPhotoSearch?: () => void;
  }
}

/**
 * Search with a photo: drop, paste or choose a picture (on a phone, take one); the AI service
 * says what it shows and the library is searched for that. Registers window.openPhotoSearch.
 */
export function PhotoSearchDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  useEffect(
    () =>
      exposeGlobal('openPhotoSearch', () => {
        setPhoto(null);
        setError('');
        setBusy(false);
        if (!dialogRef.current?.open) dialogRef.current?.showModal();
      }),
    []
  );

  async function take(file: Blob | null | undefined) {
    if (!file) return;
    setError('');
    try {
      setPhoto(await shrinkPhoto(file));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  async function search() {
    if (!photo) return;
    setBusy(true);
    setError('');
    try {
      await searchByPhoto(photo);
      dialogRef.current?.close();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    void take(event.dataTransfer.files[0]);
  };
  const onPaste = (event: ClipboardEvent) => {
    const item = [...event.clipboardData.items].find((i) => i.type.startsWith('image/'));
    if (item) {
      event.preventDefault();
      void take(item.getAsFile());
    }
  };

  return (
    <ModalDialog
      id="photo-search-dialog"
      title="Search with a Photo"
      dialogRef={dialogRef}
      footer={
        <>
          <button type="button" id="photo-search-go" className="is-primary" disabled={!photo || busy} onClick={() => void search()}>
            {busy ? 'Looking…' : 'Search'}
          </button>
          <button type="button" onClick={() => dialogRef.current?.close()}>
            Cancel
          </button>
        </>
      }
    >
      <p className="setting-description">
        A photo of the part or thing you need. The AI service (Settings → AI Tagging) says what it shows, and the library is searched for that. The photo is
        made small and sent to that service; it is not kept.
      </p>
      <div
        className={`photo-search-drop${over ? ' is-over' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        onPaste={onPaste}
      >
        {photo ? (
          <img src={photo} alt="The photo to search with" />
        ) : (
          <span className="photo-search-drop__hint">
            <ImagePlus size={28} aria-hidden="true" />
            Drop a photo here, paste one, or click to choose (or take) one
          </span>
        )}
      </div>
      <input
        ref={inputRef}
        id="photo-search-file"
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(event) => {
          void take(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      {error && (
        <p className="setting-description photo-search-error" role="alert">
          {error}
        </p>
      )}
    </ModalDialog>
  );
}

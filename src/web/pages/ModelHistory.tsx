import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, History, RotateCcw, Trash2, Upload } from 'lucide-react';
import { callAction, downloadUrl, LIBRARY_CHANGED, uploadFile, uploads } from '../api';
import { Button, IconButton } from '../components/Button';
import { formatFileSize } from '../library/paths';
import { onServerEvent, showMessage } from '../page';
import { useCan } from '../session';

interface Version {
  id: number;
  fileName: string;
  size: number | null;
  createdAt: string;
  createdBy: string | null;
  note: string | null;
}

interface Change {
  id: number;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  changedAt: string;
  changedBy: string | null;
}

/** How each detail reads in the list of changes. */
export const FIELD_LABELS: Record<string, string> = {
  fileName: 'Name',
  designer: 'Designer',
  source: 'Source',
  parentModel: 'Parent model',
  license: 'License',
  notes: 'Notes',
  description: 'Description',
  tags: 'Tags',
  rating: 'Rating',
  categories: 'Categories'
};

const when = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** A value in the list of changes: short, "(none)" when empty; long text cut. */
export function shownValue(field: string, value: string | null): string {
  const text = String(value ?? '').trim();
  if (!text) return '(none)';
  if (field === 'rating') return text === '0' ? 'not rated' : `${'★'.repeat(Number(text) || 0)}`;
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Version history on a model's page: Upload New Version (the file is replaced in place and the
 * old one kept), the earlier versions (download, put back, delete), and the changes made to the
 * model's details (put a value back).
 */
export function ModelHistory({ filePath, folder }: { filePath: string; folder: string }) {
  const canEdit = useCan('editor');
  const [history, setHistory] = useState<{ versions: Version[]; changes: Change[] } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    callAction<{ versions: Version[]; changes: Change[] }>('get-model-history', filePath).then(setHistory, () => setHistory(null));
  }, [filePath]);

  useEffect(() => {
    load();
    const off = onServerEvent('model-history-changed', load);
    window.addEventListener(LIBRARY_CHANGED, load);
    return () => {
      off();
      window.removeEventListener(LIBRARY_CHANGED, load);
    };
  }, [load]);

  async function uploadVersion(file: File) {
    const name = filePath.split(/[\\/]/).pop() || filePath;
    const answer = await showMessage(
      'Upload New Version',
      `Replace ${name} with ${file.name}? The current file is kept in its version history and can be put back.`,
      ['Replace', 'Cancel']
    );
    if (answer !== 'Replace') return;
    setProgress(0);
    try {
      const info = await uploads.info().catch(() => null);
      const sent = await uploadFile(file, folder, { chunkBytes: info?.chunkBytes || 16 * 1024 * 1024, onProgress: setProgress });
      await callAction('replace-model-file', filePath, sent.filePath);
      load();
    } catch (error) {
      await showMessage('Upload New Version', errorText(error));
    } finally {
      setProgress(null);
    }
  }

  async function putBack(version: Version) {
    const answer = await showMessage('Put Back', `Put back the version of ${when(version.createdAt)}? The current file is kept in the history.`, [
      'Put Back',
      'Cancel'
    ]);
    if (answer !== 'Put Back') return;
    await callAction('restore-model-version', version.id).catch((error) => showMessage('Put Back', errorText(error)));
    load();
  }

  async function remove(version: Version) {
    const answer = await showMessage('Delete Version', `Delete the version of ${when(version.createdAt)} for good?`, ['Delete', 'Cancel']);
    if (answer !== 'Delete') return;
    await callAction('delete-model-version', version.id).catch((error) => showMessage('Delete Version', errorText(error)));
    load();
  }

  async function download(version: Version) {
    try {
      const { filePath: copy } = await callAction<{ filePath: string }>('download-model-version', version.id);
      const link = document.createElement('a');
      link.href = downloadUrl(copy);
      link.download = version.fileName;
      link.click();
    } catch (error) {
      await showMessage('Download', errorText(error));
    }
  }

  async function undo(change: Change) {
    const label = FIELD_LABELS[change.field] || change.field;
    const answer = await showMessage('Put Back', `Put the ${label.toLowerCase()} back to ${shownValue(change.field, change.oldValue)}?`, [
      'Put Back',
      'Cancel'
    ]);
    if (answer !== 'Put Back') return;
    await callAction('undo-model-change', change.id).catch((error) => showMessage('Put Back', errorText(error)));
    load();
  }

  if (!history) return null;
  const changes = showAll ? history.changes : history.changes.slice(0, 8);
  return (
    <section className="jp-card jp-model-page__panel jp-history" aria-labelledby="jp-history-title" id="jp-model-history">
      <div className="jp-kit__head">
        <h2 className="jp-panel-title" id="jp-history-title">
          Version history
        </h2>
        {canEdit && (
          <>
            <Button size="sm" icon={Upload} id="jp-upload-version" disabled={progress !== null} onClick={() => input.current?.click()}>
              {progress !== null ? `Uploading ${Math.round(progress * 100)}%` : 'Upload New Version'}
            </Button>
            <input
              ref={input}
              type="file"
              hidden
              id="jp-upload-version-file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void uploadVersion(file);
              }}
            />
          </>
        )}
      </div>

      <h3 className="jp-history__label">Files</h3>
      {history.versions.length ? (
        <ul className="jp-history__list" id="jp-history-versions">
          {history.versions.map((version) => (
            <li key={version.id}>
              <span className="jp-history__text">
                <span>{when(version.createdAt)}</span>
                <span className="jp-meta">
                  {[version.fileName, version.size ? formatFileSize(version.size) : '', version.createdBy ? `by ${version.createdBy}` : '', version.note || '']
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <span className="jp-history__actions">
                <IconButton size="sm" icon={Download} label="Download this version" onClick={() => void download(version)} />
                {canEdit && <IconButton size="sm" icon={RotateCcw} label="Put this version back" onClick={() => void putBack(version)} />}
                {canEdit && <IconButton size="sm" icon={Trash2} label="Delete this version" onClick={() => void remove(version)} />}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="jp-meta">Only the current file. Upload New Version keeps it here when you replace it.</p>
      )}

      <h3 className="jp-history__label">Changes</h3>
      {history.changes.length ? (
        <>
          <ul className="jp-history__list" id="jp-history-changes">
            {changes.map((change) => (
              <li key={change.id}>
                <span className="jp-history__text">
                  <span>
                    <strong>{FIELD_LABELS[change.field] || change.field}</strong>: {shownValue(change.field, change.oldValue)} →{' '}
                    {shownValue(change.field, change.newValue)}
                  </span>
                  <span className="jp-meta">
                    {when(change.changedAt)}
                    {change.changedBy ? ` · by ${change.changedBy}` : ''}
                  </span>
                </span>
                {canEdit && (
                  <span className="jp-history__actions">
                    <IconButton
                      size="sm"
                      icon={History}
                      label={`Put the ${(FIELD_LABELS[change.field] || change.field).toLowerCase()} back`}
                      onClick={() => void undo(change)}
                    />
                  </span>
                )}
              </li>
            ))}
          </ul>
          {history.changes.length > changes.length && (
            <button type="button" className="jp-link-button" onClick={() => setShowAll(true)}>
              Show all {history.changes.length} changes
            </button>
          )}
        </>
      ) : (
        <p className="jp-meta">No changes to the details yet.</p>
      )}
    </section>
  );
}

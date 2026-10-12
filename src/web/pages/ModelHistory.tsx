import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { callAction, uploadFile, uploads } from '../api';
import { Button } from '../components/Button';
import { showMessage } from '../page';
import { useCan } from '../session';

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

export const when = (iso: string) => {
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
 * Upload New Version (a model's page): the file is replaced in place (same name and folder) and
 * the old one is kept in the history (the History page).
 */
export function UploadVersionButton({ filePath, folder }: { filePath: string; folder: string }) {
  const canEdit = useCan('editor');
  const [progress, setProgress] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function uploadVersion(file: File) {
    const name = filePath.split(/[\\/]/).pop() || filePath;
    const answer = await showMessage('Upload New Version', `Replace ${name} with ${file.name}? The current file is kept in the History and can be put back.`, [
      'Replace',
      'Cancel'
    ]);
    if (answer !== 'Replace') return;
    setProgress(0);
    try {
      const info = await uploads.info().catch(() => null);
      const sent = await uploadFile(file, folder, { chunkBytes: info?.chunkBytes || 16 * 1024 * 1024, onProgress: setProgress });
      await callAction('replace-model-file', filePath, sent.filePath);
    } catch (error) {
      await showMessage('Upload New Version', errorText(error));
    } finally {
      setProgress(null);
    }
  }

  if (!canEdit) return null;
  return (
    <>
      <Button icon={Upload} id="jp-upload-version" disabled={progress !== null} onClick={() => input.current?.click()}>
        {progress !== null ? `Uploading ${Math.round(progress * 100)}%` : 'New Version'}
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
  );
}

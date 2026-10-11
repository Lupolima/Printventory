import { useState } from 'react';
import { callAction } from '../api';
import { showMessage } from '../page';

/** tidy-model-folders-preview (src/server/tidy-model-folders.js). */
interface TidyPreview {
  moveCount: number;
  registerCount: number;
  fileCount: number;
  already: number;
  skipped: { zip: number; link: number; missing: number };
  sample: { id: string; action: 'move' | 'register'; from: string; to: string; files: string[]; media: string[] }[];
}

interface TidyResult {
  moved: number;
  registered: number;
  files: number;
  failed: { name: string; error: string }[];
}

const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;

/**
 * Tidy Into Model Folders (Organize, admins): a preview of which models move into a folder of
 * their own (and which folders already hold one model and stay), then the moves.
 */
export function TidyModelFolders() {
  const [preview, setPreview] = useState<TidyPreview | null>(null);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [covers, setCovers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    setBusy(true);
    setMessage('');
    try {
      setPreview(await callAction<TidyPreview>('tidy-model-folders-preview', null));
      setUnticked(new Set());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const total = preview ? preview.moveCount + preview.registerCount : 0;
  const chosen = preview ? preview.sample.filter((group) => !unticked.has(group.id)) : [];
  // Every model, unless some were unticked (then the ticked ones shown).
  const count = unticked.size ? chosen.length : total;

  async function run() {
    if (!preview || !count) return;
    const answer = await showMessage(
      'Tidy Into Model Folders',
      `Give ${plural(count, 'model')} a folder of its own? Files move on disk; their details, tags and history go with them.`,
      ['Tidy', 'Cancel']
    );
    if (answer !== 'Tidy') return;
    setBusy(true);
    try {
      const result = await callAction<TidyResult>('tidy-model-folders', null, unticked.size ? chosen.map((group) => group.id) : null, covers);
      setMessage(
        [
          `${plural(result.moved, 'model')} moved into ${result.moved === 1 ? 'a folder of its own' : 'folders of their own'}; ${plural(result.registered, 'folder')} kept as ${result.registered === 1 ? "the model's folder" : "the models' folders"}.`,
          result.failed.length ? `Failed: ${result.failed.map((f) => `${f.name} (${f.error})`).join('; ')}.` : ''
        ]
          .filter(Boolean)
          .join(' ')
      );
      setPreview(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const skipped = preview
    ? [
        preview.already ? `${plural(preview.already, 'file')} already in model folders` : '',
        preview.skipped.zip ? `${plural(preview.skipped.zip, 'model')} inside ZIP files` : '',
        preview.skipped.link ? `${plural(preview.skipped.link, 'link')} without a file` : '',
        preview.skipped.missing ? `${plural(preview.skipped.missing, 'missing file')}` : ''
      ].filter(Boolean)
    : [];

  return (
    <div className="jp-tidy" id="tidy-model-folders">
      {preview && (
        <div className="organize-preview" id="tidy-preview">
          <p id="tidy-summary">
            {total === 0
              ? 'Every model has a folder of its own.'
              : [
                  preview.moveCount
                    ? `${plural(preview.moveCount, 'model')} ${preview.moveCount === 1 ? 'moves' : 'move'} into a new folder named after ${preview.moveCount === 1 ? 'it' : 'each'}.`
                    : '',
                  preview.registerCount
                    ? `${plural(preview.registerCount, 'folder')} already ${preview.registerCount === 1 ? 'holds one model and becomes its' : 'hold one model each and become their'} folder (nothing moves).`
                    : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
            {skipped.length ? ` Left alone: ${skipped.join(', ')}.` : ''}
          </p>
          {preview.sample.length > 0 && (
            <ul className="jp-tidy__list" id="tidy-list">
              {preview.sample.map((group) => (
                <li key={group.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!unticked.has(group.id)}
                      onChange={(event) =>
                        setUnticked((now) => {
                          const next = new Set(now);
                          if (event.target.checked) next.delete(group.id);
                          else next.add(group.id);
                          return next;
                        })
                      }
                    />
                    <span>
                      <span className="jp-tidy__files">{group.files.join(', ')}</span>
                      {group.media.length > 0 && <span className="jp-meta"> + {group.media.join(', ')}</span>}
                      <span className="jp-meta jp-tidy__to">{group.action === 'move' ? `→ ${group.to}` : `stays in ${group.to}`}</span>
                    </span>
                  </label>
                </li>
              ))}
              {total > preview.sample.length && <li className="jp-meta">… and {plural(total - preview.sample.length, 'more model')}</li>}
            </ul>
          )}
          {total > 0 && (
            <label className="jp-tidy__covers">
              <input type="checkbox" id="tidy-covers" checked={covers} onChange={(event) => setCovers(event.target.checked)} />
              <span>Save each model's library picture as image/cover when its folder has no picture</span>
            </label>
          )}
        </div>
      )}
      {message && (
        <p className="organize-result" id="tidy-result" role="status">
          {message}
        </p>
      )}
      <div className="jp-organize__actions">
        <button type="button" id="tidy-preview-button" className="jp-btn jp-btn--secondary jp-btn--md" disabled={busy} onClick={() => void load()}>
          {busy && !preview ? 'Looking…' : 'Preview'}
        </button>
        <button
          type="button"
          id="tidy-run-button"
          className="jp-btn jp-btn--primary jp-btn--md"
          disabled={busy || !preview || !count}
          onClick={() => void run()}
        >
          {count ? `Tidy ${plural(count, 'Model')}` : 'Tidy'}
        </button>
      </div>
    </div>
  );
}

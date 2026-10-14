import { useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { callAction, LIBRARY_CHANGED, models as modelApi, prints, tags as tagApi } from '../api';
import { saveModelField } from '../library/saving';
import { STATUSES, STATUS_LABELS } from '../print/printStatus';
import { Button, IconButton } from '../components/Button';
import { render as renderMarkdown } from '../notes/markdown';
import { NotesEnglish } from '../notes/NotesEnglish';
import { showMessage } from '../page';
import { useCan } from '../session';

/** Where saved text keeps the original under its English (src/server/notes-translation.js). */
const ORIGINAL_MARK = '\n\n---\n\nOriginal:\n\n';

/** Text in English with its original folded away under "Original". */
function Translated({ text }: { text: string }) {
  const [english, original] = text.split(ORIGINAL_MARK);
  return (
    <>
      <div className="jp-model-page__markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(english) }} />
      {original !== undefined && (
        <details className="jp-notes-original">
          <summary>Original</summary>
          <div className="jp-model-page__markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(original) }} />
        </details>
      )}
    </>
  );
}

/**
 * The model page's Description (under the gallery): what the model is. Its own (from a 3MF, or
 * written in Edit), else what its site says (English first, the original folded away).
 */
export function DescriptionSection({
  filePath,
  description,
  siteDescription,
  siteDescriptionEnglish
}: {
  filePath: string;
  description: string | null | undefined;
  siteDescription?: string | null;
  siteDescriptionEnglish?: string | null;
}) {
  const own = String(description || '').trim();
  const fromSite = !own && (siteDescriptionEnglish || siteDescription);
  const siteText =
    siteDescriptionEnglish && siteDescription && siteDescriptionEnglish !== siteDescription
      ? `${siteDescriptionEnglish}${ORIGINAL_MARK}${siteDescription}`
      : String(siteDescriptionEnglish || siteDescription || '');
  return (
    <section className="jp-card jp-model-page__notes jp-model-page__description" id="jp-model-description" aria-labelledby="jp-model-description-title">
      <div className="jp-model-page__panel-head">
        <h2 className="jp-panel-title" id="jp-model-description-title">
          Description
        </h2>
      </div>
      {own ? (
        <>
          <Translated text={own} />
          <NotesEnglish filePath={filePath} notes={own} />
        </>
      ) : fromSite ? (
        <>
          <Translated text={siteText} />
          <p className="jp-meta">From the model's site.</p>
        </>
      ) : (
        <p className="jp-meta">No description.</p>
      )}
    </section>
  );
}

/**
 * The model page's Notes (in the sidebar): what you write about the model. Editors change them in
 * place.
 */
export function NotesPanel({ filePath, notes, onSaved }: { filePath: string; notes: string | null | undefined; onSaved: () => void }) {
  const canEdit = useCan('editor');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(notes || ''));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(String(notes || ''));
  }, [notes, editing]);

  async function save() {
    setSaving(true);
    try {
      // The library's save: asks whose notes stay when someone else changed them meanwhile, and offers Undo.
      if (window.detailsHost) {
        await window.detailsHost.saveField(filePath, 'notes', draft.trim(), String(notes || ''));
      } else {
        const current = await modelApi.get<Record<string, unknown>>(filePath);
        if (!current) throw new Error('This model is not in the library any more.');
        // The whole model: a save of some fields only would drop its tags.
        await callAction('save-model', { ...current, notes: draft.trim(), _base: { notes: String(notes || '') } });
      }
      setEditing(false);
      onSaved();
    } catch (error) {
      await showMessage('Notes', error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  const text = String(notes || '').trim();
  return (
    <section className="jp-card jp-model-page__panel" id="jp-model-notes" aria-labelledby="jp-model-notes-title">
      <div className="jp-model-page__panel-head">
        <h2 className="jp-panel-title" id="jp-model-notes-title">
          Notes
        </h2>
        {canEdit && !editing && <IconButton icon={Pencil} size="sm" label="Edit your notes" onClick={() => setEditing(true)} />}
      </div>
      {editing ? (
        <>
          <textarea
            className="jp-input jp-model-page__notes-input"
            id="jp-model-notes-input"
            rows={6}
            value={draft}
            autoFocus
            placeholder="Anything you want to remember about this model"
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="jp-model-page__notes-buttons">
            <Button size="sm" id="jp-model-notes-cancel" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" id="jp-model-notes-save" onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </>
      ) : text ? (
        <div className="jp-model-page__markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
      ) : (
        <p className="jp-meta">{canEdit ? 'No notes yet: anything you want to remember about this model.' : 'No notes.'}</p>
      )}
    </section>
  );
}

// ---- Editing in place on the model page (the sidebar has its own editors) -----------------------

/** The print status, changed right here (editors). */
export function PageStatus({ filePath, status, onSaved }: { filePath: string; status: string; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  return (
    <select
      id="jp-model-page-status"
      className="jp-model-page__select"
      value={status}
      disabled={saving}
      aria-label="Print status"
      onChange={async (event) => {
        setSaving(true);
        try {
          await prints.setStatus([filePath], event.target.value);
          window.dispatchEvent(new Event(LIBRARY_CHANGED));
          onSaved();
        } catch (error) {
          await showMessage('Print Status', error instanceof Error ? error.message : String(error));
        } finally {
          setSaving(false);
        }
      }}
    >
      {STATUSES.map((value) => (
        <option key={value} value={value}>
          {STATUS_LABELS[value]}
        </option>
      ))}
    </select>
  );
}

/** The model's tags: remove one (×), or add one (with the library's tags offered). Undo works as in the sidebar. */
export function PageTags({ filePath, tags, onSaved, onShow }: { filePath: string; tags: string[]; onSaved: () => void; onShow: (name: string) => void }) {
  const [draft, setDraft] = useState('');
  const [known, setKnown] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    tagApi.list().then(
      (list) => setKnown(list.map((tag) => tag.name)),
      () => setKnown([])
    );
  }, []);

  async function save(next: string[]) {
    setSaving(true);
    try {
      if (await saveModelField('tags', next, filePath, tags)) onSaved();
    } finally {
      setSaving(false);
    }
  }
  const add = () => {
    const name = draft.trim();
    setDraft('');
    if (name && !tags.some((tag) => tag.toLowerCase() === name.toLowerCase())) void save([...tags, name]);
  };

  return (
    <span className="jp-page-tags" id="jp-model-page-tags">
      {tags.map((name) => (
        <span key={name} className="jp-chip jp-page-tags__chip">
          <button type="button" className="jp-page-tags__name" title={`Show models tagged ${name}`} onClick={() => onShow(name)}>
            {name}
          </button>
          <button
            type="button"
            className="jp-page-tags__remove"
            aria-label={`Remove the tag ${name}`}
            disabled={saving}
            onClick={() => void save(tags.filter((t) => t !== name))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="jp-input jp-page-tags__input"
        id="jp-model-page-tag-input"
        list="jp-model-page-tag-names"
        placeholder="Add a tag"
        aria-label="Add a tag"
        value={draft}
        disabled={saving}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            add();
          }
        }}
        onBlur={() => draft.trim() && add()}
      />
      <datalist id="jp-model-page-tag-names">
        {known
          .filter((name) => !tags.includes(name))
          .slice(0, 300)
          .map((name) => (
            <option key={name} value={name} />
          ))}
      </datalist>
    </span>
  );
}

/** Delete one print history entry (after asking), as the sidebar's history does. */
export function DeletePrintButton({ id, label, onDeleted }: { id: number; label: string; onDeleted: () => void }) {
  return (
    <IconButton
      size="sm"
      icon={Trash2}
      label={`Delete the print of ${label}`}
      onClick={async () => {
        if ((await showMessage('Delete Print', `Delete the print of ${label} from the history?`, ['Delete', 'Cancel'])) !== 'Delete') return;
        try {
          await prints.removeEvent(id);
          window.dispatchEvent(new Event(LIBRARY_CHANGED));
          onDeleted();
        } catch (error) {
          await showMessage('Delete Print', error instanceof Error ? error.message : String(error));
        }
      }}
    />
  );
}

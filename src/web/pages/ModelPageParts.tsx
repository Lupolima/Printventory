import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { callAction, models as modelApi } from '../api';
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
  const canEdit = useCan('editor');
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
        {canEdit && <IconButton icon={Pencil} size="sm" label="Edit the description" onClick={() => window.openEditModel?.(filePath)} />}
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
 * place; the whole model is saved (a save of some fields only would drop its tags).
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
      const current = await modelApi.get<Record<string, unknown>>(filePath);
      if (!current) throw new Error('This model is not in the library any more.');
      const tags = (Array.isArray(current.tags) ? current.tags : []).map((tag) =>
        typeof tag === 'string' ? tag : String((tag as { name?: string })?.name ?? '')
      );
      await callAction('save-model', { ...current, tags, notes: draft.trim(), _base: { notes: String(notes || '') } });
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
            <Button size="sm" onClick={() => setEditing(false)} disabled={saving}>
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

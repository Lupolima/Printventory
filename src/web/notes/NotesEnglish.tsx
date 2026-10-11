import { useEffect, useState } from 'react';
import { callAction } from '../api';
import { render as renderMarkdown } from './markdown';

/** Where saved notes keep the original under their English (src/server/notes-translation.js). */
const ORIGINAL_MARK = '\n\n---\n\nOriginal:\n\n';

/** Whether notes look like they are in another script and have no English yet (the server decides for sure). */
export function mayNeedEnglish(notes: string | null | undefined): boolean {
  const text = String(notes || '');
  if (!text.trim() || text.includes(ORIGINAL_MARK)) return false;
  return /[^\u0000-ɏḀ-ỿ\s\d\p{P}\p{S}]/u.test(text);
}

const BY: Record<string, string> = { free: 'the free translation service', ai: 'the AI service' };

/**
 * English under notes in another language (Settings → MakerWorld picks the translator): the
 * translation and who made it. Nothing when the notes are English or the translator is off.
 */
export function NotesEnglish({ filePath, notes, compact = false }: { filePath: string; notes: string | null | undefined; compact?: boolean }) {
  const [result, setResult] = useState<{ english: string | null; by: string | null; error: string | null } | null>(null);
  const wanted = mayNeedEnglish(notes);

  useEffect(() => {
    setResult(null);
    if (!wanted) return undefined;
    let live = true;
    callAction<{ english: string | null; by: string | null; error: string | null }>('translate-notes', filePath).then(
      (found) => live && setResult(found),
      () => {}
    );
    return () => {
      live = false;
    };
  }, [filePath, notes, wanted]);

  if (!wanted || !result) return null;
  if (!result.english) {
    return result.error ? <p className="jp-meta jp-notes-english__error">No English translation: {result.error}</p> : null;
  }
  return (
    <div className={`jp-notes-english${compact ? ' is-compact' : ''}`} id="jp-notes-english">
      <p className="jp-notes-english__label">English{result.by ? ` · translated by ${BY[result.by] || result.by}` : ''}</p>
      <div className="jp-model-page__markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(result.english) }} />
    </div>
  );
}

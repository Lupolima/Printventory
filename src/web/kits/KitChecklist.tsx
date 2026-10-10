import { useCallback, useEffect, useState } from 'react';
import { LIBRARY_CHANGED } from '../api';
import { ProgressBar } from '../components/Panel';
import { formatDuration, formatGrams } from '../makerworld/makerworld';
import { onServerEvent, showMessage } from '../page';
import { useCan } from '../session';
import { getKit, progressText, setKitPart, type Kit, type KitPart } from './kits';

/**
 * Kit progress for a model page or a folder page: the parts (a 3MF's plates, a folder's files),
 * ticked as they are printed. `showSingle`: also for a kit of one part (a folder of one file).
 */
export function KitChecklist({ target, showSingle = false }: { target: string; showSingle?: boolean }) {
  const canEdit = useCan('editor');
  const [kit, setKit] = useState<Kit | null>(null);

  const load = useCallback(() => {
    getKit(target).then(setKit, () => setKit(null));
  }, [target]);

  useEffect(() => {
    load();
    const off = onServerEvent('kit-changed', load);
    window.addEventListener(LIBRARY_CHANGED, load);
    return () => {
      off();
      window.removeEventListener(LIBRARY_CHANGED, load);
    };
  }, [load]);

  async function toggle(part: KitPart) {
    setKit((now) =>
      now
        ? {
            ...now,
            parts: now.parts.map((p) => (p === part ? { ...p, done: !p.done } : p)),
            done: now.done + (part.done ? -1 : 1)
          }
        : now
    );
    try {
      await setKitPart(part.filePath, part.plate, !part.done);
    } catch (error) {
      await showMessage('Kit progress', error instanceof Error ? error.message : String(error));
      load();
    }
  }

  if (!kit || (kit.total < 2 && !showSingle)) return null;
  const left = kit.parts.filter((p) => !p.done);
  const secondsLeft = left.reduce((sum, p) => sum + (p.seconds || 0), 0);
  const gramsLeft = left.reduce((sum, p) => sum + (p.grams || 0), 0);
  return (
    <section className="jp-card jp-kit" aria-labelledby="jp-kit-title" id="jp-kit">
      <div className="jp-kit__head">
        <h2 className="jp-panel-title" id="jp-kit-title">
          Kit progress
        </h2>
        <span className="jp-kit__count" id="jp-kit-count">
          {progressText(kit.done, kit.total)}
        </span>
      </div>
      <ProgressBar value={kit.done} max={kit.total} label="Kit progress" tone={kit.done === kit.total ? 'success' : 'accent'} />
      {left.length > 0 && (secondsLeft > 0 || gramsLeft > 0) && (
        <p className="jp-meta">
          Left to print: {[secondsLeft > 0 && `about ${formatDuration(secondsLeft)}`, gramsLeft > 0 && formatGrams(gramsLeft)].filter(Boolean).join(' · ')}
        </p>
      )}
      <ul className="jp-kit__parts">
        {kit.parts.map((part) => (
          <li key={`${part.modelId}:${part.plate}`} className={part.done ? 'is-done' : undefined}>
            <label>
              <input type="checkbox" checked={part.done} disabled={!canEdit} onChange={() => void toggle(part)} />
              <span className="jp-kit__label">{part.label}</span>
            </label>
            <span className="jp-meta">
              {[part.seconds && formatDuration(part.seconds), part.grams && formatGrams(part.grams), part.done && part.doneBy ? `by ${part.doneBy}` : '']
                .filter(Boolean)
                .join(' · ')}
            </span>
          </li>
        ))}
      </ul>
      <p className="jp-meta">Tick parts as you print them. Logging a print as Printed ticks every part of that file.</p>
    </section>
  );
}

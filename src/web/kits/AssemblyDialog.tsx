import { useEffect, useRef, useState } from 'react';
import { Move, Rotate3d } from 'lucide-react';
import { callAction } from '../api';
import { cx } from '../components/Button';
import { ModalDialog } from '../components/ModalDialog';
import { exposeGlobal, showMessage } from '../page';
import { isPreviewablePath } from '../preview/studio';
import { useCan } from '../session';
import type { PartPose, PreviewEngine } from '../preview/engine';

declare global {
  interface Window {
    /** Assembly view: a folder's model files in one 3D scene. */
    openAssembly?: (folder: string) => void;
  }
}

/** Most parts loaded into one scene. */
const MAX_PARTS = 60;

type Layout = 'designed' | 'laid-out';
interface Part {
  id: string;
  name: string;
  visible: boolean;
}
interface SavedAssembly {
  layout: Layout;
  poses: Record<string, PartPose>;
}

/**
 * Assembly view: a folder's model files (Folders as models, a kit) in one 3D scene, to see the
 * whole model. "As designed" keeps each file where it puts itself (parts exported from one design
 * line up); "Laid out" spreads them on a grid. Pick a part (in the list or the scene) to move or
 * turn it; Save keeps the layout for everyone. Registers window.openAssembly.
 */
export function AssemblyDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<PreviewEngine | null>(null);
  const tokenRef = useRef(0);
  const canEdit = useCan('editor');
  const [folder, setFolder] = useState('');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('');
  const [parts, setParts] = useState<Part[]>([]);
  const [layout, setLayout] = useState<Layout>('designed');
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<'translate' | 'rotate'>('translate');
  const [changed, setChanged] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => exposeGlobal('openAssembly', (dir: string) => void open(dir)));

  function cleanup() {
    tokenRef.current++;
    engineRef.current?.dispose();
    engineRef.current = null;
    setParts([]);
    setSelected(null);
  }

  async function open(dir: string) {
    cleanup();
    const token = tokenRef.current;
    setFolder(dir);
    setTitle(dir.split(/[\\/]/).filter(Boolean).pop() || dir);
    setStatus('Getting the parts…');
    setChanged(false);
    setNote('');
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
    try {
      const [found, saved] = await Promise.all([
        callAction<{ files: { id: number; filePath: string; fileName: string | null }[] } | null>('get-folder', dir),
        callAction<SavedAssembly | null>('get-assembly', dir)
      ]);
      const files = (found?.files || []).filter((file) => isPreviewablePath(file.filePath));
      if (!files.length) throw new Error('This folder has no models that can be shown in 3D');
      await new Promise((resolve) => setTimeout(resolve, 60));
      const [{ PreviewEngine: Engine, loadPreviewObject, assembleParts }, { loadStudioSettings }] = await Promise.all([
        import('../preview/engine'),
        import('../preview/studio')
      ]);
      if (token !== tokenRef.current || !canvasRef.current || !containerRef.current) return;
      const engine = new Engine(canvasRef.current, containerRef.current, loadStudioSettings(), {
        dimensions: () => {},
        parts: () => {},
        sitOnFace: () => {},
        partPicked: (id) => setSelected(id),
        partMoved: () => setChanged(true)
      });
      engineRef.current = engine;
      const objects: { object: import('three').Object3D; name: string; id: string }[] = [];
      let failed = 0;
      const toLoad = files.slice(0, MAX_PARTS);
      for (let i = 0; i < toLoad.length; i++) {
        const file = toLoad[i];
        setStatus(`Loading part ${i + 1} of ${toLoad.length}…\n${file.fileName || ''}`);
        try {
          const loaded = await loadPreviewObject(file.filePath, { isCurrent: () => token === tokenRef.current, status: () => {}, set3mfRequest: () => {} });
          if (token !== tokenRef.current) return;
          if ('imageOnly' in loaded) failed++;
          else objects.push({ object: loaded.object, name: (file.fileName || '').replace(/\.[a-z0-9]{2,6}$/i, ''), id: String(file.id) });
        } catch (error) {
          if ((error as Error)?.message?.includes('cancelled')) return;
          failed++;
        }
      }
      if (!objects.length) throw new Error('None of the parts could be loaded');
      const start: Layout = saved?.layout || 'designed';
      engine.showModel(assembleParts(objects, start));
      engine.setAssembly(true);
      if (saved?.poses) engine.setPartPoses(saved.poses);
      setLayout(start);
      setParts(objects.map(({ id, name }) => ({ id, name, visible: true })));
      const notes: string[] = [];
      if (files.length > MAX_PARTS) notes.push(`Showing the first ${MAX_PARTS} of ${files.length} parts`);
      if (failed) notes.push(`${failed} ${failed === 1 ? 'part' : 'parts'} could not be loaded`);
      setNote(notes.join(' · '));
      setStatus('');
    } catch (error) {
      if (token === tokenRef.current) setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  // The handle follows the picked part and the tool.
  useEffect(() => {
    engineRef.current?.editPart(canEdit ? selected : null, mode);
  }, [selected, mode, canEdit]);

  function chooseLayout(next: Layout) {
    setLayout(next);
    setSelected(null);
    engineRef.current?.relayoutParts(next);
    setChanged(true);
  }

  function toggle(id: string) {
    setParts((now) =>
      now.map((part) => {
        if (part.id !== id) return part;
        engineRef.current?.setPartVisible(id, !part.visible);
        return { ...part, visible: !part.visible };
      })
    );
  }

  async function save() {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      await callAction('save-assembly', folder, { layout, poses: engine.partPoses() });
      setChanged(false);
    } catch (error) {
      await showMessage('Assembly', error instanceof Error ? error.message : String(error));
    }
  }

  async function reset() {
    await callAction('save-assembly', folder, null).catch(() => {});
    void open(folder);
  }

  return (
    <ModalDialog
      id="assembly-dialog"
      title={`Assembly: ${title}`}
      dialogRef={dialogRef}
      className="assembly-dialog"
      onClose={cleanup}
      footer={
        <>
          {canEdit && (
            <>
              <button type="button" id="assembly-save" className="is-primary" disabled={!changed || !parts.length} onClick={() => void save()}>
                Save Layout
              </button>
              <button type="button" onClick={() => void reset()} disabled={!parts.length} title="Forget the saved layout">
                Reset
              </button>
            </>
          )}
          <button type="button" onClick={() => dialogRef.current?.close()}>
            Close
          </button>
        </>
      }
    >
      <div className="assembly">
        <div className="assembly__stage" ref={containerRef}>
          <canvas ref={canvasRef} />
          {status && <p className="assembly__status">{status}</p>}
        </div>
        <aside className="assembly__side">
          <div className="jp-chip-row" role="group" aria-label="Layout">
            <button
              type="button"
              id="assembly-designed"
              className={cx('jp-chip', layout === 'designed' && 'is-selected')}
              aria-pressed={layout === 'designed'}
              onClick={() => chooseLayout('designed')}
              title="Every part where its file puts it: parts exported from one design line up"
            >
              As designed
            </button>
            <button
              type="button"
              id="assembly-laid-out"
              className={cx('jp-chip', layout === 'laid-out' && 'is-selected')}
              aria-pressed={layout === 'laid-out'}
              onClick={() => chooseLayout('laid-out')}
            >
              Laid out
            </button>
          </div>
          {canEdit && (
            <div className="jp-chip-row" role="group" aria-label="Tool">
              <button
                type="button"
                className={cx('jp-chip', mode === 'translate' && 'is-selected')}
                aria-pressed={mode === 'translate'}
                onClick={() => setMode('translate')}
              >
                <Move size={14} aria-hidden="true" /> Move
              </button>
              <button
                type="button"
                className={cx('jp-chip', mode === 'rotate' && 'is-selected')}
                aria-pressed={mode === 'rotate'}
                onClick={() => setMode('rotate')}
              >
                <Rotate3d size={14} aria-hidden="true" /> Turn
              </button>
            </div>
          )}
          <p className="jp-meta">
            {canEdit ? 'Pick a part here or in the scene to move or turn it.' : 'Turn the scene with the mouse; tick parts to show or hide them.'}
          </p>
          <ul className="assembly__parts" id="assembly-parts">
            {parts.map((part) => (
              <li key={part.id} className={cx(part.id === selected && 'is-selected')}>
                <input type="checkbox" checked={part.visible} aria-label={`Show ${part.name}`} onChange={() => toggle(part.id)} />
                <button type="button" className="assembly__part-name" onClick={() => setSelected(part.id === selected ? null : part.id)}>
                  {part.name}
                </button>
              </li>
            ))}
          </ul>
          {note && <p className="jp-meta">{note}</p>}
        </aside>
      </div>
    </ModalDialog>
  );
}

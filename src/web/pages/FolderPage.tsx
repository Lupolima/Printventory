import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Boxes, FileArchive, FolderOpen, FolderPlus, Library, Pencil } from 'lucide-react';
import { isPreviewablePath } from '../preview/studio';
import { callAction, LIBRARY_CHANGED } from '../api';
import { Button, cx } from '../components/Button';
import { EmptyState, Panel, Skeleton } from '../components/Panel';
import { Prop } from '../details/ModelDetailsPanel';
import { applyFilterChange } from '../filters/search';
import { filterActions } from '../filters/store';
import { KitChecklist } from '../kits/KitChecklist';
import { folderFilterFor, formatFileSize } from '../library/paths';
import { render as renderMarkdown } from '../notes/markdown';
import { onServerEvent, showMessage } from '../page';
import { useCan } from '../session';
import { navigate } from '../shell/routes';
import { loadSlicers, offerSlicerSettings, sendToSlicer, type Slicer } from '../slicer';
import { showCategory } from './CategoriesPage';
import { ModelMediaSection } from '../media/ModelMediaSection';
import { FileCard, type FolderFile } from './ModelPage';

/** A folder as a model (get-folder, src/core/folder-models.js). */
interface Folder {
  path: string;
  name: string;
  files: (FolderFile & { id: number; designer: string | null; dateAdded: string | null })[];
  notes: string;
  designers: string[];
  licenses: string[];
  sources: string[];
  tags: string[];
  categories: string[];
  size: number;
  added: string | null;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function showInLibrary(change: () => void) {
  navigate('library');
  applyFilterChange(() => {
    filterActions.clearAll();
    change();
  });
}

/** The folder's pictures: one per file that has one, large, with a strip to pick from. */
function Pictures({ files }: { files: Folder['files'] }) {
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const images = files.map((file) => file.image).filter((image): image is string => !!image && !broken.has(image));
  const [index, setIndex] = useState(0);
  const drop = (src: string) => setBroken((now) => new Set(now).add(src));
  if (!images.length) return null;
  const shown = images[index < images.length ? index : 0];
  return (
    <div className="jp-model-page__gallery">
      <div className="jp-model-page__stage">
        <img src={shown} alt="" draggable={false} onError={() => drop(shown)} />
      </div>
      {images.length > 1 && (
        <div className="jp-details__strip" role="listbox" aria-label="Pictures" aria-orientation="horizontal">
          {images.slice(0, 40).map((src, i) => (
            <button
              key={i}
              type="button"
              role="option"
              aria-selected={i === index}
              aria-label={`Picture ${i + 1} of ${images.length}`}
              className={cx('jp-details__thumb', i === index && 'is-selected')}
              onClick={() => setIndex(i)}
            >
              <img src={src} alt="" draggable={false} onError={() => drop(src)} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The folder's own notes: shown, and changed by editors. */
function FolderNotes({ folder, onSaved }: { folder: Folder; onSaved: () => void }) {
  const canEdit = useCan('editor');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(folder.notes);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await callAction('save-folder-notes', folder.path, draft);
      setEditing(false);
      onSaved();
    } catch (error) {
      await showMessage('Notes', errorText(error));
    } finally {
      setSaving(false);
    }
  }

  if (!folder.notes.trim() && !canEdit) return null;
  return (
    <section className="jp-card jp-model-page__notes" aria-labelledby="jp-folder-notes">
      <div className="jp-kit__head">
        <h2 className="jp-panel-title" id="jp-folder-notes">
          Notes
        </h2>
        {canEdit && !editing && (
          <Button
            size="sm"
            icon={Pencil}
            id="jp-folder-notes-edit"
            onClick={() => {
              setDraft(folder.notes);
              setEditing(true);
            }}
          >
            {folder.notes.trim() ? 'Edit' : 'Add Notes'}
          </Button>
        )}
      </div>
      {editing ? (
        <>
          <textarea
            className="jp-input jp-folder-page__notes-input"
            id="jp-folder-notes-input"
            rows={8}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="Notes about this folder (Markdown)"
          />
          <div className="jp-category-scan__buttons">
            <Button variant="primary" id="jp-folder-notes-save" disabled={saving} onClick={() => void save()}>
              Save
            </Button>
            <Button onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </>
      ) : folder.notes.trim() ? (
        <div className="jp-model-page__markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(folder.notes) }} />
      ) : (
        <p className="jp-meta">Notes about the whole model: how it goes together, what to print it in, what is left to do.</p>
      )}
    </section>
  );
}

/**
 * The archives (ZIP, RAR, 7Z) directly in a folder, with Unpack Archives for editors: each is
 * unpacked into a folder of its own here (archives inside them too), the originals kept in
 * archives/ (src/server/unpack-archives.js). Nothing when there are none.
 */
function UnpackArchives({ path, canEdit, onDone }: { path: string; canEdit: boolean; onDone: () => void }) {
  const [archives, setArchives] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    callAction<{ archives: string[] }>('get-folder-archives', path).then(
      (found) => setArchives(found.archives || []),
      () => setArchives([])
    );
  }, [path]);
  useEffect(load, [load]);
  if (!archives.length) return null;

  async function unpack() {
    setBusy(true);
    try {
      const result = await callAction<{ unpacked: string[]; failed: { name: string; error: string }[]; newModels: number; models: number }>(
        'unpack-folder-archives',
        path
      );
      const lines = [
        `Unpacked ${result.unpacked.length} ${result.unpacked.length === 1 ? 'archive' : 'archives'}: the folder now has ${result.models} ${result.models === 1 ? 'model' : 'models'} (${result.newModels} new; models already in the library kept their details). The originals are kept in archives/.`,
        ...result.failed.map((failed) => `${failed.name}: ${failed.error}`)
      ];
      await showMessage('Unpack Archives', lines.join('\n'));
    } catch (error) {
      await showMessage('Unpack Archives', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      load();
      onDone();
    }
  }

  const names = archives.slice(0, 6).join(', ') + (archives.length > 6 ? ` and ${archives.length - 6} more` : '');
  return (
    <section className="jp-card jp-model-page__panel jp-unpack" id="jp-folder-archives" aria-label="Archives">
      <p className="jp-meta">
        <FileArchive size={16} aria-hidden="true" /> {archives.length} {archives.length === 1 ? 'archive' : 'archives'} in this folder: {names}. Their models
        (and the archives inside them) can be unpacked into folders here, so they all show in the library; the archives are kept in archives/.
      </p>
      {canEdit && (
        <Button variant="primary" icon={FileArchive} id="jp-unpack-archives" disabled={busy} onClick={() => void unpack()}>
          {busy ? 'Unpacking…' : 'Unpack Archives'}
        </Button>
      )}
    </section>
  );
}

/**
 * A folder shown as one model (#/folder/<path>, Folders as models): its pictures, notes, kit
 * progress and files on the left; what its files share and actions for all of them on the right.
 */
export function FolderPage({ path }: { path: string }) {
  const canEdit = useCan('editor');
  const [folder, setFolder] = useState<Folder | null | undefined>(undefined);
  const [slicers, setSlicers] = useState<Slicer[]>([]);

  const load = useCallback(() => {
    callAction<Folder | null>('get-folder', path).then(setFolder, () => setFolder(null));
  }, [path]);

  useEffect(() => {
    setFolder(undefined);
    load();
    loadSlicers().then(setSlicers, () => {});
    document.getElementById('jp-content')?.scrollTo(0, 0);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, 400);
    };
    const offs = [onServerEvent('refresh-grid', soon), onServerEvent('folder-changed', soon), onServerEvent('categories-changed', soon)];
    window.addEventListener(LIBRARY_CHANGED, soon);
    return () => {
      if (timer) clearTimeout(timer);
      offs.forEach((off) => off());
      window.removeEventListener(LIBRARY_CHANGED, soon);
    };
  }, [load]);

  if (folder === undefined) {
    return (
      <div className="jp-page__inner jp-model-page">
        <Skeleton height={420} />
      </div>
    );
  }
  if (!folder) {
    return (
      <div className="jp-page__inner jp-model-page">
        <UnpackArchives path={path} canEdit={canEdit} onDone={load} />
        <Panel>
          <EmptyState icon={FolderOpen} title="No models in this folder" action={<Button onClick={() => navigate('library')}>Back to the Library</Button>}>
            The folder may have been moved or emptied, or its models are still inside archives (above, when it has some).
          </EmptyState>
        </Panel>
      </div>
    );
  }

  const paths = folder.files.map((file) => file.filePath);
  const parent = folder.path.split(/[\\/]/).slice(0, -1).pop() || '';
  const list = (items: string[], onPick?: (item: string) => void) =>
    items.length ? (
      <span className="jp-details__categories">
        {items.map((item) =>
          onPick ? (
            <button key={item} type="button" className="jp-chip" onClick={() => onPick(item)}>
              {item}
            </button>
          ) : (
            <span key={item} className="jp-chip">
              {item}
            </span>
          )
        )}
      </span>
    ) : (
      '—'
    );

  return (
    <div className="jp-page__inner jp-model-page jp-folder-page" data-folder={folder.path}>
      <nav className="jp-model-page__crumbs" aria-label="Where this folder is">
        <button type="button" className="jp-model-page__back" onClick={() => navigate('library')}>
          <ArrowLeft size={16} aria-hidden="true" />
          Library
        </button>
        {parent && (
          <>
            <span aria-hidden="true">/</span>
            <span>{parent}</span>
          </>
        )}
        <span aria-hidden="true">/</span>
        <span className="jp-model-page__crumb-here">{folder.name}</span>
      </nav>

      <UnpackArchives path={folder.path} canEdit={canEdit} onDone={load} />
      <header className="jp-model-page__header">
        <h1 className="jp-page-title" id="jp-folder-title">
          {folder.name}
        </h1>
        <p className="jp-model-page__byline">
          {folder.files.length} {folder.files.length === 1 ? 'file' : 'files'}
          {folder.designers.length ? ` · by ${folder.designers.join(', ')}` : ''}
        </p>
      </header>

      <div className="jp-model-page__grid">
        <div className="jp-model-page__main">
          <Pictures files={folder.files} />
          <FolderNotes folder={folder} onSaved={load} />
          {/* The folder is the model here: it may become a model folder whatever is in it. */}
          <ModelMediaSection key={folder.path} folder={folder.path} alone />
          <section className="jp-model-page__files" aria-labelledby="jp-folder-files">
            <h2 className="jp-panel-title" id="jp-folder-files">
              Files
            </h2>
            <ul className="jp-model-page__file-grid" id="jp-folder-file-grid">
              {folder.files.map((file) => (
                <FileCard key={file.filePath} file={file} current={false} />
              ))}
            </ul>
          </section>
        </div>

        <aside className="jp-model-page__side">
          <section className="jp-card jp-model-page__panel" aria-labelledby="jp-folder-details">
            <h2 className="jp-panel-title" id="jp-folder-details">
              Model Details
            </h2>
            <div className="jp-model-page__actions">
              <Button
                variant="primary"
                id="jp-folder-slicer"
                title={slicers[0] ? `Open every file in ${slicers[0].name}` : 'Set up a slicer first'}
                onClick={() => void (slicers[0] ? sendToSlicer(paths, slicers[0]) : offerSlicerSettings())}
              >
                Open All in Slicer
              </Button>
              {paths.filter(isPreviewablePath).length > 1 && (
                <Button icon={Boxes} id="jp-folder-assembly" onClick={() => window.openAssembly?.(folder.path)}>
                  Assembly View
                </Button>
              )}
              {canEdit && (
                <Button icon={FolderPlus} onClick={() => window.openAddToCollection?.(paths)}>
                  Add to Collection
                </Button>
              )}
              <Button icon={Library} onClick={() => showInLibrary(() => filterActions.setDirectory(folderFilterFor(folder.files[0].filePath)))}>
                Show in Library
              </Button>
            </div>
            <div className="jp-props">
              <Prop label="Folder" title={folder.path}>
                {folder.path}
              </Prop>
              <Prop label="Files">{folder.files.length}</Prop>
              <Prop label="Size">{formatFileSize(folder.size)}</Prop>
              <Prop label="Designers">{list(folder.designers, (name) => showInLibrary(() => filterActions.setValue('designer', name)))}</Prop>
              <Prop label="Licenses">{folder.licenses.join(', ') || '—'}</Prop>
              <Prop label="Tags">{list(folder.tags, (name) => showInLibrary(() => filterActions.setTags([name])))}</Prop>
              <Prop label="Categories">{list(folder.categories, showCategory)}</Prop>
              <Prop label="Source">
                {folder.sources.length
                  ? folder.sources.map((source) =>
                      /^https?:\/\//i.test(source) ? (
                        <a key={source} href={source} target="_blank" rel="noopener noreferrer">
                          {source.replace(/^https?:\/\/(www\.)?/i, '')}
                        </a>
                      ) : (
                        <span key={source}>{source}</span>
                      )
                    )
                  : '—'}
              </Prop>
            </div>
          </section>
          <KitChecklist target={folder.path} />
        </aside>
      </div>
    </div>
  );
}

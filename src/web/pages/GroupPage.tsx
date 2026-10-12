import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, ClipboardPen, FolderInput, Layers, Maximize2, Pencil, Ungroup, X } from 'lucide-react';
import { groups as groupsApi, LIBRARY_CHANGED, type GroupModel, type ModelGroup } from '../api';
import { PrintStatusBadge } from '../components/Badge';
import { Button, IconButton, cx } from '../components/Button';
import { Modal } from '../components/Overlay';
import { EmptyState, Panel, Skeleton } from '../components/Panel';
import { formatAdded, Prop } from '../details/ModelDetailsPanel';
import { applyFilterChange } from '../filters/search';
import { filterActions } from '../filters/store';
import { GroupNameDialog } from '../groups/GroupNameDialog';
import { formatFileSize } from '../library/paths';
import { onServerEvent, showMessage } from '../page';
import { effectiveStatus, type PrintModel } from '../print/printStatus';
import { useCan } from '../session';
import { loadSlicers, offerSlicerSettings, sendToSlicer, type Slicer } from '../slicer';
import { navigate } from '../shell/routes';
import { CategoryPlace } from './CategoriesPage';
import { render as renderMarkdown } from '../notes/markdown';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const titleOf = (model: GroupModel) => (model.fileName || model.filePath.split(/[\\/]/).pop() || model.filePath).replace(/\.[a-z0-9]{2,6}$/i, '');

function showInLibrary(change: () => void) {
  navigate('library');
  applyFilterChange(() => {
    filterActions.clearAll();
    change();
  });
}

/** The group's pictures (one per model, from every group inside it too); a click shows one full size. */
function GroupGallery({ images, name }: { images: string[]; name: string }) {
  const [index, setIndex] = useState(0);
  const [full, setFull] = useState(false);
  const at = images.length ? Math.min(index, images.length - 1) : 0;
  const shown = images[at];
  const step = (by: number) => setIndex((now) => (images.length ? (Math.min(now, images.length - 1) + by + images.length) % images.length : 0));
  return (
    <div className="jp-model-page__gallery" id="jp-group-gallery">
      <div className="jp-model-page__stage">
        {shown ? (
          <button type="button" className="jp-gallery__open" title="Show it full size" onClick={() => setFull(true)}>
            <img src={shown} alt="" draggable={false} />
          </button>
        ) : (
          <img src="3d.png" alt="" draggable={false} />
        )}
        {shown && (
          <button type="button" className="jp-details__overlay-btn jp-gallery__full" title="Show it full size" onClick={() => setFull(true)}>
            <Maximize2 size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      {images.length > 1 && (
        <div className="jp-gallery__row">
          <div className="jp-details__strip" role="listbox" aria-label="Pictures" aria-orientation="horizontal">
            {images.map((src, i) => (
              <button
                key={`${i}:${src.slice(-24)}`}
                type="button"
                role="option"
                aria-selected={i === at}
                aria-label={`Picture ${i + 1} of ${images.length}`}
                className={cx('jp-details__thumb', i === at && 'is-selected')}
                onClick={() => setIndex(i)}
              >
                <img src={src} alt="" draggable={false} />
              </button>
            ))}
          </div>
        </div>
      )}
      <Modal
        open={full && !!shown}
        onClose={() => setFull(false)}
        title={name}
        className="jp-media-viewer"
        footer={
          <Button variant="primary" onClick={() => setFull(false)}>
            Close
          </Button>
        }
      >
        {shown && (
          <div className="jp-media-viewer__stage">
            {images.length > 1 && <IconButton icon={ChevronLeft} label="Previous picture" onClick={() => step(-1)} />}
            <img src={shown} alt="" className="jp-media-viewer__image" />
            {images.length > 1 && <IconButton icon={ChevronRight} label="Next picture" onClick={() => step(1)} />}
          </div>
        )}
      </Modal>
    </div>
  );
}

/** The group's description: what the group is. Editors change it in place. */
function GroupDescription({ group, onSaved }: { group: ModelGroup; onSaved: () => void }) {
  const canEdit = useCan('editor');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(group.description || '');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(group.description || '');
  }, [group.description, editing]);

  async function save() {
    setSaving(true);
    try {
      await groupsApi.update(group.id, { description: draft });
      setEditing(false);
      onSaved();
    } catch (error) {
      await showMessage('Description', errorText(error));
    } finally {
      setSaving(false);
    }
  }

  const text = (group.description || '').trim();
  return (
    <section className="jp-card jp-model-page__notes jp-model-page__description" id="jp-group-description" aria-labelledby="jp-group-description-title">
      <div className="jp-model-page__panel-head">
        <h2 className="jp-panel-title" id="jp-group-description-title">
          Description
        </h2>
        {canEdit && !editing && <IconButton icon={Pencil} size="sm" label="Edit the description" onClick={() => setEditing(true)} />}
      </div>
      {editing ? (
        <>
          <textarea
            className="jp-input jp-model-page__notes-input"
            id="jp-group-description-input"
            rows={6}
            value={draft}
            autoFocus
            placeholder="What this group is: the set, how the parts go together"
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="jp-model-page__notes-buttons">
            <Button size="sm" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" id="jp-group-description-save" onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </>
      ) : text ? (
        <div className="jp-model-page__markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
      ) : (
        <p className="jp-meta">{canEdit ? 'No description yet.' : 'No description.'}</p>
      )}
    </section>
  );
}

/** One model of the group: its picture, name and print status; Open, and (choosing) a checkbox. */
function PartCard({ model, choosing, chosen, onChoose }: { model: GroupModel; choosing: boolean; chosen: boolean; onChoose: () => void }) {
  const name = model.fileName || model.filePath.split(/[\\/]/).pop() || '';
  return (
    <li className={cx('jp-card jp-model-file jp-group-part', chosen && 'is-chosen')} data-filepath={model.filePath}>
      <div className="jp-model-file__picture">
        <img
          src={model.image || 'assets/3d.png'}
          alt=""
          draggable={false}
          onError={(event) => {
            if (!event.currentTarget.src.endsWith('assets/3d.png')) event.currentTarget.src = 'assets/3d.png';
          }}
        />
        {choosing && (
          <label className="jp-group-part__check" title={`Choose ${name}`}>
            <input type="checkbox" checked={chosen} onChange={onChoose} aria-label={`Choose ${name}`} />
          </label>
        )}
      </div>
      <div className="jp-model-file__body">
        <span className="jp-model-file__title" title={titleOf(model)}>
          {titleOf(model)}
        </span>
        <code className="jp-model-file__name" title={name}>
          {name}
        </code>
        <div className="jp-model-file__buttons">
          <PrintStatusBadge status={effectiveStatus(model as unknown as PrintModel)} />
          <Button size="sm" variant="primary" onClick={() => navigate('model', model.filePath)}>
            Open
          </Button>
        </div>
      </div>
    </li>
  );
}

/**
 * A group's page (#/group/<id>): like a model page, for the models of a group. Its pictures,
 * description, the groups inside it and its models on the left; the details and actions for the
 * whole group on the right. Editors rename it, choose models to make a group inside it, move them
 * or take them out, and Ungroup it.
 */
export function GroupPage({ groupRef }: { groupRef: string }) {
  const canEdit = useCan('editor');
  const [group, setGroup] = useState<ModelGroup | null | undefined>(undefined);
  const [slicers, setSlicers] = useState<Slicer[]>([]);
  const [choosing, setChoosing] = useState(false);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [naming, setNaming] = useState<null | { kind: 'rename' | 'subgroup'; suggestions: string[] }>(null);
  const [moveTo, setMoveTo] = useState('');

  const load = useCallback(async () => {
    const found = await groupsApi.get(/^\d+$/.test(groupRef) ? Number(groupRef) : groupRef).catch(() => null);
    setGroup(found);
    if (found) setChosen((now) => new Set([...now].filter((id) => found.models.some((m) => m.id === id))));
  }, [groupRef]);

  useEffect(() => {
    setGroup(undefined);
    setChoosing(false);
    setChosen(new Set());
    void load();
    loadSlicers().then(setSlicers, () => {});
    document.getElementById('jp-content')?.scrollTo(0, 0);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(), 400);
    };
    const offs = [onServerEvent('groups-changed', soon), onServerEvent('models-changed', soon), onServerEvent('categories-changed', soon)];
    window.addEventListener(LIBRARY_CHANGED, soon);
    return () => {
      if (timer) clearTimeout(timer);
      offs.forEach((off) => off());
      window.removeEventListener(LIBRARY_CHANGED, soon);
    };
  }, [load]);

  if (group === undefined) {
    return (
      <div className="jp-page__inner jp-model-page">
        <Skeleton height={420} />
      </div>
    );
  }
  if (!group) {
    return (
      <div className="jp-page__inner jp-model-page">
        <Panel>
          <EmptyState icon={Layers} title="This group is not in the library" action={<Button onClick={() => navigate('library')}>Back to the Library</Button>}>
            It may have been ungrouped, or its models removed.
          </EmptyState>
        </Panel>
      </div>
    );
  }

  const paths = group.models.map((m) => m.filePath);
  const filePaths = paths.filter((p) => !p.startsWith('url::'));
  const picked = [...chosen];
  const printedShare = group.totals.models ? Math.round((group.totals.printed / group.totals.models) * 100) : 0;

  async function act(title: string, work: () => Promise<unknown>) {
    try {
      await work();
      await load();
    } catch (error) {
      await showMessage(title, errorText(error));
    }
  }

  async function ungroup() {
    const inside = group!.subgroups.length;
    const answer = await showMessage(
      'Ungroup',
      `Ungroup ${group!.name}? ${group!.parentId ? 'Its models and groups move up into the group above.' : `Its models become single models again${inside ? ' and the groups inside it top groups' : ''}.`} No file is changed.`,
      ['Ungroup', 'Cancel']
    );
    if (answer !== 'Ungroup') return;
    try {
      const { parentId } = await groupsApi.ungroup(group!.id);
      if (parentId) navigate('group', String(parentId), { replace: true });
      else navigate('library');
    } catch (error) {
      await showMessage('Ungroup', errorText(error));
    }
  }

  async function startSubgroup() {
    const suggestions = await groupsApi.suggestNames(picked).catch(() => []);
    setNaming({ kind: 'subgroup', suggestions });
  }

  const openInSlicer = (slicer?: Slicer) => {
    if (!slicer) return offerSlicerSettings();
    return sendToSlicer(filePaths, slicer);
  };

  return (
    <div className="jp-page__inner jp-model-page jp-group-page" data-group-id={group.id}>
      <nav className="jp-model-page__crumbs" aria-label="Where this group is">
        <button type="button" className="jp-model-page__back" onClick={() => navigate('library')}>
          <ArrowLeft size={16} aria-hidden="true" />
          Library
        </button>
        {group.crumbs.slice(0, -1).map((crumb) => (
          <span key={crumb.id} className="jp-model-page__crumb">
            <span aria-hidden="true">/</span>
            <button type="button" className="jp-link-button" onClick={() => navigate('group', String(crumb.id))}>
              {crumb.name}
            </button>
          </span>
        ))}
        <span aria-hidden="true">/</span>
        <span className="jp-model-page__crumb-here">{group.name}</span>
      </nav>

      <header className="jp-model-page__header">
        <h1 className="jp-page-title" id="jp-group-page-title">
          {group.name}
        </h1>
        <p className="jp-model-page__byline">
          {group.totals.models} {group.totals.models === 1 ? 'model' : 'models'}
          {group.subgroups.length > 0 && ` in ${group.subgroups.length + (group.models.length ? 1 : 0)} groups`}
          {group.designer && (
            <>
              {' · '}
              <button type="button" className="jp-link-button" onClick={() => showInLibrary(() => filterActions.setValue('designer', group.designer!))}>
                By {group.designer}
              </button>
            </>
          )}
        </p>
      </header>

      <div className="jp-model-page__grid">
        <div className="jp-model-page__main">
          <GroupGallery key={`gallery:${group.id}`} images={group.images} name={group.name} />
          <GroupDescription group={group} onSaved={() => void load()} />

          {group.subgroups.length > 0 && (
            <section className="jp-group-page__subgroups" aria-labelledby="jp-group-subgroups-title">
              <h2 className="jp-panel-title" id="jp-group-subgroups-title">
                Groups inside ({group.subgroups.length})
              </h2>
              <ul className="jp-group-page__subgroup-grid" id="jp-group-subgroups">
                {group.subgroups.map((sub) => (
                  <li key={sub.id}>
                    <button type="button" className="jp-card jp-group-stack" onClick={() => navigate('group', String(sub.id))}>
                      <span className="jp-group-stack__picture">
                        <img src={sub.image || 'assets/3d.png'} alt="" draggable={false} />
                      </span>
                      <span className="jp-group-stack__name">{sub.name}</span>
                      <span className="jp-meta">
                        {sub.modelCount} {sub.modelCount === 1 ? 'model' : 'models'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="jp-model-page__files" aria-labelledby="jp-group-models-title">
            <div className="jp-group-page__models-head">
              <h2 className="jp-panel-title" id="jp-group-models-title">
                Models ({group.models.length})
              </h2>
              {canEdit && group.models.length > 0 && (
                <Button
                  size="sm"
                  id="jp-group-choose"
                  icon={choosing ? X : Check}
                  onClick={() => {
                    setChoosing(!choosing);
                    setChosen(new Set());
                  }}
                >
                  {choosing ? 'Done' : 'Choose'}
                </Button>
              )}
            </div>
            {choosing && (
              <div className="jp-group-page__chosen" id="jp-group-chosen-bar">
                <span className="jp-meta">
                  {picked.length} chosen ·{' '}
                  <button type="button" className="jp-link-button" onClick={() => setChosen(new Set(group.models.map((m) => m.id)))}>
                    Choose all
                  </button>
                </span>
                <Button size="sm" icon={Layers} id="jp-group-make-subgroup" disabled={!picked.length} onClick={() => void startSubgroup()}>
                  Create Group Inside
                </Button>
                {group.subgroups.length > 0 && (
                  <span className="jp-group-page__move">
                    <select
                      className="jp-input"
                      id="jp-group-move-select"
                      aria-label="Move the chosen models into"
                      value={moveTo}
                      disabled={!picked.length}
                      onChange={(event) => setMoveTo(event.target.value)}
                    >
                      <option value="">Move into…</option>
                      {group.subgroups.map((sub) => (
                        <option key={sub.id} value={sub.id}>
                          {sub.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      icon={FolderInput}
                      disabled={!picked.length || !moveTo}
                      onClick={() =>
                        void act('Move', async () => {
                          await groupsApi.add(Number(moveTo), { modelIds: picked });
                          setChosen(new Set());
                          setMoveTo('');
                        })
                      }
                    >
                      Move
                    </Button>
                  </span>
                )}
                <Button
                  size="sm"
                  icon={X}
                  id="jp-group-remove"
                  disabled={!picked.length}
                  onClick={() =>
                    void act('Remove from Group', async () => {
                      await groupsApi.remove(group.id, picked);
                      setChosen(new Set());
                    })
                  }
                >
                  {group.parentId ? 'Move Up a Group' : 'Remove from Group'}
                </Button>
              </div>
            )}
            {group.models.length ? (
              <ul className="jp-model-page__file-grid" id="jp-group-models">
                {group.models.map((model) => (
                  <PartCard
                    key={model.id}
                    model={model}
                    choosing={choosing}
                    chosen={chosen.has(model.id)}
                    onChoose={() =>
                      setChosen((now) => {
                        const next = new Set(now);
                        if (next.has(model.id)) next.delete(model.id);
                        else next.add(model.id);
                        return next;
                      })
                    }
                  />
                ))}
              </ul>
            ) : (
              <p className="jp-meta">Every model of this group is in a group inside it.</p>
            )}
          </section>
        </div>

        <aside className="jp-model-page__side">
          <section className="jp-card jp-model-page__panel" aria-labelledby="jp-group-details-title">
            <h2 className="jp-panel-title" id="jp-group-details-title">
              Group Details
            </h2>
            <div className="jp-model-page__actions">
              {filePaths.length > 0 && (
                <Button
                  variant="primary"
                  id="jp-group-open-slicer"
                  title={slicers[0] ? `Open its ${filePaths.length} models in ${slicers[0].name}` : 'Set up a slicer first'}
                  onClick={() => void openInSlicer(slicers[0])}
                >
                  Open All in Slicer
                </Button>
              )}
              {canEdit && (
                <Button icon={Pencil} id="jp-group-rename" onClick={() => setNaming({ kind: 'rename', suggestions: [] })}>
                  Rename
                </Button>
              )}
              {canEdit && paths.length > 0 && (
                <Button icon={ClipboardPen} id="jp-group-log-print" onClick={() => void window.PrintHistory?.openLogDialog({ filePaths: paths })}>
                  Log Print
                </Button>
              )}
              {canEdit && (
                <Button icon={Ungroup} id="jp-group-ungroup" onClick={() => void ungroup()}>
                  Ungroup
                </Button>
              )}
            </div>
            <div className="jp-props">
              <Prop label="Models">{group.totals.models}</Prop>
              <Prop label="Printed">
                <span className="jp-group-progress" title={`${group.totals.printed} of ${group.totals.models} printed`}>
                  <span className="jp-group-progress__bar">
                    <span style={{ width: `${printedShare}%` }} />
                  </span>
                  {group.totals.printed} of {group.totals.models}
                </span>
              </Prop>
              <Prop label="Size">{group.totals.size ? formatFileSize(group.totals.size) : '—'}</Prop>
              <Prop label="Designer">{group.designer || '—'}</Prop>
              <Prop label="Tags">
                {group.tags.length ? (
                  <span className="jp-details__categories">
                    {group.tags.map((name) => (
                      <button key={name} type="button" className="jp-chip" onClick={() => showInLibrary(() => filterActions.setTags([name]))}>
                        {name}
                      </button>
                    ))}
                  </span>
                ) : (
                  '—'
                )}
              </Prop>
              <Prop label="Category">{group.category ? <CategoryPlace names={[group.category]} /> : '—'}</Prop>
              <Prop label="Subcategory">{group.subcategory ? <CategoryPlace names={[group.subcategory]} /> : '—'}</Prop>
              <Prop label="Added">{formatAdded(group.dateAdded) || '—'}</Prop>
            </div>
          </section>
        </aside>
      </div>

      <GroupNameDialog
        open={!!naming}
        title={naming?.kind === 'rename' ? 'Rename Group' : `New Group Inside ${group.name}`}
        action={naming?.kind === 'rename' ? 'Rename' : 'Create'}
        initial={naming?.kind === 'rename' ? group.name : ''}
        suggestions={naming?.suggestions || []}
        onCancel={() => setNaming(null)}
        onSubmit={async (name) => {
          if (naming?.kind === 'rename') await groupsApi.update(group.id, { name });
          else {
            await groupsApi.create({ name, modelIds: picked, parentId: group.id });
            setChosen(new Set());
            setChoosing(false);
          }
          setNaming(null);
          await load();
        }}
      />
    </div>
  );
}

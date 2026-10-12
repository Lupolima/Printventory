import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ClipboardPen, ExternalLink, FolderInput, Layers, List, ListChecks, Plus, Tags, X } from 'lucide-react';
import { callAction, categories as categoryApi, groups as groupsApi, libraryValues, models, tags as tagApi } from '../api';
import { askText, exposeGlobal, onServerEvent, showMessage } from '../page';
import { selection } from '../selection';
import { STATUSES, STATUS_LABELS } from '../print/printStatus';
import { Button } from '../components/Button';
import { pickFromList, type ListField } from '../components/ListPicker';
import { GroupEditor } from '../groups/GroupEditor';
import { GroupNameDialog } from '../groups/GroupNameDialog';
import { groupSelection, type ChosenGroup } from '../library/groupSelection';
import { parentModelKey } from '../grid/layout';

type Field = 'designer' | 'parentModel' | 'license' | 'source' | 'tags';

/** What the multi-edit panel asks of the library (library/hosts.ts), which owns the selection and the panel's visibility. */
export interface MultiEditHost {
  /** The selected models' paths. */
  selectedPaths(): string[];
  /** Leave multi-edit mode (clears the selection and shows the details panel). */
  exit(): void;
  selectAllVisible(): Promise<void>;
  clearSelection(): void;
  /** Set a field on every selected model. Tags in `value` are added to what each model has. */
  saveField(field: Field, value: string | string[]): Promise<boolean>;
  /** Remove one tag from every selected model, keeping their others. */
  removeFromSelected(field: 'tags', value: string): Promise<void>;
  openSource(url: string): void;
}

declare global {
  interface Window {
    multiEditHost?: MultiEditHost;
    /** The multi-edit panel's body (library/details.ts drives it). */
    multiEdit?: {
      /** The panel was shown: clear the form and load the pickers. */
      open: () => void;
      /** The selection changed. */
      selectionChanged: () => void;
      /** Reload the pickers (a value was added or renamed elsewhere). */
      reloadOptions: () => void;
    };
  }
}

const sortNames = (names: (string | null | undefined)[]) =>
  [...new Set(names.map((n) => String(n || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));

interface Options {
  designers: string[];
  parents: string[];
  licenses: string[];
  tags: string[];
  /** Each Category with its Subcategories' names. */
  categories: { name: string; subcategories: string[] }[];
}

interface OnSelected {
  tags: string[];
}

async function loadOptions(): Promise<Options> {
  const [designers, parents, licenses, allTags, list] = await Promise.all([
    libraryValues.designers().catch(() => []),
    libraryValues.parentModels().catch(() => []),
    libraryValues.licenses().catch(() => []),
    tagApi.list().catch(() => []),
    categoryApi.list().catch(() => ({ categories: [], uncategorized: 0 }))
  ]);
  return {
    designers: sortNames(designers),
    parents: sortNames(parents),
    licenses: sortNames(licenses),
    tags: sortNames(allTags.map((t) => t.name)),
    categories: list.categories
      .filter((c) => !c.parent_id)
      .map((main) => ({ name: main.name, subcategories: list.categories.filter((c) => c.parent_id === main.id).map((c) => c.name) }))
  };
}

/** Tags that at least one selected model has (for the Remove picker). */
async function loadOnSelected(paths: string[]): Promise<OnSelected> {
  const loaded = await Promise.all(paths.map((p) => models.get<{ tags?: unknown[] }>(p).catch(() => null)));
  const tagNames: string[] = [];
  for (const model of loaded) {
    for (const tag of model?.tags || []) tagNames.push(typeof tag === 'string' ? tag : String((tag as { name?: string })?.name ?? ''));
  }
  return { tags: sortNames(tagNames) };
}

const PROMPTS: Record<'designer' | 'parentModel' | 'license', string> = {
  designer: 'designer',
  parentModel: 'parent model',
  license: 'license'
};

/**
 * The multi-edit panel's body (#multi-edit-slot), laid out like the JusttPrint 5 details panel: the
 * count and selection buttons, then Printing, Details and Tags sections whose fields apply to
 * every selected model as soon as they change. Registers window.multiEdit.
 */
export function MultiEditPanel() {
  const [slot] = useState(() => document.getElementById('multi-edit-slot'));
  const [count, setCount] = useState(0);
  /** Models chosen on their own (not through a group). */
  const [modelCount, setModelCount] = useState(0);
  const [chosenGroups, setChosenGroups] = useState<ChosenGroup[]>([]);
  const [naming, setNaming] = useState<string[] | null>(null);
  const [target, setTarget] = useState('');
  /** Every group in the library (Add to Group), and the one picked. */
  const [allGroups, setAllGroups] = useState<{ id: number; name: string; path: string; modelCount: number }[]>([]);
  const [existing, setExisting] = useState('');
  const [options, setOptions] = useState<Options>({ designers: [], parents: [], licenses: [], tags: [], categories: [] });
  const [onSelected, setOnSelected] = useState<OnSelected>({ tags: [] });
  const [source, setSource] = useState('');
  const [picked, setPicked] = useState({ designer: '', parentModel: '', license: '' });
  const sourceTimer = useRef<number | undefined>(undefined);
  const selectionLoad = useRef(0);
  const host = window.multiEditHost;

  const reloadOptions = () => {
    loadOptions()
      .then(setOptions)
      .catch(() => {});
  };

  const selectionChanged = () => {
    const paths = window.multiEditHost?.selectedPaths() || [];
    setCount(paths.length);
    setModelCount(selection.size);
    setChosenGroups(groupSelection.values());
    const load = ++selectionLoad.current;
    if (!paths.length || document.getElementById('multi-edit-panel')?.classList.contains('hidden')) {
      setOnSelected({ tags: [] });
      return;
    }
    loadOnSelected(paths)
      .then((next) => {
        if (load === selectionLoad.current) setOnSelected(next);
      })
      .catch(() => {});
  };

  useEffect(() => selection.subscribe(() => selectionChanged()), []);
  useEffect(() => groupSelection.subscribe(() => selectionChanged()), []);
  const loadGroups = () => {
    groupsApi.list().then(setAllGroups, () => setAllGroups([]));
  };
  useEffect(() => onServerEvent('groups-changed', loadGroups), []);
  useEffect(
    () =>
      exposeGlobal('multiEdit', {
        open: () => {
          window.clearTimeout(sourceTimer.current);
          setSource('');
          setPicked({ designer: '', parentModel: '', license: '' });
          reloadOptions();
          loadGroups();
          setExisting('');
          selectionChanged();
        },
        selectionChanged,
        reloadOptions
      }),
    []
  );

  async function save(field: Field, value: string | string[]) {
    if (!host || !host.selectedPaths().length) return false;
    const ok = await host.saveField(field, value);
    if (field === 'tags') selectionChanged();
    return ok;
  }

  async function pickValue(field: 'designer' | 'parentModel' | 'license', value: string) {
    setPicked((current) => ({ ...current, [field]: value }));
    if (!value) return;
    await save(field, value);
  }

  async function addNewValue(field: 'designer' | 'parentModel' | 'license') {
    const typed = (await askText(`New ${PROMPTS[field]}`, `Enter a ${PROMPTS[field]} for the selected models:`))?.trim();
    if (!typed) return;
    setPicked((current) => ({ ...current, [field]: typed }));
    if (await save(field, typed)) {
      reloadOptions();
      window.detailsFields?.reloadOptions();
      await window.detailsHost?.valuesChanged(field);
    }
  }

  /** One Category › Subcategory for every selected model (it stays: Categorize Library and the AI leave it). */
  async function setCategory(name: string) {
    const paths = host?.selectedPaths() || [];
    if (!name || !paths.length) return;
    const answer = await showMessage(
      'Category',
      `Put ${paths.length} selected model${paths.length === 1 ? '' : 's'} in ${options.categories.find((c) => c.subcategories.includes(name))?.name ?? ''} › ${name}?`,
      ['Yes', 'No']
    );
    if (answer !== 'Yes') return;
    try {
      await callAction('set-models-category', paths, name);
    } catch (error) {
      await showMessage('Category', error instanceof Error ? error.message : String(error));
    }
  }

  async function addTag(name: string | null | undefined) {
    const tag = String(name || '').trim();
    if (tag) await save('tags', [tag]);
  }

  async function addNewTag() {
    const typed = (await askText('New tag', 'Enter a tag to add to the selected models:'))?.trim();
    if (!typed) return;
    try {
      const saved = await tagApi.create(typed);
      await addTag(saved?.name || typed);
      reloadOptions();
      window.detailsFields?.reloadOptions();
      await window.detailsHost?.valuesChanged('tag');
    } catch (error) {
      console.error('Error creating tag:', error);
    }
  }

  async function removeTag(name: string | null | undefined) {
    const tag = String(name || '').trim();
    if (!tag || !host) return;
    const n = host.selectedPaths().length;
    const answer = await showMessage('Remove Tag', `Are you sure you want to remove the tag "${tag}" from ${n} selected file${n === 1 ? '' : 's'}?`, [
      'Yes',
      'No'
    ]);
    if (answer !== 'Yes') return;
    await host.removeFromSelected('tags', tag);
    selectionChanged();
  }

  /** Create Group: name it (or take a suggestion), then the chosen models and groups go in it. */
  async function startCreate() {
    const paths = host?.selectedPaths() || [];
    const suggested = await groupsApi.suggestNames(paths.slice(0, 200)).catch(() => [] as string[]);
    setNaming([...new Set([...suggested, ...chosenGroups.map((g) => g.name)])].slice(0, 6));
  }

  async function createGroup(name: string) {
    const groupIds = (await Promise.all(chosenGroups.map((g) => groupsApi.find(g.name).catch(() => null)))).filter((id): id is number => !!id);
    const filePaths = selection.values();
    const everything = host?.selectedPaths() || [];
    await groupsApi.create({ name, filePaths, groupIds });
    setNaming(null);
    // The new group stays chosen, so it can be edited next.
    selection.clear();
    groupSelection.clear();
    groupSelection.toggle({ key: `parent:${parentModelKey(name)}`, name, filePaths: everything });
  }

  async function addToGroup() {
    const into = chosenGroups.find((g) => g.key === target) || chosenGroups[0];
    if (!into) return;
    try {
      const id = await groupsApi.find(into.name);
      if (!id) throw new Error(`${into.name} is not a group any more.`);
      const others = (await Promise.all(chosenGroups.filter((g) => g !== into).map((g) => groupsApi.find(g.name).catch(() => null)))).filter(
        (gid): gid is number => !!gid
      );
      const everything = host?.selectedPaths() || [];
      await groupsApi.add(id, { filePaths: selection.values(), groupIds: others });
      selection.clear();
      groupSelection.clear();
      groupSelection.toggle({ ...into, filePaths: everything });
      setTarget('');
    } catch (error) {
      await showMessage('Add to Group', error instanceof Error ? error.message : String(error));
    }
  }

  /** Add to Group: the chosen models (and groups) go into a group already in the library. */
  async function addToExisting() {
    const into = allGroups.find((g) => String(g.id) === existing);
    if (!into) return;
    try {
      const groupIds = (await Promise.all(chosenGroups.map((g) => groupsApi.find(g.name).catch(() => null)))).filter(
        (id): id is number => !!id && id !== into.id
      );
      const everything = host?.selectedPaths() || [];
      await groupsApi.add(into.id, { filePaths: selection.values(), groupIds });
      setExisting('');
      // Its top group stays chosen, so it can be edited next.
      const top = into.path.split(' › ')[0];
      selection.clear();
      groupSelection.clear();
      groupSelection.toggle({ key: `parent:${parentModelKey(top)}`, name: top, filePaths: everything });
    } catch (error) {
      await showMessage('Add to Group', error instanceof Error ? error.message : String(error));
    }
  }

  if (!slot) return null;
  const groupCount = chosenGroups.length;
  const chosenText = [
    modelCount ? `${modelCount} model${modelCount === 1 ? '' : 's'}` : '',
    groupCount ? `${groupCount} group${groupCount === 1 ? '' : 's'}` : ''
  ]
    .filter(Boolean)
    .join(' and ');
  const canAddTo = groupCount >= 1 && (modelCount > 0 || groupCount > 1);

  const listButton = (title: string, onClick: () => void) => (
    <button type="button" className="jp-icon-btn jp-icon-btn--sm jp-multi__tool" title={title} aria-label={title} onClick={onClick}>
      <List size={16} aria-hidden="true" />
    </button>
  );
  const addButton = (title: string, onClick: () => void, id?: string) => (
    <button type="button" id={id} className="jp-icon-btn jp-icon-btn--sm jp-multi__tool" title={title} aria-label={title} onClick={onClick}>
      <Plus size={16} aria-hidden="true" />
    </button>
  );

  const valueRow = (field: 'designer' | 'parentModel' | 'license', id: string, title: string, empty: string, values: string[], list: ListField) => (
    <div className="jp-multi__row">
      <label htmlFor={id}>{title}</label>
      <div className="jp-multi__control">
        <select id={id} value={picked[field]} onChange={(e) => pickValue(field, e.target.value)}>
          <option value="">{empty}</option>
          {values.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
          {picked[field] && !values.includes(picked[field]) && <option value={picked[field]}>{picked[field]}</option>}
        </select>
        {listButton(`Search existing ${PROMPTS[field]}s`, async () => {
          const v = await pickFromList(list);
          if (v) await pickValue(field, v);
        })}
        {addButton(`New ${PROMPTS[field]}`, () => addNewValue(field), `${id}-add`)}
      </div>
    </div>
  );

  return createPortal(
    <div className="jp jp-details jp-multi">
      <div className="jp-details__identity">
        <h2 className="jp-details__title selected-count">{chosenText ? `${chosenText} selected` : 'Nothing selected'}</h2>
        <p className="jp-details__byline">
          {count
            ? `Changes apply to ${groupCount ? `all ${count} models, the groups' too,` : `every selected model`} right away.`
            : 'Click models and groups in the library to choose them.'}
        </p>
      </div>

      <div className="jp-details__actions">
        <Button id="select-all-button" icon={ListChecks} title="Select every model shown in the library" onClick={() => host?.selectAllVisible()}>
          Select All
        </Button>
        <Button id="clear-selection-button" icon={X} onClick={() => host?.clearSelection()}>
          Clear Selection
        </Button>
      </div>

      {groupCount === 1 && modelCount === 0 && (
        <GroupEditor
          key={chosenGroups[0].key}
          name={chosenGroups[0].name}
          onGone={() => groupSelection.clear()}
          onRenamed={(name) => groupSelection.replace(chosenGroups[0].key, { ...chosenGroups[0], key: `parent:${parentModelKey(name)}`, name })}
        />
      )}

      <section className="jp-details__section" id="jp-multi-groups">
        <h3 className="jp-details__heading">Groups</h3>
        <div className="jp-multi__group-actions">
          <Button id="multi-create-group" icon={Layers} disabled={!count} onClick={() => void startCreate()}>
            Create Group
          </Button>
          {canAddTo && (
            <span className="jp-multi__add-to">
              {groupCount > 1 && (
                <select id="multi-add-to-group" aria-label="The group to add to" value={target} onChange={(e) => setTarget(e.target.value)}>
                  {chosenGroups.map((g) => (
                    <option key={g.key} value={g.key}>
                      {g.name}
                    </option>
                  ))}
                </select>
              )}
              <Button id="multi-add-to-group-button" icon={FolderInput} onClick={() => void addToGroup()}>
                {groupCount > 1 ? 'Add the Rest to It' : `Add to ${chosenGroups[0].name}`}
              </Button>
            </span>
          )}
        </div>
        <div className="jp-multi__rows">
          <div className="jp-multi__row">
            <label htmlFor="multi-existing-group">Add to</label>
            <div className="jp-multi__control">
              <select
                id="multi-existing-group"
                className="jp-multi__picker"
                value={existing}
                disabled={!count || !allGroups.length}
                onChange={(e) => setExisting(e.target.value)}
              >
                <option value="">{allGroups.length ? 'A group in the library…' : 'No groups yet'}</option>
                {allGroups
                  .filter((g) => !chosenGroups.some((c) => parentModelKey(c.name) === parentModelKey(g.path)))
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.path} ({g.modelCount})
                    </option>
                  ))}
              </select>
              <Button id="multi-add-existing" size="sm" icon={FolderInput} disabled={!existing || !count} onClick={() => void addToExisting()}>
                Add
              </Button>
            </div>
          </div>
        </div>
        <p className="jp-meta">
          {groupCount
            ? 'Create Group puts the chosen models and groups in a new group (the groups go inside it).'
            : 'Create Group keeps the chosen models together under a name, as one card in the library.'}
        </p>
      </section>

      <section className="jp-details__section">
        <h3 className="jp-details__heading">Printing</h3>
        <div className="jp-multi__rows">
          <div className="jp-multi__row">
            <label htmlFor="multi-print-status">Status</label>
            <div className="jp-multi__control">
              <select
                id="multi-print-status"
                value=""
                onChange={async (e) => {
                  const paths = host?.selectedPaths() || [];
                  const status = e.target.value;
                  if (!paths.length || !status) return;
                  await window.PrintHistory?.setStatus(paths, status);
                }}
              >
                <option value="">No change</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <Button
          id="multi-log-print-button"
          className="jp-multi__wide"
          icon={ClipboardPen}
          onClick={() => {
            const paths = host?.selectedPaths() || [];
            if (paths.length) window.PrintHistory?.openLogDialog({ filePaths: paths });
          }}
        >
          Log a Print on Selected
        </Button>
      </section>

      <section className="jp-details__section">
        <h3 className="jp-details__heading">Details</h3>
        <div className="jp-multi__rows">
          <div className="jp-multi__row">
            <label htmlFor="multi-source">Source</label>
            <div className="jp-multi__control">
              <input
                type="text"
                id="multi-source"
                placeholder="Enter a link or name…"
                spellCheck={false}
                value={source}
                onChange={(e) => {
                  const value = e.target.value;
                  setSource(value);
                  window.clearTimeout(sourceTimer.current);
                  sourceTimer.current = window.setTimeout(() => {
                    save('source', value.trim());
                  }, 500);
                }}
              />
              <button
                type="button"
                id="multi-open-source-button"
                className="jp-icon-btn jp-icon-btn--sm jp-multi__tool"
                title="Open in browser"
                aria-label="Open in browser"
                disabled={!source.trim()}
                onClick={() => host?.openSource(source.trim())}
              >
                <ExternalLink size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
          {valueRow('designer', 'multi-designer', 'Designer', 'No change', options.designers, 'designer')}
          {valueRow('parentModel', 'multi-parent', 'Parent model', 'No change', options.parents, 'parent')}
          {valueRow('license', 'multi-license', 'License', 'No change', options.licenses, 'license')}
          <div className="jp-multi__row">
            <label htmlFor="multi-category">Category</label>
            <div className="jp-multi__control">
              <select id="multi-category" value="" onChange={(e) => void setCategory(e.target.value)}>
                <option value="">No change</option>
                {options.categories.map((main) => (
                  <optgroup key={main.name} label={main.name}>
                    {main.subcategories.map((sub) => (
                      <option key={sub} value={sub}>
                        {main.name} › {sub}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>
        </div>
      </section>

      <section className="jp-details__section">
        <h3 className="jp-details__heading">Tags</h3>
        <div className="jp-multi__rows">
          <div className="jp-multi__row">
            <label htmlFor="multi-tag-select">Add</label>
            <div className="jp-multi__control">
              <select id="multi-tag-select" className="jp-multi__picker" value="" onChange={(e) => addTag(e.target.value)}>
                <option value="">Add a tag…</option>
                {options.tags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              {listButton('Search existing tags', async () => addTag(await pickFromList('tag')))}
              {addButton('New tag', addNewTag, 'multi-add-tag')}
            </div>
          </div>
          <div className="jp-multi__row">
            <label htmlFor="multi-tag-remove-select">Remove</label>
            <div className="jp-multi__control">
              <select
                id="multi-tag-remove-select"
                className="jp-multi__picker"
                value=""
                disabled={!onSelected.tags.length}
                onChange={(e) => removeTag(e.target.value)}
              >
                <option value="">{onSelected.tags.length ? 'Remove a tag…' : 'None to remove'}</option>
                {onSelected.tags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              {listButton('Search tags to remove from the selection', async () => removeTag(await pickFromList('tag', true)))}
            </div>
          </div>
        </div>
        <Button id="multi-edit-tags-button" variant="ghost" size="sm" icon={Tags} className="jp-multi__manage" onClick={() => window.openTagManager?.()}>
          Manage Tags
        </Button>
      </section>

      <div className="jp-details__footer">
        <Button id="exit-multi-edit-button" className="jp-multi__wide" onClick={() => host?.exit()}>
          Done Editing
        </Button>
      </div>
      <GroupNameDialog
        open={!!naming}
        title="Create Group"
        action="Create"
        suggestions={naming || []}
        onCancel={() => setNaming(null)}
        onSubmit={createGroup}
      />
    </div>,
    slot
  );
}

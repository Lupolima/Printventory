import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Pencil, Ungroup, X } from 'lucide-react';
import { groups as groupsApi, type ModelGroup } from '../api';
import { Button, IconButton } from '../components/Button';
import { onServerEvent, showMessage } from '../page';
import { navigate } from '../shell/routes';
import { GroupNameDialog } from './GroupNameDialog';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const titleOf = (fileName: string | null, filePath: string) => (fileName || filePath.split(/[\\/]/).pop() || filePath).replace(/\.[a-z0-9]{2,6}$/i, '');

/**
 * One group chosen in Edit mode (Multi-edit): rename it, write its description, take models out,
 * open its page, or Ungroup it (its models become single models again). `name` is the group card's
 * name (a top group's); `onGone` runs when it was ungrouped.
 */
export function GroupEditor({ name, onGone, onRenamed }: { name: string; onGone: () => void; onRenamed: (name: string) => void }) {
  const [group, setGroup] = useState<ModelGroup | null | undefined>(undefined);
  /** Found once by name, then by id (a rename changes the name). */
  const idRef = useRef<number | null>(null);
  const [description, setDescription] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const found = await groupsApi.get(idRef.current ?? name).catch(() => null);
    if (found) idRef.current = found.id;
    setGroup(found);
    setDescription(found?.description || '');
  }, [name]);

  useEffect(() => {
    void load();
    return onServerEvent('groups-changed', () => void load());
  }, [load]);

  if (group === undefined) return <p className="jp-meta">Loading the group…</p>;
  if (!group) return <p className="jp-meta">This group is not in the library any more.</p>;

  async function run(title: string, work: () => Promise<unknown>) {
    try {
      await work();
    } catch (error) {
      await showMessage(title, errorText(error));
    }
  }

  async function ungroup() {
    const answer = await showMessage('Ungroup', `Ungroup ${group!.name}? Its models become single models again. No file is changed.`, ['Ungroup', 'Cancel']);
    if (answer !== 'Ungroup') return;
    await run('Ungroup', async () => {
      await groupsApi.ungroup(group!.id);
      onGone();
    });
  }

  const changed = description.trim() !== (group.description || '').trim();
  return (
    <section className="jp-details__section jp-group-editor" id="jp-group-editor" aria-label={`Group ${group.name}`}>
      <div className="jp-group-editor__head">
        <h3 className="jp-details__heading">Group</h3>
        <span className="jp-group-editor__name" id="jp-group-editor-name" title={group.name}>
          {group.name}
        </span>
        <IconButton icon={Pencil} size="sm" label="Rename the group" onClick={() => setRenaming(true)} />
      </div>
      <p className="jp-meta">
        {group.totals.models} {group.totals.models === 1 ? 'model' : 'models'} · {group.totals.printed} printed
        {group.subgroups.length > 0 && ` · ${group.subgroups.length} ${group.subgroups.length === 1 ? 'group' : 'groups'} inside`}
      </p>
      <label className="jp-group-editor__label" htmlFor="jp-group-editor-description">
        Description
      </label>
      <textarea
        id="jp-group-editor-description"
        className="jp-input"
        rows={3}
        value={description}
        placeholder="What this group is"
        onChange={(event) => setDescription(event.target.value)}
      />
      {changed && (
        <Button
          size="sm"
          variant="primary"
          id="jp-group-editor-save"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            await run('Description', () => groupsApi.update(group.id, { description }));
            setSaving(false);
          }}
        >
          {saving ? 'Saving…' : 'Save Description'}
        </Button>
      )}
      {group.models.length > 0 && (
        <ul className="jp-group-editor__models" id="jp-group-editor-models" aria-label="Its models">
          {group.models.map((model) => (
            <li key={model.id}>
              <span title={model.filePath}>{titleOf(model.fileName, model.filePath)}</span>
              <IconButton
                icon={X}
                size="sm"
                label={`Take ${titleOf(model.fileName, model.filePath)} out of the group`}
                onClick={() => void run('Remove from Group', () => groupsApi.remove(group.id, [model.id]))}
              />
            </li>
          ))}
        </ul>
      )}
      {group.subgroups.length > 0 && (
        <ul className="jp-group-editor__models" aria-label="Groups inside">
          {group.subgroups.map((sub) => (
            <li key={sub.id}>
              <button type="button" className="jp-link-button" onClick={() => navigate('group', String(sub.id))}>
                {sub.name}
              </button>
              <span className="jp-meta">{sub.modelCount}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="jp-group-editor__buttons">
        <Button size="sm" icon={ExternalLink} id="jp-group-editor-open" onClick={() => navigate('group', String(group.id))}>
          Open Group Page
        </Button>
        <Button size="sm" icon={Ungroup} id="jp-group-editor-ungroup" onClick={() => void ungroup()}>
          Ungroup
        </Button>
      </div>
      <GroupNameDialog
        open={renaming}
        title="Rename Group"
        action="Rename"
        initial={group.name}
        onCancel={() => setRenaming(false)}
        onSubmit={async (next) => {
          const renamed = await groupsApi.update(group.id, { name: next });
          setRenaming(false);
          onRenamed(renamed.name);
        }}
      />
    </section>
  );
}

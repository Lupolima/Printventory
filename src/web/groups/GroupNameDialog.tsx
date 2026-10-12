import { useEffect, useState } from 'react';
import { Button } from '../components/Button';
import { Modal } from '../components/Overlay';

/**
 * Name a group (Create Group, Create Sub-group, Rename): a name field and the suggestions the
 * models' names, folder, site and designer give (model-groups.js suggestNames); a click on one
 * fills the field.
 */
export function GroupNameDialog({
  open,
  title,
  action,
  suggestions = [],
  initial = '',
  onCancel,
  onSubmit
}: {
  open: boolean;
  title: string;
  /** The button's label (Create, Rename). */
  action: string;
  suggestions?: string[];
  initial?: string;
  onCancel: () => void;
  /** Resolves when done; a thrown error is shown under the field. */
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initial || suggestions[0] || '');
      setError('');
    }
    // Only when it opens: the suggestions arrive with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit() {
    const text = name.trim();
    if (!text) {
      setError('Give the group a name.');
      return;
    }
    setBusy(true);
    try {
      await onSubmit(text);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      className="jp-group-name"
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" id="jp-group-name-submit" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Saving…' : action}
          </Button>
        </>
      }
    >
      <label className="jp-group-name__label" htmlFor="jp-group-name-input">
        Name
      </label>
      <input
        className="jp-input"
        id="jp-group-name-input"
        value={name}
        maxLength={200}
        autoFocus
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void submit();
          }
        }}
      />
      {suggestions.length > 0 && (
        <div className="jp-group-name__suggestions" id="jp-group-name-suggestions">
          <span className="jp-meta">Suggestions:</span>
          {suggestions.map((suggestion) => (
            <button key={suggestion} type="button" className="jp-chip" onClick={() => setName(suggestion)}>
              {suggestion}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="jp-meta jp-group-name__error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

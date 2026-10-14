import { useEffect, useState } from 'react';
import { callAction } from '../api';
import { showMessage } from '../page';
import { formatFileSize } from '../StatsDialog';

/** What get-versions-usage answers (src/server/model-versions.js versionsUsage). */
export interface VersionsUsage {
  bytes: number;
  files: number;
  models: number;
  /** Versions kept per model; 0 keeps all. */
  keep: number;
}

const CHOICES = [0, 1, 3, 5, 10];
const choiceLabel = (n: number) => (n === 0 ? 'All versions' : `The last ${n} version${n === 1 ? '' : 's'}`);

/** One line on the space the kept versions take (exported for tests). */
export function usageText(usage: VersionsUsage): string {
  if (!usage.files) return 'No earlier versions are kept yet. Upload New Version (on a model’s page) keeps the file it replaces.';
  return `Earlier versions take ${formatFileSize(usage.bytes)}: ${usage.files.toLocaleString()} file${usage.files === 1 ? '' : 's'} of ${usage.models.toLocaleString()} model${usage.models === 1 ? '' : 's'}, in versions/ in the data folder.`;
}

/**
 * Settings → Backup: the space Upload New Version's kept files take, and how many each model
 * keeps. A smaller number deletes the older ones right away (after asking) and on every new version.
 */
export function VersionsSpace({ opened }: { opened: number }) {
  const [usage, setUsage] = useState<VersionsUsage | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    callAction<VersionsUsage>('get-versions-usage').then(setUsage, () => setUsage(null));
  }, [opened]);

  async function choose(keep: number) {
    if (!usage || keep === usage.keep) return;
    if (keep > 0) {
      const answer = await showMessage(
        'Earlier Versions',
        `Keep only the last ${keep} version${keep === 1 ? '' : 's'} of each model? Older kept files are deleted now, and after each new version.`,
        ['Keep the Last ' + keep, 'Cancel']
      );
      if (answer === 'Cancel') return;
    }
    setSaving(true);
    try {
      const next = await callAction<VersionsUsage & { pruned: { deleted: number; freedBytes: number } }>('set-versions-keep', keep);
      setUsage(next);
      if (next.pruned.deleted)
        await showMessage(
          'Earlier Versions',
          `Deleted ${next.pruned.deleted} older file${next.pruned.deleted === 1 ? '' : 's'}, ${formatFileSize(next.pruned.freedBytes)} freed.`
        );
    } catch (error) {
      await showMessage('Earlier Versions', error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  if (!usage) return null;
  return (
    <div className="form-group" id="versions-space">
      <label htmlFor="versions-keep">Earlier Versions</label>
      <p className="setting-description" id="versions-usage">
        {usageText(usage)}
      </p>
      <select id="versions-keep" value={usage.keep} disabled={saving} onChange={(event) => void choose(Number(event.target.value))}>
        {CHOICES.map((n) => (
          <option key={n} value={n}>
            Keep {choiceLabel(n).toLowerCase()} of each model
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Home's Needs attention: what needs doing, the most urgent first. Each item's `key` says where
 * it is fixed (home/HomeSections.tsx runs it).
 */
import type { LibraryAttention } from '../api';
import { timeAgo } from './format';

export type AttentionKey = 'backup' | 'maintenance' | 'unorganized' | 'duplicates' | 'uncategorized' | 'untagged' | 'unlicensed' | 'thumbnails';

export interface AttentionItem {
  key: AttentionKey;
  tone: 'danger' | 'warning' | 'accent' | 'neutral';
  title: string;
  meta: string;
}

const plural = (n: number, one: string) => `${n.toLocaleString()} ${n === 1 ? one : `${one}s`}`;

/** `dueMaintenance` is how many printers have maintenance due; the library's items are for editors. */
export function attentionItems(found: LibraryAttention, dueMaintenance: number, canEdit: boolean, now = Date.now()): AttentionItem[] {
  const items: AttentionItem[] = [];
  const backup = found.backup;
  if (backup?.kind === 'failed') items.push({ key: 'backup', tone: 'danger', title: 'Automatic backup failed', meta: backup.message });
  else if (backup?.kind === 'late')
    items.push({ key: 'backup', tone: 'warning', title: 'Automatic backups are late', meta: `The newest is from ${timeAgo(backup.since, now)}` });
  if (dueMaintenance > 0) {
    items.push({ key: 'maintenance', tone: 'warning', title: `${plural(dueMaintenance, 'printer')} with maintenance due`, meta: 'Within the next 7 days' });
  }
  if (!canEdit) return items;
  if (found.unorganized && found.unorganized > 0) {
    items.push({
      key: 'unorganized',
      tone: 'accent',
      title: `${plural(found.unorganized, 'model')} not organized`,
      meta: 'Waiting in the Upload folder: Organize puts them in their categories'
    });
  }
  if (found.duplicateSets > 0) {
    items.push({
      key: 'duplicates',
      tone: 'accent',
      title: `${plural(found.duplicateSets, 'set')} of identical files`,
      meta: 'Keep one of each on the Duplicates page'
    });
  }
  if (found.uncategorized > 0) {
    items.push({
      key: 'uncategorized',
      tone: 'neutral',
      title: `${plural(found.uncategorized, 'model')} without a category`,
      meta: 'Show them in the library'
    });
  }
  if (found.untagged > 0)
    items.push({ key: 'untagged', tone: 'neutral', title: `${plural(found.untagged, 'model')} without tags`, meta: 'Show them in the library' });
  if (found.unlicensed > 0) {
    items.push({ key: 'unlicensed', tone: 'neutral', title: `${plural(found.unlicensed, 'model')} without a license`, meta: 'Show them in the library' });
  }
  if (found.noThumbnail > 0) {
    items.push({
      key: 'thumbnails',
      tone: 'neutral',
      title: `${plural(found.noThumbnail, 'model')} without a thumbnail`,
      meta: 'Generate the missing thumbnails'
    });
  }
  return items;
}

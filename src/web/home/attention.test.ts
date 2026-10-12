import { describe, expect, it } from 'vitest';
import type { LibraryAttention } from '../api';
import { attentionItems } from './attention';

const clean: LibraryAttention = { untagged: 0, unlicensed: 0, uncategorized: 0, noThumbnail: 0, duplicateSets: 0, backup: null };

describe('Needs attention', () => {
  it('is empty when nothing needs doing', () => {
    expect(attentionItems(clean, 0, true)).toEqual([]);
  });

  it('puts backups and maintenance first, then the library', () => {
    const found: LibraryAttention = {
      untagged: 12,
      unlicensed: 1,
      uncategorized: 0,
      noThumbnail: 3,
      duplicateSets: 2,
      backup: { kind: 'failed', message: 'disk full' }
    };
    const items = attentionItems(found, 1, true);
    expect(items.map((i) => i.key)).toEqual(['backup', 'maintenance', 'duplicates', 'untagged', 'unlicensed', 'thumbnails']);
    expect(items.map((i) => i.title)).toEqual([
      'Automatic backup failed',
      '1 printer with maintenance due',
      '2 sets of identical files',
      '12 models without tags',
      '1 model without a license',
      '3 models without a thumbnail'
    ]);
    expect(items[0]).toMatchObject({ tone: 'danger', meta: 'disk full' });
  });

  it('shows the library items to editors only', () => {
    expect(attentionItems({ ...clean, untagged: 5 }, 2, false).map((i) => i.key)).toEqual(['maintenance']);
  });

  it('says how late the backups are', () => {
    const now = Date.parse('2026-10-12T12:00:00Z');
    const [item] = attentionItems({ ...clean, backup: { kind: 'late', since: '2026-10-09T12:00:00Z' } }, 0, true, now);
    expect(item).toMatchObject({ key: 'backup', tone: 'warning', title: 'Automatic backups are late' });
    expect(item.meta).toMatch(/^The newest is from 3 days ago$/);
  });
});

import { describe, expect, it } from 'vitest';
import { isShareRoot, suggestedFolders, type Listing } from './folderSuggestions';

const entry = (path: string) => ({ name: path.split('/').pop() || path, path });

describe('folder setup suggestions', () => {
  it('knows an Unraid user share mount', () => {
    expect(['/mnt/user', '/mnt/user/', '/mnt/user0'].every(isShareRoot)).toBe(true);
    expect(['/mnt/models', '/mnt/user/models', '/mnt/users'].some(isShareRoot)).toBe(false);
  });

  it('suggests each mount, and the shares inside /mnt/user instead of /mnt/user', async () => {
    const listings: Record<string, Listing> = {
      '': { places: [entry('/mnt/models'), entry('/mnt/user')], folders: [] },
      '/mnt/user': { places: [], folders: [entry('/mnt/user/media'), entry('/mnt/user/models')] }
    };
    const browse = async (dir: string | null) => listings[dir || ''];
    expect(await suggestedFolders(browse)).toEqual(['/mnt/models', '/mnt/user/media', '/mnt/user/models']);
  });

  it('suggests nothing when nothing is mounted', async () => {
    expect(await suggestedFolders(async () => ({ places: [], folders: [] }))).toEqual([]);
  });
});

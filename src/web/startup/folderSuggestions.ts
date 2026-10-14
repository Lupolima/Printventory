/** Folders the folder setup (startup/FolderSetup.tsx) suggests, from browse-folders (src/server/folder-browse.js). */

interface Entry {
  name: string;
  path: string;
}
export interface Listing {
  places: Entry[];
  folders: Entry[];
}

/** An Unraid user share mount: suggest the folders in it as well as the mount itself. */
export const isShareRoot = (dir: string) => /^\/mnt\/user0?\/?$/.test(dir);

/**
 * Each mounted place; for /mnt/user also the folders in it (the shares, or the folders of the one
 * share mounted there). Unraid's own shares are left out by the server.
 */
export async function suggestedFolders(browse: (dir: string | null) => Promise<Listing>): Promise<string[]> {
  const { places } = await browse(null);
  const out: string[] = [];
  for (const place of places) {
    out.push(place.path);
    if (isShareRoot(place.path)) {
      const inside = await browse(place.path).catch(() => null);
      out.push(...(inside?.folders || []).map((folder) => folder.path));
    }
  }
  return [...new Set(out)];
}

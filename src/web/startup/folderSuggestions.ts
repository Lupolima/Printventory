/** Folders the folder setup (startup/FolderSetup.tsx) suggests, from browse-folders (src/server/folder-browse.js). */

interface Entry {
  name: string;
  path: string;
}
export interface Listing {
  places: Entry[];
  folders: Entry[];
}

/** A whole Unraid user share mount: suggest the shares in it, not the mount itself. */
export const isShareRoot = (dir: string) => /^\/mnt\/user0?\/?$/.test(dir);

/** Each mounted place, or the shares inside an Unraid user share mount (Unraid's own shares are left out by the server). */
export async function suggestedFolders(browse: (dir: string | null) => Promise<Listing>): Promise<string[]> {
  const { places } = await browse(null);
  const out: string[] = [];
  for (const place of places) {
    if (isShareRoot(place.path)) {
      const inside = await browse(place.path).catch(() => null);
      out.push(...(inside?.folders || []).map((folder) => folder.path));
    } else out.push(place.path);
  }
  return [...new Set(out)];
}

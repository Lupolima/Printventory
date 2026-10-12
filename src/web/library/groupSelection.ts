/**
 * The groups chosen in Edit mode (group cards of models that share a Parent Model, which are
 * groups: src/server/model-groups.js), next to the models in `selection`. Multi-edit applies its
 * fields to their models too, makes a group of them, or edits the one group chosen.
 */
import { normalizePath } from '../grid/layout';
import { selection } from '../selection';

export interface ChosenGroup {
  /** The group card's key (parent:<name>). */
  key: string;
  /** The group's name (its models' Parent Model). */
  name: string;
  /** Its models shown in the grid. */
  filePaths: string[];
}

const chosen = new Map<string, ChosenGroup>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

export const groupSelection = {
  get size() {
    return chosen.size;
  },
  has: (key: string) => chosen.has(key),
  values: () => [...chosen.values()],
  toggle(group: ChosenGroup) {
    if (chosen.has(group.key)) chosen.delete(group.key);
    else chosen.set(group.key, group);
    changed();
    return chosen.has(group.key);
  },
  /** A chosen group was renamed: its card has a new key. */
  replace(key: string, group: ChosenGroup) {
    if (!chosen.delete(key)) return;
    chosen.set(group.key, group);
    changed();
  },
  /** Replace the chosen groups (a Shift-click range). */
  set(groups: ChosenGroup[]) {
    chosen.clear();
    for (const group of groups) chosen.set(group.key, group);
    changed();
  },
  clear() {
    if (!chosen.size) return;
    chosen.clear();
    changed();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }
};

/** Every model Edit mode changes: the chosen models and the models of the chosen groups. */
export function editedPaths(): string[] {
  const out = new Map<string, string>();
  for (const filePath of selection.values()) out.set(normalizePath(filePath), filePath);
  for (const group of chosen.values())
    for (const filePath of group.filePaths) if (!out.has(normalizePath(filePath))) out.set(normalizePath(filePath), filePath);
  return [...out.values()];
}

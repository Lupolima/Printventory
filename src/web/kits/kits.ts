/**
 * Kit progress (src/server/kits.js): which parts of a model or folder are printed, and the
 * progress of folder cards (asked for together, and kept until a part changes).
 */
import { callAction } from '../api';
import { onServerEvent } from '../page';

export interface KitPart {
  modelId: number;
  /** The plate number; 0 for a file without several plates. */
  plate: number;
  filePath: string;
  label: string;
  seconds: number | null;
  grams: number | null;
  done: boolean;
  doneAt: string | null;
  doneBy: string | null;
}

export interface Kit {
  kind: 'file' | 'folder';
  parts: KitPart[];
  done: number;
  total: number;
}

export const getKit = (target: string) => callAction<Kit>('get-kit', target);
export const setKitPart = (filePath: string, plate: number, done: boolean) => callAction<{ done: boolean }>('set-kit-part', filePath, plate, done);

/** "3 of 12 printed". */
export const progressText = (done: number, total: number) => `${done} of ${total} printed`;

// ---- Folder cards ----

type Summary = { done: number; total: number } | null;
const summaries = new Map<string, Summary>();
const waiting = new Map<string, ((summary: Summary) => void)[]>();
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

function flush() {
  timer = null;
  const folders = [...waiting.keys()];
  const callbacks = new Map(waiting);
  waiting.clear();
  callAction<Record<string, { done: number; total: number }>>('get-kit-summaries', folders).then(
    (found) => {
      for (const folder of folders) {
        const summary = found[folder] || null;
        summaries.set(folder, summary);
        callbacks.get(folder)?.forEach((done) => done(summary));
      }
    },
    () => {}
  );
}

/** A folder's progress (null for no kit of two parts or more), asked for with the other cards in view. */
export function kitSummary(folder: string, onSummary: (summary: Summary) => void) {
  if (!listening) {
    listening = true;
    onServerEvent('kit-changed', () => summaries.clear());
  }
  if (summaries.has(folder)) return onSummary(summaries.get(folder) ?? null);
  waiting.set(folder, [...(waiting.get(folder) || []), onSummary]);
  if (!timer) timer = setTimeout(flush, 150);
}

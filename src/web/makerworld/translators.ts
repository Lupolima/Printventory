/**
 * The translators for file names and notes (Settings → MakerWorld), in the order to try them
 * (src/server/translate.js): the list on screen has every translator, ticked or not, in order.
 */
export type TranslatorId = 'google' | 'free' | 'ai';
export const TRANSLATORS: TranslatorId[] = ['google', 'free', 'ai'];

export interface TranslatorRow {
  id: TranslatorId;
  on: boolean;
}

export const TRANSLATOR_LABELS: Record<TranslatorId, string> = {
  google: 'Google Cloud Translation',
  free: 'Free translation service (MyMemory)',
  ai: 'AI service (Settings → AI Tagging)'
};

/** The saved order (a JSON list), else the older single choice (free, ai or off). */
export function savedOrder(orderValue: string | null, legacyValue: string | null): TranslatorId[] {
  if (orderValue != null) {
    try {
      const list = JSON.parse(orderValue);
      if (Array.isArray(list)) return [...new Set(list.filter((t): t is TranslatorId => TRANSLATORS.includes(t)))];
    } catch {
      // The older setting below.
    }
  }
  if (legacyValue === 'off') return [];
  return [legacyValue === 'ai' ? 'ai' : 'free'];
}

/** The rows: the ones in use in their order, then the others. */
export function rowsFor(order: TranslatorId[]): TranslatorRow[] {
  return [...order.map((id) => ({ id, on: true })), ...TRANSLATORS.filter((id) => !order.includes(id)).map((id) => ({ id, on: false }))];
}

/** The order to save: the ticked ones, top first. */
export const orderOf = (rows: TranslatorRow[]): TranslatorId[] => rows.filter((row) => row.on).map((row) => row.id);

/** Move a row up (-1) or down (+1). */
export function move(rows: TranslatorRow[], index: number, by: -1 | 1): TranslatorRow[] {
  const to = index + by;
  if (to < 0 || to >= rows.length) return rows;
  const next = [...rows];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** Google, ticked and first (when its key is added). */
export const googleFirst = (rows: TranslatorRow[]): TranslatorRow[] => [{ id: 'google', on: true }, ...rows.filter((row) => row.id !== 'google')];

/** "12,345 of 500,000 free characters used in October · 20 days until it resets (Nov 1)". */
export function usageLine(status: { used: number; free: number; month: string; daysLeft: number; resetsOn: string }): string {
  const reset = new Date(`${status.resetsOn}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${status.used.toLocaleString('en-US')} of ${status.free.toLocaleString('en-US')} free characters used in ${status.month} · ${status.daysLeft} ${
    status.daysLeft === 1 ? 'day' : 'days'
  } until it resets (${reset})`;
}

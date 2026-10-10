/**
 * Typed searches: the search box understands a small query language, the same as the search
 * chips build with AND/OR/NOT, so a power user can type it at once:
 *
 *   tag:robot AND creator:"M Armory" -tag:broken
 *   (category:Toys OR category:Art) is:unprinted rating:4+
 *
 * Fields (`field:value`, a value with spaces in quotes): tag, creator/designer/by, category, name,
 * notes, folder/path, source, license, parent. Filters: is:printed, is:unprinted, is:want,
 * is:queued, is:printing, is:failed, is:favorite, is:new, rating:N (N+ for at least N), type:3mf.
 * AND, OR and NOT (in capitals), "-" before a term for NOT, brackets, and terms side by side
 * mean AND. Plain words search every field, as before.
 */
import type { AtomKind, SearchToken } from './query';

/** Field names someone may type, and the search field each means. */
export const TYPED_FIELDS: Record<string, string> = {
  tag: 'tag',
  tags: 'tag',
  creator: 'designer',
  designer: 'designer',
  by: 'designer',
  category: 'category',
  cat: 'category',
  name: 'fileName',
  file: 'fileName',
  filename: 'fileName',
  notes: 'notes',
  note: 'notes',
  folder: 'filePath',
  path: 'filePath',
  source: 'source',
  src: 'source',
  license: 'license',
  parent: 'parentModel'
};

const IS_VALUES: Record<string, [AtomKind, string]> = {
  printed: ['printed', 'printed'],
  unprinted: ['printed', 'unprinted'],
  'not-printed': ['printed', 'not-printed'],
  want: ['printed', 'want'],
  queued: ['printed', 'queued'],
  queue: ['printed', 'in-queue'],
  printing: ['printed', 'printing'],
  failed: ['printed', 'failed'],
  favorite: ['favorite', 'favorited'],
  favourite: ['favorite', 'favorited'],
  fav: ['favorite', 'favorited'],
  new: ['isNew', 'new']
};

const FILTER_FIELDS = new Set(['is', 'status', 'rating', 'type', 'ext']);

/** Whether the text uses the query language (a known field, quotes, brackets, AND/OR/NOT, or -term). */
export function looksTyped(text: string): boolean {
  const fieldUse = /(^|[\s(-])([a-z]+):(?!\/\/)\S/gi;
  for (const m of text.matchAll(fieldUse)) {
    const field = m[2].toLowerCase();
    if (TYPED_FIELDS[field] || FILTER_FIELDS.has(field)) return true;
  }
  return /["()]/.test(text) || /(^|\s)(AND|OR|NOT)(\s|$)/.test(text) || /(^|\s)-[^\s-]/.test(text);
}

type Lexeme = { kind: 'open' | 'close' | 'and' | 'or' | 'not' } | { kind: 'term'; field: string | null; value: string; negate: boolean };

function lex(text: string): Lexeme[] {
  const out: Lexeme[] = [];
  let i = 0;
  const readValue = (): string => {
    if (text[i] === '"') {
      const end = text.indexOf('"', i + 1);
      const value = text.slice(i + 1, end < 0 ? text.length : end);
      i = end < 0 ? text.length : end + 1;
      return value;
    }
    const start = i;
    while (i < text.length && !/[\s()]/.test(text[i])) i++;
    return text.slice(start, i);
  };
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '(' || ch === ')') {
      out.push({ kind: ch === '(' ? 'open' : 'close' });
      i++;
      continue;
    }
    let negate = false;
    if (ch === '-' && i + 1 < text.length && !/[\s-]/.test(text[i + 1])) {
      negate = true;
      i++;
    }
    const field = /^([a-z]+):/i.exec(text.slice(i));
    const name = field ? field[1].toLowerCase() : '';
    if (field && (TYPED_FIELDS[name] || FILTER_FIELDS.has(name)) && i + field[0].length < text.length && !/\s/.test(text[i + field[0].length])) {
      i += field[0].length;
      out.push({ kind: 'term', field: name, value: readValue(), negate });
      continue;
    }
    const word = readValue();
    if (!negate && (word === 'AND' || word === 'OR' || word === 'NOT')) {
      out.push({ kind: word.toLowerCase() as 'and' | 'or' | 'not' });
      continue;
    }
    if (word) out.push({ kind: 'term', field: null, value: word, negate });
  }
  return out;
}

/** A term as a token, or an error for a filter value JusttPrint does not know. */
function termToken(field: string | null, raw: string): SearchToken | string {
  const value = raw.trim();
  if (!field) return { t: 'clause', field: 'all', value };
  if (TYPED_FIELDS[field]) return { t: 'clause', field: TYPED_FIELDS[field], value };
  const v = value.toLowerCase();
  if (field === 'is' || field === 'status') {
    const found = IS_VALUES[v];
    return found ? { t: 'filter', kind: found[0], value: found[1] } : `Unknown ${field}:${value} (try is:printed, is:unprinted, is:favorite, is:new)`;
  }
  if (field === 'rating') {
    const at = /^(?:>=\s*)?([1-5])(\+)?$/.exec(v);
    if (v === '0' || v === 'none' || v === 'unrated') return { t: 'filter', kind: 'rating', value: 'unrated' };
    if (!at) return `Unknown rating:${value} (try rating:4 or rating:4+)`;
    return { t: 'filter', kind: at[2] || v.startsWith('>=') ? 'ratingMin' : 'rating', value: at[1] };
  }
  // type: / ext:
  return { t: 'filter', kind: 'fileType', value: v.replace(/^\./, '') };
}

/**
 * The tokens for typed text, with AND between terms side by side: { tokens, error }. `error` says
 * what could not be read (the rest is still used).
 */
export function parseTyped(text: string): { tokens: SearchToken[]; error: string | null } {
  const tokens: SearchToken[] = [];
  let error: string | null = null;
  const endsTerm = () => {
    const last = tokens[tokens.length - 1];
    return !!last && (last.t === 'clause' || last.t === 'filter' || last.t === 'filterMulti' || last.t === 'close');
  };
  for (const lexeme of lex(text)) {
    if (lexeme.kind === 'and' || lexeme.kind === 'or') {
      if (endsTerm()) tokens.push({ t: 'op', op: lexeme.kind === 'and' ? 'AND' : 'OR' });
      continue;
    }
    if (lexeme.kind === 'close') {
      tokens.push({ t: 'close' });
      continue;
    }
    // A term, NOT or an opening bracket next to a term: AND between them.
    if (endsTerm()) tokens.push({ t: 'op', op: 'AND' });
    if (lexeme.kind === 'not') tokens.push({ t: 'not' });
    else if (lexeme.kind === 'open') tokens.push({ t: 'open' });
    else if (lexeme.kind === 'term') {
      if (!lexeme.value.trim()) continue;
      const token = termToken(lexeme.field, lexeme.value);
      if (typeof token === 'string') {
        error = error || token;
        // An AND added for this term goes again.
        const last = tokens[tokens.length - 1];
        if (last && last.t === 'op') tokens.pop();
        continue;
      }
      if (lexeme.negate) tokens.push({ t: 'not' });
      tokens.push(token);
    }
  }
  return { tokens, error };
}

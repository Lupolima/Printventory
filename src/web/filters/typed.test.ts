import { describe, expect, it } from 'vitest';
import { emptyFilterState, normalizeTokens, removeToken, serverFilters } from './query';
import { looksTyped, parseTyped } from './typed';

const clause = (field: string, value: string) => ({ t: 'clause', field, value });
const AND = { t: 'op', op: 'AND' };
const OR = { t: 'op', op: 'OR' };

describe('typed searches', () => {
  it('are told apart from plain words', () => {
    expect(looksTyped('phone stand')).toBe(false);
    expect(looksTyped('https://makerworld.com/x')).toBe(false);
    expect(looksTyped('note: 3:2 ratio')).toBe(false);
    expect(looksTyped('tag:robot')).toBe(true);
    expect(looksTyped('"phone stand"')).toBe(true);
    expect(looksTyped('robot -broken')).toBe(true);
    expect(looksTyped('robot OR dragon')).toBe(true);
    expect(looksTyped('robot or dragon')).toBe(false);
  });

  it('read fields, quotes, NOT and side-by-side terms', () => {
    expect(parseTyped('tag:robot AND creator:"M Armory" -tag:broken')).toEqual({
      tokens: [clause('tag', 'robot'), AND, clause('designer', 'M Armory'), AND, { t: 'not' }, clause('tag', 'broken')],
      error: null
    });
    expect(parseTyped('voltron lion').tokens).toEqual([clause('all', 'voltron'), AND, clause('all', 'lion')]);
  });

  it('read brackets, OR and filters', () => {
    expect(parseTyped('(category:Toys OR cat:Art) is:unprinted rating:4+ type:.3mf').tokens).toEqual([
      { t: 'open' },
      clause('category', 'Toys'),
      OR,
      clause('category', 'Art'),
      { t: 'close' },
      AND,
      { t: 'filter', kind: 'printed', value: 'unprinted' },
      AND,
      { t: 'filter', kind: 'ratingMin', value: '4' },
      AND,
      { t: 'filter', kind: 'fileType', value: '3mf' }
    ]);
    expect(parseTyped('is:favorite rating:5 NOT by:bob').tokens).toEqual([
      { t: 'filter', kind: 'favorite', value: 'favorited' },
      AND,
      { t: 'filter', kind: 'rating', value: '5' },
      AND,
      { t: 'not' },
      clause('designer', 'bob')
    ]);
  });

  it('say what they could not read and keep the rest', () => {
    expect(parseTyped('is:sideways tag:a')).toEqual({ tokens: [clause('tag', 'a')], error: expect.stringContaining('is:sideways') });
    expect(parseTyped('rating:9').error).toContain('rating:9');
  });

  it('pair their brackets before the server gets them', () => {
    expect(normalizeTokens(parseTyped('(tag:a OR tag:b').tokens as never)).toEqual([{ t: 'open' }, clause('tag', 'a'), OR, clause('tag', 'b'), { t: 'close' }]);
    expect(normalizeTokens(parseTyped('tag:a) ()').tokens as never)).toEqual([clause('tag', 'a')]);
    const state = { ...emptyFilterState(), tokens: parseTyped('(tag:a OR tag:b) name:x').tokens as never };
    expect(removeToken(state, 0).tokens).toEqual([clause('tag', 'a'), OR, clause('tag', 'b'), AND, clause('fileName', 'x')]);
    expect(serverFilters(state).searchTokens).toEqual(state.tokens);
  });
});

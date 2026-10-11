import { describe, expect, it } from 'vitest';
import type { CategoryScan } from '../api';
import { groupCategories, scanSummary } from './CategoriesPage';

const run = (changes: Partial<CategoryScan>): CategoryScan => ({
  id: 1,
  running: false,
  stopping: false,
  phase: 'done',
  useAi: false,
  total: 10,
  processed: 10,
  placed: {},
  left: 0,
  aiTotal: 0,
  aiDone: 0,
  noPicture: 0,
  error: null,
  again: false,
  aiPlaced: [],
  ...changes
});

describe('Categorize Library summary', () => {
  it('says where the categories came from and what is left', () => {
    expect(scanSummary(run({ placed: { site: 3, folder: 1 }, left: 6 }))).toEqual([
      '3 models placed from the site they came from.',
      '1 model placed from their folder names.',
      '6 models still without a Subcategory.'
    ]);
  });

  it('counts what the AI looked at, without the models it skipped', () => {
    expect(scanSummary(run({ useAi: true, placed: { tag: 2 }, left: 8, aiTotal: 8, aiDone: 8, noPicture: 2, error: 'Rate limit exceeded' }))).toEqual([
      '2 models placed from their tags.',
      'The AI looked at 6 models (2 models without a picture skipped).',
      '8 models still without a Subcategory.',
      'Stopped: Rate limit exceeded'
    ]);
  });

  it('has nothing to do when every model has a category', () => {
    expect(scanSummary(run({ total: 0 }))).toEqual(['Every model already has a Category and a Subcategory.']);
  });

  it('counts what the AI placed', () => {
    expect(scanSummary(run({ useAi: true, placed: { site: 1, ai: 4 }, aiTotal: 4, aiDone: 4 }))).toEqual([
      '1 model placed from the site they came from.',
      '4 models placed by the AI.',
      'The AI looked at 4 models.'
    ]);
  });
});

describe('Category groups', () => {
  it('puts each Subcategory under its Category', () => {
    const c = (id: number, name: string, parent_id: number | null) => ({ id, name, parent_id, keywords: [], model_count: 0 });
    const groups = groupCategories([c(1, 'Art', null), c(2, '2D Art', 1), c(3, 'Tools', null), c(4, 'Hand Tools', 3), c(5, 'Sculptures', 1)]);
    expect(groups.map((g) => [g.category.name, g.subcategories.map((s) => s.name)])).toEqual([
      ['Art', ['2D Art', 'Sculptures']],
      ['Tools', ['Hand Tools']]
    ]);
  });
});

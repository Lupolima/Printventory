import { describe, expect, it } from 'vitest';
import { amountText, etaText, percentOf, shown, type Activity } from './activity';

const job = (changes: Partial<Activity>): Activity => ({
  id: 'x',
  kind: 'scan',
  label: 'Scanning',
  detail: null,
  done: 0,
  total: null,
  unit: 'models',
  startedAt: new Date(0).toISOString(),
  etaMs: null,
  ...changes
});

describe('background activity', () => {
  it('tells how much is done', () => {
    expect(amountText(job({ done: 12, total: 140 }))).toBe('12 of 140 models');
    expect(amountText(job({ done: 1204, unit: 'files' }))).toBe('1,204 files so far');
    expect(amountText(job({ done: 3.2 * 1024 * 1024, total: 10 * 1024 * 1024, unit: 'bytes' }))).toBe('3.2 MB of 10.0 MB');
    expect(amountText(job({ done: 45, total: 100, unit: 'pages' }))).toBe('45%');
    expect(percentOf(job({ done: 1, total: 3 }))).toBe(33);
    expect(percentOf(job({ done: 5 }))).toBeNull();
  });

  it('tells the time left', () => {
    expect(etaText(null)).toBe('');
    expect(etaText(20000)).toBe('less than a minute left');
    expect(etaText(3 * 60000)).toBe('about 3 min left');
    expect(etaText(80 * 60000)).toBe('about 1 h 20 min left');
    expect(etaText(120 * 60000)).toBe('about 2 h left');
  });

  it('shows a scan once it has run for a moment, other jobs at once', () => {
    const now = Date.parse('2026-10-12T10:00:10Z');
    const list = [
      job({ id: 'old', startedAt: '2026-10-12T10:00:00Z' }),
      job({ id: 'new', startedAt: '2026-10-12T10:00:09.500Z' }),
      job({ id: 'upload', kind: 'upload', startedAt: '2026-10-12T10:00:09.900Z' })
    ];
    expect(shown(list, now).map((j) => j.id)).toEqual(['old', 'upload']);
  });
});

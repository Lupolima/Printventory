import { describe, expect, it } from 'vitest';
import { googleFirst, move, orderOf, rowsFor, savedOrder, usageLine } from './translators';

describe('the translators in order', () => {
  it('read the saved order, or the older single choice', () => {
    expect(savedOrder('["google","ai","nope","google"]', 'free')).toEqual(['google', 'ai']);
    expect(savedOrder(null, 'ai')).toEqual(['ai']);
    expect(savedOrder(null, 'off')).toEqual([]);
    expect(savedOrder(null, null)).toEqual(['free']);
    expect(savedOrder('[]', 'free')).toEqual([]);
  });

  it('list every translator, the ones in use first, and save the ticked ones in order', () => {
    const rows = rowsFor(['free']);
    expect(rows).toEqual([
      { id: 'free', on: true },
      { id: 'google', on: false },
      { id: 'ai', on: false }
    ]);
    expect(orderOf(move(rows, 1, -1).map((r) => ({ ...r, on: true })))).toEqual(['google', 'free', 'ai']);
    expect(move(rows, 0, -1)).toBe(rows);
    expect(orderOf(googleFirst(rows))).toEqual(['google', 'free']);
  });

  it('say how much of the month is used and when it resets', () => {
    expect(usageLine({ used: 412345, free: 500000, month: 'October', daysLeft: 21, resetsOn: '2026-11-01' })).toBe(
      '412,345 of 500,000 free characters used in October · 21 days until it resets (Nov 1)'
    );
    expect(usageLine({ used: 0, free: 500000, month: 'December', daysLeft: 1, resetsOn: '2027-01-01' })).toContain('1 day until it resets (Jan 1)');
  });
});

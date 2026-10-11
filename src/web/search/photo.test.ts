import { describe, expect, it } from 'vitest';
import { fitInside, PHOTO_MAX_SIDE } from './photo';

describe('photos for Search with a Photo', () => {
  it('are made small on their longest side, never larger', () => {
    expect(fitInside(4032, 3024)).toEqual({ width: PHOTO_MAX_SIDE, height: 768 });
    expect(fitInside(3024, 4032)).toEqual({ width: 768, height: PHOTO_MAX_SIDE });
    expect(fitInside(640, 480)).toEqual({ width: 640, height: 480 });
    expect(fitInside(0, 10)).toEqual({ width: 0, height: 0 });
  });
});

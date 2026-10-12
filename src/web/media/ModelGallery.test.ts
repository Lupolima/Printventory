import { describe, expect, it } from 'vitest';
import { galleryItems } from './ModelGallery';

const file = (name: string) => ({ name, path: `/m/image/${name}`, size: 1, modified: null });

describe('the model page gallery', () => {
  it('shows the photos, the cover first, then the renders', () => {
    const items = galleryItems({ image: [file('a.jpg'), file('b.jpg')], cover: 'b.jpg' }, ['data:image/webp;base64,R', '3d.png']);
    expect(items.map((i) => (i.kind === 'photo' ? `${i.file.name}${i.cover ? '*' : ''}` : 'render'))).toEqual(['b.jpg*', 'a.jpg', 'render']);
  });

  it('shows only renders without photos', () => {
    expect(galleryItems({ image: [], cover: null }, ['data:image/png;base64,X']).length).toBe(1);
    expect(galleryItems({ image: [], cover: null }, ['3d.png']).length).toBe(0);
  });
});

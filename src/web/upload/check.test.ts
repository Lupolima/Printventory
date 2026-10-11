import { describe, expect, it } from 'vitest';
import { checkFile, extensionOf } from './check';

const info = { extensions: ['.3mf', '.stl'], maxBytes: 100 };

describe('upload checks', () => {
  it('reads extensions in lower case', () => {
    expect(extensionOf('Benchy.STL')).toBe('.stl');
    expect(extensionOf('README')).toBe('');
    expect(extensionOf('.hidden')).toBe('');
  });

  it('lets through model files within the limit, and says why others are skipped', () => {
    expect(checkFile({ name: 'a.stl', size: 100 }, info)).toEqual({ ok: true });
    expect(checkFile({ name: 'a.obj', size: 1 }, info)).toEqual({ ok: false, reason: '.obj files are not scanned (Settings → File Types)' });
    expect(checkFile({ name: 'a.3mf', size: 101 }, info)).toEqual({ ok: false, reason: 'larger than the upload limit' });
    expect(checkFile({ name: '.a.stl', size: 1 }, info)).toEqual({ ok: false, reason: 'hidden files are not uploaded' });
    expect(checkFile({ name: 'notes', size: 1 }, info)).toEqual({ ok: false, reason: 'no file extension' });
  });

  it('warns about files the scan will skip', () => {
    const check = checkFile({ name: 'huge.stl', size: 60 }, { ...info, scanMaxBytes: 50 });
    expect(check.ok).toBe(true);
    expect(check.ok && check.warning).toMatch(/scan limit/);
  });

  it('takes pictures, videos and documents only into a model folder', () => {
    const withMedia = { ...info, mediaExtensions: { image: ['.png'], video: ['.mp4'], document: ['.pdf'] } };
    expect(checkFile({ name: 'cover.png', size: 1 }, withMedia, 'yes')).toEqual({ ok: true });
    expect(checkFile({ name: 'cover.png', size: 101 }, withMedia, 'yes')).toEqual({ ok: false, reason: 'larger than the upload limit' });
    expect(checkFile({ name: 'guide.pdf', size: 1 }, withMedia, 'no')).toEqual({ ok: false, reason: 'pictures, videos and documents need “One model”' });
    expect(checkFile({ name: 'cover.png', size: 1 }, withMedia).ok).toBe(false);
  });
});

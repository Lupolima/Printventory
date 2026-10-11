import { describe, expect, it } from 'vitest';
import { documentView, folderOf, isPlayable, isTiff, mediaUrl } from './media';

describe('model media', () => {
  it('picks a viewer for each document', () => {
    expect(documentView('Guide.PDF')).toBe('pdf');
    expect(documentView('readme.md')).toBe('markdown');
    expect(documentView('parts.text')).toBe('text');
    expect(documentView('manual.docx')).toBe('docx');
    expect(documentView('old.doc')).toBe('none');
    expect(documentView('page.html')).toBe('html');
  });

  it('knows what browsers play and show', () => {
    expect(isPlayable('clip.m4v')).toBe(true);
    expect(isPlayable('clip.mpg')).toBe(false);
    expect(isTiff('scan.TIF')).toBe(true);
  });

  it('builds addresses and folders', () => {
    expect(mediaUrl('/lib/Robot/image/a b.png')).toBe('/api/media/%2Flib%2FRobot%2Fimage%2Fa%20b.png');
    expect(mediaUrl('/x/d.pdf', true)).toMatch(/\?download=1$/);
    expect(folderOf('/lib/Robot/Robot.3mf')).toBe('/lib/Robot');
    expect(folderOf('C:\\lib\\Robot\\a.stl')).toBe('C:\\lib\\Robot');
  });
});

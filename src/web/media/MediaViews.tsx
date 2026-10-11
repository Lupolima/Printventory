import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { render as renderMarkdown } from '../notes/markdown';
import { documentView, isTiff, mediaUrl, type MediaFile } from './media';

/** TIFF pictures as PNG data URLs (browsers other than Safari do not show TIFF), kept per address. */
const tiffCache = new Map<string, Promise<string>>();

function tiffToDataUrl(url: string): Promise<string> {
  let found = tiffCache.get(url);
  if (!found) {
    found = (async () => {
      const [UTIF, response] = await Promise.all([import('utif'), fetch(url, { credentials: 'same-origin' })]);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      const [first] = UTIF.decode(buffer);
      if (!first) throw new Error('Not a TIFF picture');
      UTIF.decodeImage(buffer, first);
      const rgba = UTIF.toRGBA8(first);
      const canvas = document.createElement('canvas');
      canvas.width = first.width;
      canvas.height = first.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('No canvas');
      context.putImageData(new ImageData(Uint8ClampedArray.from(rgba), first.width, first.height), 0, 0);
      return canvas.toDataURL('image/png');
    })();
    tiffCache.set(url, found);
    found.catch(() => tiffCache.delete(url));
  }
  return found;
}

/** A model folder picture, TIFF included. */
export function MediaImage({ file, className, alt = '' }: { file: MediaFile; className?: string; alt?: string }) {
  const url = mediaUrl(file.path);
  const [src, setSrc] = useState<string | null>(isTiff(file.name) ? null : url);
  useEffect(() => {
    if (!isTiff(file.name)) {
      setSrc(url);
      return undefined;
    }
    let current = true;
    tiffToDataUrl(url).then(
      (data) => current && setSrc(data),
      () => current && setSrc('')
    );
    return () => {
      current = false;
    };
  }, [url, file.name]);
  if (src === null) return <span className={`jp-media__loading ${className || ''}`} aria-label="Loading" />;
  if (!src) return <span className={`jp-media__broken ${className || ''}`}>Cannot show {file.name}</span>;
  return <img src={src} alt={alt} className={className} draggable={false} loading="lazy" />;
}

/** A document, read in the page: PDF in the browser's viewer, HTML and Word in a sandbox (no scripts), Markdown and text as text. */
export function DocumentViewer({ file }: { file: MediaFile }) {
  const view = documentView(file.name);
  const url = mediaUrl(file.path);
  const [content, setContent] = useState<{ html?: string; text?: string; error?: string } | null>(null);

  useEffect(() => {
    setContent(null);
    if (!['markdown', 'text', 'docx'].includes(view)) return undefined;
    let current = true;
    (async () => {
      const response = await fetch(url, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (view === 'docx') {
        const mammoth = await import('mammoth');
        const result = await mammoth.convertToHtml({ arrayBuffer: await response.arrayBuffer() });
        return { html: result.value };
      }
      const text = await response.text();
      return view === 'markdown' ? { html: renderMarkdown(text) } : { text };
    })().then(
      (found) => current && setContent(found),
      (error: unknown) => current && setContent({ error: error instanceof Error ? error.message : String(error) })
    );
    return () => {
      current = false;
    };
  }, [url, view]);

  if (view === 'pdf') return <iframe className="jp-doc-view__frame" title={file.name} src={url} />;
  if (view === 'html') return <iframe className="jp-doc-view__frame" title={file.name} src={url} sandbox="" referrerPolicy="no-referrer" />;
  if (view === 'none') {
    return (
      <div className="jp-doc-view__none">
        <p>Browsers cannot show {file.name} (the old Word format). Download it to open it, or save it as .docx or .pdf to read it here.</p>
        <a className="jp-btn" href={mediaUrl(file.path, true)} download={file.name}>
          <Download size={16} aria-hidden="true" /> Download
        </a>
      </div>
    );
  }
  if (!content) return <div className="jp-doc-view__loading">Opening {file.name}…</div>;
  if (content.error)
    return (
      <div className="jp-doc-view__none">
        Could not open {file.name}: {content.error}
      </div>
    );
  if (view === 'docx') {
    // Word's text in a sandbox: links and anything else in it cannot run.
    const page = `<!doctype html><meta charset="utf-8"><style>body{font:15px/1.55 system-ui,sans-serif;margin:24px;color:#222;background:#fff}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}</style>${content.html || ''}`;
    return <iframe className="jp-doc-view__frame" title={file.name} srcDoc={page} sandbox="" />;
  }
  if (content.html !== undefined) return <div className="jp-doc-view__text jp-model-page__markdown" dangerouslySetInnerHTML={{ __html: content.html }} />;
  return <pre className="jp-doc-view__text jp-doc-view__pre">{content.text}</pre>;
}

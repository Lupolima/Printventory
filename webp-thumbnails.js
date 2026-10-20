/**
 * Shrinks WebP thumbnails (the gallery pictures inside MakerWorld 3MFs) that nativeImage cannot
 * decode. A hidden Chromium window decodes each one, scales it to THUMBNAIL_MAX_DIMENSION and
 * re-encodes it as JPEG (WebP again when it has transparency). The work runs in that window's
 * renderer, so the main process stays responsive.
 */
const { app, BrowserWindow } = require('electron');
const { THUMBNAIL_MAX_DIMENSION } = require('./thumbnail-compress');

/** WebP parts longer than this are re-encoded (about 75 KB of image data). */
const WEBP_SHRINK_MIN_CHARS = 100000;
const JPEG_QUALITY = 0.82;
const IDLE_CLOSE_MS = 15000;

let converter = null;
let converterReady = null;
let idleTimer = null;

function destroyConverter() {
  clearTimeout(idleTimer);
  if (converter && !converter.isDestroyed()) converter.destroy();
  converter = null;
  converterReady = null;
}

// The app quits when its last window closes: never let this hidden window keep it alive.
app.on('browser-window-created', (_event, win) => {
  if (win === converter) return;
  win.on('closed', () => {
    const others = BrowserWindow.getAllWindows().filter((w) => w !== converter && !w.isDestroyed());
    if (others.length === 0) destroyConverter();
  });
});

function getConverter() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(destroyConverter, IDLE_CLOSE_MS);
  if (converter && !converter.isDestroyed()) return converterReady;
  converter = new BrowserWindow({
    width: 64,
    height: 64,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  converter.on('closed', () => {
    converter = null;
    converterReady = null;
  });
  const win = converter;
  converterReady = win.loadURL('about:blank').then(() => win);
  return converterReady;
}

/* Runs in the hidden window: data URL in, smaller data URL out. */
async function shrinkInPage(src, maxDimension, quality) {
  const blob = await (await fetch(src)).blob();
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const pixels = ctx.getImageData(0, 0, width, height).data;
  let opaque = true;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] < 255) {
      opaque = false;
      break;
    }
  }
  const out = await canvas.convertToBlob({ type: opaque ? 'image/jpeg' : 'image/webp', quality });
  const bytes = new Uint8Array(await out.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return `data:${out.type};base64,${btoa(binary)}`;
}

function isOversizedWebp(part) {
  return typeof part === 'string' && part.startsWith('data:image/webp') && part.length > WEBP_SHRINK_MIN_CHARS;
}

/** A smaller data URL for one WebP picture, or null when it cannot be made smaller. */
async function shrinkWebpDataUrl(dataUrl) {
  try {
    const win = await getConverter();
    const script = `(${shrinkInPage.toString()})(${JSON.stringify(dataUrl)}, ${THUMBNAIL_MAX_DIMENSION}, ${JPEG_QUALITY})`;
    const result = await win.webContents.executeJavaScript(script);
    return typeof result === 'string' && result.startsWith('data:image/') && result.length < dataUrl.length ? result : null;
  } catch (error) {
    console.warn('[WebP thumbnails] Could not shrink a picture:', error.message);
    return null;
  }
}

/**
 * Shrinks the oversized WebP parts of a thumbnail column value (single or :: joined).
 * @returns {Promise<{ value: string, changed: boolean }>}
 */
async function shrinkWebpThumbnailParts(thumbnailString) {
  if (!thumbnailString || !thumbnailString.includes('data:image/webp')) {
    return { value: thumbnailString, changed: false };
  }
  const parts = thumbnailString.split('::');
  let changed = false;
  for (let i = 0; i < parts.length; i++) {
    if (!isOversizedWebp(parts[i])) continue;
    const smaller = await shrinkWebpDataUrl(parts[i]);
    if (smaller) {
      parts[i] = smaller;
      changed = true;
    }
  }
  return { value: changed ? parts.join('::') : thumbnailString, changed };
}

module.exports = { isOversizedWebp, shrinkWebpThumbnailParts, closeWebpConverter: destroyConverter };

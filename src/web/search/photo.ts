/** Photos for Search with a Photo: how small they are made before sending. */

/** The size a photo is sent at: its longest side at most this many pixels. */
export const PHOTO_MAX_SIDE = 1024;

/** The width and height a picture is scaled to (never up). */
export function fitInside(width: number, height: number, max = PHOTO_MAX_SIDE): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

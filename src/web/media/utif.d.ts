/** UTIF.js (utif on npm): TIFF decoding in the browser. */
declare module 'utif' {
  interface Ifd {
    width: number;
    height: number;
  }
  export function decode(buffer: ArrayBuffer): Ifd[];
  export function decodeImage(buffer: ArrayBuffer, ifd: Ifd): void;
  export function toRGBA8(ifd: Ifd): Uint8Array;
}

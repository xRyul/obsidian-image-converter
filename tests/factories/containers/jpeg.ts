/** JPEG builder and inspectors, which do not use the code under test. */

import { makeJpegBytes } from '../image';

export function buildJpeg(options: { width?: number; height?: number; exif?: Uint8Array } = {}): Uint8Array {
  return new Uint8Array(makeJpegBytes(options));
}

export function countApp1ExifSegments(bytes: Uint8Array): number {
  let count = 0;
  let offset = 2;

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;

    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    const payload = offset + 4;
    const isExif = marker === 0xe1
      && bytes[payload] === 0x45
      && bytes[payload + 1] === 0x78
      && bytes[payload + 2] === 0x69
      && bytes[payload + 3] === 0x66;

    if (isExif) count++;
    offset = offset + 2 + length;
  }

  return count;
}

/**
 * Sets the 0xFF byte of the SOS marker to zero, so the segment reader stops
 * before it gets to the scan.
 */
export function damageJpegScanMarker(bytes: Uint8Array): Uint8Array {
  const out = bytes.slice();
  let offset = 2;

  while (offset + 4 <= out.length) {
    if (out[offset + 1] === 0xda) break;

    const length = (out[offset + 2] << 8) | out[offset + 3];
    const next = offset + 2 + length;

    if (next + 1 < out.length && out[next + 1] === 0xda) {
      out[next] = 0x00;
      return out;
    }

    offset = next;
  }

  throw new Error('fixture has no segment before the scan');
}

/**
 * Returns all bytes from the SOS marker to the end (the compressed scan
 * data). Throws if there is no SOS marker, so that two broken fixtures cannot
 * compare as equal.
 */
export function jpegScanData(bytes: Uint8Array): Uint8Array {
  let offset = 2;

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === 0xda) return bytes.slice(offset);
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    offset = offset + 2 + length;
  }

  throw new Error('no start-of-scan segment found');
}

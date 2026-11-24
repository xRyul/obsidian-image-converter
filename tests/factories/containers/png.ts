/** A spec-accurate PNG builder, with inspectors that do not use the code under test. */

import { ascii, concat, readFourCc } from '../../../src/metadata/containers/bytes';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function crcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
}

const TABLE = crcTable();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);

  view.setUint32(0, data.length, false);
  chunk.set(ascii(type), 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)), false);

  return chunk;
}

/** A structurally valid PNG with correct chunk CRCs. */
export function buildPng(options: { width?: number; height?: number; exif?: Uint8Array } = {}): Uint8Array {
  const width = options.width ?? 100;
  const height = options.height ?? 80;

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB

  const parts: Uint8Array[] = [
    new Uint8Array(PNG_SIGNATURE),
    pngChunk('IHDR', ihdr),
  ];

  if (options.exif) {
    parts.push(pngChunk('eXIf', options.exif));
  }

  parts.push(pngChunk('IDAT', new Uint8Array([0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01])));
  parts.push(pngChunk('IEND', new Uint8Array(0)));

  return concat(parts);
}

/** True when every chunk CRC in a PNG is correct. */
export function pngChunkCrcsValid(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = PNG_SIGNATURE.length;

  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset, false);
    const payloadEnd = offset + 8 + length;
    if (payloadEnd + 4 > bytes.length) return false;

    const expected = view.getUint32(payloadEnd, false);
    if (crc32(bytes.subarray(offset + 4, payloadEnd)) !== expected) return false;

    offset = payloadEnd + 4;
  }

  return true;
}

/** PNG chunks in file order, with the offset and size of each payload. */
function pngChunks(bytes: Uint8Array): { type: string; payloadStart: number; size: number }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: { type: string; payloadStart: number; size: number }[] = [];
  let offset = PNG_SIGNATURE.length;

  while (offset + 12 <= bytes.length) {
    const size = view.getUint32(offset, false);
    chunks.push({ type: readFourCc(bytes, offset + 4), payloadStart: offset + 8, size });
    offset = offset + 12 + size;
  }

  return chunks;
}

/** Returns a copy of the payload of the first chunk of this type, or null if there is none. */
export function pngChunkPayload(bytes: Uint8Array, type: string): Uint8Array | null {
  const chunk = pngChunks(bytes).find((candidate) => candidate.type === type);
  return chunk ? bytes.slice(chunk.payloadStart, chunk.payloadStart + chunk.size) : null;
}

/** Lists PNG chunk types in file order. */
export function pngChunkTypes(bytes: Uint8Array): string[] {
  return pngChunks(bytes).map((chunk) => chunk.type);
}

/** Gives the chunk after IDAT a length that goes past the end of the file. */
export function damagePngChunkAfterIdat(bytes: Uint8Array): Uint8Array {
  const out = bytes.slice();
  const view = new DataView(out.buffer);
  let offset = PNG_SIGNATURE.length;

  while (offset + 12 <= out.length) {
    const length = view.getUint32(offset, false);
    const next = offset + 12 + length;

    if (readFourCc(out, offset + 4) === 'IDAT' && next + 4 <= out.length) {
      view.setUint32(next, 0x7fffffff, false);
      return out;
    }

    offset = next;
  }

  throw new Error('fixture has no chunk after IDAT');
}

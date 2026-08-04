/**
 * Spec-accurate PNG and WebP builders for the metadata container tests.
 *
 * The builders in image.ts are intentionally loose (fake CRCs, a VP8 chunk with
 * no frame tag) because the tests using them only care about magic bytes. The
 * metadata writers parse these containers for real, so they need real ones.
 */

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

export function crc32(bytes: Uint8Array): number {
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
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)), false);

  return chunk;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
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

/** Verifies every chunk CRC in a PNG. */
export function pngChunkCrcsValid(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = PNG_SIGNATURE.length;

  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset, false);
    const dataEnd = offset + 8 + length;
    if (dataEnd + 4 > bytes.length) return false;

    const expected = view.getUint32(dataEnd, false);
    if (crc32(bytes.subarray(offset + 4, dataEnd)) !== expected) return false;

    offset = dataEnd + 4;
  }

  return true;
}

/** Lists PNG chunk types in file order. */
export function pngChunkTypes(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const types: string[] = [];
  let offset = PNG_SIGNATURE.length;

  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset, false);
    types.push(String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]));
    offset = offset + 12 + length;
  }

  return types;
}

// --- WebP -------------------------------------------------------------------

function riffChunk(type: string, payload: Uint8Array): Uint8Array {
  const padding = payload.length % 2;
  const chunk = new Uint8Array(8 + payload.length + padding);
  const view = new DataView(chunk.buffer);

  for (let i = 0; i < 4; i++) chunk[i] = type.charCodeAt(i);
  view.setUint32(4, payload.length, true);
  chunk.set(payload, 8);

  return chunk;
}

function riff(body: Uint8Array[]): Uint8Array {
  const bodyBytes = concat(body);
  const header = new Uint8Array(12);

  header.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  new DataView(header.buffer).setUint32(4, 4 + bodyBytes.length, true);
  header.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"

  return concat([header, bodyBytes]);
}

/** Simple lossy WebP: a bare `VP8 ` chunk, which is what canvas emits. */
export function buildWebpLossy(width = 100, height = 80): Uint8Array {
  const payload = new Uint8Array(20);
  const view = new DataView(payload.buffer);

  // 3-byte frame tag: keyframe (low bit clear).
  payload[0] = 0x10;
  payload[1] = 0x00;
  payload[2] = 0x00;
  // Start code.
  payload[3] = 0x9d;
  payload[4] = 0x01;
  payload[5] = 0x2a;
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);

  return riff([riffChunk('VP8 ', payload)]);
}

/** Simple lossless WebP: a bare `VP8L` chunk. */
export function buildWebpLossless(width = 100, height = 80, hasAlpha = false): Uint8Array {
  const payload = new Uint8Array(16);
  payload[0] = 0x2f; // VP8L signature

  const bits = ((width - 1) & 0x3fff)
    | (((height - 1) & 0x3fff) << 14)
    | ((hasAlpha ? 1 : 0) << 28);
  new DataView(payload.buffer).setUint32(1, bits >>> 0, true);

  return riff([riffChunk('VP8L', payload)]);
}

/** Extended WebP that already has a VP8X chunk, optionally carrying EXIF. */
export function buildWebpExtended(
  options: { width?: number; height?: number; exif?: Uint8Array; alpha?: boolean } = {}
): Uint8Array {
  const width = options.width ?? 100;
  const height = options.height ?? 80;

  const vp8x = new Uint8Array(10);
  vp8x[0] = (options.alpha ? 0x10 : 0) | (options.exif ? 0x08 : 0);
  writeUint24(vp8x, 4, width - 1);
  writeUint24(vp8x, 7, height - 1);

  const body = [riffChunk('VP8X', vp8x)];

  const image = new Uint8Array(20);
  image[0] = 0x10;
  image[3] = 0x9d;
  image[4] = 0x01;
  image[5] = 0x2a;
  new DataView(image.buffer).setUint16(6, width, true);
  new DataView(image.buffer).setUint16(8, height, true);
  body.push(riffChunk('VP8 ', image));

  if (options.exif) {
    body.push(riffChunk('EXIF', options.exif));
  }

  return riff(body);
}

/** Lists WebP chunk FourCCs in file order. */
export function webpChunkTypes(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const types: string[] = [];
  let offset = 12;

  while (offset + 8 <= bytes.length) {
    const size = view.getUint32(offset + 4, true);
    types.push(String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]));
    offset += 8 + size + (size % 2);
  }

  return types;
}

/** Reads the VP8X flags byte, or null when the file is not extended. */
export function webpVp8xFlags(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;

  while (offset + 8 <= bytes.length) {
    const size = view.getUint32(offset + 4, true);
    const type = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    if (type === 'VP8X') return bytes[offset + 8];
    offset += 8 + size + (size % 2);
  }

  return null;
}

/** True when the RIFF size field matches the actual file length. */
export function webpRiffSizeValid(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(4, true) === bytes.length - 8;
}

function writeUint24(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
  bytes[offset + 2] = (value >> 16) & 0xff;
}

// --- ISOBMFF (HEIC / AVIF) --------------------------------------------------

function fourCc(text: string): Uint8Array {
  const out = new Uint8Array(4);
  for (let i = 0; i < 4; i++) out[i] = text.charCodeAt(i);
  return out;
}

function u16be(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, false);
  return out;
}

function u32be(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length, false);
  out.set(fourCc(type), 4);
  out.set(payload, 8);
  return out;
}

/**
 * A minimal HEIC/AVIF file carrying an EXIF item.
 *
 * `mdat` is placed before `meta` so the item's file offset is known while the
 * `iloc` box is being built - no back-patching needed.
 */
export function buildIsobmff(
  options: {
    brand?: string;
    compatibleBrands?: string[];
    exif?: Uint8Array;
    tiffHeaderOffset?: number;
    omitExifItem?: boolean;
  } = {}
): Uint8Array {
  const brand = options.brand ?? 'heic';
  const compatible = options.compatibleBrands ?? [brand, 'mif1'];
  const ftyp = box('ftyp', concat([fourCc(brand), u32be(0), ...compatible.map(fourCc)]));

  if (!options.exif) {
    return concat([ftyp, box('mdat', new Uint8Array(8))]);
  }

  const headerOffset = options.tiffHeaderOffset ?? 0;
  const itemPayload = concat([u32be(headerOffset), new Uint8Array(headerOffset), options.exif]);
  const mdat = box('mdat', itemPayload);
  const extentOffset = ftyp.length + 8; // mdat payload begins here

  // Item type is deliberately wrong when omitExifItem is set, so the reader
  // has an item table to walk but no EXIF in it.
  const infe = box('infe', concat([
    new Uint8Array([2, 0, 0, 0]),          // version 2, flags
    u16be(1),                              // item_ID
    u16be(0),                              // item_protection_index
    fourCc(options.omitExifItem ? 'mime' : 'Exif'),
    new Uint8Array([0]),                   // item_name
  ]));

  const iinf = box('iinf', concat([new Uint8Array([0, 0, 0, 0]), u16be(1), infe]));

  const iloc = box('iloc', concat([
    new Uint8Array([1, 0, 0, 0]),          // version 1, flags
    new Uint8Array([0x44]),                // offset_size 4, length_size 4
    new Uint8Array([0x00]),                // base_offset_size 0, index_size 0
    u16be(1),                              // item_count
    u16be(1),                              // item_ID
    u16be(0),                              // construction_method 0 (file offset)
    u16be(0),                              // data_reference_index
    u16be(1),                              // extent_count
    u32be(extentOffset),
    u32be(itemPayload.length),
  ]));

  const hdlr = box('hdlr', concat([
    new Uint8Array([0, 0, 0, 0]),
    u32be(0),
    fourCc('pict'),
    new Uint8Array(12),
    new Uint8Array([0]),
  ]));

  const meta = box('meta', concat([new Uint8Array([0, 0, 0, 0]), hdlr, iinf, iloc]));

  return concat([ftyp, mdat, meta]);
}

/**
 * Spec-accurate PNG, WebP and ISOBMFF (HEIC / AVIF) builders and inspectors for
 * the metadata container tests.
 *
 * The builders in image.ts are not complete (fake CRCs, a VP8 chunk with no
 * frame tag), because the tests that use them check only the magic bytes. The
 * metadata writers parse the full container structure, so they need valid files.
 */

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

function fourCc(text: string): Uint8Array {
  const out = new Uint8Array(4);
  for (let i = 0; i < 4; i++) out[i] = text.charCodeAt(i);
  return out;
}

function readFourCc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

// --- PNG --------------------------------------------------------------------

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
  chunk.set(fourCc(type), 4);
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
    types.push(readFourCc(bytes, offset + 4));
    offset = offset + 12 + length;
  }

  return types;
}

// --- WebP -------------------------------------------------------------------

function riffChunk(type: string, payload: Uint8Array): Uint8Array {
  const padding = payload.length % 2;
  const chunk = new Uint8Array(8 + payload.length + padding);
  const view = new DataView(chunk.buffer);

  chunk.set(fourCc(type), 0);
  view.setUint32(4, payload.length, true);
  chunk.set(payload, 8);

  return chunk;
}

function riff(body: Uint8Array[]): Uint8Array {
  const bodyBytes = concat(body);
  const header = new Uint8Array(12);

  header.set(fourCc('RIFF'), 0);
  new DataView(header.buffer).setUint32(4, 4 + bodyBytes.length, true);
  header.set(fourCc('WEBP'), 8);

  return concat([header, bodyBytes]);
}

/** A lossy keyframe header: frame tag, start code, then the frame size. */
function vp8Payload(width: number, height: number): Uint8Array {
  const payload = new Uint8Array(20);
  const view = new DataView(payload.buffer);

  payload[0] = 0x10; // 3-byte frame tag: keyframe (low bit clear)
  payload.set([0x9d, 0x01, 0x2a], 3); // start code
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);

  return payload;
}

/** Simple lossy WebP: one `VP8 ` chunk only. Canvas writes this format. */
export function buildWebpLossy(options: { width?: number; height?: number } = {}): Uint8Array {
  return riff([riffChunk('VP8 ', vp8Payload(options.width ?? 100, options.height ?? 80))]);
}

/** Simple lossless WebP: one `VP8L` chunk only. */
export function buildWebpLossless(
  options: { width?: number; height?: number; alpha?: boolean } = {}
): Uint8Array {
  const width = options.width ?? 100;
  const height = options.height ?? 80;

  const payload = new Uint8Array(16);
  payload[0] = 0x2f; // VP8L signature

  const bits = ((width - 1) & 0x3fff)
    | (((height - 1) & 0x3fff) << 14)
    | ((options.alpha ? 1 : 0) << 28);
  new DataView(payload.buffer).setUint32(1, bits >>> 0, true);

  return riff([riffChunk('VP8L', payload)]);
}

/** Extended WebP that already has a VP8X chunk, with an optional EXIF chunk. */
export function buildWebpExtended(
  options: { width?: number; height?: number; exif?: Uint8Array; alpha?: boolean } = {}
): Uint8Array {
  const width = options.width ?? 100;
  const height = options.height ?? 80;

  const vp8x = new Uint8Array(10);
  vp8x[0] = (options.alpha ? 0x10 : 0) | (options.exif ? 0x08 : 0);
  writeUint24(vp8x, 4, width - 1);
  writeUint24(vp8x, 7, height - 1);

  const body = [riffChunk('VP8X', vp8x), riffChunk('VP8 ', vp8Payload(width, height))];

  if (options.exif) {
    body.push(riffChunk('EXIF', options.exif));
  }

  return riff(body);
}

/** WebP chunks in file order, with the offset of each payload. */
function webpChunks(bytes: Uint8Array): { type: string; payloadStart: number }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: { type: string; payloadStart: number }[] = [];
  let offset = 12;

  while (offset + 8 <= bytes.length) {
    const size = view.getUint32(offset + 4, true);
    chunks.push({ type: readFourCc(bytes, offset), payloadStart: offset + 8 });
    offset += 8 + size + (size % 2);
  }

  return chunks;
}

/** Lists WebP chunk FourCCs in file order. */
export function webpChunkTypes(bytes: Uint8Array): string[] {
  return webpChunks(bytes).map((chunk) => chunk.type);
}

/** Reads the VP8X flags byte, or null when the file is not extended. */
export function webpVp8xFlags(bytes: Uint8Array): number | null {
  const vp8x = webpChunks(bytes).find((chunk) => chunk.type === 'VP8X');
  return vp8x ? bytes[vp8x.payloadStart] : null;
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

/** Item IDs that the builder assigns, in item table order. */
const IMAGE_ITEM_ID = 1;
const EXIF_ITEM_ID = 2;

/** Placeholder for coded image data, with a byte pattern a test can find if it moves. */
function imageItemData(): Uint8Array {
  const data = new Uint8Array(48);
  for (let i = 0; i < data.length; i++) data[i] = (i * 7 + 3) & 0xff;
  return data;
}

export interface IsobmffOptions {
  brand?: string;
  compatibleBrands?: string[];
  exif?: Uint8Array;
  tiffHeaderOffset?: number;
  /** Give the EXIF item the wrong item_type, so the item table has no EXIF item. */
  omitExifItem?: boolean;
  /** Drop the `meta` box entirely. */
  omitMeta?: boolean;
  /**
   * Box order. `mdat-first` puts item data before `meta`, so a larger `meta`
   * does not move the data. `meta-first` is the order that real encoders
   * write. With this order, the writer must update every item offset.
   */
  layout?: 'mdat-first' | 'meta-first';
  width?: number;
  height?: number;
  /** Quarter turns recorded in an `irot` property. */
  rotation?: 0 | 1 | 2 | 3;
  /** Drop `pitm`, so no item is marked as the primary item. */
  omitPrimaryItem?: boolean;
  /** Drop `iprp`, leaving no `ispe` to read dimensions from. */
  omitProperties?: boolean;
  /**
   * Put a box just before `iprp` with a declared size that goes past the end
   * of `meta`. A walk of the children stops at this box and does not find the
   * boxes after it.
   */
  unwalkableMetaChild?: boolean;
}

/**
 * A HEIC/AVIF file with a primary image item, its properties, and an optional
 * EXIF item.
 *
 * The `meta` box is built first with placeholder offsets, then again with the
 * real offsets. Every field in `iloc` has a fixed width, so both builds have
 * the same length and one measuring pass is enough.
 */
export function buildIsobmff(options: IsobmffOptions = {}): Uint8Array {
  const brand = options.brand ?? 'heic';
  const compatible = options.compatibleBrands ?? [brand, 'mif1'];
  const ftyp = box('ftyp', concat([fourCc(brand), u32be(0), ...compatible.map(fourCc)]));

  const imageData = imageItemData();
  const headerOffset = options.tiffHeaderOffset ?? 0;
  const exifPayload = options.exif
    ? concat([u32be(headerOffset), new Uint8Array(headerOffset), options.exif])
    : null;

  const mdat = box('mdat', exifPayload ? concat([imageData, exifPayload]) : imageData);

  if (options.omitMeta) {
    return concat([ftyp, mdat]);
  }

  const layout = options.layout ?? 'mdat-first';

  const buildMeta = (mdatPayloadStart: number) => {
    const items: Uint8Array[] = [
      box('infe', concat([
        new Uint8Array([2, 0, 0, 0]),    // version 2, flags
        u16be(IMAGE_ITEM_ID),
        u16be(0),                        // item_protection_index
        fourCc('av01'),
        new Uint8Array([0]),             // item_name
      ])),
    ];

    const locations: Uint8Array[] = [
      itemLocation(IMAGE_ITEM_ID, mdatPayloadStart, imageData.length),
    ];

    if (exifPayload) {
      items.push(box('infe', concat([
        new Uint8Array([2, 0, 0, 0]),
        u16be(EXIF_ITEM_ID),
        u16be(0),
        // Wrong on purpose when omitExifItem is set. The reader then has an item
        // table to walk, but no EXIF item in it.
        fourCc(options.omitExifItem ? 'mime' : 'Exif'),
        new Uint8Array([0]),
      ])));
      locations.push(itemLocation(
        EXIF_ITEM_ID,
        mdatPayloadStart + imageData.length,
        exifPayload.length
      ));
    }

    const children: Uint8Array[] = [
      box('hdlr', concat([
        new Uint8Array([0, 0, 0, 0]),
        u32be(0),
        fourCc('pict'),
        new Uint8Array(12),
        new Uint8Array([0]),
      ])),
    ];

    if (!options.omitPrimaryItem) {
      children.push(box('pitm', concat([new Uint8Array([0, 0, 0, 0]), u16be(IMAGE_ITEM_ID)])));
    }

    children.push(box('iinf', concat([
      new Uint8Array([0, 0, 0, 0]),
      u16be(items.length),
      ...items,
    ])));

    children.push(box('iloc', concat([
      new Uint8Array([1, 0, 0, 0]),      // version 1, flags
      new Uint8Array([0x44]),            // offset_size 4, length_size 4
      new Uint8Array([0x00]),            // base_offset_size 0, index_size 0
      u16be(locations.length),
      ...locations,
    ])));

    if (exifPayload && !options.omitExifItem) {
      children.push(box('iref', concat([
        new Uint8Array([0, 0, 0, 0]),
        box('cdsc', concat([u16be(EXIF_ITEM_ID), u16be(1), u16be(IMAGE_ITEM_ID)])),
      ])));
    }

    if (options.unwalkableMetaChild) {
      const free = box('free', new Uint8Array(4));
      // Declares more bytes than it contains, so a box walk stops here.
      new DataView(free.buffer).setUint32(0, free.length + 64, false);
      children.push(free);
    }

    if (!options.omitProperties) {
      children.push(buildIprp(options));
    }

    return box('meta', concat([new Uint8Array([0, 0, 0, 0]), ...children]));
  };

  if (layout === 'mdat-first') {
    return concat([ftyp, mdat, buildMeta(ftyp.length + 8)]);
  }

  const measured = buildMeta(0);
  const meta = buildMeta(ftyp.length + measured.length + 8);
  if (meta.length !== measured.length) {
    throw new Error('meta box changed size between passes');
  }

  return concat([ftyp, meta, mdat]);
}

function itemLocation(itemId: number, offset: number, length: number): Uint8Array {
  return concat([
    u16be(itemId),
    u16be(0),        // construction_method 0 (file offset)
    u16be(0),        // data_reference_index
    u16be(1),        // extent_count
    u32be(offset),
    u32be(length),
  ]);
}

function buildIprp(options: IsobmffOptions): Uint8Array {
  const properties: Uint8Array[] = [
    box('ispe', concat([
      new Uint8Array([0, 0, 0, 0]),
      u32be(options.width ?? 100),
      u32be(options.height ?? 80),
    ])),
  ];

  if (options.rotation) {
    properties.push(box('irot', new Uint8Array([options.rotation & 0x03])));
  }

  const ipco = box('ipco', concat(properties));

  // One entry, which associates every property with the image item.
  const associations = properties.map((_, index) => new Uint8Array([(index + 1) & 0x7f]));
  const ipma = box('ipma', concat([
    new Uint8Array([0, 0, 0, 0]),        // version 0, flags 0: 1-byte indices
    u32be(1),                            // entry_count
    u16be(IMAGE_ITEM_ID),
    new Uint8Array([properties.length]), // association_count
    ...associations,
  ]));

  return box('iprp', concat([ipco, ipma]));
}

// --- ISOBMFF inspectors, which do not use the code under test -------------

function isobmffBoxes(bytes: Uint8Array, start: number, end: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes: { type: string; payloadStart: number; end: number }[] = [];
  let offset = start;

  while (offset + 8 <= end) {
    const size = view.getUint32(offset, false);
    if (size < 8 || offset + size > end) break;
    boxes.push({
      type: readFourCc(bytes, offset + 4),
      payloadStart: offset + 8,
      end: offset + size,
    });
    offset += size;
  }

  return boxes;
}

function metaChildren(bytes: Uint8Array) {
  const meta = isobmffBoxes(bytes, 0, bytes.length).find((box) => box.type === 'meta');
  if (!meta) throw new Error('no meta box');
  return isobmffBoxes(bytes, meta.payloadStart + 4, meta.end);
}

/** Item types in `iinf` order, paired with their item IDs. */
export function isobmffItems(bytes: Uint8Array): { itemId: number; itemType: string }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const iinf = metaChildren(bytes).find((box) => box.type === 'iinf');
  if (!iinf) throw new Error('no iinf box');

  return isobmffBoxes(bytes, iinf.payloadStart + 6, iinf.end)
    .filter((box) => box.type === 'infe')
    .map((infe) => ({
      itemId: view.getUint16(infe.payloadStart + 4, false),
      itemType: readFourCc(bytes, infe.payloadStart + 8),
    }));
}

/**
 * Finds an item's bytes through `iloc`. Supports only the fixed 4/4/0/0 field
 * widths that the builder and the writer both use.
 */
export function isobmffItemData(bytes: Uint8Array, itemId: number): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const iloc = metaChildren(bytes).find((box) => box.type === 'iloc');
  if (!iloc) throw new Error('no iloc box');

  const version = bytes[iloc.payloadStart];
  if (version !== 1 || bytes[iloc.payloadStart + 4] !== 0x44 || bytes[iloc.payloadStart + 5] !== 0x00) {
    throw new Error('unexpected iloc field widths');
  }

  let cursor = iloc.payloadStart + 6;
  const itemCount = view.getUint16(cursor, false);
  cursor += 2;

  for (let i = 0; i < itemCount; i++) {
    const currentId = view.getUint16(cursor, false);
    const constructionMethod = view.getUint16(cursor + 2, false) & 0x0f;
    const extentCount = view.getUint16(cursor + 6, false);
    cursor += 8;

    for (let extent = 0; extent < extentCount; extent++) {
      const offset = view.getUint32(cursor, false);
      const length = view.getUint32(cursor + 4, false);
      cursor += 8;

      if (currentId === itemId && extent === 0) {
        if (constructionMethod !== 0 || offset + length > bytes.length) return null;
        return bytes.slice(offset, offset + length);
      }
    }
  }

  return null;
}

/** `iref` entries as (type, from, to[]) triples, for version 0 boxes. */
export function isobmffReferences(bytes: Uint8Array): { type: string; from: number; to: number[] }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const iref = metaChildren(bytes).find((box) => box.type === 'iref');
  if (!iref) return [];
  if (bytes[iref.payloadStart] !== 0) throw new Error('unexpected iref version');

  return isobmffBoxes(bytes, iref.payloadStart + 4, iref.end).map((reference) => {
    const count = view.getUint16(reference.payloadStart + 2, false);
    const to: number[] = [];
    for (let i = 0; i < count; i++) {
      to.push(view.getUint16(reference.payloadStart + 4 + i * 2, false));
    }
    return { type: reference.type, from: view.getUint16(reference.payloadStart, false), to };
  });
}

/** Top-level box types in file order. */
export function isobmffBoxTypes(bytes: Uint8Array): string[] {
  return isobmffBoxes(bytes, 0, bytes.length).map((box) => box.type);
}

/** Child box types of `meta`, in order. */
export function isobmffMetaChildTypes(bytes: Uint8Array): string[] {
  return metaChildren(bytes).map((box) => box.type);
}

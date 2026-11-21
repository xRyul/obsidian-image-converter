/** A spec-accurate HEIC / AVIF builder, with inspectors that do not use the code under test. */

import { ascii, concat, readFourCc } from '../../../src/metadata/containers/bytes';

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
  out.set(ascii(type), 4);
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
  const ftyp = box('ftyp', concat([ascii(brand), u32be(0), ...compatible.map(ascii)]));

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
        ascii('av01'),
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
        ascii(options.omitExifItem ? 'mime' : 'Exif'),
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
        ascii('pict'),
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

// --- Inspectors ---

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

// isobmff.ts
// HEIC/HEIF and AVIF share the ISO base media file format, where metadata is an
// item inside the `meta` box: `iinf` says what each item is, `iloc` says where
// its bytes are.
//
// Read-only. Writing an EXIF item means adding `infe`, `iloc` and `iref`
// entries, then patching every existing item offset because `meta` grew.

import { readFourCc } from "./bytes";

/** Brands that indicate a still image we can read EXIF from. */
const BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'avif', 'avis']);

interface Box {
    type: string;
    payloadStart: number;
    end: number;
}

interface Extent {
    offset: number;
    length: number;
}

/** True when the bytes declare an ISOBMFF still-image brand we can read. */
export function isIsobmff(bytes: Uint8Array): boolean {
    const ftyp = findBox(bytes, 0, bytes.length, 'ftyp');
    if (!ftyp) {
        return false;
    }

    // Payload is major_brand (4), minor_version (4), then compatible brands.
    for (let offset = ftyp.payloadStart; offset + 4 <= ftyp.end; offset += 4) {
        if (offset === ftyp.payloadStart + 4) {
            continue; // minor_version is a number, not a brand
        }
        if (BRANDS.has(readFourCc(bytes, offset))) {
            return true;
        }
    }

    return false;
}

/**
 * Reads the EXIF block out of the `Exif` item of a HEIC, HEIF or AVIF file.
 * @param bytes - The image file.
 * @returns The raw block, or null if there is no readable EXIF item.
 */
export function readExif(bytes: Uint8Array): Uint8Array | null {
    if (!isIsobmff(bytes)) {
        return null;
    }

    const meta = findBox(bytes, 0, bytes.length, 'meta');
    if (!meta) {
        return null;
    }

    // `meta` is a FullBox: version and flags precede its child boxes.
    const childrenStart = meta.payloadStart + 4;
    const iinf = findBox(bytes, childrenStart, meta.end, 'iinf');
    const iloc = findBox(bytes, childrenStart, meta.end, 'iloc');
    if (!iinf || !iloc) {
        return null;
    }

    const itemId = findExifItemId(bytes, iinf);
    if (itemId === null) {
        return null;
    }

    const extent = findItemExtent(bytes, iloc, itemId);
    if (!extent) {
        return null;
    }

    return readExifItem(bytes, extent);
}

/**
 * The Exif item payload is a 4-byte big-endian offset to the TIFF header,
 * followed by the block itself.
 */
function readExifItem(bytes: Uint8Array, extent: Extent): Uint8Array | null {
    const { offset, length } = extent;
    if (length < 4 || offset + length > bytes.length) {
        return null;
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const headerOffset = view.getUint32(offset, false);

    const blockStart = offset + 4 + headerOffset;
    const blockEnd = offset + length;
    if (blockStart >= blockEnd || blockEnd > bytes.length) {
        return null;
    }

    return bytes.slice(blockStart, blockEnd);
}

/** Scans `iinf` for the item whose type is `Exif`, returning its item ID. */
function findExifItemId(bytes: Uint8Array, iinf: Box): number | null {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = bytes[iinf.payloadStart];

    let offset = iinf.payloadStart + 4; // past version and flags
    if (version === 0) {
        offset += 2; // entry_count as u16
    } else {
        offset += 4; // entry_count as u32
    }

    for (const infe of walkBoxes(bytes, offset, iinf.end)) {
        if (infe.type !== 'infe') {
            continue;
        }

        const infeVersion = bytes[infe.payloadStart];
        if (infeVersion < 2) {
            continue; // pre-v2 entries carry no item_type
        }

        let cursor = infe.payloadStart + 4; // past version and flags
        let itemId: number;
        if (infeVersion === 2) {
            itemId = view.getUint16(cursor, false);
            cursor += 2;
        } else {
            itemId = view.getUint32(cursor, false);
            cursor += 4;
        }
        cursor += 2; // item_protection_index

        if (cursor + 4 > infe.end) {
            continue;
        }
        if (readFourCc(bytes, cursor) === 'Exif') {
            return itemId;
        }
    }

    return null;
}

/** Resolves an item ID to its first extent via `iloc`. */
function findItemExtent(bytes: Uint8Array, iloc: Box, itemId: number): Extent | null {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = bytes[iloc.payloadStart];

    let cursor = iloc.payloadStart + 4; // past version and flags

    const offsetSize = bytes[cursor] >> 4;
    const lengthSize = bytes[cursor] & 0x0f;
    const baseOffsetSize = bytes[cursor + 1] >> 4;
    const indexSize = (version === 1 || version === 2) ? (bytes[cursor + 1] & 0x0f) : 0;
    cursor += 2;

    let itemCount: number;
    if (version < 2) {
        itemCount = view.getUint16(cursor, false);
        cursor += 2;
    } else {
        itemCount = view.getUint32(cursor, false);
        cursor += 4;
    }

    for (let i = 0; i < itemCount; i++) {
        if (cursor >= iloc.end) {
            return null;
        }

        let currentId: number;
        if (version < 2) {
            currentId = view.getUint16(cursor, false);
            cursor += 2;
        } else {
            currentId = view.getUint32(cursor, false);
            cursor += 4;
        }

        let constructionMethod = 0;
        if (version === 1 || version === 2) {
            constructionMethod = view.getUint16(cursor, false) & 0x0f;
            cursor += 2;
        }

        cursor += 2; // data_reference_index
        const baseOffset = readUint(view, cursor, baseOffsetSize);
        cursor += baseOffsetSize;

        const extentCount = view.getUint16(cursor, false);
        cursor += 2;

        for (let extent = 0; extent < extentCount; extent++) {
            cursor += indexSize;
            const extentOffset = readUint(view, cursor, offsetSize);
            cursor += offsetSize;
            const extentLength = readUint(view, cursor, lengthSize);
            cursor += lengthSize;

            // Other construction methods need the item reassembled from `idat`.
            if (currentId === itemId && extent === 0) {
                if (constructionMethod !== 0) {
                    return null;
                }
                return { offset: baseOffset + extentOffset, length: extentLength };
            }
        }
    }

    return null;
}

function findBox(bytes: Uint8Array, start: number, end: number, type: string): Box | null {
    for (const box of walkBoxes(bytes, start, end)) {
        if (box.type === type) {
            return box;
        }
    }
    return null;
}

function* walkBoxes(bytes: Uint8Array, start: number, end: number): Generator<Box> {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = start;

    while (offset + 8 <= end) {
        let size = view.getUint32(offset, false);
        const type = readFourCc(bytes, offset + 4);
        let payloadStart = offset + 8;

        if (size === 1) {
            // 64-bit size follows the type.
            if (offset + 16 > end) {
                return;
            }
            size = view.getUint32(offset + 8, false) * 0x100000000
                + view.getUint32(offset + 12, false);
            payloadStart = offset + 16;
        } else if (size === 0) {
            size = end - offset; // box runs to the end of its parent
        }

        const boxEnd = offset + size;
        if (size < 8 || boxEnd > end) {
            return;
        }

        yield { type, payloadStart, end: boxEnd };
        offset = boxEnd;
    }
}

/** Reads a big-endian unsigned integer of 0, 4 or 8 bytes. */
function readUint(view: DataView, offset: number, size: number): number {
    if (size === 0) {
        return 0;
    }
    if (size === 4) {
        return view.getUint32(offset, false);
    }
    if (size === 8) {
        return view.getUint32(offset, false) * 0x100000000 + view.getUint32(offset + 4, false);
    }

    let value = 0;
    for (let i = 0; i < size; i++) {
        value = value * 256 + view.getUint8(offset + i);
    }
    return value;
}

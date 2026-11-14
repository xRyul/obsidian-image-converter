// ExifBlock.ts
// Parses, normalises and re-serialises the TIFF block that every EXIF-carrying container wraps.

import { viewOf } from "./containers/bytes";
import {
    TAG_EXIF_IFD_POINTER,
    TAG_GPS_IFD_POINTER,
    TAG_IMAGE_LENGTH,
    TAG_IMAGE_WIDTH,
    TAG_INTEROP_IFD_POINTER,
    TAG_MAKER_NOTE,
    TAG_ORIENTATION,
    TAG_PIXEL_X_DIMENSION,
    TAG_PIXEL_Y_DIMENSION,
    TAG_USER_COMMENT,
} from "./tags";
import { Dimensions, ExifBlock, ExifEntry, ExifIfd } from "./types";

// --- TIFF value types ---

const TYPE_SHORT = 3;
const TYPE_LONG = 4;

/** Byte width of each TIFF value type, indexed by type number. */
const TYPE_SIZES: readonly number[] = [
    0, // type numbers start at 1
    1, // 1  BYTE
    1, // 2  ASCII
    2, // 3  SHORT
    4, // 4  LONG
    8, // 5  RATIONAL
    1, // 6  SBYTE
    1, // 7  UNDEFINED
    2, // 8  SSHORT
    4, // 9  SLONG
    8, // 10 SRATIONAL
    4, // 11 FLOAT
    8, // 12 DOUBLE
    4, // 13 IFD
];

/** Ceiling on a single tag's value, so a corrupt count cannot ask for gigabytes. */
const MAX_VALUE_BYTES = 4 * 1024 * 1024;

const TIFF_MAGIC = 42;
const HEADER_SIZE = 8;

// --- Parsing ---

/**
 * Parses a raw EXIF block. Corrupt individual tags are skipped rather than
 * failing the whole parse, since partial metadata beats none.
 *
 * @param bytes - A TIFF header followed by its IFDs.
 * @returns The parsed block, or null if this is not a TIFF structure.
 */
export function parseExifBlock(bytes: Uint8Array): ExifBlock | null {
    if (bytes.length < HEADER_SIZE) {
        return null;
    }

    const byteOrder = (bytes[0] << 8) | bytes[1];
    let bigEndian: boolean;
    if (byteOrder === 0x4949) {
        bigEndian = false;
    } else if (byteOrder === 0x4d4d) {
        bigEndian = true;
    } else {
        return null;
    }

    const littleEndian = !bigEndian;
    const view = viewOf(bytes);

    if (view.getUint16(2, littleEndian) !== TIFF_MAGIC) {
        return null;
    }

    const ifd0Offset = view.getUint32(4, littleEndian);

    const ifd0 = readIfd(bytes, view, ifd0Offset, littleEndian);

    // Follows a pointer tag to its sub-IFD.
    const readSubIfd = (parent: ExifIfd, tag: number): ExifIfd => {
        const pointer = parent.get(tag);
		// Sub-IFD pointers are structural and regenerated on serialise.
        parent.delete(tag);
        if (!pointer || pointer.value.length < 4) {
            return new Map();
        }
        const offset = viewOf(pointer.value).getUint32(0, littleEndian);
        return readIfd(bytes, view, offset, littleEndian);
    };

    const exif = readSubIfd(ifd0, TAG_EXIF_IFD_POINTER);
    const gps = readSubIfd(ifd0, TAG_GPS_IFD_POINTER);
    const interop = readSubIfd(exif, TAG_INTEROP_IFD_POINTER);

    return { bigEndian, ifd0, exif, gps, interop };
}

function readIfd(
    bytes: Uint8Array,
    view: DataView,
    offset: number,
    littleEndian: boolean
): ExifIfd {
    const ifd: ExifIfd = new Map();

    if (offset < HEADER_SIZE || offset + 2 > bytes.length) {
        return ifd;
    }

    const entryCount = view.getUint16(offset, littleEndian);
    if (offset + 2 + entryCount * 12 > bytes.length) {
        return ifd;
    }

    for (let i = 0; i < entryCount; i++) {
        const entryOffset = offset + 2 + i * 12;
        const tag = view.getUint16(entryOffset, littleEndian);
        const type = view.getUint16(entryOffset + 2, littleEndian);
        const count = view.getUint32(entryOffset + 4, littleEndian);

        const typeSize = TYPE_SIZES[type];
        if (!typeSize) {
            continue;
        }

        const byteLength = typeSize * count;
        if (byteLength > MAX_VALUE_BYTES) {
            continue;
        }

        let value: Uint8Array;
        if (byteLength <= 4) {
            value = bytes.slice(entryOffset + 8, entryOffset + 8 + byteLength);
        } else {
            const valueOffset = view.getUint32(entryOffset + 8, littleEndian);
            if (valueOffset + byteLength > bytes.length) {
                continue;
            }
            value = bytes.slice(valueOffset, valueOffset + byteLength);
        }

        ifd.set(tag, { tag, type, count, value });
    }

    return ifd;
}

// --- Serialising ---

interface IfdPlan {
    ifd: ExifIfd;
    structureOffset: number;
    dataOffset: number;
}

/**
 * Serialises a block back to TIFF bytes, recomputing every offset. Endianness
 * is preserved so the opaque value bytes stay valid.
 *
 * @param block - The block to write.
 * @returns A TIFF header followed by its IFDs.
 */
export function serialiseExifBlock(block: ExifBlock): Uint8Array {
    const littleEndian = !block.bigEndian;

    const ifd0 = new Map(block.ifd0);
    const exif = new Map(block.exif);
    const gps = new Map(block.gps);
    const interop = new Map(block.interop);

    const setPointer = (parent: ExifIfd, tag: number, offset: number): void => {
        parent.set(tag, longEntry(tag, offset, littleEndian));
    };
	
    const link = (parent: ExifIfd, tag: number, child: ExifIfd): void => {
        parent.delete(tag);
        if (child.size > 0) {
            setPointer(parent, tag, 0);
        }
    };

    // Interop goes first: its pointer can make an empty Exif IFD non-empty.
    link(exif, TAG_INTEROP_IFD_POINTER, interop);
    link(ifd0, TAG_EXIF_IFD_POINTER, exif);
    link(ifd0, TAG_GPS_IFD_POINTER, gps);

    let cursor = HEADER_SIZE;
    const layout = (ifd: ExifIfd): IfdPlan => {
        const structureOffset = cursor;
        cursor += 2 + 12 * ifd.size + 4;
        const dataOffset = cursor;
        for (const entry of ifd.values()) {
            if (entry.value.length > 4) {
                cursor += entry.value.length + (entry.value.length % 2);
            }
        }
        return { ifd, structureOffset, dataOffset };
    };

    // Places a sub-IFD and writes its position into the pointer of the parent.
    const layoutChild = (parent: ExifIfd, tag: number, child: ExifIfd): IfdPlan | null => {
        if (child.size === 0) {
            return null;
        }
        const plan = layout(child);
        setPointer(parent, tag, plan.structureOffset);
        return plan;
    };

    const ifd0Plan = layout(ifd0);
    const exifPlan = layoutChild(ifd0, TAG_EXIF_IFD_POINTER, exif);
    const interopPlan = layoutChild(exif, TAG_INTEROP_IFD_POINTER, interop);
    const gpsPlan = layoutChild(ifd0, TAG_GPS_IFD_POINTER, gps);

    const out = new Uint8Array(cursor);
    const outView = new DataView(out.buffer);

    const byteOrderMark = block.bigEndian ? 0x4d : 0x49;
    out[0] = byteOrderMark;
    out[1] = byteOrderMark;
    outView.setUint16(2, TIFF_MAGIC, littleEndian);
    outView.setUint32(4, ifd0Plan.structureOffset, littleEndian);

    for (const plan of [ifd0Plan, exifPlan, interopPlan, gpsPlan]) {
        if (plan) {
            writeIfd(out, outView, plan, littleEndian);
        }
    }

    return out;
}

function writeIfd(
    out: Uint8Array,
    outView: DataView,
    plan: IfdPlan,
    littleEndian: boolean
): void {
    const { ifd, structureOffset } = plan;
    let { dataOffset } = plan;

    outView.setUint16(structureOffset, ifd.size, littleEndian);

    // TIFF requires directory entries in ascending tag order.
    const tags = [...ifd.keys()].sort((left, right) => left - right);

    let entryOffset = structureOffset + 2;
    for (const tag of tags) {
        const entry = ifd.get(tag);
        if (!entry) {
            continue;
        }

        outView.setUint16(entryOffset, tag, littleEndian);
        outView.setUint16(entryOffset + 2, entry.type, littleEndian);
        outView.setUint32(entryOffset + 4, entry.count, littleEndian);

        if (entry.value.length <= 4) {
            out.set(entry.value, entryOffset + 8);
        } else {
            outView.setUint32(entryOffset + 8, dataOffset, littleEndian);
            out.set(entry.value, dataOffset);
            dataOffset += entry.value.length + (entry.value.length % 2);
        }

        entryOffset += 12;
    }

    outView.setUint32(entryOffset, 0, littleEndian); // no next IFD
}

// --- Normalising ---

/**
 * Rewrites the tags that stop being true once an image is re-encoded.
 *
 * @param block - The block to normalise.
 * @param dimensions - Size of the encoded output, or null when unknown.
 * @param orientationApplied - True when the conversion rotated the pixels to
 *        match the Orientation tag. False when the pixels are as stored in the
 *        source.
 * @returns A new block; the input is left untouched.
 */
export function normalise(
    block: ExifBlock,
    dimensions: Dimensions | null,
    orientationApplied = true
): ExifBlock {
    const littleEndian = !block.bigEndian;

    const ifd0 = new Map(block.ifd0);
    const exif = new Map(block.exif);

    // If the conversion rotated the pixels, the old tag makes viewers rotate
    // the image a second time. A missing tag already means "normal", so change
    // the tag only if it exists.
    //
    // If the conversion did not rotate the pixels, the old tag is still
    // correct, so it stays. The caller knows which case applies.
    if (orientationApplied && ifd0.has(TAG_ORIENTATION)) {
        ifd0.set(TAG_ORIENTATION, shortEntry(TAG_ORIENTATION, 1, littleEndian));
    }

    // After a resize, these dimensions are incorrect.
    ifd0.delete(TAG_IMAGE_WIDTH);
    ifd0.delete(TAG_IMAGE_LENGTH);

    if (dimensions) {
        exif.set(TAG_PIXEL_X_DIMENSION, longEntry(TAG_PIXEL_X_DIMENSION, dimensions.width, littleEndian));
        exif.set(TAG_PIXEL_Y_DIMENSION, longEntry(TAG_PIXEL_Y_DIMENSION, dimensions.height, littleEndian));
    } else {
        // The output size is unknown. Incorrect dimensions are worse than none.
        exif.delete(TAG_PIXEL_X_DIMENSION);
        exif.delete(TAG_PIXEL_Y_DIMENSION);
    }

    return {
        bigEndian: block.bigEndian,
        ifd0,
        exif,
        gps: new Map(block.gps),
        interop: new Map(block.interop),
    };
}

/**
 * Serialises within a byte limit. If the block is too large, this removes
 * MakerNote, then UserComment, until the block fits. JPEG needs this because
 * its APP1 segment cannot be larger than 64 KB.
 *
 * @param block - The block to write.
 * @param maxBytes - The container's hard limit.
 * @returns The serialised block, or null if even a stripped block will not fit.
 */
export function serialiseWithin(block: ExifBlock, maxBytes: number): Uint8Array | null {
    let current = block;
    let out = serialiseExifBlock(current);
    if (out.length <= maxBytes) {
        return out;
    }

    for (const tag of [TAG_MAKER_NOTE, TAG_USER_COMMENT]) {
        if (!current.exif.has(tag)) {
            continue;
        }
        const exif = new Map(current.exif);
        exif.delete(tag);
        current = { ...current, exif };
        out = serialiseExifBlock(current);
        if (out.length <= maxBytes) {
            return out;
        }
    }

    return null;
}

/**
 * Reads the Orientation tag of a block.
 * @param block - The block to read.
 * @returns The value (1 to 8), or 1 if the tag is absent or not valid.
 */
export function readOrientation(block: ExifBlock): number {
    const entry = block.ifd0.get(TAG_ORIENTATION);
    if (!entry || entry.type !== TYPE_SHORT || entry.value.length < 2) {
        return 1;
    }

    const orientation = viewOf(entry.value).getUint16(0, !block.bigEndian);
    return orientation >= 1 && orientation <= 8 ? orientation : 1;
}

/** True when a block carries no tags worth writing. */
export function isEmptyBlock(block: ExifBlock): boolean {
    return block.ifd0.size === 0
        && block.exif.size === 0
        && block.gps.size === 0
        && block.interop.size === 0;
}

// --- Entry constructors ---

function shortEntry(tag: number, value: number, littleEndian: boolean): ExifEntry {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value, littleEndian);
    return { tag, type: TYPE_SHORT, count: 1, value: bytes };
}

function longEntry(tag: number, value: number, littleEndian: boolean): ExifEntry {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, littleEndian);
    return { tag, type: TYPE_LONG, count: 1, value: bytes };
}

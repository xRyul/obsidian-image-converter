// tiff.ts
// A TIFF file is itself a TIFF block, so there is no wrapper to remove. IFD0
// of a TIFF file also holds tags that tell where the pixels are in that file
// (for example, StripOffsets). These tags point to data that the converted
// image does not have. The reader keeps only a list of known descriptive IFD0
// tags. The sub-IFDs hold only metadata, so the reader keeps them complete.

import { isEmptyBlock, parseExifBlock, serialiseExifBlock } from "../ExifBlock";
import {
    TAG_ARTIST,
    TAG_COPYRIGHT,
    TAG_DATE_TIME,
    TAG_HOST_COMPUTER,
    TAG_IMAGE_DESCRIPTION,
    TAG_MAKE,
    TAG_MODEL,
    TAG_ORIENTATION,
    TAG_RESOLUTION_UNIT,
    TAG_SOFTWARE,
    TAG_X_RESOLUTION,
    TAG_Y_RESOLUTION,
} from "../tags";
import { matchesAt } from "./bytes";

const LITTLE_ENDIAN_HEADER = [0x49, 0x49, 0x2a, 0x00]; // "II" + 42
const BIG_ENDIAN_HEADER = [0x4d, 0x4d, 0x00, 0x2a];    // "MM" + 42

/** Descriptive IFD0 tags worth carrying into a converted image. */
const DESCRIPTIVE_IFD0_TAGS = new Set([
    TAG_IMAGE_DESCRIPTION,
    TAG_MAKE,
    TAG_MODEL,
    TAG_ORIENTATION,
    TAG_X_RESOLUTION,
    TAG_Y_RESOLUTION,
    TAG_RESOLUTION_UNIT,
    TAG_SOFTWARE,
    TAG_DATE_TIME,
    TAG_ARTIST,
    TAG_HOST_COMPUTER,
    TAG_COPYRIGHT,
]);

/** True when the bytes open with a TIFF header in either byte order. */
export function matches(bytes: Uint8Array): boolean {
    return matchesAt(bytes, 0, LITTLE_ENDIAN_HEADER)
        || matchesAt(bytes, 0, BIG_ENDIAN_HEADER);
}

/**
 * Reads descriptive metadata out of a TIFF, discarding the tags that describe
 * how pixels are stored in the source file.
 *
 * @returns A new, re-serialised block that holds only the descriptive tags,
 *          or null if no descriptive tags remain.
 */
export function readExif(bytes: Uint8Array): Uint8Array | null {
    const block = parseExifBlock(bytes);
    if (!block) {
        return null;
    }

    for (const tag of block.ifd0.keys()) {
        if (!DESCRIPTIVE_IFD0_TAGS.has(tag)) {
            block.ifd0.delete(tag);
        }
    }

    if (isEmptyBlock(block)) {
        return null;
    }

    return serialiseExifBlock(block);
}

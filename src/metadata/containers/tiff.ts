// tiff.ts
// A TIFF file is itself a TIFF block, so there is no wrapper to unpick. But its
// IFD0 mixes descriptive metadata with tags describing pixel storage in that
// file - StripOffsets and friends, pointing at ranges the converted image will
// not have. Hence an allowlist of descriptive tags rather than a denylist of
// structural ones. The sub-IFDs are pure metadata and pass through whole.

import { isEmptyBlock, parseExifBlock, serialiseExifBlock } from "../ExifBlock";
import { matchesAt } from "./bytes";

const LITTLE_ENDIAN_HEADER = [0x49, 0x49, 0x2a, 0x00]; // "II" + 42
const BIG_ENDIAN_HEADER = [0x4d, 0x4d, 0x00, 0x2a];    // "MM" + 42

/** Descriptive IFD0 tags worth carrying into a converted image. */
const DESCRIPTIVE_IFD0_TAGS = new Set([
    270,   // ImageDescription
    271,   // Make
    272,   // Model
    274,   // Orientation
    282,   // XResolution
    283,   // YResolution
    296,   // ResolutionUnit
    305,   // Software
    306,   // DateTime
    315,   // Artist
    316,   // HostComputer
    33432, // Copyright
]);

/** True when the bytes open with a TIFF header in either byte order. */
export function isTiff(bytes: Uint8Array): boolean {
    return matchesAt(bytes, 0, LITTLE_ENDIAN_HEADER)
        || matchesAt(bytes, 0, BIG_ENDIAN_HEADER);
}

/**
 * Reads descriptive metadata out of a TIFF, discarding the tags that describe
 * how pixels are stored in the source file.
 *
 * @param bytes - The TIFF file.
 * @returns The raw block, or null if nothing descriptive remains.
 */
export function readExif(bytes: Uint8Array): Uint8Array | null {
    if (!isTiff(bytes)) {
        return null;
    }

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

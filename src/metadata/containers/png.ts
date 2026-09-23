// png.ts
// PNG carries EXIF in an `eXIf` chunk (PNG 3rd edition), holding the raw TIFF
// block with no "Exif\0\0" prefix.

import { Dimensions } from "../types";
import { ascii, concat, matchesAt, readFourCc, stripExifPrefix, viewOf } from "./bytes";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A PNG chunk's length field is a 31-bit value. */
export const MAX_EXIF_BYTES = 0x7fffffff;

const CHUNK_IHDR = "IHDR";
const CHUNK_IDAT = "IDAT";
const CHUNK_IEND = "IEND";
const CHUNK_EXIF = "eXIf";

interface Chunk {
    type: string;
    /** Offset of the chunk's length field. */
    start: number;
    /** Offset just past the chunk's CRC. */
    end: number;
    payloadStart: number;
    payloadEnd: number;
}

/** True when the bytes open with the PNG signature. */
export function isPng(bytes: Uint8Array): boolean {
    return matchesAt(bytes, 0, SIGNATURE);
}

/**
 * Reads the EXIF block out of a PNG's `eXIf` chunk.
 * @param bytes - The PNG file.
 * @returns The raw block, or null if the file carries none.
 */
export function readExif(bytes: Uint8Array): Uint8Array | null {
    if (!isPng(bytes)) {
        return null;
    }

    for (const chunk of walkChunks(bytes)) {
        if (chunk.type === CHUNK_EXIF) {
            return stripExifPrefix(bytes.slice(chunk.payloadStart, chunk.payloadEnd));
        }
    }

    return null;
}

/**
 * Writes an EXIF block into a PNG, replacing any existing one.
 * @param bytes - The PNG file.
 * @param exif - The raw block to embed.
 * @returns A new PNG carrying the block.
 * @throws If the file is not a PNG, the block will not fit, or the chunk walk
 *         never reaches IEND.
 */
export function writeExif(bytes: Uint8Array, exif: Uint8Array): Uint8Array {
    if (!isPng(bytes)) {
        throw new Error("Not a PNG");
    }
    if (exif.length > MAX_EXIF_BYTES) {
        throw new Error("EXIF block is too large for a PNG chunk");
    }

    const parts: Uint8Array[] = [bytes.subarray(0, SIGNATURE.length)];
    let inserted = false;
    let reachedEnd = false;

    for (const chunk of walkChunks(bytes)) {
        if (chunk.type === CHUNK_EXIF) {
            continue; // drop any pre-existing EXIF
        }

        // eXIf must sit between IHDR and the image data.
        if (!inserted && (chunk.type === CHUNK_IDAT || chunk.type === CHUNK_IEND)) {
            parts.push(buildChunk(CHUNK_EXIF, exif));
            inserted = true;
        }

        parts.push(bytes.subarray(chunk.start, chunk.end));

        if (chunk.type === CHUNK_IEND) {
            reachedEnd = true;
        }
    }

    if (!inserted) {
        throw new Error("PNG has no IDAT or IEND chunk");
    }

    if (!reachedEnd) {
        throw new Error("PNG has no IEND chunk");
    }

    return concat(parts);
}

/**
 * Reads dimensions from a PNG's IHDR chunk.
 * @param bytes - The PNG file.
 * @returns The dimensions, or null if IHDR is missing or not valid.
 */
export function readDimensions(bytes: Uint8Array): Dimensions | null {
    if (!isPng(bytes)) {
        return null;
    }

    for (const chunk of walkChunks(bytes)) {
        if (chunk.type !== CHUNK_IHDR) {
            continue;
        }
        if (chunk.payloadStart + 8 > chunk.payloadEnd) {
            return null;
        }

        const view = viewOf(bytes);
        const width = view.getUint32(chunk.payloadStart, false);
        const height = view.getUint32(chunk.payloadStart + 4, false);
        if (width === 0 || height === 0) {
            return null;
        }

        return { width, height };
    }

    return null;
}

function* walkChunks(bytes: Uint8Array): Generator<Chunk> {
    const view = viewOf(bytes);
    let offset = SIGNATURE.length;

    while (offset + 12 <= bytes.length) {
        const length = view.getUint32(offset, false);
        const payloadStart = offset + 8;
        const payloadEnd = payloadStart + length;
        const end = payloadEnd + 4;

        if (end > bytes.length) {
            return;
        }

        const type = readFourCc(bytes, offset + 4);
        yield { type, start: offset, end, payloadStart, payloadEnd };

        if (type === CHUNK_IEND) {
            return;
        }

        offset = end;
    }
}

function buildChunk(type: string, data: Uint8Array): Uint8Array {
    const chunk = new Uint8Array(12 + data.length);
    const view = new DataView(chunk.buffer);

    view.setUint32(0, data.length, false);
    chunk.set(ascii(type), 4);
    chunk.set(data, 8);
    view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)), false);

    return chunk;
}

// --- CRC-32 (IEEE 802.3, as specified by PNG) ---

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
    if (crcTable) {
        return crcTable;
    }

    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let value = i;
        for (let bit = 0; bit < 8; bit++) {
            value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
        }
        table[i] = value >>> 0;
    }

    crcTable = table;
    return table;
}

function crc32(bytes: Uint8Array): number {
    const table = getCrcTable();
    let crc = 0xffffffff;

    for (let i = 0; i < bytes.length; i++) {
        crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }

    return (crc ^ 0xffffffff) >>> 0;
}

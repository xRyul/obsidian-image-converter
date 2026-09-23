// webp.ts
// WebP keeps EXIF in an `EXIF` RIFF chunk. Only the extended file format can
// hold this chunk. Canvas writes simple WebP, which has one VP8 or VP8L chunk
// only. To add EXIF, the writer changes the file to the extended format. It
// puts a VP8X chunk first, with the canvas size and flags, and adds the EXIF
// chunk after the image data.

import { Dimensions } from "../types";
import { ascii, concat, equalBytes, matchesAt, readFourCc, stripExifPrefix, viewOf } from "./bytes";

const RIFF = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP = [0x57, 0x45, 0x42, 0x50]; // "WEBP"

const CHUNK_VP8X = "VP8X";
const CHUNK_VP8 = "VP8 ";
const CHUNK_VP8L = "VP8L";
const CHUNK_ALPH = "ALPH";
const CHUNK_ANIM = "ANIM";
const CHUNK_ICCP = "ICCP";
const CHUNK_EXIF = "EXIF";
const CHUNK_XMP = "XMP ";

const FLAG_ICC = 0x20;
const FLAG_ALPHA = 0x10;
const FLAG_EXIF = 0x08;
const FLAG_XMP = 0x04;
const FLAG_ANIMATION = 0x02;

const HEADER_SIZE = 12;
const VP8X_PAYLOAD_SIZE = 10;

/** VP8X keeps the canvas size in 24-bit fields. The format cannot go past this limit. */
const MAX_DIMENSION = 1 << 24;

/** The size field of a RIFF chunk is 32 bits. */
export const MAX_EXIF_BYTES = 0xffffffff;

const MAX_RIFF_SIZE = 0xffffffff;

interface Chunk {
    type: string;
    payloadStart: number;
    payloadEnd: number;
}

/** True when the bytes are a RIFF file of type WEBP. */
export function isWebp(bytes: Uint8Array): boolean {
    return bytes.length >= HEADER_SIZE
        && matchesAt(bytes, 0, RIFF)
        && matchesAt(bytes, 8, WEBP);
}

/**
 * Reads the EXIF block out of a WebP's `EXIF` chunk.
 * @param bytes - The WebP file.
 * @returns The raw block, or null if the file carries none.
 */
export function readExif(bytes: Uint8Array): Uint8Array | null {
    if (!isWebp(bytes)) {
        return null;
    }

    for (const chunk of parseChunks(bytes).chunks) {
        if (chunk.type === CHUNK_EXIF) {
            return stripExifPrefix(bytes.slice(chunk.payloadStart, chunk.payloadEnd));
        }
    }

    return null;
}

/**
 * Writes an EXIF block into a WebP and replaces any existing block. If the
 * file is simple WebP, the writer changes it to the extended format.
 *
 * @param bytes - The WebP file.
 * @param exif - The raw block to embed.
 * @returns A new WebP that holds the block.
 * @throws If the file cannot be fully parsed, or if the block does not read
 *         back from the result.
 */
export function writeExif(bytes: Uint8Array, exif: Uint8Array): Uint8Array {
    if (!isWebp(bytes)) {
        throw new Error("Not a WebP");
    }
    if (exif.length > MAX_EXIF_BYTES) {
        throw new Error("EXIF block is too large for a RIFF chunk");
    }

    const { chunks, complete } = parseChunks(bytes);
    if (chunks.length === 0) {
        throw new Error("WebP has no chunks");
    }
    if (!complete) {
        throw new Error("WebP chunks could not be fully parsed");
    }

    const canvas = readCanvas(bytes, chunks);
    if (!canvas) {
        throw new Error("Could not determine WebP canvas size");
    }
    if (canvas.width > MAX_DIMENSION || canvas.height > MAX_DIMENSION) {
        throw new Error("WebP canvas exceeds the VP8X dimension limit");
    }

    const has = (type: string) => chunks.some((chunk) => chunk.type === type);

    let flags = FLAG_EXIF;
    if (hasAlpha(bytes, chunks)) {
        flags |= FLAG_ALPHA;
    }
    if (has(CHUNK_ICCP)) {
        flags |= FLAG_ICC;
    }
    if (has(CHUNK_XMP)) {
        flags |= FLAG_XMP;
    }
    if (has(CHUNK_ANIM)) {
        flags |= FLAG_ANIMATION;
    }

    // The WebP specification gives this chunk order: VP8X, [ICCP], image data,
    // [EXIF], [XMP].
    const body: Uint8Array[] = [buildChunk(CHUNK_VP8X, buildVp8xPayload(flags, canvas))];

    for (const chunk of chunks) {
        if (chunk.type === CHUNK_VP8X || chunk.type === CHUNK_EXIF || chunk.type === CHUNK_XMP) {
            continue;
        }
        body.push(buildChunk(chunk.type, payloadOf(bytes, chunk)));
    }

    body.push(buildChunk(CHUNK_EXIF, exif));

    for (const chunk of chunks) {
        if (chunk.type === CHUNK_XMP) {
            body.push(buildChunk(CHUNK_XMP, payloadOf(bytes, chunk)));
        }
    }

    const out = buildRiff(body);

    // This writer changes the structure of the file, so it checks its own output.
    const roundTripped = readExif(out);
    if (!roundTripped || !equalBytes(roundTripped, exif)) {
        throw new Error("WebP EXIF round trip failed");
    }

    return out;
}

/**
 * Reads the canvas size from the VP8X chunk or the image data of a WebP.
 * @param bytes - The WebP file.
 * @returns The dimensions, or null if no chunk gives a size.
 */
export function readDimensions(bytes: Uint8Array): Dimensions | null {
    if (!isWebp(bytes)) {
        return null;
    }
    return readCanvas(bytes, parseChunks(bytes).chunks);
}

/**
 * Reads the chunks inside the RIFF size. `complete` is true when the chunks
 * fill all of that size. Bytes after the RIFF size are not part of the WebP,
 * so the reader ignores them.
 */
function parseChunks(bytes: Uint8Array): { chunks: Chunk[]; complete: boolean } {
    const chunks: Chunk[] = [];
    const view = viewOf(bytes);
    const riffEnd = 8 + view.getUint32(4, true);
    const end = Math.min(riffEnd, bytes.length);
    let offset = HEADER_SIZE;

    while (offset + 8 <= end) {
        const type = readFourCc(bytes, offset);
        const size = view.getUint32(offset + 4, true);
        const payloadStart = offset + 8;
        const payloadEnd = payloadStart + size;

        if (payloadEnd > end) {
            break;
        }

        // A chunk with an odd size has one padding byte after it.
        const next = payloadEnd + (size % 2);

        chunks.push({ type, payloadStart, payloadEnd });

        offset = next;
    }

    // Some encoders do not write the padding byte after an odd-sized final
    // chunk. Their RIFF size can count that byte or not. Accept both files.
    const complete = offset === riffEnd || offset === riffEnd + 1;

    return { chunks, complete };
}

/** A view of a chunk's payload. It does not copy the bytes. */
function payloadOf(bytes: Uint8Array, chunk: Chunk): Uint8Array {
    return bytes.subarray(chunk.payloadStart, chunk.payloadEnd);
}

function readCanvas(bytes: Uint8Array, chunks: Chunk[]): Dimensions | null {
    for (const chunk of chunks) {
        if (chunk.type === CHUNK_VP8X) {
            const payload = payloadOf(bytes, chunk);
            if (payload.length >= VP8X_PAYLOAD_SIZE) {
                return {
                    width: readUint24(payload, 4) + 1,
                    height: readUint24(payload, 7) + 1,
                };
            }
        }
        if (chunk.type === CHUNK_VP8L) {
            const lossless = readLosslessHeader(payloadOf(bytes, chunk));
            if (lossless) {
                return { width: lossless.width, height: lossless.height };
            }
        }
        if (chunk.type === CHUNK_VP8) {
            const lossy = readLossyHeader(payloadOf(bytes, chunk));
            if (lossy) {
                return lossy;
            }
        }
    }

    return null;
}

function hasAlpha(bytes: Uint8Array, chunks: Chunk[]): boolean {
    for (const chunk of chunks) {
        if (chunk.type === CHUNK_ALPH) {
            return true;
        }
        if (chunk.type === CHUNK_VP8X) {
            const payload = payloadOf(bytes, chunk);
            if (payload.length >= VP8X_PAYLOAD_SIZE && (payload[0] & FLAG_ALPHA) !== 0) {
                return true;
            }
        }
        if (chunk.type === CHUNK_VP8L) {
            const lossless = readLosslessHeader(payloadOf(bytes, chunk));
            if (lossless?.hasAlpha) {
                return true;
            }
        }
    }

    return false;
}

/**
 * VP8L header: a 0x2F signature byte, then 32 bits that hold width-1 (14 bits),
 * height-1 (14 bits), an alpha flag and a version.
 */
function readLosslessHeader(
    payload: Uint8Array
): { width: number; height: number; hasAlpha: boolean } | null {
    if (payload.length < 5 || payload[0] !== 0x2f) {
        return null;
    }

    const view = viewOf(payload);
    const bits = view.getUint32(1, true);

    return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
        hasAlpha: ((bits >>> 28) & 1) === 1,
    };
}

/**
 * VP8 keyframe header: a 3-byte frame tag, the 0x9D 0x01 0x2A start code, then
 * 14-bit width and height.
 */
function readLossyHeader(payload: Uint8Array): Dimensions | null {
    if (payload.length < 10) {
        return null;
    }
    if (payload[3] !== 0x9d || payload[4] !== 0x01 || payload[5] !== 0x2a) {
        return null;
    }

    const view = viewOf(payload);
    const width = view.getUint16(6, true) & 0x3fff;
    const height = view.getUint16(8, true) & 0x3fff;
    if (width === 0 || height === 0) {
        return null;
    }

    return { width, height };
}

function buildVp8xPayload(flags: number, canvas: Dimensions): Uint8Array {
    const payload = new Uint8Array(VP8X_PAYLOAD_SIZE);

    payload[0] = flags;
    // Bytes 1-3 are reserved and must be zero.
    writeUint24(payload, 4, canvas.width - 1);
    writeUint24(payload, 7, canvas.height - 1);

    return payload;
}

function buildChunk(type: string, payload: Uint8Array): Uint8Array {
    // A chunk with an odd size gets one padding byte after it. The size field
    // gives the payload length without the padding byte.
    const padding = payload.length % 2;
    const chunk = new Uint8Array(8 + payload.length + padding);
    const view = new DataView(chunk.buffer);

    chunk.set(ascii(type), 0);
    view.setUint32(4, payload.length, true);
    chunk.set(payload, 8);

    return chunk;
}

function buildRiff(body: Uint8Array[]): Uint8Array {
    let bodyLength = 0;
    for (const chunk of body) {
        bodyLength += chunk.length;
    }

    if (4 + bodyLength > MAX_RIFF_SIZE) {
        throw new Error("WebP is too large for a RIFF file");
    }

    const header = new Uint8Array(HEADER_SIZE);
    header.set(RIFF, 0);
    new DataView(header.buffer).setUint32(4, 4 + bodyLength, true);
    header.set(WEBP, 8);

    return concat([header, ...body]);
}

function readUint24(bytes: Uint8Array, offset: number): number {
    return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function writeUint24(bytes: Uint8Array, offset: number, value: number): void {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >> 8) & 0xff;
    bytes[offset + 2] = (value >> 16) & 0xff;
}

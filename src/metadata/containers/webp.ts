// webp.ts
// WebP carries EXIF in an `EXIF` RIFF chunk, but only the extended file format
// has anywhere to put one. Canvas emits simple WebP (a bare VP8 or VP8L chunk),
// so writing means promoting the file: prepend a VP8X chunk describing the
// canvas and flags, then append the EXIF chunk.

import { Dimensions } from "../types";
import { ascii, concat, matchesAt, readFourCc, stripExifPrefix } from "./bytes";

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

/** WebP dimensions are stored as 24-bit fields, so this is a hard format limit. */
const MAX_DIMENSION = 1 << 24;

/** A RIFF chunk's size field is a 32-bit value. */
export const MAX_EXIF_BYTES = 0xffffffff;

interface Chunk {
    type: string;
    payload: Uint8Array;
}

/** True when the bytes are a RIFF container declaring WEBP. */
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

    for (const chunk of parseChunks(bytes)) {
        if (chunk.type === CHUNK_EXIF) {
            return stripExifPrefix(chunk.payload);
        }
    }

    return null;
}

/**
 * Writes an EXIF block into a WebP, promoting a simple file to the extended
 * format if needed and replacing any existing block.
 *
 * @param bytes - The WebP file.
 * @param exif - The raw block to embed.
 * @returns A new WebP carrying the block.
 * @throws If the file cannot be parsed or the result fails its own round trip.
 */
export function writeExif(bytes: Uint8Array, exif: Uint8Array): Uint8Array {
    if (!isWebp(bytes)) {
        throw new Error("Not a WebP");
    }

    const chunks = parseChunks(bytes);
    if (chunks.length === 0) {
        throw new Error("WebP has no chunks");
    }

    const canvas = readCanvas(chunks);
    if (!canvas) {
        throw new Error("Could not determine WebP canvas size");
    }
    if (canvas.width > MAX_DIMENSION || canvas.height > MAX_DIMENSION) {
        throw new Error("WebP canvas exceeds the VP8X dimension limit");
    }

    const has = (type: string) => chunks.some((chunk) => chunk.type === type);

    let flags = FLAG_EXIF;
    if (hasAlpha(chunks)) {
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

    // Spec chunk order: VP8X, [ICCP], image data, [EXIF], [XMP].
    const body: Uint8Array[] = [buildChunk(CHUNK_VP8X, buildVp8xPayload(flags, canvas))];

    for (const chunk of chunks) {
        if (chunk.type === CHUNK_VP8X || chunk.type === CHUNK_EXIF || chunk.type === CHUNK_XMP) {
            continue;
        }
        body.push(buildChunk(chunk.type, chunk.payload));
    }

    body.push(buildChunk(CHUNK_EXIF, exif));

    for (const chunk of chunks) {
        if (chunk.type === CHUNK_XMP) {
            body.push(buildChunk(CHUNK_XMP, chunk.payload));
        }
    }

    const out = buildRiff(body);

    // This writer restructures the container, so it verifies its own output.
    const roundTripped = readExif(out);
    if (!roundTripped || roundTripped.length !== exif.length) {
        throw new Error("WebP EXIF round trip failed");
    }

    return out;
}

/**
 * Reads the canvas size from a WebP's VP8X header or image bitstream.
 * @param bytes - The WebP file.
 * @returns The dimensions, or null if no bitstream could be read.
 */
export function readDimensions(bytes: Uint8Array): Dimensions | null {
    if (!isWebp(bytes)) {
        return null;
    }
    return readCanvas(parseChunks(bytes));
}

function parseChunks(bytes: Uint8Array): Chunk[] {
    const chunks: Chunk[] = [];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = HEADER_SIZE;

    while (offset + 8 <= bytes.length) {
        const type = readFourCc(bytes, offset);
        const size = view.getUint32(offset + 4, true);
        const payloadStart = offset + 8;
        const payloadEnd = payloadStart + size;

        if (payloadEnd > bytes.length) {
            break;
        }

        chunks.push({ type, payload: bytes.slice(payloadStart, payloadEnd) });

        // RIFF chunks are padded to an even length.
        offset = payloadEnd + (size % 2);
    }

    return chunks;
}

function readCanvas(chunks: Chunk[]): Dimensions | null {
    for (const chunk of chunks) {
        if (chunk.type === CHUNK_VP8X && chunk.payload.length >= VP8X_PAYLOAD_SIZE) {
            return {
                width: readUint24(chunk.payload, 4) + 1,
                height: readUint24(chunk.payload, 7) + 1,
            };
        }
        if (chunk.type === CHUNK_VP8L) {
            const lossless = readLosslessHeader(chunk.payload);
            if (lossless) {
                return { width: lossless.width, height: lossless.height };
            }
        }
        if (chunk.type === CHUNK_VP8) {
            const lossy = readLossyHeader(chunk.payload);
            if (lossy) {
                return lossy;
            }
        }
    }

    return null;
}

function hasAlpha(chunks: Chunk[]): boolean {
    for (const chunk of chunks) {
        if (chunk.type === CHUNK_ALPH) {
            return true;
        }
        if (chunk.type === CHUNK_VP8X && chunk.payload.length >= VP8X_PAYLOAD_SIZE) {
            if ((chunk.payload[0] & FLAG_ALPHA) !== 0) {
                return true;
            }
        }
        if (chunk.type === CHUNK_VP8L) {
            const lossless = readLosslessHeader(chunk.payload);
            if (lossless?.hasAlpha) {
                return true;
            }
        }
    }

    return false;
}

/**
 * VP8L header: a 0x2F signature byte, then 32 bits packing width-1 (14 bits),
 * height-1 (14 bits), an alpha flag and a version.
 */
function readLosslessHeader(
    payload: Uint8Array
): { width: number; height: number; hasAlpha: boolean } | null {
    if (payload.length < 5 || payload[0] !== 0x2f) {
        return null;
    }

    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
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

    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

    return {
        width: view.getUint16(6, true) & 0x3fff,
        height: view.getUint16(8, true) & 0x3fff,
    };
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
    // RIFF chunks are padded to an even length; the size field records the
    // true payload length, not the padded one.
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

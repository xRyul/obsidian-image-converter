// jpeg.ts
// JPEG carries EXIF in an APP1 segment: "Exif\0\0" then the raw TIFF block.

import { Dimensions } from "../types";
import { concat, EXIF_PREFIX, matchesAt, viewOf } from "./bytes";

const MARKER_SOI = 0xd8;
const MARKER_EOI = 0xd9;
const MARKER_SOS = 0xda;
const MARKER_APP0 = 0xe0;
const MARKER_APP1 = 0xe1;
const MARKER_TEM = 0x01;

/** An APP1 length field is 16 bits and counts itself; six bytes go to the prefix. */
export const MAX_EXIF_BYTES = 65527;

interface Segment {
    marker: number;
    /** Offset of the 0xFF that starts the marker. */
    start: number;
    /** Offset just past the segment. */
    end: number;
    /** Offset of the segment payload (past marker and length field). */
    payloadStart: number;
}

/** True when the bytes open with a JPEG start-of-image marker. */
export function isJpeg(bytes: Uint8Array): boolean {
    return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === MARKER_SOI;
}

/**
 * Reads the EXIF block out of a JPEG's APP1 segment.
 * @param bytes - The JPEG file.
 * @returns The raw block, or null if the file carries none.
 */
export function readExif(bytes: Uint8Array): Uint8Array | null {
    if (!isJpeg(bytes)) {
        return null;
    }

    for (const segment of walkSegments(bytes)) {
        if (segment.marker === MARKER_APP1 && hasExifPrefix(bytes, segment.payloadStart)) {
            return bytes.slice(segment.payloadStart + EXIF_PREFIX.length, segment.end);
        }
    }

    return null;
}

/**
 * Writes an EXIF block into a JPEG, replacing any existing one. A leading JFIF
 * APP0 segment stays directly after the start-of-image marker.
 *
 * @param bytes - The JPEG file.
 * @param exif - The raw block to embed.
 * @returns A new JPEG carrying the block.
 * @throws If the file is not a JPEG, the block will not fit, or the segment
 *         walk never reaches the scan.
 */
export function writeExif(bytes: Uint8Array, exif: Uint8Array): Uint8Array {
    if (!isJpeg(bytes)) {
        throw new Error("Not a JPEG");
    }
    if (exif.length > MAX_EXIF_BYTES) {
        throw new Error("EXIF block exceeds the JPEG APP1 limit");
    }

    const parts: Uint8Array[] = [bytes.subarray(0, 2)]; // SOI

    const segments = [...walkSegments(bytes)];
    let index = 0;

    // A JFIF APP0 segment, if present, must stay directly after SOI.
    if (segments.length > 0 && segments[0].marker === MARKER_APP0) {
        parts.push(bytes.subarray(segments[0].start, segments[0].end));
        index = 1;
    }

    parts.push(buildApp1(exif));

    for (; index < segments.length; index++) {
        const segment = segments[index];
        if (segment.marker === MARKER_APP1 && hasExifPrefix(bytes, segment.payloadStart)) {
            continue; // drop any pre-existing EXIF
        }
        if (segment.marker === MARKER_SOS) {
            // Entropy-coded data runs from here to the end of the file.
            parts.push(bytes.subarray(segment.start));
            return concat(parts);
        }
        parts.push(bytes.subarray(segment.start, segment.end));
    }

    throw new Error("JPEG has no start-of-scan segment");
}

/**
 * Reads dimensions from a JPEG's start-of-frame segment.
 * @param bytes - The JPEG file.
 * @returns The dimensions, or null if no frame header was found.
 */
export function readDimensions(bytes: Uint8Array): Dimensions | null {
    if (!isJpeg(bytes)) {
        return null;
    }

    for (const segment of walkSegments(bytes)) {
        // SOF0..SOF15, excluding DHT (0xC4), JPG (0xC8) and DAC (0xCC).
        const isStartOfFrame = segment.marker >= 0xc0
            && segment.marker <= 0xcf
            && segment.marker !== 0xc4
            && segment.marker !== 0xc8
            && segment.marker !== 0xcc;

        if (!isStartOfFrame) {
            continue;
        }
        if (segment.payloadStart + 5 > bytes.length) {
            return null;
        }

        const view = viewOf(bytes);
        // Payload is: precision (1 byte), height (2), width (2).
        return {
            height: view.getUint16(segment.payloadStart + 1, false),
            width: view.getUint16(segment.payloadStart + 3, false),
        };
    }

    return null;
}

/** Walks marker segments from just past SOI up to and including SOS. */
function* walkSegments(bytes: Uint8Array): Generator<Segment> {
    let offset = 2;

    while (offset + 1 < bytes.length) {
        if (bytes[offset] !== 0xff) {
            return;
        }

        // Fill bytes: any number of 0xFF may pad the gap before a marker.
        let markerOffset = offset + 1;
        while (markerOffset < bytes.length && bytes[markerOffset] === 0xff) {
            markerOffset++;
        }
        if (markerOffset >= bytes.length) {
            return;
        }

        const marker = bytes[markerOffset];

        if (marker === MARKER_EOI) {
            return;
        }
        if (marker === MARKER_TEM || (marker >= 0xd0 && marker <= 0xd8)) {
            offset = markerOffset + 1; // standalone marker, no length field
            continue;
        }

        const lengthOffset = markerOffset + 1;
        if (lengthOffset + 2 > bytes.length) {
            return;
        }

        const length = (bytes[lengthOffset] << 8) | bytes[lengthOffset + 1];
        if (length < 2) {
            return;
        }

        const end = lengthOffset + length;
        if (end > bytes.length) {
            return;
        }

        yield {
            marker,
            start: markerOffset - 1,
            end,
            payloadStart: lengthOffset + 2,
        };

        if (marker === MARKER_SOS) {
            return;
        }

        offset = end;
    }
}

function hasExifPrefix(bytes: Uint8Array, offset: number): boolean {
    return matchesAt(bytes, offset, EXIF_PREFIX);
}

function buildApp1(exif: Uint8Array): Uint8Array {
    const length = 2 + EXIF_PREFIX.length + exif.length;
    const segment = new Uint8Array(2 + length);

    segment[0] = 0xff;
    segment[1] = MARKER_APP1;
    segment[2] = (length >> 8) & 0xff;
    segment[3] = length & 0xff;
    segment.set(EXIF_PREFIX, 4);
    segment.set(exif, 4 + EXIF_PREFIX.length);

    return segment;
}

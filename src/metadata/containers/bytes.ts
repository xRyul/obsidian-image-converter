// Byte helpers shared by the container readers and writers

/** "Exif\0\0" - the JPEG APP1 marker. */
const EXIF_PREFIX = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];

/**
 * Concatenates chunks into a single new buffer.
 * @param parts - The chunks to join, in order.
 * @returns A new buffer containing every chunk.
 */
export function concat(parts: Uint8Array[]): Uint8Array {
    let total = 0;
    for (const part of parts) {
        total += part.length;
    }

    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }

    return out;
}

/**
 * Tests whether a byte sequence appears at a given offset.
 * @param bytes - The buffer to test.
 * @param offset - Where to start comparing.
 * @param prefix - The bytes to look for.
 * @returns True if every byte matches.
 */
export function matchesAt(bytes: Uint8Array, offset: number, prefix: readonly number[]): boolean {
    if (offset + prefix.length > bytes.length) {
        return false;
    }
    return prefix.every((byte, index) => bytes[offset + index] === byte);
}

/**
 * Encodes an ASCII string as bytes, for four-character container tags.
 * @param text - The string to encode.
 * @returns One byte per character.
 */
export function ascii(text: string): Uint8Array {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
        out[i] = text.charCodeAt(i) & 0xff;
    }
    return out;
}

/**
 * Reads a four-character tag as an ASCII string.
 * @param bytes - The buffer to read from.
 * @param offset - Where the tag starts.
 * @returns The four characters.
 */
export function readFourCc(bytes: Uint8Array, offset: number): string {
    return String.fromCharCode(
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3]
    );
}

/**
 * Strips the "Exif\0\0" marker some encoders wrongly prepend to PNG and WebP
 * payloads.
 *
 * @param payload - The raw chunk payload.
 * @returns The payload with any marker removed.
 */
export function stripExifPrefix(payload: Uint8Array): Uint8Array {
    if (matchesAt(payload, 0, EXIF_PREFIX)) {
        return payload.slice(EXIF_PREFIX.length);
    }
    return payload;
}

// Byte helpers shared by the container readers and writers

/** "Exif\0\0" - the JPEG APP1 marker. */
export const EXIF_PREFIX: readonly number[] = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];

/** Concatenates chunks into a single new buffer. */
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

/** Views a buffer through a DataView, respecting the offset a subarray sits at. */
export function viewOf(bytes: Uint8Array): DataView {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Compares two buffers byte for byte. */
export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
    if (left.length !== right.length) {
        return false;
    }
    for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) {
            return false;
        }
    }
    return true;
}

/** Tests whether a byte sequence appears at a given offset. */
export function matchesAt(bytes: Uint8Array, offset: number, prefix: readonly number[]): boolean {
    if (offset + prefix.length > bytes.length) {
        return false;
    }
    return prefix.every((byte, index) => bytes[offset + index] === byte);
}

/** Encodes an ASCII string as bytes, for four-character container tags. */
export function ascii(text: string): Uint8Array {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
        out[i] = text.charCodeAt(i) & 0xff;
    }
    return out;
}

/** Reads a four-character tag as an ASCII string. */
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
 */
export function stripExifPrefix(payload: Uint8Array): Uint8Array {
    if (matchesAt(payload, 0, EXIF_PREFIX)) {
        return payload.slice(EXIF_PREFIX.length);
    }
    return payload;
}

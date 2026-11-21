// Shared types for EXIF metadata preservation

/** A single TIFF/EXIF directory entry with its value bytes already resolved. */
export interface ExifEntry {
    tag: number;
    type: number;
    count: number;
    /** Raw value bytes, kept opaque so unrecognised tags survive a round trip. */
    value: Uint8Array;
}

/** One image file directory, keyed by tag number. */
export type ExifIfd = Map<number, ExifEntry>;

/**
 * A parsed EXIF block. Every container that holds EXIF (JPEG, PNG, WebP,
 * HEIC/AVIF and TIFF) uses this same TIFF structure. Only the wrapper around
 * the block is different.
 *
 * The parser does not keep IFD1 (the embedded thumbnail).
 */
export interface ExifBlock {
    /** Byte order of every value in this block. */
    bigEndian: boolean;
    /** Main directory: camera, software, orientation, copyright. */
    ifd0: ExifIfd;
    /** Exif sub-IFD: capture settings such as exposure and ISO. */
    exif: ExifIfd;
    /** GPS sub-IFD: location. */
    gps: ExifIfd;
    /** Interoperability sub-IFD, pointed to from the Exif sub-IFD. */
    interop: ExifIfd;
}

/** Pixel dimensions of an encoded image, as read back from its container. */
export interface Dimensions {
    width: number;
    height: number;
}

/**
 * Spec-accurate container builders and inspectors for the metadata tests.
 *
 * The builders in image.ts are not complete (fake CRCs, a VP8 chunk with no
 * frame tag), because the tests that use them check only the magic bytes. The
 * metadata writers parse the full container structure, so they need valid files.
 */

export * from './isobmff';
export * from './jpeg';
export * from './png';
export * from './webp';

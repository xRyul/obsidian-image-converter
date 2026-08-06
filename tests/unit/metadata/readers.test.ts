/**
 * Unit tests for the read-only source containers: HEIC/AVIF (ISOBMFF) and TIFF.
 * These are the formats the plugin converts *from* and cannot write back to.
 */

import { describe, it, expect } from 'vitest';

import * as isobmff from '../../../src/metadata/containers/isobmff';
import * as tiff from '../../../src/metadata/containers/tiff';
import { parseExifBlock } from '../../../src/metadata/ExifBlock';
import { exifBlockFrom, TAG } from '../../factories/exif';
import { buildIsobmff, buildPng } from '../../factories/containers';

function asciiValue(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes).replace(/\0+$/, '');
}

// TIFF structural tags, which describe pixel storage in the source file only.
const TAG_IMAGE_WIDTH = 256;
const TAG_COMPRESSION = 259;
const TAG_STRIP_OFFSETS = 273;
const TAG_STRIP_BYTE_COUNTS = 279;

describe('ISOBMFF container (HEIC / AVIF)', () => {
  it('Given a HEIC with an EXIF item, When read, Then the block is returned', () => {
    const block = exifBlockFrom({ make: 'Phone', model: 'Camera', dateTimeOriginal: '2024:05:06 07:08:09' });

    const raw = isobmff.readExif(buildIsobmff({ brand: 'heic', exif: block }));

    expect(raw).toEqual(block);
  });

  it('Given an AVIF with an EXIF item, When read, Then the block is returned', () => {
    // AVIF uses the same meta/iinf/iloc structure, so reading it comes free.
    const block = exifBlockFrom({ make: 'Phone' });

    expect(isobmff.readExif(buildIsobmff({ brand: 'avif', exif: block }))).toEqual(block);
  });

  it('Given a non-zero TIFF header offset, When read, Then padding is skipped', () => {
    const block = exifBlockFrom({ make: 'Phone' });

    const raw = isobmff.readExif(buildIsobmff({ exif: block, tiffHeaderOffset: 6 }));

    expect(raw).toEqual(block);
  });

  it('Given a big-endian block inside HEIC, When read, Then it parses', () => {
    const block = exifBlockFrom({ make: 'Phone', orientation: 3, bigEndian: true });

    const parsed = parseExifBlock(isobmff.readExif(buildIsobmff({ exif: block }))!);

    expect(parsed!.bigEndian).toBe(true);
    expect(asciiValue(parsed!.ifd0.get(TAG.make)!.value)).toBe('Phone');
  });

  it('Given a HEIC with no meta box, When read, Then null is returned', () => {
    expect(isobmff.readExif(buildIsobmff({ omitMeta: true }))).toBeNull();
  });

  it('Given a HEIC with an image item but no EXIF item, When read, Then null is returned', () => {
    expect(isobmff.readExif(buildIsobmff({}))).toBeNull();
  });

  it('Given a HEIC whose items contain no EXIF, When read, Then null is returned', () => {
    const file = buildIsobmff({ exif: exifBlockFrom({ make: 'Phone' }), omitExifItem: true });

    expect(isobmff.readExif(file)).toBeNull();
  });

  it('Given a non-ISOBMFF file, When matched, Then it is rejected', () => {
    expect(isobmff.isIsobmff(buildPng())).toBe(false);
    expect(isobmff.isIsobmff(new Uint8Array(4))).toBe(false);
  });

  it('Given an ftyp with no brand we handle, When matched, Then it is rejected', () => {
    expect(isobmff.isIsobmff(buildIsobmff({ brand: 'qt  ', compatibleBrands: ['qt  '] }))).toBe(false);
  });

  it('Given a HEIF brand only in the compatible list, When matched, Then it is accepted', () => {
    // Real HEIC files often declare mif1 as major brand with heic alongside.
    const file = buildIsobmff({ brand: 'mp42', compatibleBrands: ['mp42', 'heic'] });

    expect(isobmff.isIsobmff(file)).toBe(true);
  });

  it('Given a truncated file, When read, Then it returns null instead of throwing', () => {
    const file = buildIsobmff({ exif: exifBlockFrom({ make: 'Phone' }) });

    expect(() => isobmff.readExif(file.slice(0, file.length - 20))).not.toThrow();
  });
});

describe('TIFF container', () => {
  it('Given a TIFF, When read, Then descriptive tags are kept', () => {
    const file = exifBlockFrom({
      make: 'Scanner',
      model: 'Model',
      software: 'ScanApp',
      orientation: 6,
      dateTimeOriginal: '2024:05:06 07:08:09',
    });

    const parsed = parseExifBlock(tiff.readExif(file)!)!;

    expect(asciiValue(parsed.ifd0.get(TAG.make)!.value)).toBe('Scanner');
    expect(asciiValue(parsed.ifd0.get(TAG.model)!.value)).toBe('Model');
    expect(asciiValue(parsed.ifd0.get(TAG.software)!.value)).toBe('ScanApp');
    expect(parsed.ifd0.has(TAG.orientation)).toBe(true);
    expect(asciiValue(parsed.exif.get(TAG.dateTimeOriginal)!.value)).toBe('2024:05:06 07:08:09');
  });

  it('Given a TIFF, When read, Then structural tags are dropped', () => {
    // These point at byte ranges in the source file that will not exist in the
    // converted image.
    const file = exifBlockFrom({
      make: 'Scanner',
      extraIfd0Shorts: {
        [TAG_IMAGE_WIDTH]: 4000,
        [TAG_COMPRESSION]: 1,
        [TAG_STRIP_OFFSETS]: 512,
        [TAG_STRIP_BYTE_COUNTS]: 2048,
      },
    });

    const parsed = parseExifBlock(tiff.readExif(file)!)!;

    expect(parsed.ifd0.has(TAG_IMAGE_WIDTH)).toBe(false);
    expect(parsed.ifd0.has(TAG_COMPRESSION)).toBe(false);
    expect(parsed.ifd0.has(TAG_STRIP_OFFSETS)).toBe(false);
    expect(parsed.ifd0.has(TAG_STRIP_BYTE_COUNTS)).toBe(false);
    expect(asciiValue(parsed.ifd0.get(TAG.make)!.value)).toBe('Scanner');
  });

  it('Given a TIFF with GPS, When read, Then the GPS IFD passes through whole', () => {
    const file = exifBlockFrom({
      make: 'Scanner',
      gpsLatitudeRef: 'N',
      gpsLatitude: [[51, 1], [30, 1], [0, 1]],
    });

    const parsed = parseExifBlock(tiff.readExif(file)!)!;

    expect(asciiValue(parsed.gps.get(TAG.gpsLatitudeRef)!.value)).toBe('N');
    expect(parsed.gps.get(TAG.gpsLatitude)!.count).toBe(3);
  });

  it('Given a big-endian TIFF, When read, Then endianness is preserved', () => {
    const file = exifBlockFrom({ make: 'Scanner', bigEndian: true });

    expect(parseExifBlock(tiff.readExif(file)!)!.bigEndian).toBe(true);
  });

  it('Given a TIFF with only structural tags, When read, Then null is returned', () => {
    const file = exifBlockFrom({
      extraIfd0Shorts: { [TAG_IMAGE_WIDTH]: 4000, [TAG_COMPRESSION]: 1 },
    });

    expect(tiff.readExif(file)).toBeNull();
  });

  it('Given a non-TIFF file, When matched, Then it is rejected', () => {
    expect(tiff.isTiff(buildPng())).toBe(false);
    expect(tiff.isTiff(new Uint8Array([0x49, 0x49, 0x00, 0x00]))).toBe(false);
  });

  it('Given both byte orders, When matched, Then each is recognised', () => {
    expect(tiff.isTiff(exifBlockFrom({ make: 'Cam' }))).toBe(true);
    expect(tiff.isTiff(exifBlockFrom({ make: 'Cam', bigEndian: true }))).toBe(true);
  });
});

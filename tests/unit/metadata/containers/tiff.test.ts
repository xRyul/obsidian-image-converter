/** Tests for the TIFF reader. TIFF is a source format only, so it has no writer. */

import { describe, it, expect } from 'vitest';

import { parseExifBlock } from '../../../../src/metadata/ExifBlock';
import { TAG_IMAGE_WIDTH } from '../../../../src/metadata/tags';
import * as tiff from '../../../../src/metadata/containers/tiff';
import { asciiValue, exifBlockFrom, TAG } from '../../../factories/exif';
import { buildPng } from '../../../factories/containers';

// TIFF structural tags, which describe pixel storage in the source file only.
const TAG_COMPRESSION = 259;
const TAG_STRIP_OFFSETS = 273;
const TAG_STRIP_BYTE_COUNTS = 279;

describe('TIFF container', () => {
  it('Given a TIFF, When read, Then the descriptive tags are kept', () => {
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

  it('Given a TIFF, When read, Then the structural tags are removed', () => {
    // These tags point at byte ranges in the source file. Those ranges do not
    // exist in the converted image.
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

  it('Given a TIFF with GPS, When read, Then the GPS IFD is kept complete', () => {
    const file = exifBlockFrom({
      make: 'Scanner',
      gpsLatitudeRef: 'N',
      gpsLatitude: [[51, 1], [30, 1], [0, 1]],
    });

    const parsed = parseExifBlock(tiff.readExif(file)!)!;

    expect(asciiValue(parsed.gps.get(TAG.gpsLatitudeRef)!.value)).toBe('N');
    expect(parsed.gps.get(TAG.gpsLatitude)!.count).toBe(3);
  });

  it('Given a big-endian TIFF, When read, Then the byte order is kept', () => {
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
    expect(tiff.matches(buildPng())).toBe(false);
    expect(tiff.matches(new Uint8Array([0x49, 0x49, 0x00, 0x00]))).toBe(false);
  });

  it('Given a TIFF in each byte order, When matched, Then it is accepted', () => {
    expect(tiff.matches(exifBlockFrom({ make: 'Cam' }))).toBe(true);
    expect(tiff.matches(exifBlockFrom({ make: 'Cam', bigEndian: true }))).toBe(true);
  });
});

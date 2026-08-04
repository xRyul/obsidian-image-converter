/**
 * Unit tests for the TIFF/EXIF block parser, serialiser and normaliser.
 * Given-When-Then naming, AAA structure, real bytes throughout - no mocks.
 */

import { describe, it, expect } from 'vitest';

import {
  isEmptyBlock,
  normalise,
  parseExifBlock,
  serialiseExifBlock,
  serialiseWithin,
  TAG_ORIENTATION,
  TAG_PIXEL_X_DIMENSION,
  TAG_PIXEL_Y_DIMENSION,
  TAG_USER_COMMENT,
} from '../../../src/metadata/ExifBlock';
import { exifBlockFrom, TAG } from '../../factories/exif';

function shortValue(bytes: Uint8Array, bigEndian: boolean): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(0, !bigEndian);
}

function longValue(bytes: Uint8Array, bigEndian: boolean): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, !bigEndian);
}

function asciiValue(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes).replace(/\0+$/, '');
}

describe('ExifBlock', () => {
  describe('parseExifBlock', () => {
    it('Given a little-endian block, When parsed, Then IFD0 tags are readable', () => {
      const block = exifBlockFrom({ make: 'TestCamera', model: 'TestModel', orientation: 6 });

      const parsed = parseExifBlock(block);

      expect(parsed).not.toBeNull();
      expect(parsed!.bigEndian).toBe(false);
      expect(asciiValue(parsed!.ifd0.get(TAG.make)!.value)).toBe('TestCamera');
      expect(asciiValue(parsed!.ifd0.get(TAG.model)!.value)).toBe('TestModel');
      expect(shortValue(parsed!.ifd0.get(TAG_ORIENTATION)!.value, false)).toBe(6);
    });

    it('Given a big-endian block, When parsed, Then endianness is detected and values decode', () => {
      const block = exifBlockFrom({ make: 'BigEndianCam', orientation: 3, bigEndian: true });

      const parsed = parseExifBlock(block);

      expect(parsed!.bigEndian).toBe(true);
      expect(asciiValue(parsed!.ifd0.get(TAG.make)!.value)).toBe('BigEndianCam');
      expect(shortValue(parsed!.ifd0.get(TAG_ORIENTATION)!.value, true)).toBe(3);
    });

    it('Given a block with sub-IFDs, When parsed, Then Exif and GPS entries are followed', () => {
      const block = exifBlockFrom({
        make: 'Cam',
        dateTimeOriginal: '2024:01:02 03:04:05',
        isoSpeedRatings: 400,
        gpsLatitudeRef: 'N',
        gpsLatitude: [[51, 1], [30, 1], [0, 1]],
      });

      const parsed = parseExifBlock(block);

      expect(asciiValue(parsed!.exif.get(TAG.dateTimeOriginal)!.value)).toBe('2024:01:02 03:04:05');
      expect(shortValue(parsed!.exif.get(TAG.isoSpeedRatings)!.value, false)).toBe(400);
      expect(asciiValue(parsed!.gps.get(TAG.gpsLatitudeRef)!.value)).toBe('N');
      expect(parsed!.gps.get(TAG.gpsLatitude)!.count).toBe(3);
    });

    it('Given sub-IFD pointers, When parsed, Then they are not exposed as ordinary tags', () => {
      const block = exifBlockFrom({ make: 'Cam', isoSpeedRatings: 100, gpsLatitudeRef: 'N' });

      const parsed = parseExifBlock(block);

      expect(parsed!.ifd0.has(TAG.exifIfdPointer)).toBe(false);
      expect(parsed!.ifd0.has(TAG.gpsIfdPointer)).toBe(false);
    });

    it('Given bytes that are not TIFF, When parsed, Then null is returned', () => {
      expect(parseExifBlock(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
      expect(parseExifBlock(new Uint8Array(2))).toBeNull();
    });

    it('Given a truncated block, When parsed, Then it degrades instead of throwing', () => {
      const block = exifBlockFrom({ make: 'Cam', model: 'Model' });
      const truncated = block.slice(0, block.length - 6);

      expect(() => parseExifBlock(truncated)).not.toThrow();
    });
  });

  describe('serialiseExifBlock', () => {
    it('Given a parsed block, When re-serialised and parsed again, Then all values survive', () => {
      const original = exifBlockFrom({
        make: 'RoundTrip',
        model: 'Camera9000',
        orientation: 8,
        software: 'Firmware 1.2',
        dateTimeOriginal: '2024:01:02 03:04:05',
        isoSpeedRatings: 1600,
        gpsLatitudeRef: 'W',
        gpsLatitude: [[12, 1], [34, 1], [56, 100]],
      });

      const parsed = parseExifBlock(original)!;
      const reparsed = parseExifBlock(serialiseExifBlock(parsed))!;

      expect(asciiValue(reparsed.ifd0.get(TAG.make)!.value)).toBe('RoundTrip');
      expect(asciiValue(reparsed.ifd0.get(TAG.model)!.value)).toBe('Camera9000');
      expect(asciiValue(reparsed.ifd0.get(TAG.software)!.value)).toBe('Firmware 1.2');
      expect(shortValue(reparsed.ifd0.get(TAG_ORIENTATION)!.value, false)).toBe(8);
      expect(asciiValue(reparsed.exif.get(TAG.dateTimeOriginal)!.value)).toBe('2024:01:02 03:04:05');
      expect(shortValue(reparsed.exif.get(TAG.isoSpeedRatings)!.value, false)).toBe(1600);
      expect(asciiValue(reparsed.gps.get(TAG.gpsLatitudeRef)!.value)).toBe('W');
      expect(reparsed.gps.get(TAG.gpsLatitude)!.value).toEqual(parsed.gps.get(TAG.gpsLatitude)!.value);
    });

    it('Given a big-endian block, When re-serialised, Then endianness is preserved', () => {
      const parsed = parseExifBlock(exifBlockFrom({ make: 'BE', orientation: 3, bigEndian: true }))!;

      const out = serialiseExifBlock(parsed);

      expect(out[0]).toBe(0x4d);
      expect(out[1]).toBe(0x4d);
      expect(parseExifBlock(out)!.bigEndian).toBe(true);
    });

    it('Given any block, When serialised, Then IFD0 declares no following IFD', () => {
      // IFD1 holds the embedded thumbnail, which is stale after re-encoding.
      const parsed = parseExifBlock(exifBlockFrom({ make: 'Cam', model: 'Model' }))!;

      const out = serialiseExifBlock(parsed);
      const view = new DataView(out.buffer);
      const ifd0Offset = view.getUint32(4, true);
      const entryCount = view.getUint16(ifd0Offset, true);
      const nextIfdOffset = view.getUint32(ifd0Offset + 2 + entryCount * 12, true);

      expect(nextIfdOffset).toBe(0);
    });

    it('Given entries out of order, When serialised, Then tags are written ascending', () => {
      const parsed = parseExifBlock(exifBlockFrom({
        software: 'S',
        make: 'M',
        orientation: 1,
        model: 'D',
      }))!;

      const out = serialiseExifBlock(parsed);
      const view = new DataView(out.buffer);
      const ifd0Offset = view.getUint32(4, true);
      const entryCount = view.getUint16(ifd0Offset, true);

      const tags: number[] = [];
      for (let i = 0; i < entryCount; i++) {
        tags.push(view.getUint16(ifd0Offset + 2 + i * 12, true));
      }

      expect(tags).toEqual([...tags].sort((left, right) => left - right));
    });
  });

  describe('normalise', () => {
    it('Given a rotated image, When normalised, Then Orientation becomes 1', () => {
      // Canvas bakes rotation into the pixels; a surviving tag rotates twice.
      const parsed = parseExifBlock(exifBlockFrom({ orientation: 6, make: 'Cam' }))!;

      const result = normalise(parsed, null);

      expect(shortValue(result.ifd0.get(TAG_ORIENTATION)!.value, false)).toBe(1);
    });

    it('Given no Orientation tag, When normalised, Then none is added', () => {
      const parsed = parseExifBlock(exifBlockFrom({ make: 'Cam' }))!;

      const result = normalise(parsed, null);

      expect(result.ifd0.has(TAG_ORIENTATION)).toBe(false);
    });

    it('Given output dimensions, When normalised, Then pixel dimension tags match them', () => {
      const parsed = parseExifBlock(exifBlockFrom({ make: 'Cam', isoSpeedRatings: 100 }))!;

      const result = normalise(parsed, { width: 640, height: 480 });

      expect(longValue(result.exif.get(TAG_PIXEL_X_DIMENSION)!.value, false)).toBe(640);
      expect(longValue(result.exif.get(TAG_PIXEL_Y_DIMENSION)!.value, false)).toBe(480);
    });

    it('Given unknown dimensions, When normalised, Then stale pixel dimensions are dropped', () => {
      const parsed = parseExifBlock(exifBlockFrom({ make: 'Cam', isoSpeedRatings: 100 }))!;
      parsed.exif.set(TAG_PIXEL_X_DIMENSION, {
        tag: TAG_PIXEL_X_DIMENSION,
        type: 4,
        count: 1,
        value: new Uint8Array([0x00, 0x10, 0x00, 0x00]),
      });

      const result = normalise(parsed, null);

      expect(result.exif.has(TAG_PIXEL_X_DIMENSION)).toBe(false);
    });

    it('Given a block with metadata, When normalised, Then untouched IFDs pass through', () => {
      const parsed = parseExifBlock(exifBlockFrom({
        make: 'Cam',
        dateTimeOriginal: '2024:01:02 03:04:05',
        gpsLatitudeRef: 'N',
        gpsLatitude: [[51, 1], [30, 1], [0, 1]],
      }))!;

      const result = normalise(parsed, null);

      expect(asciiValue(result.ifd0.get(TAG.make)!.value)).toBe('Cam');
      expect(asciiValue(result.exif.get(TAG.dateTimeOriginal)!.value)).toBe('2024:01:02 03:04:05');
      expect(asciiValue(result.gps.get(TAG.gpsLatitudeRef)!.value)).toBe('N');
    });

    it('Given normalisation, When applied, Then the input block is not mutated', () => {
      const parsed = parseExifBlock(exifBlockFrom({ orientation: 6, make: 'Cam' }))!;

      normalise(parsed, { width: 10, height: 10 });

      expect(shortValue(parsed.ifd0.get(TAG_ORIENTATION)!.value, false)).toBe(6);
      expect(parsed.exif.has(TAG_PIXEL_X_DIMENSION)).toBe(false);
    });
  });

  describe('serialiseWithin', () => {
    it('Given a block that fits, When serialised within a ceiling, Then it is returned whole', () => {
      const parsed = parseExifBlock(exifBlockFrom({ make: 'Cam', model: 'Model' }))!;

      const out = serialiseWithin(parsed, 65527);

      expect(out).not.toBeNull();
      expect(parseExifBlock(out!)).not.toBeNull();
    });

    it('Given an oversized comment, When serialised within a ceiling, Then it is shed to fit', () => {
      const parsed = parseExifBlock(exifBlockFrom({
        make: 'Cam',
        userComment: 'x'.repeat(3000),
      }))!;

      const out = serialiseWithin(parsed, 1024);

      expect(out).not.toBeNull();
      expect(out!.length).toBeLessThanOrEqual(1024);
      expect(parseExifBlock(out!)!.exif.has(TAG_USER_COMMENT)).toBe(false);
      expect(asciiValue(parseExifBlock(out!)!.ifd0.get(TAG.make)!.value)).toBe('Cam');
    });

    it('Given a block that cannot be shrunk enough, When serialised, Then null is returned', () => {
      const parsed = parseExifBlock(exifBlockFrom({ make: 'A'.repeat(2000) }))!;

      expect(serialiseWithin(parsed, 64)).toBeNull();
    });
  });

  describe('isEmptyBlock', () => {
    it('Given a block with no tags, When checked, Then it reports empty', () => {
      const parsed = parseExifBlock(exifBlockFrom({}))!;

      expect(isEmptyBlock(parsed)).toBe(true);
    });

    it('Given a block with tags, When checked, Then it reports non-empty', () => {
      const parsed = parseExifBlock(exifBlockFrom({ make: 'Cam' }))!;

      expect(isEmptyBlock(parsed)).toBe(false);
    });
  });
});

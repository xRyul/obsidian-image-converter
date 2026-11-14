/**
 * Unit tests for transferMetadata. transferMetadata decides if metadata is
 * written, and which output container it is written into.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { transferMetadata } from '../../../src/metadata/transferMetadata';
import { parseExifBlock } from '../../../src/metadata/ExifBlock';
import * as isobmff from '../../../src/metadata/containers/isobmff';
import * as jpeg from '../../../src/metadata/containers/jpeg';
import * as png from '../../../src/metadata/containers/png';
import * as webp from '../../../src/metadata/containers/webp';
import { asciiValue, exifBlockFrom, longValue, shortValue, TAG } from '../../factories/exif';
import { makeJpegBytes } from '../../factories/image';
import { buildIsobmff, buildPng, buildWebpExtended, buildWebpLossy } from '../../factories/containers';

function blobOf(bytes: Uint8Array | ArrayBuffer): Blob {
  return new Blob([bytes]);
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

// A TIFF structural tag. It points at pixel data in the source file only.
const TAG_STRIP_OFFSETS = 273;

const richExif = () => exifBlockFrom({
  make: 'TestCamera',
  model: 'TestModel',
  orientation: 6,
  dateTimeOriginal: '2024:01:02 03:04:05',
  isoSpeedRatings: 400,
  gpsLatitudeRef: 'N',
  gpsLatitude: [[51, 1], [30, 1], [0, 1]],
});

describe('transferMetadata', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Given identical source and output bytes, When metadata is transferred, Then nothing is rewritten', async () => {
    // The image was not re-encoded, so Orientation must keep its value.
    const bytes = new Uint8Array(makeJpegBytes({ exif: richExif() }));
    const source = blobOf(bytes);
    const output = bufferOf(bytes);

    const result = await transferMetadata(source, output);

    const block = parseExifBlock(jpeg.readExif(new Uint8Array(result))!)!;
    expect(shortValue(block.ifd0.get(TAG.orientation)!.value)).toBe(6);
  });

  it('Given a re-encoded image, When metadata is transferred, Then Orientation is normalised to 1', async () => {
    const source = blobOf(makeJpegBytes({ exif: richExif() }));
    const output = bufferOf(buildWebpLossy());

    const result = await transferMetadata(source, output);

    const block = parseExifBlock(webp.readExif(new Uint8Array(result))!)!;
    expect(shortValue(block.ifd0.get(TAG.orientation)!.value)).toBe(1);
  });

  it('Given a conversion that did not rotate the pixels, When metadata is transferred, Then Orientation keeps its value', async () => {
    const source = blobOf(makeJpegBytes({ exif: richExif() }));
    const output = bufferOf(buildWebpLossy());

    const result = await transferMetadata(source, output, false);

    const block = parseExifBlock(webp.readExif(new Uint8Array(result))!)!;
    expect(shortValue(block.ifd0.get(TAG.orientation)!.value)).toBe(6);
  });

  it('Given a source with GPS, When metadata is transferred, Then the GPS data is kept', async () => {
    const source = blobOf(makeJpegBytes({ exif: richExif() }));
    const output = bufferOf(buildWebpLossy());

    const result = await transferMetadata(source, output);

    const block = parseExifBlock(webp.readExif(new Uint8Array(result))!)!;
    expect(asciiValue(block.gps.get(TAG.gpsLatitudeRef)!.value)).toBe('N');
  });

  // --- output containers ----------------------------------------------------

  it('Given JPEG output, When metadata is transferred, Then EXIF is written with the output dimensions', async () => {
    const source = blobOf(makeJpegBytes({ exif: richExif() }));
    const output = bufferOf(new Uint8Array(makeJpegBytes({ width: 800, height: 600 })));

    const result = await transferMetadata(source, output);

    const block = parseExifBlock(jpeg.readExif(new Uint8Array(result))!)!;
    expect(asciiValue(block.ifd0.get(TAG.make)!.value)).toBe('TestCamera');
    expect(longValue(block.exif.get(TAG.pixelXDimension)!.value)).toBe(800);
  });

  it('Given PNG output, When metadata is transferred, Then EXIF is written with the output dimensions', async () => {
    const source = blobOf(makeJpegBytes({ exif: richExif() }));
    const output = bufferOf(buildPng({ width: 640, height: 480 }));

    const result = await transferMetadata(source, output);

    const block = parseExifBlock(png.readExif(new Uint8Array(result))!)!;
    expect(asciiValue(block.ifd0.get(TAG.make)!.value)).toBe('TestCamera');
    expect(longValue(block.exif.get(TAG.pixelXDimension)!.value)).toBe(640);
  });

  it('Given WebP output, When metadata is transferred, Then EXIF is written with the output dimensions', async () => {
    const source = blobOf(makeJpegBytes({ exif: richExif() }));
    const output = bufferOf(buildWebpLossy({ width: 200, height: 150 }));

    const result = await transferMetadata(source, output);

    const block = parseExifBlock(webp.readExif(new Uint8Array(result))!)!;
    expect(asciiValue(block.ifd0.get(TAG.make)!.value)).toBe('TestCamera');
    expect(longValue(block.exif.get(TAG.pixelXDimension)!.value)).toBe(200);
  });

  it('Given AVIF output, When metadata is transferred, Then EXIF is written with the output dimensions', async () => {
    // The ffmpeg conversion writes the meta box before the image data. The
    // EXIF item makes meta larger, so the writer must update every item offset.
    const source = blobOf(makeJpegBytes({ exif: richExif() }));
    const output = bufferOf(buildIsobmff({ brand: 'avif', layout: 'meta-first', width: 200, height: 150 }));

    const result = await transferMetadata(source, output);

    const block = parseExifBlock(isobmff.readExif(new Uint8Array(result))!)!;
    expect(asciiValue(block.ifd0.get(TAG.make)!.value)).toBe('TestCamera');
    expect(longValue(block.exif.get(TAG.pixelXDimension)!.value)).toBe(200);
  });

  // --- source containers ----------------------------------------------------

  it('Given a PNG source, When metadata is transferred, Then EXIF is written to the output', async () => {
    const source = blobOf(buildPng({ exif: richExif() }));
    const output = bufferOf(buildWebpLossy());

    const result = await transferMetadata(source, output);

    const block = parseExifBlock(webp.readExif(new Uint8Array(result))!)!;
    expect(asciiValue(block.ifd0.get(TAG.make)!.value)).toBe('TestCamera');
    expect(asciiValue(block.exif.get(TAG.dateTimeOriginal)!.value)).toBe('2024:01:02 03:04:05');
  });

  it('Given a WebP source, When metadata is transferred, Then EXIF is written to the output', async () => {
    const source = blobOf(buildWebpExtended({ exif: richExif() }));
    const output = bufferOf(buildPng());

    const result = await transferMetadata(source, output);

    const block = parseExifBlock(png.readExif(new Uint8Array(result))!)!;
    expect(asciiValue(block.ifd0.get(TAG.make)!.value)).toBe('TestCamera');
    expect(asciiValue(block.exif.get(TAG.dateTimeOriginal)!.value)).toBe('2024:01:02 03:04:05');
  });

  it('Given a HEIC source, When metadata is transferred, Then EXIF is written to the output', async () => {
    const source = blobOf(buildIsobmff({ brand: 'heic', exif: richExif() }));
    const output = bufferOf(buildWebpLossy());

    const result = await transferMetadata(source, output);

    const block = parseExifBlock(webp.readExif(new Uint8Array(result))!)!;
    expect(asciiValue(block.ifd0.get(TAG.make)!.value)).toBe('TestCamera');
    expect(asciiValue(block.exif.get(TAG.dateTimeOriginal)!.value)).toBe('2024:01:02 03:04:05');
  });

  it('Given a TIFF source, When metadata is transferred, Then only the descriptive tags are written to the output', async () => {
    const source = blobOf(exifBlockFrom({
      make: 'Scanner',
      software: 'ScanApp',
      extraIfd0Shorts: { [TAG_STRIP_OFFSETS]: 512 },
    }));
    const output = bufferOf(buildPng());

    const result = await transferMetadata(source, output);

    const block = parseExifBlock(png.readExif(new Uint8Array(result))!)!;
    expect(asciiValue(block.ifd0.get(TAG.make)!.value)).toBe('Scanner');
    expect(asciiValue(block.ifd0.get(TAG.software)!.value)).toBe('ScanApp');
    expect(block.ifd0.has(TAG_STRIP_OFFSETS)).toBe(false);
  });

  // --- failures -------------------------------------------------------------

  it('Given a source with no EXIF, When metadata is transferred, Then the output is returned unchanged', async () => {
    const source = blobOf(makeJpegBytes({}));
    const output = bufferOf(buildWebpLossy());

    const result = await transferMetadata(source, output);

    expect(result).toBe(output);
  });

  it('Given a source container with no reader, When metadata is transferred, Then the output is returned unchanged', async () => {
    const source = blobOf(new Uint8Array([0x42, 0x4d, 0x36, 0x00, 0x00, 0x00, 0x00, 0x00])); // BMP
    const output = bufferOf(buildWebpLossy());

    const result = await transferMetadata(source, output);

    expect(result).toBe(output);
  });

  it('Given corrupt EXIF in the source, When metadata is transferred, Then the output is returned unchanged', async () => {
    const source = blobOf(makeJpegBytes({ exif: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) }));
    const output = bufferOf(buildWebpLossy());

    const result = await transferMetadata(source, output);

    expect(result).toBe(output);
  });

  it('Given an output container with no writer, When metadata is transferred, Then the output is returned unchanged', async () => {
    const source = blobOf(makeJpegBytes({ exif: richExif() }));
    const output = bufferOf(new Uint8Array([0x42, 0x4d, 0x36, 0x00, 0x00, 0x00, 0x00, 0x00])); // BMP

    const result = await transferMetadata(source, output);

    expect(result).toBe(output);
  });

  it('Given an output that the writer rejects, When metadata is transferred, Then the output is returned unchanged', async () => {
    // A RIFF/WEBP header with no chunks. It matches as WebP, but it has no image
    // chunk to convert to the extended format, so the writer throws.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const headerOnly = buildWebpLossy().slice(0, 12);

    const source = blobOf(makeJpegBytes({ exif: richExif() }));
    const output = bufferOf(headerOnly);

    const result = await transferMetadata(source, output);

    expect(new Uint8Array(result)).toEqual(headerOnly);
    expect(warn).toHaveBeenCalled();
  });
});

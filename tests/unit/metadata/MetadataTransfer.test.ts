/**
 * Unit tests for MetadataTransfer. MetadataTransfer decides if metadata is
 * written, and which output container it is written into.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { MetadataTransfer } from '../../../src/metadata/MetadataTransfer';
import { parseExifBlock } from '../../../src/metadata/ExifBlock';
import * as isobmff from '../../../src/metadata/containers/isobmff';
import * as jpeg from '../../../src/metadata/containers/jpeg';
import * as png from '../../../src/metadata/containers/png';
import * as webp from '../../../src/metadata/containers/webp';
import { asciiValue, exifBlockFrom, longValue, shortValue, TAG } from '../../factories/exif';
import { makeJpegBytes } from '../../factories/image';
import { buildIsobmff, buildPng, buildWebpLossy } from '../../factories/containers';

function blobOf(bytes: Uint8Array | ArrayBuffer): Blob {
  return new Blob([bytes]);
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

const richExif = () => exifBlockFrom({
  make: 'TestCamera',
  model: 'TestModel',
  orientation: 6,
  dateTimeOriginal: '2024:01:02 03:04:05',
  isoSpeedRatings: 400,
  gpsLatitudeRef: 'N',
  gpsLatitude: [[51, 1], [30, 1], [0, 1]],
});

describe('MetadataTransfer', () => {
  const transfer = new MetadataTransfer();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Given identical source and output bytes, When transferring, Then nothing is rewritten', async () => {
    // The image was not re-encoded, so Orientation must keep its value.
    const bytes = new Uint8Array(makeJpegBytes({ exif: richExif() }));
    const source = blobOf(bytes);
    const output = bufferOf(bytes);

    const result = await transfer.transfer(source, output);

    const block = parseExifBlock(jpeg.readExif(new Uint8Array(result))!)!;
    expect(shortValue(block.ifd0.get(TAG.orientation)!.value)).toBe(6);
  });

  it('Given a JPEG source and WebP output, When transferring, Then EXIF is written to the WebP output', async () => {
    const source = blobOf(makeJpegBytes({ exif: richExif() }));
    const output = bufferOf(buildWebpLossy({ width: 200, height: 150 }));

    const result = await transfer.transfer(source, output);

    const raw = webp.readExif(new Uint8Array(result));
    expect(raw).not.toBeNull();

    const block = parseExifBlock(raw!)!;
    expect(asciiValue(block.ifd0.get(TAG.make)!.value)).toBe('TestCamera');
    expect(asciiValue(block.exif.get(TAG.dateTimeOriginal)!.value)).toBe('2024:01:02 03:04:05');
  });

  it('Given a re-encoded image, When transferring, Then Orientation is normalised to 1', async () => {
    const source = blobOf(makeJpegBytes({ exif: richExif() }));
    const output = bufferOf(buildWebpLossy());

    const result = await transfer.transfer(source, output);

    const block = parseExifBlock(webp.readExif(new Uint8Array(result))!)!;
    expect(shortValue(block.ifd0.get(TAG.orientation)!.value)).toBe(1);
  });

  it('Given an output with known dimensions, When transferring, Then the pixel dimension tags match the output', async () => {
    const source = blobOf(makeJpegBytes({ w: 4000, h: 3000, exif: richExif() }));
    const output = bufferOf(buildWebpLossy({ width: 800, height: 600 }));

    const result = await transfer.transfer(source, output);

    const block = parseExifBlock(webp.readExif(new Uint8Array(result))!)!;
    expect(longValue(block.exif.get(TAG.pixelXDimension)!.value)).toBe(800);
  });

  it('Given a source with GPS, When transferring, Then the GPS data is kept', async () => {
    const source = blobOf(makeJpegBytes({ exif: richExif() }));
    const output = bufferOf(buildWebpLossy());

    const result = await transfer.transfer(source, output);

    const block = parseExifBlock(webp.readExif(new Uint8Array(result))!)!;
    expect(asciiValue(block.gps.get(TAG.gpsLatitudeRef)!.value)).toBe('N');
  });

  it('Given a source with no EXIF, When transferring, Then the output is returned untouched', async () => {
    const source = blobOf(makeJpegBytes({}));
    const output = bufferOf(buildWebpLossy());

    const result = await transfer.transfer(source, output);

    expect(result).toBe(output);
  });

  it('Given a source container we cannot read, When transferring, Then the output is returned untouched', async () => {
    const source = blobOf(new Uint8Array([0x42, 0x4d, 0x36, 0x00, 0x00, 0x00, 0x00, 0x00])); // BMP
    const output = bufferOf(buildWebpLossy());

    const result = await transfer.transfer(source, output);

    expect(result).toBe(output);
  });

  it('Given a HEIC source, When transferring, Then EXIF is written to the WebP output', async () => {
    // Phone photos are the most common source of detailed EXIF.
    const source = blobOf(buildIsobmff({ brand: 'heic', exif: richExif() }));
    const output = bufferOf(buildWebpLossy({ width: 200, height: 150 }));

    const result = await transfer.transfer(source, output);

    const block = parseExifBlock(webp.readExif(new Uint8Array(result))!)!;
    expect(asciiValue(block.ifd0.get(TAG.make)!.value)).toBe('TestCamera');
    expect(asciiValue(block.exif.get(TAG.dateTimeOriginal)!.value)).toBe('2024:01:02 03:04:05');
    expect(shortValue(block.ifd0.get(TAG.orientation)!.value)).toBe(1);
  });

  it('Given an AVIF source, When transferring, Then EXIF is written to the JPEG output', async () => {
    const source = blobOf(buildIsobmff({ brand: 'avif', exif: richExif() }));
    const output = bufferOf(new Uint8Array(makeJpegBytes({ w: 800, h: 600 })));

    const result = await transfer.transfer(source, output);

    const block = parseExifBlock(jpeg.readExif(new Uint8Array(result))!)!;
    expect(asciiValue(block.ifd0.get(TAG.make)!.value)).toBe('TestCamera');
  });

  it('Given a JPEG source and AVIF output, When transferring, Then EXIF is written to the AVIF output', async () => {
    // The ffmpeg conversion writes the meta box before the image data. The
    // EXIF item makes meta larger, so the writer must update every item offset.
    const source = blobOf(makeJpegBytes({ exif: richExif() }));
    const output = bufferOf(buildIsobmff({ brand: 'avif', layout: 'meta-first', width: 200, height: 150 }));

    const result = await transfer.transfer(source, output);

    const block = parseExifBlock(isobmff.readExif(new Uint8Array(result))!)!;
    expect(asciiValue(block.ifd0.get(TAG.make)!.value)).toBe('TestCamera');
    expect(asciiValue(block.exif.get(TAG.dateTimeOriginal)!.value)).toBe('2024:01:02 03:04:05');
    expect(asciiValue(block.gps.get(TAG.gpsLatitudeRef)!.value)).toBe('N');
  });

  it('Given AVIF output, When transferring, Then Orientation and pixel dimensions are normalised', async () => {
    const source = blobOf(makeJpegBytes({ exif: richExif() }));
    const output = bufferOf(buildIsobmff({ brand: 'avif', layout: 'meta-first', width: 200, height: 150 }));

    const result = await transfer.transfer(source, output);

    const block = parseExifBlock(isobmff.readExif(new Uint8Array(result))!)!;
    expect(shortValue(block.ifd0.get(TAG.orientation)!.value)).toBe(1);
    expect(longValue(block.exif.get(TAG.pixelXDimension)!.value)).toBe(200);
  });

  it('Given a TIFF source, When transferring, Then descriptive tags reach the PNG output', async () => {
    const source = blobOf(exifBlockFrom({
      make: 'Scanner',
      software: 'ScanApp',
      extraIfd0Shorts: { 273: 512 }, // StripOffsets: not valid after conversion
    }));
    const output = bufferOf(buildPng({ width: 640, height: 480 }));

    const result = await transfer.transfer(source, output);

    const block = parseExifBlock(png.readExif(new Uint8Array(result))!)!;
    expect(asciiValue(block.ifd0.get(TAG.make)!.value)).toBe('Scanner');
    expect(asciiValue(block.ifd0.get(TAG.software)!.value)).toBe('ScanApp');
    expect(block.ifd0.has(273)).toBe(false);
  });

  it('Given an output container we cannot write, When transferring, Then the output is returned untouched', async () => {
    const source = blobOf(makeJpegBytes({ exif: richExif() }));
    const output = bufferOf(new Uint8Array([0x42, 0x4d, 0x36, 0x00, 0x00, 0x00, 0x00, 0x00])); // BMP

    const result = await transfer.transfer(source, output);

    expect(result).toBe(output);
  });

  it('Given a PNG output, When transferring, Then EXIF is written as an eXIf chunk', async () => {
    const source = blobOf(makeJpegBytes({ exif: richExif() }));
    const output = bufferOf(buildPng({ width: 640, height: 480 }));

    const result = await transfer.transfer(source, output);

    const block = parseExifBlock(png.readExif(new Uint8Array(result))!)!;
    expect(asciiValue(block.ifd0.get(TAG.make)!.value)).toBe('TestCamera');
    expect(longValue(block.exif.get(TAG.pixelXDimension)!.value)).toBe(640);
  });

  it('Given an output the writer rejects, When transferring, Then the output is returned untouched', async () => {
    // A RIFF/WEBP header with no chunks. It matches as WebP, but it has no image
    // chunk to convert to the extended format, so the writer throws.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const headerOnly = buildWebpLossy().slice(0, 12);

    const source = blobOf(makeJpegBytes({ exif: richExif() }));
    const output = bufferOf(headerOnly);

    const result = await transfer.transfer(source, output);

    expect(new Uint8Array(result)).toEqual(headerOnly);
    expect(warn).toHaveBeenCalled();
  });

  it('Given corrupt EXIF in the source, When transferring, Then the output is returned untouched', async () => {
    const source = blobOf(makeJpegBytes({ exif: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) }));
    const output = bufferOf(buildWebpLossy());

    const result = await transfer.transfer(source, output);

    expect(result).toBe(output);
  });

  it('Given a JPEG output, When transferring, Then the result is still a valid JPEG', async () => {
    const source = blobOf(makeJpegBytes({ w: 4000, h: 3000, exif: richExif() }));
    const output = bufferOf(new Uint8Array(makeJpegBytes({ w: 800, h: 600 })));

    const result = await transfer.transfer(source, output);
    const bytes = new Uint8Array(result);

    expect(jpeg.isJpeg(bytes)).toBe(true);
    expect(jpeg.readDimensions(bytes)).toEqual({ width: 800, height: 600 });
    expect(parseExifBlock(jpeg.readExif(bytes)!)).not.toBeNull();
  });
});

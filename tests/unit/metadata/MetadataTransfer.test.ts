/**
 * Unit tests for MetadataTransfer - the routing layer that decides whether, and
 * into what, metadata gets written.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { MetadataTransfer } from '../../../src/metadata/MetadataTransfer';
import { parseExifBlock, TAG_ORIENTATION, TAG_PIXEL_X_DIMENSION } from '../../../src/metadata/ExifBlock';
import * as isobmff from '../../../src/metadata/containers/isobmff';
import * as jpeg from '../../../src/metadata/containers/jpeg';
import * as png from '../../../src/metadata/containers/png';
import * as webp from '../../../src/metadata/containers/webp';
import { exifBlockFrom, TAG } from '../../factories/exif';
import { makeJpegBytes } from '../../factories/image';
import { buildIsobmff, buildPng, buildWebpLossy } from '../../factories/containers';

function blobOf(bytes: Uint8Array | ArrayBuffer): Blob {
  return new Blob([bytes]);
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function shortValue(bytes: Uint8Array): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(0, true);
}

function longValue(bytes: Uint8Array): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
}

function asciiValue(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes).replace(/\0+$/, '');
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
    // Nothing was re-encoded, so orientation must not be normalised away.
    const bytes = new Uint8Array(makeJpegBytes({ exif: richExif() }));
    const source = blobOf(bytes);
    const output = bufferOf(bytes);

    const result = await transfer.transfer(source, output);

    const block = parseExifBlock(jpeg.readExif(new Uint8Array(result))!)!;
    expect(shortValue(block.ifd0.get(TAG_ORIENTATION)!.value)).toBe(6);
  });

  it('Given a JPEG source and WebP output, When transferring, Then EXIF crosses containers', async () => {
    const source = blobOf(makeJpegBytes({ exif: richExif() }));
    const output = bufferOf(buildWebpLossy(200, 150));

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
    expect(shortValue(block.ifd0.get(TAG_ORIENTATION)!.value)).toBe(1);
  });

  it('Given output of known size, When transferring, Then pixel dimensions match the output', async () => {
    const source = blobOf(makeJpegBytes({ w: 4000, h: 3000, exif: richExif() }));
    const output = bufferOf(buildWebpLossy(800, 600));

    const result = await transfer.transfer(source, output);

    const block = parseExifBlock(webp.readExif(new Uint8Array(result))!)!;
    expect(longValue(block.exif.get(TAG_PIXEL_X_DIMENSION)!.value)).toBe(800);
  });

  it('Given a source with GPS, When transferring, Then location is carried over', async () => {
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

  it('Given a source container we cannot read, When transferring, Then the output is untouched', async () => {
    const source = blobOf(new Uint8Array([0x42, 0x4d, 0x36, 0x00, 0x00, 0x00, 0x00, 0x00])); // BMP
    const output = bufferOf(buildWebpLossy());

    const result = await transfer.transfer(source, output);

    expect(result).toBe(output);
  });

  it('Given a HEIC source, When transferring, Then EXIF reaches the WebP output', async () => {
    // Phone photos are the richest EXIF source the plugin handles.
    const source = blobOf(buildIsobmff({ brand: 'heic', exif: richExif() }));
    const output = bufferOf(buildWebpLossy(200, 150));

    const result = await transfer.transfer(source, output);

    const block = parseExifBlock(webp.readExif(new Uint8Array(result))!)!;
    expect(asciiValue(block.ifd0.get(TAG.make)!.value)).toBe('TestCamera');
    expect(asciiValue(block.exif.get(TAG.dateTimeOriginal)!.value)).toBe('2024:01:02 03:04:05');
    expect(shortValue(block.ifd0.get(TAG_ORIENTATION)!.value)).toBe(1);
  });

  it('Given an AVIF source, When transferring, Then EXIF reaches the JPEG output', async () => {
    const source = blobOf(buildIsobmff({ brand: 'avif', exif: richExif() }));
    const output = bufferOf(new Uint8Array(makeJpegBytes({ w: 800, h: 600 })));

    const result = await transfer.transfer(source, output);

    const block = parseExifBlock(jpeg.readExif(new Uint8Array(result))!)!;
    expect(asciiValue(block.ifd0.get(TAG.make)!.value)).toBe('TestCamera');
  });

  it('Given a JPEG source and AVIF output, When transferring, Then EXIF reaches the AVIF', async () => {
    // What the ffmpeg conversion path produces: a meta box ahead of the image
    // data, so every item offset has to be patched as the EXIF item goes in.
    const source = blobOf(makeJpegBytes({ exif: richExif() }));
    const output = bufferOf(buildIsobmff({ brand: 'avif', layout: 'meta-first', width: 200, height: 150 }));

    const result = await transfer.transfer(source, output);

    const block = parseExifBlock(isobmff.readExif(new Uint8Array(result))!)!;
    expect(asciiValue(block.ifd0.get(TAG.make)!.value)).toBe('TestCamera');
    expect(asciiValue(block.exif.get(TAG.dateTimeOriginal)!.value)).toBe('2024:01:02 03:04:05');
    expect(asciiValue(block.gps.get(TAG.gpsLatitudeRef)!.value)).toBe('N');
  });

  it('Given AVIF output, When transferring, Then orientation and dimensions are normalised', async () => {
    const source = blobOf(makeJpegBytes({ exif: richExif() }));
    const output = bufferOf(buildIsobmff({ brand: 'avif', layout: 'meta-first', width: 200, height: 150 }));

    const result = await transfer.transfer(source, output);

    const block = parseExifBlock(isobmff.readExif(new Uint8Array(result))!)!;
    expect(shortValue(block.ifd0.get(TAG_ORIENTATION)!.value)).toBe(1);
    expect(longValue(block.exif.get(TAG_PIXEL_X_DIMENSION)!.value)).toBe(200);
  });

  it('Given a HEIC source and AVIF output, When transferring, Then EXIF survives the hop', async () => {
    const source = blobOf(buildIsobmff({ brand: 'heic', exif: richExif() }));
    const output = bufferOf(buildIsobmff({ brand: 'avif', layout: 'meta-first', width: 200, height: 150 }));

    const result = await transfer.transfer(source, output);

    const block = parseExifBlock(isobmff.readExif(new Uint8Array(result))!)!;
    expect(asciiValue(block.ifd0.get(TAG.make)!.value)).toBe('TestCamera');
  });

  it('Given an AVIF output that cannot be rewritten, When transferring, Then it is returned untouched', async () => {
    const source = blobOf(makeJpegBytes({ exif: richExif() }));
    const output = bufferOf(buildIsobmff({ brand: 'avif', omitMeta: true }));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await transfer.transfer(source, output);

    expect(new Uint8Array(result)).toEqual(new Uint8Array(output));
  });

  it('Given a TIFF source, When transferring, Then descriptive tags reach the PNG output', async () => {
    const source = blobOf(exifBlockFrom({
      make: 'Scanner',
      software: 'ScanApp',
      extraIfd0Shorts: { 273: 512 }, // StripOffsets - meaningless once converted
    }));
    const output = bufferOf(buildPng({ width: 640, height: 480 }));

    const result = await transfer.transfer(source, output);

    const block = parseExifBlock(png.readExif(new Uint8Array(result))!)!;
    expect(asciiValue(block.ifd0.get(TAG.make)!.value)).toBe('Scanner');
    expect(asciiValue(block.ifd0.get(TAG.software)!.value)).toBe('ScanApp');
    expect(block.ifd0.has(273)).toBe(false);
  });

  it('Given an output container we cannot write, When transferring, Then the output is untouched', async () => {
    // AVIF output is out of scope for now; it must pass through unharmed.
    const source = blobOf(makeJpegBytes({ exif: richExif() }));
    const avif = new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]);
    const output = bufferOf(avif);

    const result = await transfer.transfer(source, output);

    expect(result).toBe(output);
  });

  it('Given a PNG output, When transferring, Then EXIF is written as an eXIf chunk', async () => {
    const source = blobOf(makeJpegBytes({ exif: richExif() }));
    const output = bufferOf(buildPng(({ width: 640, height: 480 })));

    const result = await transfer.transfer(source, output);

    const block = parseExifBlock(png.readExif(new Uint8Array(result))!)!;
    expect(asciiValue(block.ifd0.get(TAG.make)!.value)).toBe('TestCamera');
    expect(longValue(block.exif.get(TAG_PIXEL_X_DIMENSION)!.value)).toBe(640);
  });

  it('Given an output the writer chokes on, When transferring, Then the output survives unchanged', async () => {
    // A RIFF/WEBP header with no chunks at all: recognised as WebP, but there
    // is no image to promote to extended format, so the writer throws.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const headerOnly = buildWebpLossy().slice(0, 12);

    const source = blobOf(makeJpegBytes({ exif: richExif() }));
    const output = bufferOf(headerOnly);

    const result = await transfer.transfer(source, output);

    expect(new Uint8Array(result)).toEqual(headerOnly);
    expect(warn).toHaveBeenCalled();
  });

  it('Given corrupt EXIF in the source, When transferring, Then the output is untouched', async () => {
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

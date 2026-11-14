/**
 * The behaviour that every container writer must have. The tests that apply
 * to one container only are in the test file of that container.
 */

import { describe, it, expect } from 'vitest';

import * as isobmff from '../../../../src/metadata/containers/isobmff';
import * as jpeg from '../../../../src/metadata/containers/jpeg';
import * as png from '../../../../src/metadata/containers/png';
import * as webp from '../../../../src/metadata/containers/webp';
import type { Dimensions } from '../../../../src/metadata/types';
import { exifBlockFrom } from '../../../factories/exif';
import {
  buildIsobmff,
  buildJpeg,
  buildPng,
  buildWebpExtended,
  buildWebpLossy,
  countApp1ExifSegments,
  isobmffItemData,
  isobmffItems,
  jpegScanData,
  pngChunkPayload,
  pngChunkTypes,
  webpChunkPayload,
  webpChunkTypes,
} from '../../../factories/containers';

interface BuildOptions {
  exif?: Uint8Array;
  width?: number;
  height?: number;
}

interface Fixture {
  name: string;
  container: {
    matches(bytes: Uint8Array): boolean;
    readExif(bytes: Uint8Array): Uint8Array | null;
    writeExif(bytes: Uint8Array, exif: Uint8Array): Uint8Array;
    readDimensions(bytes: Uint8Array): Dimensions | null;
  };
  build: (options?: BuildOptions) => Uint8Array;
  /** A valid file of a different format. */
  foreign: Uint8Array;
  /** Counts the EXIF blocks in a file, without the code under test. */
  exifCount: (bytes: Uint8Array) => number;
  /** Finds the encoded image data in a file, without the code under test. */
  imageData: (bytes: Uint8Array) => Uint8Array | null;
}

const countOf = (types: string[], type: string) => types.filter((candidate) => candidate === type).length;

// The ISOBMFF layout controls if the item data comes after the meta box. If it
// does, a larger meta box moves the data, and every offset in iloc must change.
const isobmffFixture = (layout: 'mdat-first' | 'meta-first'): Fixture => ({
  name: `ISOBMFF (${layout})`,
  container: isobmff,
  build: (options) => buildIsobmff({ brand: 'avif', layout, ...options }),
  foreign: buildPng(),
  exifCount: (bytes) => isobmffItems(bytes).filter((item) => item.itemType === 'Exif').length,
  imageData: (bytes) => isobmffItemData(bytes, 1),
});

const fixtures: Fixture[] = [
  {
    name: 'JPEG',
    container: jpeg,
    build: buildJpeg,
    foreign: buildPng(),
    exifCount: countApp1ExifSegments,
    imageData: jpegScanData,
  },
  {
    name: 'PNG',
    container: png,
    build: buildPng,
    foreign: buildWebpLossy(),
    exifCount: (bytes) => countOf(pngChunkTypes(bytes), 'eXIf'),
    imageData: (bytes) => pngChunkPayload(bytes, 'IDAT'),
  },
  {
    name: 'WebP',
    container: webp,
    // Only extended WebP can hold EXIF. Without EXIF, use the simple format that canvas writes.
    build: (options) => (options?.exif ? buildWebpExtended(options) : buildWebpLossy(options)),
    foreign: buildPng(),
    exifCount: (bytes) => countOf(webpChunkTypes(bytes), 'EXIF'),
    imageData: (bytes) => webpChunkPayload(bytes, 'VP8 '),
  },
  isobmffFixture('mdat-first'),
  isobmffFixture('meta-first'),
];

describe.each(fixtures)('$name container contract', ({ container, build, foreign, exifCount, imageData }) => {
  it('Given a file with EXIF, When read, Then the raw block is returned', () => {
    const block = exifBlockFrom({ make: 'Cam', orientation: 6 });

    expect(container.readExif(build({ exif: block }))).toEqual(block);
  });

  it('Given a file without EXIF, When read, Then null is returned', () => {
    expect(container.readExif(build())).toBeNull();
  });

  it('Given a file of a different format, When matched, Then it is rejected', () => {
    expect(container.matches(foreign)).toBe(false);
    expect(container.matches(new Uint8Array(4))).toBe(false);
  });

  it('Given a file without EXIF, When written, Then the block reads back', () => {
    const block = exifBlockFrom({ make: 'Cam', model: 'Model' });

    const out = container.writeExif(build(), block);

    expect(container.readExif(out)).toEqual(block);
    expect(container.matches(out)).toBe(true);
  });

  it('Given a file with EXIF, When written, Then the old block is replaced not duplicated', () => {
    const bytes = build({ exif: exifBlockFrom({ make: 'Old' }) });
    const replacement = exifBlockFrom({ make: 'New', model: 'Replacement' });

    const out = container.writeExif(bytes, replacement);

    expect(container.readExif(out)).toEqual(replacement);
    expect(exifCount(out)).toBe(1);
  });

  it('Given a file, When written, Then the image data is kept byte for byte', () => {
    const bytes = build();
    const before = imageData(bytes);

    const out = container.writeExif(bytes, exifBlockFrom({ make: 'Cam' }));

    expect(before).not.toBeNull();
    expect(imageData(out)).toEqual(before);
  });

  it('Given a file, When dimensions are read, Then the values in the image header are returned', () => {
    expect(container.readDimensions(build({ width: 321, height: 123 }))).toEqual({ width: 321, height: 123 });
  });
});

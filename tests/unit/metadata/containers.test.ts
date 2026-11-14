/**
 * Unit tests for the per-container EXIF readers and writers.
 * Each writer must produce a file that still parses as its own format.
 */

import { describe, it, expect } from 'vitest';

import { parseExifBlock } from '../../../src/metadata/ExifBlock';
import * as isobmff from '../../../src/metadata/containers/isobmff';
import * as jpeg from '../../../src/metadata/containers/jpeg';
import * as png from '../../../src/metadata/containers/png';
import * as tiff from '../../../src/metadata/containers/tiff';
import * as webp from '../../../src/metadata/containers/webp';
import { asciiValue, exifBlockFrom, TAG } from '../../factories/exif';
import { makeJpegBytes } from '../../factories/image';
import {
  buildIsobmff,
  buildPng,
  buildWebpExtended,
  buildWebpLossless,
  buildWebpLossy,
  isobmffBoxTypes,
  isobmffItemData,
  isobmffItems,
  isobmffMetaChildTypes,
  isobmffReferences,
  pngChunkCrcsValid,
  pngChunkPayload,
  pngChunkTypes,
  webpChunkPayload,
  webpChunkTypes,
  webpRiffSizeValid,
  webpVp8xFlags,
} from '../../factories/containers';

const FLAG_ICC = 0x20;
const FLAG_ALPHA = 0x10;
const FLAG_EXIF = 0x08;
const FLAG_XMP = 0x04;
const FLAG_ANIMATION = 0x02;

// TIFF structural tags, which describe pixel storage in the source file only.
const TAG_IMAGE_WIDTH = 256;
const TAG_COMPRESSION = 259;
const TAG_STRIP_OFFSETS = 273;
const TAG_STRIP_BYTE_COUNTS = 279;

describe('JPEG container', () => {
  it('Given a JPEG with EXIF, When read, Then the raw block is returned', () => {
    const block = exifBlockFrom({ make: 'Cam', orientation: 6 });
    const bytes = new Uint8Array(makeJpegBytes({ exif: block }));

    expect(jpeg.readExif(bytes)).toEqual(block);
  });

  it('Given a JPEG without EXIF, When read, Then null is returned', () => {
    const bytes = new Uint8Array(makeJpegBytes({}));

    expect(jpeg.readExif(bytes)).toBeNull();
  });

  it('Given a non-JPEG file, When matched, Then it is rejected', () => {
    expect(jpeg.matches(buildPng())).toBe(false);
    expect(jpeg.matches(new Uint8Array(4))).toBe(false);
  });

  it('Given a JPEG without EXIF, When written, Then the block reads back', () => {
    const bytes = new Uint8Array(makeJpegBytes({}));
    const block = exifBlockFrom({ make: 'Cam', model: 'Model' });

    const out = jpeg.writeExif(bytes, block);

    expect(jpeg.readExif(out)).toEqual(block);
    expect(jpeg.matches(out)).toBe(true);
  });

  it('Given a JPEG with EXIF, When written, Then the old segment is replaced not duplicated', () => {
    const bytes = new Uint8Array(makeJpegBytes({ exif: exifBlockFrom({ make: 'Old' }) }));
    const replacement = exifBlockFrom({ make: 'New', model: 'Replacement' });

    const out = jpeg.writeExif(bytes, replacement);

    expect(jpeg.readExif(out)).toEqual(replacement);
    expect(countApp1ExifSegments(out)).toBe(1);
  });

  it('Given a JFIF JPEG, When written, Then APP0 still directly follows SOI', () => {
    const bytes = new Uint8Array(makeJpegBytes({}));

    const out = jpeg.writeExif(bytes, exifBlockFrom({ make: 'Cam' }));

    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8);
    expect(out[2]).toBe(0xff);
    expect(out[3]).toBe(0xe0); // APP0
  });

  it('Given a JPEG, When written, Then the image data is kept byte for byte', () => {
    const bytes = new Uint8Array(makeJpegBytes({}));

    const out = jpeg.writeExif(bytes, exifBlockFrom({ make: 'Cam' }));

    expect(tailFromScan(out)).toEqual(tailFromScan(bytes));
  });

  it('Given an oversized block, When written, Then it throws instead of truncating', () => {
    const bytes = new Uint8Array(makeJpegBytes({}));
    const huge = new Uint8Array(jpeg.MAX_EXIF_BYTES + 1);

    expect(() => jpeg.writeExif(bytes, huge)).toThrow();
  });

  it('Given non-JPEG bytes, When written, Then it throws', () => {
    expect(() => jpeg.writeExif(buildPng(), exifBlockFrom({ make: 'Cam' }))).toThrow();
  });

  it('Given a JPEG with a damaged marker before the scan, When written, Then it throws instead of dropping the image data', () => {
    const bytes = new Uint8Array(makeJpegBytes({}));

    expect(() => jpeg.writeExif(damageJpegScanMarker(bytes), exifBlockFrom({ make: 'Cam' }))).toThrow();
  });

  it('Given a JPEG with a damaged marker before the scan, When read, Then the segments before it are still read', () => {
    const bytes = new Uint8Array(makeJpegBytes({ width: 321, height: 123 }));

    // SOF0 comes before the damaged marker and holds the image size.
    expect(jpeg.readDimensions(damageJpegScanMarker(bytes))).toEqual({ width: 321, height: 123 });
  });

  it('Given a JPEG, When dimensions are read, Then the SOF values are returned', () => {
    const bytes = new Uint8Array(makeJpegBytes({ width: 321, height: 123 }));

    expect(jpeg.readDimensions(bytes)).toEqual({ width: 321, height: 123 });
  });
});

describe('PNG container', () => {
  it('Given a PNG with EXIF, When read, Then the raw block is returned', () => {
    const block = exifBlockFrom({ make: 'Cam' });

    expect(png.readExif(buildPng({ exif: block }))).toEqual(block);
  });

  it('Given a PNG without EXIF, When read, Then null is returned', () => {
    expect(png.readExif(buildPng())).toBeNull();
  });

  it('Given a PNG payload that starts with "Exif\\0\\0", When read, Then the prefix is removed', () => {
    // Some encoders put the JPEG APP1 prefix in the chunk. The PNG specification does not.
    const block = exifBlockFrom({ make: 'Cam' });
    const prefixed = new Uint8Array(6 + block.length);
    prefixed.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 0);
    prefixed.set(block, 6);

    expect(png.readExif(buildPng({ exif: prefixed }))).toEqual(block);
  });

  it('Given a non-PNG file, When matched, Then it is rejected', () => {
    expect(png.matches(buildWebpLossy())).toBe(false);
    expect(png.matches(new Uint8Array(4))).toBe(false);
  });

  it('Given a PNG without EXIF, When written, Then the block reads back and the CRCs stay valid', () => {
    const block = exifBlockFrom({ make: 'Cam', model: 'Model' });

    const out = png.writeExif(buildPng(), block);

    expect(png.readExif(out)).toEqual(block);
    expect(pngChunkCrcsValid(out)).toBe(true);
  });

  it('Given a PNG, When written, Then eXIf is between IHDR and IDAT', () => {
    const out = png.writeExif(buildPng(), exifBlockFrom({ make: 'Cam' }));

    const types = pngChunkTypes(out);
    expect(types.indexOf('eXIf')).toBeGreaterThan(types.indexOf('IHDR'));
    expect(types.indexOf('eXIf')).toBeLessThan(types.indexOf('IDAT'));
  });

  it('Given a PNG with EXIF, When written, Then the old chunk is replaced not duplicated', () => {
    const bytes = buildPng({ exif: exifBlockFrom({ make: 'Old' }) });
    const replacement = exifBlockFrom({ make: 'New', model: 'Replacement' });

    const out = png.writeExif(bytes, replacement);

    expect(png.readExif(out)).toEqual(replacement);
    expect(pngChunkTypes(out).filter((type) => type === 'eXIf')).toHaveLength(1);
  });

  it('Given a PNG, When written, Then the image data is kept byte for byte', () => {
    const bytes = buildPng();
    const before = pngChunkPayload(bytes, 'IDAT');

    const out = png.writeExif(bytes, exifBlockFrom({ make: 'Cam' }));

    expect(before).not.toBeNull();
    expect(pngChunkPayload(out, 'IDAT')).toEqual(before);
  });

  it('Given non-PNG bytes, When written, Then it throws', () => {
    expect(() => png.writeExif(buildWebpLossy(), exifBlockFrom({ make: 'Cam' }))).toThrow();
  });

  it('Given a PNG with a damaged chunk after IDAT, When written, Then it throws instead of dropping IEND', () => {
    const bytes = buildPng();

    expect(() => png.writeExif(damagePngChunkAfterIdat(bytes), exifBlockFrom({ make: 'Cam' }))).toThrow();
  });

  it('Given a PNG with a damaged chunk after IDAT, When read, Then the chunks before it are still read', () => {
    const bytes = buildPng({ width: 321, height: 123 });

    // IHDR comes before the damaged chunk and holds the image size.
    expect(png.readDimensions(damagePngChunkAfterIdat(bytes))).toEqual({ width: 321, height: 123 });
  });

  it('Given a PNG truncated before IEND, When written, Then it throws', () => {
    const bytes = buildPng();

    expect(() => png.writeExif(bytes.slice(0, bytes.length - 12), exifBlockFrom({ make: 'Cam' }))).toThrow();
  });

  it('Given a PNG, When dimensions are read, Then the IHDR values are returned', () => {
    expect(png.readDimensions(buildPng({ width: 321, height: 123 }))).toEqual({ width: 321, height: 123 });
  });
});

describe('WebP container', () => {
  it('Given a WebP with EXIF, When read, Then the raw block is returned', () => {
    const block = exifBlockFrom({ make: 'Cam' });

    expect(webp.readExif(buildWebpExtended({ exif: block }))).toEqual(block);
  });

  it('Given a WebP without EXIF, When read, Then null is returned', () => {
    expect(webp.readExif(buildWebpLossy())).toBeNull();
  });

  it('Given a WebP payload that starts with "Exif\\0\\0", When read, Then the prefix is removed', () => {
    // Some encoders put the JPEG APP1 prefix in the chunk. The WebP specification does not.
    const block = exifBlockFrom({ make: 'Cam' });
    const prefixed = new Uint8Array(6 + block.length);
    prefixed.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 0);
    prefixed.set(block, 6);

    expect(webp.readExif(buildWebpExtended({ exif: prefixed }))).toEqual(block);
  });

  it('Given a non-WebP file, When matched, Then it is rejected', () => {
    expect(webp.matches(buildPng())).toBe(false);
    expect(webp.matches(new Uint8Array(4))).toBe(false);
  });

  it('Given simple lossy WebP, When written, Then it changes to the extended (VP8X) format with the EXIF flag and the same dimensions', () => {
    const block = exifBlockFrom({ make: 'Cam', model: 'Model' });

    const out = webp.writeExif(buildWebpLossy({ width: 200, height: 150 }), block);

    expect(webp.readExif(out)).toEqual(block);
    expect(webpChunkTypes(out)[0]).toBe('VP8X');
    expect(webpVp8xFlags(out)! & FLAG_EXIF).toBe(FLAG_EXIF);
    expect(webp.readDimensions(out)).toEqual({ width: 200, height: 150 });
    expect(webpRiffSizeValid(out)).toBe(true);
  });

  const simpleFormats = [
    { label: 'lossy', build: buildWebpLossy, imageChunk: 'VP8 ' },
    { label: 'lossless', build: buildWebpLossless, imageChunk: 'VP8L' },
  ];

  // The writer copies every chunk to a new file, so the image data must not change.
  for (const { label, build, imageChunk } of simpleFormats) {
    it(`Given simple ${label} WebP, When written, Then the image data is kept byte for byte`, () => {
      const bytes = build();
      const before = webpChunkPayload(bytes, imageChunk);

      const out = webp.writeExif(bytes, exifBlockFrom({ make: 'Cam' }));

      expect(before).not.toBeNull();
      expect(webpChunkPayload(out, imageChunk)).toEqual(before);
    });
  }

  it('Given extended WebP with ICCP and XMP chunks, When written, Then the chunks are in the order of the WebP specification', () => {
    const iccp = new Uint8Array([1, 2, 3, 4, 5]);
    const xmp = new Uint8Array([6, 7, 8]);
    const bytes = buildWebpExtended({ iccp, xmp, exif: exifBlockFrom({ make: 'Old' }) });

    const out = webp.writeExif(bytes, exifBlockFrom({ make: 'New' }));

    expect(webpChunkTypes(out)).toEqual(['VP8X', 'ICCP', 'VP8 ', 'EXIF', 'XMP ']);
    expect(webpChunkPayload(out, 'ICCP')).toEqual(iccp);
    expect(webpChunkPayload(out, 'XMP ')).toEqual(xmp);
    expect(webpVp8xFlags(out)! & FLAG_ICC).toBe(FLAG_ICC);
    expect(webpVp8xFlags(out)! & FLAG_XMP).toBe(FLAG_XMP);
  });

  it('Given animated WebP, When written, Then the animation flag is kept and the EXIF chunk comes after the frames', () => {
    const bytes = buildWebpExtended({ width: 200, height: 150, animated: true });

    const out = webp.writeExif(bytes, exifBlockFrom({ make: 'Cam' }));

    expect(webpChunkTypes(out)).toEqual(['VP8X', 'ANIM', 'ANMF', 'EXIF']);
    expect(webpVp8xFlags(out)! & FLAG_ANIMATION).toBe(FLAG_ANIMATION);
    expect(webp.readDimensions(out)).toEqual({ width: 200, height: 150 });
  });

  it('Given simple lossless WebP, When written, Then the dimensions are kept', () => {
    const out = webp.writeExif(buildWebpLossless({ width: 321, height: 123 }), exifBlockFrom({ make: 'Cam' }));

    expect(webp.readDimensions(out)).toEqual({ width: 321, height: 123 });
    expect(webpRiffSizeValid(out)).toBe(true);
  });

  it('Given lossless WebP with alpha, When written, Then the alpha flag is set', () => {
    const out = webp.writeExif(buildWebpLossless({ width: 100, height: 80, alpha: true }), exifBlockFrom({ make: 'Cam' }));

    expect(webpVp8xFlags(out)! & FLAG_ALPHA).toBe(FLAG_ALPHA);
  });

  it('Given lossless WebP without alpha, When written, Then the alpha flag is clear', () => {
    const out = webp.writeExif(buildWebpLossless({ width: 100, height: 80, alpha: false }), exifBlockFrom({ make: 'Cam' }));

    expect(webpVp8xFlags(out)! & FLAG_ALPHA).toBe(0);
  });

  it('Given a WebP with EXIF, When written, Then the old chunk is replaced not duplicated', () => {
    const bytes = buildWebpExtended({ exif: exifBlockFrom({ make: 'Old' }) });
    const replacement = exifBlockFrom({ make: 'New', model: 'Replacement' });

    const out = webp.writeExif(bytes, replacement);

    expect(webp.readExif(out)).toEqual(replacement);
    expect(webpChunkTypes(out).filter((type) => type === 'EXIF')).toHaveLength(1);
    expect(webpChunkTypes(out).filter((type) => type === 'VP8X')).toHaveLength(1);
  });

  it('Given extended WebP with alpha, When written, Then the alpha flag is kept', () => {
    const out = webp.writeExif(buildWebpExtended({ alpha: true }), exifBlockFrom({ make: 'Cam' }));

    expect(webpVp8xFlags(out)! & FLAG_ALPHA).toBe(FLAG_ALPHA);
  });

  it('Given an odd-sized EXIF block, When written, Then the RIFF padding keeps the file valid', () => {
    const block = exifBlockFrom({ make: 'Cam' });
    const odd = block.slice(0, block.length - 1); // exifBlockFrom output has an even length
    expect(odd.length % 2).toBe(1);

    const out = webp.writeExif(buildWebpLossy(), odd);

    expect(webp.readExif(out)).toEqual(odd);
    expect(webpRiffSizeValid(out)).toBe(true);
  });

  it('Given non-WebP bytes, When written, Then it throws', () => {
    expect(() => webp.writeExif(buildPng(), exifBlockFrom({ make: 'Cam' }))).toThrow();
  });

  it('Given a WebP with a damaged image chunk, When written, Then it throws instead of dropping the image data', () => {
    const bytes = buildWebpExtended();

    expect(() => webp.writeExif(damageWebpImageChunk(bytes), exifBlockFrom({ make: 'Cam' }))).toThrow(/fully parsed/);
  });

  it('Given a WebP with a damaged image chunk, When read, Then the chunks before it are still read', () => {
    const bytes = buildWebpExtended({ width: 321, height: 123 });

    // VP8X comes before the damaged chunk and holds the canvas size.
    expect(webp.readDimensions(damageWebpImageChunk(bytes))).toEqual({ width: 321, height: 123 });
  });

  it('Given a WebP truncated before the end of its RIFF data, When written, Then it throws', () => {
    const old = exifBlockFrom({ make: 'Old' }); // even length, so no padding byte
    const bytes = buildWebpExtended({ exif: old });
    // Remove the whole EXIF chunk but keep the RIFF size, which still counts it.
    const truncated = bytes.slice(0, bytes.length - (8 + old.length));

    expect(() => webp.writeExif(truncated, exifBlockFrom({ make: 'Cam' }))).toThrow(/fully parsed/);
  });

  it('Given bytes after the RIFF data, When written, Then they are removed', () => {
    const bytes = buildWebpLossy();
    // A full empty chunk. A reader that goes past the RIFF size reads it as a chunk.
    const trailing = new Uint8Array(bytes.length + 8);
    trailing.set(bytes, 0);
    trailing.set([0x4a, 0x55, 0x4e, 0x4b, 0x00, 0x00, 0x00, 0x00], bytes.length); // "JUNK", size 0
    const block = exifBlockFrom({ make: 'Cam' });

    const out = webp.writeExif(trailing, block);

    expect(webp.readExif(out)).toEqual(block);
    expect(webpRiffSizeValid(out)).toBe(true);
    expect(webpChunkTypes(out)).not.toContain('JUNK');
  });

  // Some encoders do not write the final padding byte. Some of them count the
  // byte in the RIFF size, and some do not. Decoders accept both files.
  for (const riffCountsPadding of [true, false]) {
    const label = riffCountsPadding ? 'counts' : 'does not count';

    it(`Given no padding byte after an odd final chunk and a RIFF size that ${label} it, When written, Then the block reads back`, () => {
      const old = exifBlockFrom({ make: 'Old' });
      const odd = old.slice(0, old.length - 1); // exifBlockFrom output has an even length
      expect(odd.length % 2).toBe(1);
      const bytes = removeWebpFinalPadding(buildWebpExtended({ exif: odd }), riffCountsPadding);
      const block = exifBlockFrom({ make: 'New' });

      const out = webp.writeExif(bytes, block);

      expect(webp.readExif(out)).toEqual(block);
      expect(webpRiffSizeValid(out)).toBe(true);
    });
  }

  it('Given a WebP, When dimensions are read, Then the VP8 values are returned', () => {
    expect(webp.readDimensions(buildWebpLossy({ width: 321, height: 123 }))).toEqual({ width: 321, height: 123 });
  });
});

describe('ISOBMFF container (HEIC / AVIF)', () => {
  it('Given a HEIC with EXIF, When read, Then the raw block is returned', () => {
    const block = exifBlockFrom({ make: 'Phone', model: 'Camera', dateTimeOriginal: '2024:05:06 07:08:09' });

    expect(isobmff.readExif(buildIsobmff({ brand: 'heic', exif: block }))).toEqual(block);
  });

  it('Given a non-zero TIFF header offset, When read, Then the padding is skipped', () => {
    const block = exifBlockFrom({ make: 'Phone' });

    expect(isobmff.readExif(buildIsobmff({ exif: block, tiffHeaderOffset: 6 }))).toEqual(block);
  });

  it('Given a HEIC without EXIF, When read, Then null is returned', () => {
    expect(isobmff.readExif(buildIsobmff({}))).toBeNull();
  });

  it('Given a HEIC with no meta box, When read, Then null is returned', () => {
    expect(isobmff.readExif(buildIsobmff({ omitMeta: true }))).toBeNull();
  });

  it('Given EXIF data in an item whose type is not Exif, When read, Then null is returned', () => {
    const file = buildIsobmff({ exif: exifBlockFrom({ make: 'Phone' }), omitExifItem: true });

    expect(isobmff.readExif(file)).toBeNull();
  });

  it('Given a HEIC truncated before the end of its meta box, When read, Then null is returned', () => {
    const file = buildIsobmff({ exif: exifBlockFrom({ make: 'Phone' }) });

    expect(isobmff.readExif(file.slice(0, file.length - 20))).toBeNull();
  });

  it('Given a non-ISOBMFF file, When matched, Then it is rejected', () => {
    expect(isobmff.matches(buildPng())).toBe(false);
    expect(isobmff.matches(new Uint8Array(4))).toBe(false);
  });

  it('Given an ftyp with no supported brand, When matched, Then it is rejected', () => {
    expect(isobmff.matches(buildIsobmff({ brand: 'qt  ', compatibleBrands: ['qt  '] }))).toBe(false);
  });

  it('Given a HEIF brand only in the compatible list, When matched, Then it is accepted', () => {
    // The major brand can be a brand that is not HEIF. The reader must also
    // look at the compatible brands.
    const file = buildIsobmff({ brand: 'mp42', compatibleBrands: ['mp42', 'heic'] });

    expect(isobmff.matches(file)).toBe(true);
  });

  const layouts = ['mdat-first', 'meta-first'] as const;

  // The layout controls if the item data comes after the meta box. If it does,
  // a larger meta box moves the data, and every offset in iloc must change.
  for (const layout of layouts) {
    describe(`${layout} layout`, () => {
      it('Given an AVIF without EXIF, When written, Then the block reads back', () => {
        const file = buildIsobmff({ brand: 'avif', layout });
        const block = exifBlockFrom({ make: 'Cam', model: 'Model' });

        const out = isobmff.writeExif(file, block);

        expect(isobmff.readExif(out)).toEqual(block);
        expect(isobmff.matches(out)).toBe(true);
      });

      it('Given an AVIF, When written, Then the image data is kept byte for byte', () => {
        const file = buildIsobmff({ brand: 'avif', layout });
        const before = isobmffItemData(file, 1);

        const out = isobmff.writeExif(file, exifBlockFrom({ make: 'Cam' }));

        expect(before).not.toBeNull();
        expect(isobmffItemData(out, 1)).toEqual(before);
      });

      it('Given a HEIC with EXIF, When written, Then the old item is replaced not duplicated', () => {
        const file = buildIsobmff({ brand: 'heic', layout, exif: exifBlockFrom({ make: 'Old' }) });
        const replacement = exifBlockFrom({ make: 'New', model: 'Replacement' });

        const out = isobmff.writeExif(file, replacement);

        expect(isobmff.readExif(out)).toEqual(replacement);
        expect(isobmffItems(out).filter((item) => item.itemType === 'Exif')).toHaveLength(1);
      });
    });
  }

  it('Given an AVIF, When written, Then a cdsc reference links the EXIF item to the primary item', () => {
    const file = buildIsobmff({ brand: 'avif', layout: 'meta-first' });

    const out = isobmff.writeExif(file, exifBlockFrom({ make: 'Cam' }));

    const exifItem = isobmffItems(out).find((item) => item.itemType === 'Exif');
    expect(exifItem).toBeDefined();
    expect(isobmffReferences(out)).toContainEqual({
      type: 'cdsc',
      from: exifItem!.itemId,
      to: [1],
    });
  });

  it('Given a HEIC with EXIF, When written, Then the old reference is removed', () => {
    const file = buildIsobmff({ brand: 'heic', exif: exifBlockFrom({ make: 'Old' }) });

    const out = isobmff.writeExif(file, exifBlockFrom({ make: 'New' }));

    expect(isobmffReferences(out).filter((reference) => reference.type === 'cdsc')).toHaveLength(1);
  });

  it('Given an AVIF, When written, Then the EXIF data is in a new mdat at the end', () => {
    const file = buildIsobmff({ brand: 'avif', layout: 'meta-first' });

    const out = isobmff.writeExif(file, exifBlockFrom({ make: 'Cam' }));

    expect(isobmffBoxTypes(out)).toEqual(['ftyp', 'meta', 'mdat', 'mdat']);
    expect(isobmffMetaChildTypes(out)).toEqual(['hdlr', 'pitm', 'iinf', 'iref', 'iloc', 'iprp']);
  });

  it('Given an oversized block, When written, Then it throws instead of truncating', () => {
    const file = buildIsobmff({ brand: 'avif' });
    const huge = new Uint8Array(isobmff.MAX_EXIF_BYTES + 1);

    expect(() => isobmff.writeExif(file, huge)).toThrow();
  });

  it('Given non-ISOBMFF bytes, When written, Then it throws', () => {
    expect(() => isobmff.writeExif(buildPng(), exifBlockFrom({ make: 'Cam' }))).toThrow();
  });

  it('Given a HEIC with no meta box, When written, Then it throws', () => {
    const file = buildIsobmff({ brand: 'heic', omitMeta: true });

    expect(() => isobmff.writeExif(file, exifBlockFrom({ make: 'Cam' }))).toThrow();
  });

  it('Given a HEIC with a damaged meta child box, When written, Then it throws instead of dropping the boxes after it', () => {
    const file = buildIsobmff({ brand: 'heic', unwalkableMetaChild: true });

    // Without this check, the writer returns a file with no iprp box, and so no
    // decoder configuration. That file passes every other check in the writer.
    expect(() => isobmff.writeExif(file, exifBlockFrom({ make: 'Cam' }))).toThrow(/fully parsed/);
  });

  it('Given a HEIC with a damaged meta child box, When read, Then the boxes before it are still read', () => {
    const block = exifBlockFrom({ make: 'Cam' });
    const file = buildIsobmff({ brand: 'heic', exif: block, unwalkableMetaChild: true });

    expect(isobmff.readExif(file)).toEqual(block);
    // iprp comes after the damaged box, so the reader does not find it. This is
    // the box that a rewrite would drop.
    expect(isobmff.readDimensions(file)).toBeNull();
  });

  it('Given a HEIC truncated before the end of its meta box, When written, Then it throws', () => {
    const file = buildIsobmff({ exif: exifBlockFrom({ make: 'Phone' }) });

    expect(() => isobmff.writeExif(file.slice(0, file.length - 20), exifBlockFrom({ make: 'Cam' }))).toThrow();
  });

  it('Given an AVIF, When dimensions are read, Then the ispe values of the primary item are returned', () => {
    const file = buildIsobmff({ brand: 'avif', width: 321, height: 123 });

    expect(isobmff.readDimensions(file)).toEqual({ width: 321, height: 123 });
  });

  it('Given a quarter-turn irot, When dimensions are read, Then the axes are swapped', () => {
    // ispe gives the size of the stored image. irot rotates it after decoding.
    const file = buildIsobmff({ brand: 'avif', width: 321, height: 123, rotation: 1 });

    expect(isobmff.readDimensions(file)).toEqual({ width: 123, height: 321 });
  });

  it('Given a half-turn irot, When dimensions are read, Then the axes are unchanged', () => {
    const file = buildIsobmff({ brand: 'avif', width: 321, height: 123, rotation: 2 });

    expect(isobmff.readDimensions(file)).toEqual({ width: 321, height: 123 });
  });

  it('Given no property association, When dimensions are read, Then the first ispe is used', () => {
    const file = buildIsobmff({ brand: 'avif', width: 321, height: 123, omitPrimaryItem: true });

    expect(isobmff.readDimensions(file)).toEqual({ width: 321, height: 123 });
  });

  it('Given no properties, When dimensions are read, Then null is returned', () => {
    const file = buildIsobmff({ brand: 'avif', omitProperties: true });

    expect(isobmff.readDimensions(file)).toBeNull();
  });

  it('Given an AVIF, When written, Then the dimensions are kept', () => {
    const file = buildIsobmff({ brand: 'avif', width: 321, height: 123, layout: 'meta-first' });

    const out = isobmff.writeExif(file, exifBlockFrom({ make: 'Cam' }));

    expect(isobmff.readDimensions(out)).toEqual({ width: 321, height: 123 });
  });
});

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

// --- helpers ----------------------------------------------------------------

function countApp1ExifSegments(bytes: Uint8Array): number {
  let count = 0;
  let offset = 2;

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;

    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    const payload = offset + 4;
    const isExif = marker === 0xe1
      && bytes[payload] === 0x45
      && bytes[payload + 1] === 0x78
      && bytes[payload + 2] === 0x69
      && bytes[payload + 3] === 0x66;

    if (isExif) count++;
    offset = offset + 2 + length;
  }

  return count;
}

/**
 * Sets the 0xFF byte of the SOS marker to zero, so the segment reader stops
 * before it gets to the scan.
 */
function damageJpegScanMarker(bytes: Uint8Array): Uint8Array {
  const out = bytes.slice();
  let offset = 2;

  while (offset + 4 <= out.length) {
    if (out[offset + 1] === 0xda) break;

    const length = (out[offset + 2] << 8) | out[offset + 3];
    const next = offset + 2 + length;

    if (next + 1 < out.length && out[next + 1] === 0xda) {
      out[next] = 0x00;
      return out;
    }

    offset = next;
  }

  throw new Error('fixture has no segment before the scan');
}

/** Gives the chunk after IDAT a length that goes past the end of the file. */
function damagePngChunkAfterIdat(bytes: Uint8Array): Uint8Array {
  const out = bytes.slice();
  const view = new DataView(out.buffer);
  let offset = 8; // past the signature

  while (offset + 12 <= out.length) {
    const length = view.getUint32(offset, false);
    const type = String.fromCharCode(out[offset + 4], out[offset + 5], out[offset + 6], out[offset + 7]);
    const next = offset + 12 + length;

    if (type === 'IDAT' && next + 4 <= out.length) {
      view.setUint32(next, 0x7fffffff, false);
      return out;
    }

    offset = next;
  }

  throw new Error('fixture has no chunk after IDAT');
}

/** Gives the `VP8 ` chunk a size that goes past the end of the file. */
function damageWebpImageChunk(bytes: Uint8Array): Uint8Array {
  const out = bytes.slice();
  const view = new DataView(out.buffer);
  let offset = 12; // past the RIFF header

  while (offset + 8 <= out.length) {
    const size = view.getUint32(offset + 4, true);
    const type = String.fromCharCode(out[offset], out[offset + 1], out[offset + 2], out[offset + 3]);

    if (type === 'VP8 ') {
      view.setUint32(offset + 4, 0x7fffffff, true);
      return out;
    }

    offset += 8 + size + (size % 2);
  }

  throw new Error('fixture has no VP8 chunk');
}

/**
 * Removes the padding byte after an odd-sized final chunk. If
 * `riffCountsPadding` is false, the RIFF size changes to match the new length.
 */
function removeWebpFinalPadding(bytes: Uint8Array, riffCountsPadding: boolean): Uint8Array {
  if ((bytes.length - 12) % 2 !== 0 || bytes[bytes.length - 1] !== 0) {
    throw new Error('fixture does not end with a padding byte');
  }

  const out = bytes.slice(0, bytes.length - 1);
  const view = new DataView(out.buffer);

  if (!riffCountsPadding) {
    view.setUint32(4, out.length - 8, true);
  }

  return out;
}

/**
 * Returns all bytes from the SOS marker to the end, that is, the compressed
 * scan data. If there is no SOS marker, it throws. The helper does not return
 * an empty result, because two broken fixtures then compare as equal.
 */
function tailFromScan(bytes: Uint8Array): Uint8Array {
  let offset = 2;

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === 0xda) return bytes.slice(offset);
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    offset = offset + 2 + length;
  }

  throw new Error('no start-of-scan segment found');
}

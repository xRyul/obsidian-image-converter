/**
 * Unit tests for the per-container EXIF readers and writers.
 * Each writer must produce a file that still parses as its own format.
 */

import { describe, it, expect } from 'vitest';

import * as isobmff from '../../../src/metadata/containers/isobmff';
import * as jpeg from '../../../src/metadata/containers/jpeg';
import * as png from '../../../src/metadata/containers/png';
import * as webp from '../../../src/metadata/containers/webp';
import { exifBlockFrom } from '../../factories/exif';
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
  pngChunkTypes,
  webpChunkTypes,
  webpRiffSizeValid,
  webpVp8xFlags,
} from '../../factories/containers';

const FLAG_ALPHA = 0x10;
const FLAG_EXIF = 0x08;

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

  it('Given a JPEG without EXIF, When written, Then the block reads back', () => {
    const bytes = new Uint8Array(makeJpegBytes({}));
    const block = exifBlockFrom({ make: 'Written', model: 'Model' });

    const out = jpeg.writeExif(bytes, block);

    expect(jpeg.readExif(out)).toEqual(block);
    expect(jpeg.isJpeg(out)).toBe(true);
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

  it('Given a JPEG, When written, Then scan data is preserved byte for byte', () => {
    const bytes = new Uint8Array(makeJpegBytes({}));

    const out = jpeg.writeExif(bytes, exifBlockFrom({ make: 'Cam' }));

    expect(tailFromScan(out)).toEqual(tailFromScan(bytes));
  });

  it('Given an oversized block, When written, Then it refuses rather than truncating', () => {
    const bytes = new Uint8Array(makeJpegBytes({}));
    const huge = new Uint8Array(jpeg.MAX_EXIF_BYTES + 1);

    expect(() => jpeg.writeExif(bytes, huge)).toThrow();
  });

  it('Given non-JPEG bytes, When written, Then it throws', () => {
    expect(() => jpeg.writeExif(buildPng(), exifBlockFrom({ make: 'Cam' }))).toThrow();
  });

  it('Given a JPEG the segment walk cannot cross, When written, Then it throws rather than dropping the scan', () => {
    const bytes = new Uint8Array(makeJpegBytes({}));
    // Corrupt the byte where a marker must start, so the walk stops before SOS.
    const damaged = damageJpegBeforeScan(bytes);

    expect(() => jpeg.writeExif(damaged, exifBlockFrom({ make: 'Cam' }))).toThrow();
  });

  it('Given a JPEG, When dimensions are read, Then SOF values are returned', () => {
    const bytes = new Uint8Array(makeJpegBytes({ w: 321, h: 123 }));

    expect(jpeg.readDimensions(bytes)).toEqual({ width: 321, height: 123 });
  });
});

describe('PNG container', () => {
  it('Given a PNG with an eXIf chunk, When read, Then the raw block is returned', () => {
    const block = exifBlockFrom({ make: 'Cam' });

    expect(png.readExif(buildPng({ exif: block }))).toEqual(block);
  });

  it('Given a PNG without EXIF, When read, Then null is returned', () => {
    expect(png.readExif(buildPng())).toBeNull();
  });

  it('Given a PNG, When written, Then the block reads back and CRCs stay valid', () => {
    const block = exifBlockFrom({ make: 'Cam', model: 'Model' });

    const out = png.writeExif(buildPng(), block);

    expect(png.readExif(out)).toEqual(block);
    expect(pngChunkCrcsValid(out)).toBe(true);
  });

  it('Given a PNG, When written, Then eXIf sits between IHDR and IDAT', () => {
    const out = png.writeExif(buildPng(), exifBlockFrom({ make: 'Cam' }));

    const types = pngChunkTypes(out);
    expect(types.indexOf('eXIf')).toBeGreaterThan(types.indexOf('IHDR'));
    expect(types.indexOf('eXIf')).toBeLessThan(types.indexOf('IDAT'));
  });

  it('Given a PNG with EXIF, When written, Then only one eXIf chunk remains', () => {
    const withExif = buildPng({ exif: exifBlockFrom({ make: 'Old' }) });

    const out = png.writeExif(withExif, exifBlockFrom({ make: 'New' }));

    expect(pngChunkTypes(out).filter((type) => type === 'eXIf')).toHaveLength(1);
  });

  it('Given a PNG payload wrongly prefixed with "Exif\\0\\0", When read, Then the prefix is stripped', () => {
    const block = exifBlockFrom({ make: 'Cam' });
    const prefixed = new Uint8Array(6 + block.length);
    prefixed.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 0);
    prefixed.set(block, 6);

    expect(png.readExif(buildPng({ exif: prefixed }))).toEqual(block);
  });

  it('Given a PNG, When dimensions are read, Then IHDR values are returned', () => {
    expect(png.readDimensions(buildPng({ width: 320, height: 240 }))).toEqual({ width: 320, height: 240 });
  });

  it('Given non-PNG bytes, When written, Then it throws', () => {
    expect(() => png.writeExif(buildWebpLossy(), exifBlockFrom({ make: 'Cam' }))).toThrow();
  });

  it('Given a PNG with a corrupt chunk after IDAT, When written, Then it throws rather than dropping IEND', () => {
    const bytes = buildPng();
    // A chunk length reaching past the file stops the walk short of IEND.
    const damaged = damagePngLengthAfterIdat(bytes);

    expect(() => png.writeExif(damaged, exifBlockFrom({ make: 'Cam' }))).toThrow();
  });

  it('Given a PNG truncated before IEND, When written, Then it throws', () => {
    const bytes = buildPng();

    expect(() => png.writeExif(bytes.slice(0, bytes.length - 12), exifBlockFrom({ make: 'Cam' }))).toThrow();
  });
});

describe('WebP container', () => {
  it('Given simple lossy WebP, When written, Then it is promoted to VP8X with the EXIF flag', () => {
    const block = exifBlockFrom({ make: 'Cam', model: 'Model' });

    const out = webp.writeExif(buildWebpLossy(200, 150), block);

    expect(webp.readExif(out)).toEqual(block);
    expect(webpChunkTypes(out)[0]).toBe('VP8X');
    expect(webpVp8xFlags(out)! & FLAG_EXIF).toBe(FLAG_EXIF);
    expect(webpRiffSizeValid(out)).toBe(true);
  });

  it('Given simple lossy WebP, When written, Then the canvas size matches the bitstream', () => {
    const out = webp.writeExif(buildWebpLossy(200, 150), exifBlockFrom({ make: 'Cam' }));

    expect(webp.readDimensions(out)).toEqual({ width: 200, height: 150 });
  });

  it('Given simple lossless WebP, When written, Then dimensions survive the promotion', () => {
    const out = webp.writeExif(buildWebpLossless(321, 123), exifBlockFrom({ make: 'Cam' }));

    expect(webp.readDimensions(out)).toEqual({ width: 321, height: 123 });
    expect(webpRiffSizeValid(out)).toBe(true);
  });

  it('Given lossless WebP with alpha, When written, Then the alpha flag is set', () => {
    const out = webp.writeExif(buildWebpLossless(100, 80, true), exifBlockFrom({ make: 'Cam' }));

    expect(webpVp8xFlags(out)! & FLAG_ALPHA).toBe(FLAG_ALPHA);
  });

  it('Given lossless WebP without alpha, When written, Then the alpha flag is clear', () => {
    const out = webp.writeExif(buildWebpLossless(100, 80, false), exifBlockFrom({ make: 'Cam' }));

    expect(webpVp8xFlags(out)! & FLAG_ALPHA).toBe(0);
  });

  it('Given already-extended WebP, When written, Then EXIF is replaced not duplicated', () => {
    const existing = buildWebpExtended({ exif: exifBlockFrom({ make: 'Old' }) });
    const replacement = exifBlockFrom({ make: 'New', model: 'Model' });

    const out = webp.writeExif(existing, replacement);

    expect(webp.readExif(out)).toEqual(replacement);
    expect(webpChunkTypes(out).filter((type) => type === 'EXIF')).toHaveLength(1);
    expect(webpChunkTypes(out).filter((type) => type === 'VP8X')).toHaveLength(1);
  });

  it('Given extended WebP with alpha, When written, Then the existing alpha flag is carried over', () => {
    const out = webp.writeExif(buildWebpExtended({ alpha: true }), exifBlockFrom({ make: 'Cam' }));

    expect(webpVp8xFlags(out)! & FLAG_ALPHA).toBe(FLAG_ALPHA);
  });

  it('Given a WebP, When written, Then the image chunk is preserved', () => {
    const out = webp.writeExif(buildWebpLossy(), exifBlockFrom({ make: 'Cam' }));

    expect(webpChunkTypes(out)).toContain('VP8 ');
  });

  it('Given an odd-sized EXIF block, When written, Then RIFF padding keeps the file parseable', () => {
    // exifBlockFrom pads its own data, so force an odd payload explicitly.
    const block = exifBlockFrom({ make: 'Cam' });
    const odd = block.length % 2 === 0 ? block.slice(0, block.length - 1) : block;

    const out = webp.writeExif(buildWebpLossy(), odd);

    expect(webpRiffSizeValid(out)).toBe(true);
    expect(webpChunkTypes(out)).toContain('VP8 ');
  });

  it('Given a WebP with no EXIF, When read, Then null is returned', () => {
    expect(webp.readExif(buildWebpLossy())).toBeNull();
  });

  it('Given non-WebP bytes, When written, Then it throws', () => {
    expect(() => webp.writeExif(buildPng(), exifBlockFrom({ make: 'Cam' }))).toThrow();
  });
});

describe('ISOBMFF container (AVIF / HEIC)', () => {
  const layouts = ['mdat-first', 'meta-first'] as const;

  // The layout decides whether item data sits after the meta box, and so
  // whether growing meta forces every offset in iloc to be patched.
  for (const layout of layouts) {
    describe(`${layout} layout`, () => {
      it('Given no EXIF item, When written, Then the block reads back', () => {
        const file = buildIsobmff({ brand: 'avif', layout });
        const block = exifBlockFrom({ make: 'Cam', model: 'Model' });

        const out = isobmff.writeExif(file, block);

        expect(isobmff.readExif(out)).toEqual(block);
        expect(isobmff.isIsobmff(out)).toBe(true);
      });

      it('Given an image item, When written, Then its data still resolves unchanged', () => {
        const file = buildIsobmff({ brand: 'avif', layout });
        const before = isobmffItemData(file, 1);

        const out = isobmff.writeExif(file, exifBlockFrom({ make: 'Cam' }));

        expect(before).not.toBeNull();
        expect(isobmffItemData(out, 1)).toEqual(before);
      });

      it('Given an EXIF item already present, When written, Then it is replaced not duplicated', () => {
        const file = buildIsobmff({ brand: 'heic', layout, exif: exifBlockFrom({ make: 'Old' }) });
        const replacement = exifBlockFrom({ make: 'New', model: 'Replacement' });

        const out = isobmff.writeExif(file, replacement);

        expect(isobmff.readExif(out)).toEqual(replacement);
        expect(isobmffItems(out).filter((item) => item.itemType === 'Exif')).toHaveLength(1);
      });
    });
  }

  it('Given a written file, When inspected, Then the EXIF item describes the primary item', () => {
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

  it('Given an EXIF item being replaced, When written, Then its stale reference is dropped', () => {
    const file = buildIsobmff({ brand: 'heic', exif: exifBlockFrom({ make: 'Old' }) });

    const out = isobmff.writeExif(file, exifBlockFrom({ make: 'New' }));

    expect(isobmffReferences(out).filter((reference) => reference.type === 'cdsc')).toHaveLength(1);
  });

  it('Given a written file, When inspected, Then the payload lands in a trailing mdat', () => {
    const file = buildIsobmff({ brand: 'avif', layout: 'meta-first' });

    const out = isobmff.writeExif(file, exifBlockFrom({ make: 'Cam' }));

    expect(isobmffBoxTypes(out)).toEqual(['ftyp', 'meta', 'mdat', 'mdat']);
    expect(isobmffMetaChildTypes(out)).toEqual(['hdlr', 'pitm', 'iinf', 'iref', 'iloc', 'iprp']);
  });

  it('Given a file with no meta box, When written, Then it throws', () => {
    const file = buildIsobmff({ brand: 'avif', omitMeta: true });

    expect(() => isobmff.writeExif(file, exifBlockFrom({ make: 'Cam' }))).toThrow();
  });

  it('Given non-ISOBMFF bytes, When written, Then it throws', () => {
    expect(() => isobmff.writeExif(buildPng(), exifBlockFrom({ make: 'Cam' }))).toThrow();
  });

  it('Given a meta child that cannot be walked, When written, Then it throws rather than dropping the boxes behind it', () => {
    const file = buildIsobmff({ brand: 'avif', unwalkableMetaChild: true });

    // Writing would otherwise return a file with no iprp, and so no decoder
    // configuration, while passing every check the writer makes.
    expect(() => isobmff.writeExif(file, exifBlockFrom({ make: 'Cam' }))).toThrow(/fully parsed/);
  });

  it('Given a meta child that cannot be walked, When read, Then the boxes ahead of it still resolve', () => {
    const block = exifBlockFrom({ make: 'Cam' });
    const file = buildIsobmff({ brand: 'heic', exif: block, unwalkableMetaChild: true });

    expect(isobmff.readExif(file)).toEqual(block);
    // iprp sits behind the box the walk gives up on, which is exactly what a
    // rewrite would have dropped.
    expect(isobmff.readDimensions(file)).toBeNull();
  });

  it('Given an oversized block, When written, Then it refuses rather than truncating', () => {
    const file = buildIsobmff({ brand: 'avif' });
    const huge = new Uint8Array(isobmff.MAX_EXIF_BYTES + 1);

    expect(() => isobmff.writeExif(file, huge)).toThrow();
  });

  it('Given a primary item, When dimensions are read, Then its ispe values are returned', () => {
    const file = buildIsobmff({ brand: 'avif', width: 321, height: 123 });

    expect(isobmff.readDimensions(file)).toEqual({ width: 321, height: 123 });
  });

  it('Given a quarter-turn irot, When dimensions are read, Then the axes are swapped', () => {
    // ispe describes the stored image; irot is applied on top of it.
    const file = buildIsobmff({ brand: 'avif', width: 321, height: 123, rotation: 1 });

    expect(isobmff.readDimensions(file)).toEqual({ width: 123, height: 321 });
  });

  it('Given a half-turn irot, When dimensions are read, Then the axes are unchanged', () => {
    const file = buildIsobmff({ brand: 'avif', width: 321, height: 123, rotation: 2 });

    expect(isobmff.readDimensions(file)).toEqual({ width: 321, height: 123 });
  });

  it('Given no property association, When dimensions are read, Then the first ispe is used', () => {
    const file = buildIsobmff({ brand: 'avif', width: 640, height: 480, omitPrimaryItem: true });

    expect(isobmff.readDimensions(file)).toEqual({ width: 640, height: 480 });
  });

  it('Given no properties at all, When dimensions are read, Then null is returned', () => {
    const file = buildIsobmff({ brand: 'avif', omitProperties: true });

    expect(isobmff.readDimensions(file)).toBeNull();
  });

  it('Given a written file, When dimensions are read, Then they are unaffected', () => {
    const file = buildIsobmff({ brand: 'avif', width: 200, height: 150, layout: 'meta-first' });

    const out = isobmff.writeExif(file, exifBlockFrom({ make: 'Cam' }));

    expect(isobmff.readDimensions(out)).toEqual({ width: 200, height: 150 });
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
 * Clears the 0xFF that introduces the segment just before the scan, so the
 * segment walk stops with the scan still ahead of it.
 */
function damageJpegBeforeScan(bytes: Uint8Array): Uint8Array {
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

/** Gives the chunk following IDAT a length that runs past the end of the file. */
function damagePngLengthAfterIdat(bytes: Uint8Array): Uint8Array {
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

/**
 * Everything from the SOS marker onward, i.e. the entropy-coded scan. Throws
 * rather than returning empty, so a fixture that has drifted out of spec fails
 * loudly instead of letting a comparison pass on two empty slices.
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

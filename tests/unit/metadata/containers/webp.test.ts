/** WebP-specific tests. The shared writer behaviour is in contract.test.ts. */

import { describe, it, expect } from 'vitest';

import { concat, EXIF_PREFIX } from '../../../../src/metadata/containers/bytes';
import * as webp from '../../../../src/metadata/containers/webp';
import { exifBlockFrom } from '../../../factories/exif';
import {
  buildWebpExtended,
  buildWebpLossless,
  buildWebpLossy,
  damageWebpImageChunk,
  removeWebpFinalPadding,
  webpChunkPayload,
  webpChunkTypes,
  webpRiffSizeValid,
  webpVp8xFlags,
} from '../../../factories/containers';

const FLAG_ICC = 0x20;
const FLAG_ALPHA = 0x10;
const FLAG_EXIF = 0x08;
const FLAG_XMP = 0x04;
const FLAG_ANIMATION = 0x02;

describe('WebP container', () => {
  it('Given a WebP payload that starts with "Exif\\0\\0", When read, Then the prefix is removed', () => {
    // Some encoders put the JPEG APP1 prefix in the chunk. The WebP specification does not.
    const block = exifBlockFrom({ make: 'Cam' });
    const prefixed = concat([Uint8Array.from(EXIF_PREFIX), block]);

    expect(webp.readExif(buildWebpExtended({ exif: prefixed }))).toEqual(block);
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

  // The writer copies every chunk to a new file, so the image data must not change.
  it('Given simple lossless WebP, When written, Then the image data is kept byte for byte', () => {
    const bytes = buildWebpLossless();
    const before = webpChunkPayload(bytes, 'VP8L');

    const out = webp.writeExif(bytes, exifBlockFrom({ make: 'Cam' }));

    expect(before).not.toBeNull();
    expect(webpChunkPayload(out, 'VP8L')).toEqual(before);
  });

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
});

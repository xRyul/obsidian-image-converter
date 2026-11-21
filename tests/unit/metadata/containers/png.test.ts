/** PNG-specific tests. The shared writer behaviour is in contract.test.ts. */

import { describe, it, expect } from 'vitest';

import { concat, EXIF_PREFIX } from '../../../../src/metadata/containers/bytes';
import * as png from '../../../../src/metadata/containers/png';
import { exifBlockFrom } from '../../../factories/exif';
import { buildPng, damagePngChunkAfterIdat, pngChunkCrcsValid, pngChunkTypes } from '../../../factories/containers';

describe('PNG container', () => {
  it('Given a PNG payload that starts with "Exif\\0\\0", When read, Then the prefix is removed', () => {
    // Some encoders put the JPEG APP1 prefix in the chunk. The PNG specification does not.
    const block = exifBlockFrom({ make: 'Cam' });
    const prefixed = concat([Uint8Array.from(EXIF_PREFIX), block]);

    expect(png.readExif(buildPng({ exif: prefixed }))).toEqual(block);
  });

  it('Given a PNG, When written, Then the CRCs stay valid', () => {
    const out = png.writeExif(buildPng(), exifBlockFrom({ make: 'Cam', model: 'Model' }));

    expect(pngChunkCrcsValid(out)).toBe(true);
  });

  it('Given a PNG, When written, Then eXIf is between IHDR and IDAT', () => {
    const out = png.writeExif(buildPng(), exifBlockFrom({ make: 'Cam' }));

    const types = pngChunkTypes(out);
    expect(types.indexOf('eXIf')).toBeGreaterThan(types.indexOf('IHDR'));
    expect(types.indexOf('eXIf')).toBeLessThan(types.indexOf('IDAT'));
  });

  it('Given a PNG with a damaged chunk after IDAT, When written, Then it throws instead of dropping IEND', () => {
    expect(() => png.writeExif(damagePngChunkAfterIdat(buildPng()), exifBlockFrom({ make: 'Cam' }))).toThrow();
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
});

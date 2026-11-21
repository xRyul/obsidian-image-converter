/** JPEG-specific tests. The shared writer behaviour is in contract.test.ts. */

import { describe, it, expect } from 'vitest';

import * as jpeg from '../../../../src/metadata/containers/jpeg';
import { exifBlockFrom } from '../../../factories/exif';
import { buildJpeg, damageJpegScanMarker } from '../../../factories/containers';

describe('JPEG container', () => {
  it('Given a JFIF JPEG, When written, Then APP0 still directly follows SOI', () => {
    const out = jpeg.writeExif(buildJpeg(), exifBlockFrom({ make: 'Cam' }));

    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8);
    expect(out[2]).toBe(0xff);
    expect(out[3]).toBe(0xe0); // APP0
  });

  it('Given an oversized block, When written, Then it throws instead of truncating', () => {
    const huge = new Uint8Array(jpeg.MAX_EXIF_BYTES + 1);

    expect(() => jpeg.writeExif(buildJpeg(), huge)).toThrow();
  });

  it('Given a JPEG with a damaged marker before the scan, When written, Then it throws instead of dropping the image data', () => {
    expect(() => jpeg.writeExif(damageJpegScanMarker(buildJpeg()), exifBlockFrom({ make: 'Cam' }))).toThrow();
  });

  it('Given a JPEG with a damaged marker before the scan, When read, Then the segments before it are still read', () => {
    const bytes = buildJpeg({ width: 321, height: 123 });

    // SOF0 comes before the damaged marker and holds the image size.
    expect(jpeg.readDimensions(damageJpegScanMarker(bytes))).toEqual({ width: 321, height: 123 });
  });
});

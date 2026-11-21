/** HEIC / AVIF-specific tests. The shared writer behaviour is in contract.test.ts. */

import { describe, it, expect } from 'vitest';

import * as isobmff from '../../../../src/metadata/containers/isobmff';
import { exifBlockFrom } from '../../../factories/exif';
import {
  buildIsobmff,
  isobmffBoxTypes,
  isobmffItems,
  isobmffMetaChildTypes,
  isobmffReferences,
} from '../../../factories/containers';

describe('ISOBMFF container (HEIC / AVIF)', () => {
  it('Given a non-zero TIFF header offset, When read, Then the padding is skipped', () => {
    const block = exifBlockFrom({ make: 'Phone' });

    expect(isobmff.readExif(buildIsobmff({ exif: block, tiffHeaderOffset: 6 }))).toEqual(block);
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

  it('Given an ftyp with no supported brand, When matched, Then it is rejected', () => {
    expect(isobmff.matches(buildIsobmff({ brand: 'qt  ', compatibleBrands: ['qt  '] }))).toBe(false);
  });

  it('Given a HEIF brand only in the compatible list, When matched, Then it is accepted', () => {
    // The major brand can be a brand that is not HEIF. The reader must also
    // look at the compatible brands.
    const file = buildIsobmff({ brand: 'mp42', compatibleBrands: ['mp42', 'heic'] });

    expect(isobmff.matches(file)).toBe(true);
  });

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

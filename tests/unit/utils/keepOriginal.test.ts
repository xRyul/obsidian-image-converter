/**
 * Unit tests for the rules that keep the original image in place of the
 * converted one.
 */

import { describe, it, expect } from 'vitest';

import {
  getRevertPolicy,
  getSelectedConversionPreset,
  isInOutputFormat,
  reasonToKeepOriginal,
} from '../../../src/utils/keepOriginal';
import type { ConversionPreset } from '../../../src/ImageConverterSettings';
import { buildIsobmff } from '../../factories/containers';
import { makeImageBytesOfSize, makeJpegBytes, makePngBytes, makeWebpBytes } from '../../factories/image';

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function makePreset(overrides: Partial<ConversionPreset> = {}): ConversionPreset {
  return {
    name: 'Preset',
    outputFormat: 'WEBP',
    quality: 75,
    colorDepth: 1,
    resizeMode: 'None',
    desiredWidth: 0,
    desiredHeight: 0,
    desiredLongestEdge: 0,
    enlargeOrReduce: 'Auto',
    allowLargerFiles: false,
    skipConversionPatterns: '',
    ...overrides,
  };
}

const images = {
  png: () => makePngBytes(),
  jpeg: () => makeJpegBytes(),
  webp: () => makeWebpBytes(),
  avif: () => toArrayBuffer(buildIsobmff({ brand: 'avif' })),
  heic: () => toArrayBuffer(buildIsobmff({ brand: 'heic' })),
  svg: () => toArrayBuffer(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')),
  empty: () => new ArrayBuffer(0),
} as const;

describe('isInOutputFormat', () => {
  it.each([
    // [requested format, image, expected]
    ['WEBP', 'webp', true],
    ['WEBP', 'png', false],
    ['WEBP', 'jpeg', false],
    ['WEBP', 'svg', false],
    ['WEBP', 'empty', false],
    ['JPEG', 'jpeg', true],
    ['JPEG', 'png', false],
    ['PNG', 'png', true],
    ['PNG', 'webp', false],
    ['PNGQUANT', 'png', true],
    ['PNGQUANT', 'jpeg', false],
    ['AVIF', 'avif', true],
    ['AVIF', 'heic', false],
    ['AVIF', 'png', false],
  ] as const)('Given %s is requested and the image is %s, Then the result is %s', (format, image, expected) => {
    expect(isInOutputFormat(images[image](), format)).toBe(expected);
  });

  it.each(['ORIGINAL', 'NONE'] as const)('Given %s, which requests no format, Then every image passes', (format) => {
    expect(isInOutputFormat(images.png(), format)).toBe(true);
    expect(isInOutputFormat(images.svg(), format)).toBe(true);
  });

  it('Given a format that the plugin does not know, Then the image does not pass', () => {
    expect(isInOutputFormat(images.png(), 'JPG' as never)).toBe(false);
  });

  it('Given an AVIF brand only in the compatible list, Then the image passes as AVIF', () => {
    const image = toArrayBuffer(buildIsobmff({ brand: 'mif1', compatibleBrands: ['mif1', 'avif'] }));

    expect(isInOutputFormat(image, 'AVIF')).toBe(true);
  });
});

describe('getRevertPolicy', () => {
  const settings = { revertToOriginalIfLarger: false, minimumCompressionSavingsInKB: 30 };

  it('Given a preset with its own values, Then the preset wins over the plugin settings', () => {
    const preset = makePreset({ revertToOriginalIfLarger: true, minimumCompressionSavingsInKB: 5 });

    expect(getRevertPolicy(settings, preset)).toEqual({ revertIfLarger: true, minSavingsKB: 5 });
  });

  it('Given a preset that switches the revert off, Then the plugin setting does not switch it on', () => {
    const preset = makePreset({ revertToOriginalIfLarger: false });

    expect(getRevertPolicy({ ...settings, revertToOriginalIfLarger: true }, preset).revertIfLarger).toBe(false);
  });

  it('Given a preset saved before it had these values, Then the plugin settings are used', () => {
    const policy = getRevertPolicy({ revertToOriginalIfLarger: true, minimumCompressionSavingsInKB: 12 }, makePreset());

    expect(policy).toEqual({ revertIfLarger: true, minSavingsKB: 12 });
  });

  it('Given no preset, Then the plugin settings are used', () => {
    expect(getRevertPolicy(settings)).toEqual({ revertIfLarger: false, minSavingsKB: 30 });
  });

  it.each([-1, Number.NaN, '10' as unknown as number])('Given the minimum savings value %s, Then 30 KB is used', (value) => {
    const preset = makePreset({ minimumCompressionSavingsInKB: value });

    expect(getRevertPolicy(settings, preset).minSavingsKB).toBe(30);
  });

  it('Given a minimum of 0 KB, Then 0 is kept', () => {
    expect(getRevertPolicy(settings, makePreset({ minimumCompressionSavingsInKB: 0 })).minSavingsKB).toBe(0);
  });
});

describe('getSelectedConversionPreset', () => {
  const presets = [makePreset({ name: 'First' }), makePreset({ name: 'Second' })];

  it('Given the name of a preset, Then that preset is returned', () => {
    expect(getSelectedConversionPreset({ conversionPresets: presets, selectedConversionPreset: 'Second' })).toBe(presets[1]);
  });

  it('Given a name with no preset, Then there is no preset, not the first one', () => {
    expect(getSelectedConversionPreset({ conversionPresets: presets, selectedConversionPreset: 'Deleted' })).toBeUndefined();
  });
});

describe('reasonToKeepOriginal', () => {
  const revertOff = { revertIfLarger: false, minSavingsKB: 30 };
  const revertOn = { revertIfLarger: true, minSavingsKB: 0 };

  it('Given a converted image in the requested format and revert off, Then the converted image is used', () => {
    // The converted image is larger than the 100-byte original.
    expect(reasonToKeepOriginal(100, makeImageBytesOfSize('WEBP', 5000), 'WEBP', revertOff)).toBeNull();
  });

  it('Given an image that is not in the requested format, Then the original is kept as not converted', () => {
    expect(reasonToKeepOriginal(100, makeImageBytesOfSize('PNG', 50), 'WEBP', revertOff)).toBe('notConverted');
  });

  it('Given an image that is not in the requested format and too small a saving, Then "not converted" is the reason', () => {
    expect(reasonToKeepOriginal(100, makeImageBytesOfSize('PNG', 5000), 'WEBP', revertOn)).toBe('notConverted');
  });

  it.each([
    // [original size, converted size, minimum savings in KB, expected]
    [1000, 1001, 0, 'smallSaving'],
    [1000, 1000, 0, null],
    [1000, 999, 0, null],
    [40 * 1024, 11 * 1024, 30, 'smallSaving'],
    [40 * 1024, 10 * 1024, 30, null],
  ] as const)('Given revert on, an original of %i bytes, a converted image of %i bytes and a minimum of %i KB, Then the reason is %s', (originalSize, convertedSize, minSavingsKB, expected) => {
    const converted = makeImageBytesOfSize('WEBP', convertedSize);

    expect(reasonToKeepOriginal(originalSize, converted, 'WEBP', { revertIfLarger: true, minSavingsKB })).toBe(expected);
  });

  it('Given "Original" as the format and revert on, Then only the saving decides', () => {
    expect(reasonToKeepOriginal(1000, new ArrayBuffer(2000), 'ORIGINAL', revertOn)).toBe('smallSaving');
    expect(reasonToKeepOriginal(1000, new ArrayBuffer(500), 'ORIGINAL', revertOn)).toBeNull();
  });
});

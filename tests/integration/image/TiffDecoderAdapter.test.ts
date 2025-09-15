/**
 * Integration-lite tests for TIFF decoder adapter
 * Covers TEST_CHECKLIST.md item 1.39
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mocks before imports
vi.mock('child_process');

import { ImageProcessor } from '../../../src/ImageProcessor';
import { SupportedImageFormats } from '../../../src/SupportedImageFormats';
import { makeImageBlob } from '../../factories/image';
import { fakeApp } from '../../factories/obsidian';

describe('Integration-lite: TiffDecoderAdapter', () => {
  let processor: ImageProcessor;
  let supportedFormats: SupportedImageFormats;

  beforeEach(() => {
    const app = fakeApp() as any;
    supportedFormats = new SupportedImageFormats(app);
    processor = new ImageProcessor(supportedFormats);
  });

  it('1.39 [I] TIFF decoding: calls handler and passes through pipeline', async () => {
    // Arrange - TIFF-like header (II*)
    const tiffBytes = new ArrayBuffer(8);
    const view = new Uint8Array(tiffBytes);
    view[0] = 0x49; view[1] = 0x49; view[2] = 0x2A; view[3] = 0x00;
    const tiffBlob = makeImageBlob(tiffBytes, 'image/tiff');

    // Spy and stub handleTiff to avoid dynamic import
    const outPng = new Blob([new Uint8Array([5, 5, 5])], { type: 'image/png' });
    const spy = vi.spyOn<any, any>(processor as any, 'handleTiff').mockResolvedValue(outPng);

    // Act
    const result = await processor.processImage(
      tiffBlob,
      'PNG',
      1.0,
      1.0,
      'None',
      0, 0, 0,
      'Auto',
      true
    );

    // Assert
    expect(spy).toHaveBeenCalled();
    expect(new Uint8Array(result).byteLength).toBeGreaterThan(0);
  });

  it('1.39 [I] TIFF failure: on error returns original bytes', async () => {
    // Arrange
    const tiffBytes = new ArrayBuffer(8);
    const view = new Uint8Array(tiffBytes);
    view[0] = 0x49; view[1] = 0x49; view[2] = 0x2A; view[3] = 0x00;
    const tiffBlob = makeImageBlob(tiffBytes, 'image/tiff');

    const spy = vi.spyOn<any, any>(processor as any, 'handleTiff').mockRejectedValue(new Error('decode fail'));

    // Act
    const result = await processor.processImage(
      tiffBlob,
      'PNG',
      1.0,
      1.0,
      'None',
      0, 0, 0,
      'Auto',
      true
    );

    // Assert - original returned
    expect(new Uint8Array(result).byteLength).toBe(tiffBytes.byteLength);
    expect(spy).toHaveBeenCalled();
  });
});
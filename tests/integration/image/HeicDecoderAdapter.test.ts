/**
 * Integration-lite tests for HEIC decoder adapter
 * Covers TEST_CHECKLIST.md item 1.38
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mocks before imports
vi.mock('child_process');

import { ImageProcessor } from '@/ImageProcessor';
import { SupportedImageFormats } from '@/SupportedImageFormats';
import { makeImageBlob } from '../../factories/image';

describe('Integration-lite: HeicDecoderAdapter', () => {
  let processor: ImageProcessor;
  let supportedFormats: SupportedImageFormats;

  beforeEach(() => {
    supportedFormats = new SupportedImageFormats();
    processor = new ImageProcessor(supportedFormats);
  });

  it('1.38 [I] HEIC decoding: calls handler and passes through pipeline', async () => {
    // Arrange - HEIC-like header
    const heicHeader = new Uint8Array([
      0x00, 0x00, 0x00, 0x20,
      0x66, 0x74, 0x79, 0x70,
      0x68, 0x65, 0x69, 0x63
    ]);
    const heicBlob = makeImageBlob(heicHeader.buffer, 'image/heic');

    // Spy and stub handleHeic to avoid dynamic import
    const outPng = new Blob([new Uint8Array([9, 9, 9])], { type: 'image/png' });
    const spy = vi.spyOn<any, any>(processor as any, 'handleHeic').mockResolvedValue(outPng);

    // Act - convert to JPEG target (quality applies when JPEG)
    const result = await processor.processImage(
      heicBlob,
      'JPEG',
      0.85,
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
});
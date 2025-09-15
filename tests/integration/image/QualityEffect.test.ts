/**
 * Integration-lite: Quality effect determinism on size (1.41)
 * For a known fixture, lower quality yields smaller or equal output.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ImageProcessor } from '../../../src/ImageProcessor';
import { SupportedImageFormats } from '../../../src/SupportedImageFormats';
import { makePngBytes, makeImageBlob } from '../../factories/image';
import { fakeCanvas } from '../../factories/canvas';
import { fakeApp } from '../../factories/obsidian';

describe('Integration-lite: Quality Effect (1.41)', () => {
  let processor: ImageProcessor;
  let supportedFormats: SupportedImageFormats;

  beforeEach(() => {
    const app = fakeApp() as any;
    supportedFormats = new SupportedImageFormats(app);
    processor = new ImageProcessor(supportedFormats);
  });

  it('Given a fixed input, When quality is reduced, Then output size is smaller or equal (WEBP)', async () => {
    // Arrange: fixed PNG input as the fixture
    // eslint-disable-next-line id-length
    const inputBytes = makePngBytes({ w: 80, h: 80, alpha: true });
    const inputBlob = makeImageBlob(inputBytes, 'image/png');

    // Mock compressOriginalImage to return a large buffer so it won't be selected
    vi.spyOn(processor as any, 'compressOriginalImage').mockResolvedValue(new ArrayBuffer(10000));

    // Build a canvas whose toBlob output depends on quality (higher q => bigger)
    const dynamicCanvas = fakeCanvas({
      toBlob: vi.fn((callback: (b: Blob|null) => void, type?: string, quality?: number) => {
        const base = 500; // base size
        const size = base + Math.round((quality ?? 1) * 500); // quality in [0,1] => size in [500,1000]
        const buf = new ArrayBuffer(size);
        callback(new Blob([buf], { type: type || 'image/webp' }));
      }),
      toDataURL: vi.fn((type?: string, quality?: number) => {
        // dataURL yields larger size to ensure toBlob path is chosen
        const buf = new ArrayBuffer(2000);
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        return `data:${type || 'image/webp'};base64,${base64}`;
      })
    });

    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: any) => {
      if (tag === 'canvas') return dynamicCanvas as any;
      return realCreateElement(tag);
    });

    // Act: high q vs low q
    const highQuality = await processor.processImage(
      inputBlob, 'WEBP', 0.9, 1.0, 'None', 0, 0, 0, 'Auto', true
    );
    const lowQuality = await processor.processImage(
      inputBlob, 'WEBP', 0.5, 1.0, 'None', 0, 0, 0, 'Auto', true
    );

    // Assert: low quality should be smaller or equal
    expect(lowQuality.byteLength).toBeLessThanOrEqual(highQuality.byteLength);
  });
});
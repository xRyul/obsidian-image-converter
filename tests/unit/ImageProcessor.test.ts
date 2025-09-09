/**
 * ImageProcessor unit tests
 *
 * Coverage mapping to memory-bank/TEST_CHECKLIST.md:
 * - 1.5 NONE format pass-through — Verify that format=NONE with resize=None returns original bytes unchanged
 * - 1.4 ORIGINAL format compression (no resize) — Verify that format=ORIGINAL with resize=None returns PNG bytes
 */
import { describe, it, expect, vi } from 'vitest';
import { ImageProcessor } from '../../src/ImageProcessor';
import { SupportedImageFormats } from '../../src/SupportedImageFormats';
import { App } from 'obsidian';
import { anImage } from '../helpers/test-builders';
import { expectImageFormat } from '../helpers/assertions';
import { Buffer } from 'node:buffer';

// Helper to ensure BlobPart gets a real ArrayBuffer (not SharedArrayBuffer-compatible type)
function toStrictArrayBuffer(u8: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(u8.byteLength);
  new Uint8Array(ab).set(u8);
  return ab;
}

// 1.5 NONE format pass-through
// Given format NONE and no resize, When processing an image, Then it returns original bytes unchanged
describe('ImageProcessor — [1.5] Given NONE format, When not resizing, Then pass through', () => {
  it('[1.5] Given PNG blob, When processing with format=NONE and resize=None, Then returns identical bytes', async () => {
    // Arrange
    const supported = new SupportedImageFormats(new App());
    const processor = new ImageProcessor(supported);
    const inputBytes = anImage().withFormat('png').withSize(256).build();
    const inputAb = toStrictArrayBuffer(inputBytes);
    const inputBlob = new Blob([inputAb], { type: 'image/png' });

    // Act
    const out = await processor.processImage(
      inputBlob,
      'NONE',      // format
      1,           // quality (unused for NONE)
      1,           // colorDepth (unused for NONE)
      'None',      // resizeMode
      0,           // desiredWidth
      0,           // desiredHeight
      0,           // desiredLongestEdge
      'Auto',      // enlargeOrReduce
      false        // allowLargerFiles
      // preset, settings omitted
    );

    // Assert
    const outBytes = new Uint8Array(out);
    expect(outBytes).toEqual(inputBytes);
  });
});

// 1.4 ORIGINAL format compression (no resize)
// Given format ORIGINAL and no resize, When processing a PNG image, Then it returns PNG bytes (compressed in original format)
describe('ImageProcessor — [1.4] Given ORIGINAL format, When not resizing, Then compress in-place as original format', () => {
  it('[1.4] Given PNG blob, When processing with format=ORIGINAL and resize=None, Then returns PNG bytes', async () => {
    // Arrange
    const ORIGINAL_IMAGE = (globalThis as any).Image;
    // Create a deterministic expected PNG (1x1)
    const EXPECTED_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2C4L0AAAAASUVORK5CYII=';
    const expectedBytes = new Uint8Array(Buffer.from(EXPECTED_BASE64, 'base64'));

    class FakeImage {
      naturalWidth = 2;
      naturalHeight = 2;
      onload: (() => void) | null = null;
      onerror: ((e: any) => void) | null = null;
      set src(_v: string) {
        // Trigger load synchronously to avoid timer dependencies
        this.onload && this.onload();
      }
    }
    (globalThis as any).Image = FakeImage as any;

    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype as any, 'getContext')
      .mockReturnValue({ drawImage: vi.fn() } as any);

    const toBlobSpy = vi
      .spyOn(HTMLCanvasElement.prototype as any, 'toBlob')
      .mockImplementation((cb: any, type?: any) => {
        const expectedAb = toStrictArrayBuffer(expectedBytes);
        const blob = new Blob([expectedAb], { type: type || 'image/png' });
        cb(blob);
      });

    const supported = new SupportedImageFormats(new App());
    const processor = new ImageProcessor(supported);

    // Minimal valid PNG as input blob as well
    const inputBase64 = EXPECTED_BASE64;
    const inputBytes = new Uint8Array(Buffer.from(inputBase64, 'base64'));
    const inputAb2 = toStrictArrayBuffer(inputBytes);
    const inputBlob = new Blob([inputAb2], { type: 'image/png' });

    try {
      // Act
      const out = await processor.processImage(
        inputBlob,
        'ORIGINAL', // format
        1,          // quality
        1,          // colorDepth (unused)
        'None',     // resizeMode
        0,
        0,
        0,
        'Auto',
        false
      );

      // Assert
      const outBytes = new Uint8Array(out);
      expect(outBytes).toEqual(expectedBytes);
      expectImageFormat(outBytes, 'png');
    } finally {
      // Cleanup mocks/stubs
      toBlobSpy.mockRestore();
      getContextSpy.mockRestore();
      (globalThis as any).Image = ORIGINAL_IMAGE;
    }
  });
});


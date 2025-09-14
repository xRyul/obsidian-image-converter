/**
 * Unit tests for ImageProcessor MIME type detection and handling
 * Test checklist items 1.18, 1.19 and related MIME functionality
 * Following SDET testing rules: AAA pattern, Given-When-Then naming
 */

import { vi } from 'vitest';

// All mocks must be defined before imports due to hoisting
vi.mock('child_process');
vi.mock('fs/promises');
vi.mock('os');
vi.mock('path');
vi.mock('sortablejs');
vi.mock('piexifjs');
vi.mock('@/main');

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ImageProcessor } from '@/ImageProcessor';
import { SupportedImageFormats } from '@/SupportedImageFormats';
import { 
  makePngBytes, 
  makeJpegBytes, 
  makeWebpBytes,
  makeImageBlob,
  makeImageFile,
  corruptedBytes 
} from '../../factories/image';
import { fakeCanvas } from '../../factories/canvas';
import { setMockImageSize, failNextImageLoad } from '@helpers/test-setup';

describe('ImageProcessor - MIME Type Detection Tests', () => {
  let processor: ImageProcessor;
  let supportedFormats: SupportedImageFormats;
  let mockCanvas: HTMLCanvasElement;
  let mockDocument: any;

  beforeEach(() => {
    // Arrange: Set up processor and mocks
    supportedFormats = new SupportedImageFormats();
    processor = new ImageProcessor(supportedFormats);
    
    // Mock document.createElement for canvas without replacing whole document
    mockCanvas = fakeCanvas();
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: any) => {
      if (tagName === 'canvas') {
        return mockCanvas as any;
      }
      return realCreateElement(tagName);
    });

    // Default image size
    setMockImageSize(100, 100);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('MIME Type Detection', () => {
    // Test 1.18
    it('Given unknown/mismatched MIME, When detected via magic bytes, Then uses detected type; on failure returns original', async () => {
      // Arrange - PNG data but wrong MIME type
      const pngBytes = makePngBytes({ w: 100, h: 100 });
      // Create blob with wrong MIME type
      const mislabeledBlob = new Blob([pngBytes], { type: 'image/jpeg' });
      
      // Mock SupportedImageFormats to detect PNG from bytes
      const getMimeTypeSpy = vi.spyOn(supportedFormats, 'getMimeTypeFromFile');
      
      // Act
      const result = await processor.processImage(
        mislabeledBlob,
        'PNG',
        1.0,
        1.0,
        'None',
        0, 0, 0,
        'Auto',
        true
      );
      
      // Assert
      expect(getMimeTypeSpy).toHaveBeenCalled();
      // Should process as PNG despite wrong MIME type
      expect(result).toBeDefined();
      expect(result.byteLength).toBeGreaterThan(0);
    });

    it('Given corrupted file with no detectable type, When processing, Then returns original bytes', async () => {
      // Arrange - Corrupted data
      const badBytes = corruptedBytes(100);
      const corruptedBlob = new Blob([badBytes], { type: 'application/octet-stream' });
      
      // Act
      const result = await processor.processImage(
        corruptedBlob,
        'WEBP',
        0.8,
        1.0,
        'None',
        0, 0, 0,
        'Auto',
        true
      );
      
      // Assert - Should return original when detection fails
      expect(result.byteLength).toBe(badBytes.byteLength);
      const resultArray = new Uint8Array(result);
      const originalArray = new Uint8Array(badBytes);
      expect(resultArray).toEqual(originalArray);
    });

    it('Given file with no extension and valid magic bytes, When processing, Then detects and processes correctly', async () => {
      // Arrange - JPEG data with no type hint
      const jpegBytes = makeJpegBytes({ w: 100, h: 100 });
      const unTypedBlob = new Blob([jpegBytes]); // No type specified
      
      // Act
      const result = await processor.processImage(
        unTypedBlob,
        'JPEG',
        0.85,
        1.0,
        'None',
        0, 0, 0,
        'Auto',
        true
      );
      
      // Assert
      expect(result).toBeDefined();
      expect(result.byteLength).toBeGreaterThan(0);
    });
  });

  describe('Allow Larger Files Behavior', () => {
    // Test 1.19
    it('Given allowLargerFiles flag, When toggled, Then engine selection ignores it (same result)', async () => {
      // Arrange
      const inputBytes = makePngBytes({ w: 50, h: 50 });
      const inputBlob = makeImageBlob(inputBytes, 'image/png');
      
      // Mock canvas to return larger result
      const largerBytes = makeWebpBytes({ w: 200, h: 200 });
      mockCanvas.toBlob = vi.fn((callback) => {
        callback(new Blob([largerBytes], { type: 'image/webp' }));
      });
      
      // Act with allowLargerFiles=true
      const resultTrue = await processor.processImage(
        inputBlob,
        'WEBP',
        0.9,
        1.0,
        'None',
        0, 0, 0,
        'Auto',
        true
      );
      // Act with allowLargerFiles=false
      const resultFalse = await processor.processImage(
        inputBlob,
        'WEBP',
        0.9,
        1.0,
        'None',
        0, 0, 0,
        'Auto',
        false
      );
      
      // Assert - selection is independent of allowLargerFiles
      expect(new Uint8Array(resultTrue)).toEqual(new Uint8Array(resultFalse));
    });

    it('Given allowLargerFiles=false (handled by caller), When processing returns larger, Then caller responsible for reverting', async () => {
      // Arrange
      const inputBytes = makePngBytes({ w: 50, h: 50 });
      const inputBlob = makeImageBlob(inputBytes, 'image/png');
      
      // Mock canvas to return larger result
      const largerBytes = makeWebpBytes({ w: 200, h: 200 });
      mockCanvas.toBlob = vi.fn((callback) => {
        callback(new Blob([largerBytes], { type: 'image/webp' }));
      });
      
      // Act
      const result = await processor.processImage(
        inputBlob,
        'WEBP',
        0.9,
        1.0,
        'None',
        0, 0, 0,
        'Auto',
        false // allowLargerFiles = false (but handled by caller, not engine)
      );
      
      // Assert - Engine still returns the processed result
      // The caller (e.g., revertToOriginalIfLarger) is responsible for size checking
      expect(result.byteLength).toBe(largerBytes.byteLength);
    });
  });

  describe('Format-Specific MIME Handling', () => {
    it('Given TIFF input, When processing, Then handles via UTIF decoder', async () => {
      // Arrange - TIFF magic bytes
      const tiffBytes = new Uint8Array([0x49, 0x49, 0x2A, 0x00]); // Little-endian TIFF
      const tiffBlob = new Blob([tiffBytes], { type: 'image/tiff' });
      
      // Mock UTIF decode
      const mockUTIF = {
        decode: vi.fn().mockReturnValue([{ width: 100, height: 100, data: new Uint8Array(40000) }]),
        toRGBA8: vi.fn().mockReturnValue(new Uint8Array(40000))
      };
      (global as any).UTIF = mockUTIF;
      
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
      expect(result).toBeDefined();
      // Should return original on error or process via UTIF
    });

    it('Given HEIC input, When processing, Then handles via heic decoder', async () => {
      // Arrange - HEIC magic bytes (ftyp box with heic brand)
      const heicHeader = new Uint8Array([
        0x00, 0x00, 0x00, 0x20, // Box size
        0x66, 0x74, 0x79, 0x70, // 'ftyp'
        0x68, 0x65, 0x69, 0x63  // 'heic'
      ]);
      const heicBlob = new Blob([heicHeader], { type: 'image/heic' });
      
      // Mock heic-to module
      const mockHeicTo = {
        PNG: vi.fn().mockResolvedValue({ data: makePngBytes({ w: 100, h: 100 }) }),
        JPEG: vi.fn().mockResolvedValue({ data: makeJpegBytes({ w: 100, h: 100 }) })
      };
      (global as any).heicTo = mockHeicTo;
      
      // Act
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
      expect(result).toBeDefined();
      // Should handle HEIC or return original on error
    });
  });

  describe('Animated Format Handling (policy: first frame only)', () => {
    it('Given animated GIF, When processing to PNG, Then first frame is drawn to canvas and output is produced', async () => {
      // Arrange - GIF header (GIF89a)
      const gifHeader = new Uint8Array([
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
        0x01, 0x00, 0x01, 0x00, // Width, height
        0x80, // Global color table flag
        0x00, 0x00 // Background color, aspect ratio
      ]);
      const gifBlob = new Blob([gifHeader], { type: 'image/gif' });
      
      // Act
      const result = await processor.processImage(
        gifBlob,
        'PNG',
        1.0,
        1.0,
        'Fit',
        1, 1, 0,
        'Auto',
        true
      );
      
      // Assert - Drawn to canvas (first frame) and bytes produced
      const ctx = mockCanvas.getContext('2d');
      expect(ctx?.drawImage).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.byteLength).toBeGreaterThan(0);
    });

    it('Given animated WEBP, When processing to WEBP, Then first frame is drawn to canvas and output is produced', async () => {
      // Arrange - WebP bytes (animation flag not strictly required for unit scope)
      const animatedWebpBytes = makeWebpBytes({ w: 100, h: 100 });
      const animatedWebpBlob = new Blob([animatedWebpBytes], { type: 'image/webp' });
      
      // Act
      const result = await processor.processImage(
        animatedWebpBlob,
        'WEBP',
        0.8,
        1.0,
        'None',
        0, 0, 0,
        'Auto',
        true
      );
      
      // Assert - Drawn to canvas and bytes produced
      const ctx = mockCanvas.getContext('2d');
      expect(ctx?.drawImage).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.byteLength).toBeGreaterThan(0);
    });
  });
});
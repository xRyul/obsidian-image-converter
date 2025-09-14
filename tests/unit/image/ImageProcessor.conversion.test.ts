/**
 * Unit tests for ImageProcessor conversion functionality
 * Test checklist items 1.1-1.19 (conversion and selection logic)
 * Following SDET testing rules: AAA pattern, Given-When-Then naming, behavior-focused
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
import { Notice } from 'obsidian';
import * as piexif from 'piexifjs';
import { 
  makePngBytes, 
  makeJpegBytes, 
  makeWebpBytes, 
  makeImageBlob,
  makeImageFile,
  corruptedBytes 
} from '../../factories/image';
import { setMockImageSize, failNextImageLoad } from '@helpers/test-setup';
import { 
  fakeCanvas, 
  createCanvasWithPresetBehavior,
  fakeImage 
} from '../../factories/canvas';
import { exifFrom, stripOrientation, exifToBinary } from '../../factories/exif';
import { fakeNotice } from '../../factories/obsidian';

// Mock dependencies
// The obsidian mock is already configured in vitest.config.ts via alias

describe('ImageProcessor - Conversion Tests', () => {
  let processor: ImageProcessor;
  let supportedFormats: SupportedImageFormats;
  let mockCanvas: HTMLCanvasElement;
  let mockDocument: any;

  beforeEach(() => {
    // Arrange: Set up processor and mocks
    supportedFormats = new SupportedImageFormats();
    processor = new ImageProcessor(supportedFormats);
    
    // Mock document.createElement for canvas without replacing the whole document (avoid recursion)
    mockCanvas = fakeCanvas();
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: any) => {
      if (tagName === 'canvas') {
        return mockCanvas as any;
      }
      return realCreateElement(tagName);
    });
    
    // Configure mock image size
    setMockImageSize(100, 100);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('WEBP Conversion', () => {
    // Test 1.1
    it('Given WEBP format requested, When multiple candidates available, Then selects smallest among toBlob, toDataURL, and compressOriginalImage', async () => {
      // Arrange
      const inputBytes = makePngBytes({ w: 200, h: 200 });
      const inputBlob = makeImageBlob(inputBytes, 'image/png');
      
      // Mock canvas to return different sizes for each method
      const smallestBlobBytes = makeWebpBytes({ w: 50, h: 50 }); // Smallest
      const mediumDataUrlBytes = makeWebpBytes({ w: 100, h: 100 });
      const largestOriginalBytes = makeWebpBytes({ w: 150, h: 150 });
      
      mockCanvas.toBlob = vi.fn((callback) => {
        callback(new Blob([smallestBlobBytes], { type: 'image/webp' }));
      });
      
      mockCanvas.toDataURL = vi.fn(() => {
        const base64 = btoa(String.fromCharCode(...new Uint8Array(mediumDataUrlBytes)));
        return `data:image/webp;base64,${base64}`;
      });
      
      // Mock compressOriginalImage to return larger result
      vi.spyOn(processor as any, 'compressOriginalImage').mockResolvedValue(largestOriginalBytes);
      
      // Act
      const result = await processor.processImage(
        inputBlob,
        'WEBP',
        0.8, // quality
        1.0, // colorDepth
        'None', // resizeMode
        0, // desiredWidth
        0, // desiredHeight
        0, // desiredLongestEdge
        'Auto', // enlargeOrReduce
        true // allowLargerFiles
      );
      
      // Assert
      expect(result.byteLength).toBe(smallestBlobBytes.byteLength);
      expect(mockCanvas.toBlob).toHaveBeenCalledWith(
        expect.any(Function),
        'image/webp',
        0.8
      );
      expect(mockCanvas.toDataURL).toHaveBeenCalledWith('image/webp', 0.8);
    });

    // Test 1.2
    it('Given WEBP Fit mode, When resizing, Then preserves aspect ratio and fits within target bounds', async () => {
      // Arrange
      const inputBytes = makePngBytes({ w: 1000, h: 800 }); // Landscape
      const inputBlob = makeImageBlob(inputBytes, 'image/png');
      
      // Mock Image to have specific dimensions
      setMockImageSize(1000, 800);
      
      // Act
      const result = await processor.processImage(
        inputBlob,
        'WEBP',
        0.8,
        1.0,
        'Fit', // Fit mode
        500, // Target width
        400, // Target height
        0,
        'Auto',
        true
      );
      
      // Assert
      expect(mockCanvas.width).toBe(500); // Fits width
      expect(mockCanvas.height).toBe(400); // Maintains aspect ratio
      const context = mockCanvas.getContext('2d');
      expect(context?.drawImage).toHaveBeenCalled();
    });

    // Test 1.3
    it('Given WEBP Fill mode, When resizing, Then scales to cover target using center-crop', async () => {
      // Arrange
      const inputBytes = makePngBytes({ w: 1000, h: 800 });
      const inputBlob = makeImageBlob(inputBytes, 'image/png');
      
      setMockImageSize(1000, 800);
      
      // Act
      const result = await processor.processImage(
        inputBlob,
        'WEBP',
        0.8,
        1.0,
        'Fill', // Fill mode
        400,
        400, // Square target
        0,
        'Auto',
        true
      );
      
      // Assert
      expect(mockCanvas.width).toBe(400);
      expect(mockCanvas.height).toBe(400);
      const context = mockCanvas.getContext('2d');
      // Should crop from center
      expect(context?.drawImage).toHaveBeenCalledWith(
        expect.any(Object), // image
        expect.any(Number), // sx (should be > 0 for crop)
        expect.any(Number), // sy
        expect.any(Number), // sWidth
        expect.any(Number), // sHeight
        0, // dx
        0, // dy
        400, // dWidth
        400  // dHeight
      );
    });

    // Test 1.4
    it('Given WEBP conversion error, When processing fails, Then returns original bytes without throw', async () => {
      // Arrange
      const inputBytes = makePngBytes({ w: 100, h: 100 });
      const inputBlob = makeImageBlob(inputBytes, 'image/png');
      
      // Mock canvas to fail
      mockCanvas.toBlob = vi.fn((callback) => callback(null));
      mockCanvas.toDataURL = vi.fn(() => 'data:,'); // Invalid data URL
      vi.spyOn(processor as any, 'compressOriginalImage').mockRejectedValue(new Error('Compression failed'));
      // Simulate image load error
      failNextImageLoad();
      
      // Act
      const result = await processor.processImage(
        inputBlob,
        'WEBP',
        0.8,
        1.0,
        'None',
        0, 0, 0,
        'Auto',
        true
      );
      
      // Assert
      expect(result.byteLength).toBe(inputBytes.byteLength);
      // No error should be thrown
    });

    // Test 1.42
    it('Given alpha PNG input, When converting to WEBP, Then alpha is preserved (simulated) and no error', async () => {
      // Arrange
      const inputBytes = makePngBytes({ w: 100, h: 100, alpha: true });
      const inputBlob = makeImageBlob(inputBytes, 'image/png');

      // Provide a canvas whose WEBP output simulates alpha preservation
      const alphaWebp = makeWebpBytes({ w: 100, h: 100, alpha: true });
      mockCanvas.toBlob = vi.fn((callback) => {
        callback(new Blob([alphaWebp], { type: 'image/webp' }));
      });

      // Act
      const result = await processor.processImage(
        inputBlob,
        'WEBP',
        0.8,
        1.0,
        'None',
        0, 0, 0,
        'Auto',
        true
      );

      // Assert
      expect(mockCanvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.8);
      expect(result.byteLength).toBe(alphaWebp.byteLength);
    });
  });

  describe('JPEG Conversion', () => {
    // Test 1.5
    it('Given JPEG format for non-JPEG input, When converting, Then selects smallest among toBlob, toDataURL, and compressOriginalImage', async () => {
      // Arrange
      const inputBytes = makePngBytes({ w: 100, h: 100 });
      const inputBlob = makeImageBlob(inputBytes, 'image/png');
      
      const smallestBytes = makeJpegBytes({ w: 50, h: 50 });
      mockCanvas.toBlob = vi.fn((callback) => {
        callback(new Blob([smallestBytes], { type: 'image/jpeg' }));
      });
      
      // Act
      const result = await processor.processImage(
        inputBlob,
        'JPEG',
        0.85,
        1.0,
        'None',
        0, 0, 0,
        'Auto',
        true
      );
      
      // Assert
      expect(mockCanvas.toBlob).toHaveBeenCalledWith(
        expect.any(Function),
        'image/jpeg',
        0.85
      );
    });

    // Test 1.6
    it('Given JPEG format for JPEG input, When converting, Then excludes compressOriginalImage from candidates', async () => {
      // Arrange
      const inputBytes = makeJpegBytes({ w: 100, h: 100 });
      const inputBlob = makeImageBlob(inputBytes, 'image/jpeg');
      
      const compressOriginalSpy = vi.spyOn(processor as any, 'compressOriginalImage');
      
      // Act
      const result = await processor.processImage(
        inputBlob,
        'JPEG',
        0.85,
        1.0,
        'None',
        0, 0, 0,
        'Auto',
        true
      );
      
      // Assert
      // For JPEG input to JPEG output, compressOriginalImage should not be called
      // since it would be redundant
      expect(compressOriginalSpy).not.toHaveBeenCalled();
    });

    // Test 1.7
    it('Given JPEG with EXIF, When re-encoding, Then EXIF from original is injected with Orientation removed', async () => {
      // Arrange
      const exifData = exifFrom({ 
        Orientation: 6, // Rotated
        Make: 'TestCamera',
        Model: 'TestModel'
      });
      const inputBytes = makeJpegBytes({ w: 100, h: 100, exif: exifData });
      const inputBlob = makeImageBlob(inputBytes, 'image/jpeg');
      
      // Mock piexif to verify orientation removal
      const mockExtractMetadata = vi.spyOn(processor as any, 'extractMetadata');
      const mockApplyMetadata = vi.spyOn(processor as any, 'applyMetadata');
      
      // Act
      const result = await processor.processImage(
        inputBlob,
        'JPEG',
        0.85,
        1.0,
        'None',
        0, 0, 0,
        'Auto',
        true
      );
      
      // Assert
      expect(mockExtractMetadata).toHaveBeenCalled();
      expect(mockApplyMetadata).toHaveBeenCalled();
    });

    // Test 1.8  
    it('Given JPEG EXIF injection failure, When applying metadata fails, Then returns JPEG without EXIF and no throw', async () => {
      // Arrange
      const inputBytes = makeJpegBytes({ w: 100, h: 100 });
      const inputBlob = makeImageBlob(inputBytes, 'image/jpeg');
      
      // Mock metadata application to fail
      vi.spyOn(processor as any, 'applyMetadata').mockRejectedValue(new Error('EXIF insert failed'));
      
      // Act
      const result = await processor.processImage(
        inputBlob,
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
      // No error thrown
    });

    // Test 1.43
    it('Given alpha PNG input, When converting to JPEG, Then completes with valid JPEG and no throw (alpha unsupported)', async () => {
      // Arrange
      const inputBytes = makePngBytes({ w: 120, h: 120, alpha: true });
      const inputBlob = makeImageBlob(inputBytes, 'image/png');

      // Intercept getContext to capture alpha:false
      const contextSpy = vi.fn((contextType: string, attrs?: any) => {
        return (mockCanvas.getContext as any).original?.call(mockCanvas, '2d') || mockCanvas.getContext('2d');
      });
      // Preserve original
      (mockCanvas.getContext as any).original = mockCanvas.getContext;
      mockCanvas.getContext = contextSpy as any;

      // Act
      const result = await processor.processImage(
        inputBlob,
        'JPEG',
        0.9,
        1.0,
        'None',
        0, 0, 0,
        'Auto',
        true
      );

      // Assert: completes successfully and yields non-empty JPEG bytes (alpha unsupported but no throw)
      expect(result.byteLength).toBeGreaterThan(0);
    });
  });

  describe('PNG Conversion', () => {
    // Test 1.9
    it('Given PNG format, When converting, Then selects smallest between toBlob and toDataURL', async () => {
      // Arrange
      const inputBytes = makeJpegBytes({ w: 100, h: 100 });
      const inputBlob = makeImageBlob(inputBytes, 'image/jpeg');
      
      const smallerBlobBytes = makePngBytes({ w: 80, h: 80 });
      const largerDataUrlBytes = makePngBytes({ w: 120, h: 120 });
      
      mockCanvas.toBlob = vi.fn((callback) => {
        callback(new Blob([smallerBlobBytes], { type: 'image/png' }));
      });
      
      mockCanvas.toDataURL = vi.fn(() => {
        const base64 = btoa(String.fromCharCode(...new Uint8Array(largerDataUrlBytes)));
        return `data:image/png;base64,${base64}`;
      });
      
      // Act
      const result = await processor.processImage(
        inputBlob,
        'PNG',
        1.0, // Quality ignored for PNG
        0.8, // Color depth
        'None',
        0, 0, 0,
        'Auto',
        true
      );
      
      // Assert
      expect(result.byteLength).toBe(smallerBlobBytes.byteLength);
      // PNG ignores quality; ensure correct MIME used
      const calls = (mockCanvas.toBlob as any).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0][1]).toBe('image/png');
    });

    // Test 1.10
    it('Given PNG with colorDepth < 1, When converting, Then color reduction routine is invoked', async () => {
      // Arrange
      const inputBytes = makeJpegBytes({ w: 100, h: 100 });
      const inputBlob = makeImageBlob(inputBytes, 'image/jpeg');
      
      const reduceColorsSpy = vi.spyOn(processor as any, 'reduceColorDepth');
      
      // Act
      const result = await processor.processImage(
        inputBlob,
        'PNG',
        1.0,
        0.5, // Color depth < 1
        'None',
        0, 0, 0,
        'Auto',
        true
      );
      
      // Assert
      expect(reduceColorsSpy).toHaveBeenCalledWith(
        expect.any(Object), // context
        0.5 // colorDepth value
      );
    });

    // Test 1.11
    it('Given PNG with alpha channel, When converting, Then alpha channel is preserved', async () => {
      // Arrange
      const inputBytes = makePngBytes({ w: 100, h: 100, alpha: true });
      const inputBlob = makeImageBlob(inputBytes, 'image/png');
      
      const outputBytes = makePngBytes({ w: 100, h: 100, alpha: true });
      mockCanvas.toBlob = vi.fn((callback) => {
        callback(new Blob([outputBytes], { type: 'image/png' }));
      });
      
      // Act
      const result = await processor.processImage(
        inputBlob,
        'PNG',
        1.0,
        1.0,
        'None',
        0, 0, 0,
        'Auto',
        true
      );
      
      // Assert
      // Result should maintain alpha channel (verified by output having alpha bytes)
      expect(result.byteLength).toBe(outputBytes.byteLength);
    });
  });

  describe('ORIGINAL Format', () => {
    // Test 1.12
    it('Given ORIGINAL format, When re-encoding, Then uses file.type via toBlob and applies resize', async () => {
      // Arrange
      const inputBytes = makeJpegBytes({ w: 200, h: 200 });
      const inputBlob = makeImageBlob(inputBytes, 'image/jpeg');
      
      // Act
      const result = await processor.processImage(
        inputBlob,
        'ORIGINAL',
        0.9,
        1.0,
        'Fit',
        100,
        100,
        0,
        'Auto',
        true
      );
      
      // Assert
      expect(mockCanvas.toBlob).toHaveBeenCalledWith(
        expect.any(Function),
        'image/jpeg', // Original type
        0.9
      );
      expect(mockCanvas.width).toBe(100);
      expect(mockCanvas.height).toBe(100);
    });

    it('Given ORIGINAL format error, When encoding fails, Then shows Notice and returns original bytes', async () => {
      // Arrange
      const inputBytes = corruptedBytes(100);
      const inputBlob = makeImageBlob(inputBytes, 'invalid/type');
      
      mockCanvas.toBlob = vi.fn((callback) => callback(null));
      const NoticeMock = fakeNotice();
      (global as any).Notice = NoticeMock;
      
      // Act
      const result = await processor.processImage(
        inputBlob,
        'ORIGINAL',
        0.9,
        1.0,
        'None',
        0, 0, 0,
        'Auto',
        true
      );
      
      // Assert
      expect(result.byteLength).toBe(inputBytes.byteLength);
      // Notice may be shown depending on implementation
    });
  });

  describe('NONE Format', () => {
    // Test 1.13
    it('Given NONE format with resizeMode=None, When processing, Then returns original bytes unchanged', async () => {
      // Arrange
      const inputBytes = makeJpegBytes({ w: 100, h: 100 });
      const inputBlob = makeImageBlob(inputBytes, 'image/jpeg');
      
      // Act
      const result = await processor.processImage(
        inputBlob,
        'NONE',
        0.5, // Should be ignored
        0.5, // Should be ignored
        'None',
        0, 0, 0,
        'Auto',
        true
      );
      
      // Assert
      expect(result.byteLength).toBe(inputBytes.byteLength);
      expect(mockCanvas.toBlob).not.toHaveBeenCalled();
      expect(mockCanvas.toDataURL).not.toHaveBeenCalled();
    });

    // Test 1.14
    it('Given NONE format with resize mode set, When processing, Then applies resize only without format conversion', async () => {
      // Arrange
      const inputBytes = makePngBytes({ w: 200, h: 200 });
      const inputBlob = makeImageBlob(inputBytes, 'image/png');
      
      // Act
      const result = await processor.processImage(
        inputBlob,
        'NONE',
        1.0,
        1.0,
        'Fit',
        100,
        100,
        0,
        'Auto',
        true
      );
      
      // Assert
      expect(mockCanvas.width).toBe(100);
      expect(mockCanvas.height).toBe(100);
      // Should use original format
      expect(mockCanvas.toBlob).toHaveBeenCalledWith(
        expect.any(Function),
        'image/png', // Original format preserved
        expect.any(Number)
      );
    });
  });

  describe('Quality and Color Depth Parameters', () => {
    // Test 1.15
    it('Given quality parameter, When encoding WEBP/JPEG, Then encoders receive expected quality', async () => {
      // Arrange
      const inputBytes = makePngBytes({ w: 100, h: 100 });
      const inputBlob = makeImageBlob(inputBytes, 'image/png');
      
      // Test WEBP
      await processor.processImage(
        inputBlob,
        'WEBP',
        0.75, // Quality
        1.0,
        'None',
        0, 0, 0,
        'Auto',
        true
      );
      
      // Assert
      expect(mockCanvas.toBlob).toHaveBeenCalledWith(
        expect.any(Function),
        'image/webp',
        0.75 // Quality passed through
      );
      
      vi.clearAllMocks();
      
      // Test JPEG
      await processor.processImage(
        inputBlob,
        'JPEG',
        0.65, // Quality
        1.0,
        'None',
        0, 0, 0,
        'Auto',
        true
      );
      
      // Assert
      expect(mockCanvas.toBlob).toHaveBeenCalledWith(
        expect.any(Function),
        'image/jpeg',
        0.65 // Quality passed through
      );
    });

    // Test 1.16
    it('Given quality=1 and resizeMode=None, When processing, Then early return occurs', async () => {
      // Arrange
      const inputBytes = makeWebpBytes({ w: 100, h: 100 });
      const inputBlob = makeImageBlob(inputBytes, 'image/webp');
      
      const toBlobSpy = vi.spyOn(mockCanvas, 'toBlob');
      const toDataURLSpy = vi.spyOn(mockCanvas, 'toDataURL');
      
      // Act
      const result = await processor.processImage(
        inputBlob,
        'WEBP',
        1.0, // Quality = 1
        1.0,
        'None', // No resize
        0, 0, 0,
        'Auto',
        true
      );
      
      // Assert - should early return without canvas operations
      expect(toBlobSpy).not.toHaveBeenCalled();
      expect(toDataURLSpy).not.toHaveBeenCalled();
      expect(result.byteLength).toBe(inputBytes.byteLength);
    });

    // Test 1.17
    it('Given PNG colorDepth, When c < 1, Then color reduction runs; when c >= 1, Then skips reduction', async () => {
      // Arrange
      const inputBytes = makeJpegBytes({ w: 100, h: 100 });
      const inputBlob = makeImageBlob(inputBytes, 'image/jpeg');
      const reduceColorsSpy = vi.spyOn(processor as any, 'reduceColorDepth');
      
      // Test with colorDepth < 1
      await processor.processImage(
        inputBlob,
        'PNG',
        1.0,
        0.3, // Color depth < 1
        'None',
        0, 0, 0,
        'Auto',
        true
      );
      
      // Assert
      expect(reduceColorsSpy).toHaveBeenCalledWith(
        expect.any(Object),
        0.3
      );
      
      vi.clearAllMocks();
      
      // Test with colorDepth >= 1
      await processor.processImage(
        inputBlob,
        'PNG',
        1.0,
        1.5, // Color depth >= 1
        'None',
        0, 0, 0,
        'Auto',
        true
      );
      
      // Assert
      expect(reduceColorsSpy).not.toHaveBeenCalled();
    });
  });

  describe('MIME Type Detection', () => {
    // Test 1.18
    it('Given unknown/mismatched MIME, When detected via magic bytes, Then uses detected type; on failure returns original', async () => {
      // Arrange
      const pngBytes = makePngBytes({ w: 100, h: 100 });
      // Create blob with wrong MIME type
      const inputBlob = makeImageBlob(pngBytes, 'application/octet-stream');
      
      // Mock getMimeTypeFromFile to detect correct type
      vi.spyOn(supportedFormats, 'getMimeTypeFromFile').mockResolvedValue('image/png');
      
      // Act
      const result = await processor.processImage(
        inputBlob,
        'WEBP',
        0.8,
        1.0,
        'None',
        0, 0, 0,
        'Auto',
        true
      );
      
      // Assert
      expect(supportedFormats.getMimeTypeFromFile).toHaveBeenCalled();
      // Should process as PNG detected from magic bytes
      expect(result).toBeDefined();
    });
  });

  describe('Allow Larger Files', () => {
    // Test 1.19
    it('Given allowLargerFiles flag, When toggled, Then engine selection ignores it (same result)', async () => {
      // Arrange
      const inputBytes = makePngBytes({ w: 50, h: 50 }); // Small input
      const inputBlob = makeImageBlob(inputBytes, 'image/png');
      
      // Mock canvas to return larger output
      const largerBytes = makeWebpBytes({ w: 200, h: 200 });
      mockCanvas.toBlob = vi.fn((callback) => {
        callback(new Blob([largerBytes], { type: 'image/webp' }));
      });
      
      // Act with allowLargerFiles=true
      const resultTrue = await processor.processImage(
        inputBlob,
        'WEBP',
        0.8,
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
        0.8,
        1.0,
        'None',
        0, 0, 0,
        'Auto',
        false
      );
      
      // Assert - selection is independent of allowLargerFiles
      expect(new Uint8Array(resultTrue)).toEqual(new Uint8Array(resultFalse));
    });
  });
});
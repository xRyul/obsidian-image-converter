/**
 * Unit tests for ImageProcessor resize math functionality
 * Test checklist items 1.20-1.30 (resize calculations)
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
import { makePngBytes, makeImageBlob } from '../../factories/image';
import { fakeCanvas } from '../../factories/canvas';
import { setMockImageSize } from '@helpers/test-setup';

describe('ImageProcessor - Resize Math Tests', () => {
  let processor: ImageProcessor;
  let supportedFormats: SupportedImageFormats;
  let mockCanvas: HTMLCanvasElement;
  let mockDocument: any;

  beforeEach(() => {
    // Arrange: Set up processor and mocks
    supportedFormats = new SupportedImageFormats();
    processor = new ImageProcessor(supportedFormats);
    
    // Mock document.createElement for canvas without replacing whole document
    mockCanvas = fakeCanvas({ w: 100, h: 100 });
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: any) => {
      if (tagName === 'canvas') {
        return mockCanvas as any;
      }
      return realCreateElement(tagName);
    });
    
    // Configure mock image size
    setMockImageSize(1000, 800);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Resize Fit Mode', () => {
    // Test 1.20
    it('Given Fit mode with portrait image, When resizing to landscape target, Then preserves aspect ratio and fits within bounds', async () => {
      // Arrange
      const inputBytes = makePngBytes({ w: 600, h: 800 }); // Portrait
      const inputBlob = makeImageBlob(inputBytes, 'image/png');
      const targetWidth = 400;
      const targetHeight = 300; // Landscape target
      
      // Mock Image with portrait dimensions
      setMockImageSize(600, 800);
      
      // Act
      await processor.processImage(
        inputBlob,
        'PNG',
        1.0,
        1.0,
        'Fit',
        targetWidth,
        targetHeight,
        0,
        'Auto',
        true
      );
      
      // Assert - Should scale to fit height (limiting dimension)
      const expectedWidth = Math.round(300 * (600/800)); // 225
      expect(mockCanvas.width).toBe(expectedWidth);
      expect(mockCanvas.height).toBe(300);
    });

    it('Given Fit mode with landscape image, When resizing to portrait target, Then preserves aspect ratio and fits within bounds', async () => {
      // Arrange
      const inputBytes = makePngBytes({ w: 800, h: 600 }); // Landscape
      const inputBlob = makeImageBlob(inputBytes, 'image/png');
      
      setMockImageSize(800, 600);
      
      // Act
      await processor.processImage(
        inputBlob,
        'PNG',
        1.0,
        1.0,
        'Fit',
        300, // Portrait target
        400,
        0,
        'Auto',
        true
      );
      
      // Assert - Should scale to fit width (limiting dimension)
      const expectedHeight = Math.round(300 * (600/800)); // 225
      expect(mockCanvas.width).toBe(300);
      expect(mockCanvas.height).toBe(expectedHeight);
    });

    it('Given Fit mode with square image, When resizing to rectangle, Then preserves aspect ratio', async () => {
      // Arrange
      const inputBytes = makePngBytes({ w: 500, h: 500 }); // Square
      const inputBlob = makeImageBlob(inputBytes, 'image/png');
      
      setMockImageSize(500, 500);
      
      // Act
      await processor.processImage(
        inputBlob,
        'PNG',
        1.0,
        1.0,
        'Fit',
        400,
        200, // Rectangle target
        0,
        'Auto',
        true
      );
      
      // Assert - Should scale to fit height
      expect(mockCanvas.width).toBe(200);
      expect(mockCanvas.height).toBe(200);
    });
  });

  describe('Resize Fill Mode', () => {
    // Test 1.21
    it('Given Fill mode with portrait image, When resizing to landscape target, Then covers target using center-crop', async () => {
      // Arrange
      const inputBytes = makePngBytes({ w: 600, h: 800 });
      const inputBlob = makeImageBlob(inputBytes, 'image/png');
      
      setMockImageSize(600, 800);
      
      const context = mockCanvas.getContext('2d');
      
      // Act
      await processor.processImage(
        inputBlob,
        'PNG',
        1.0,
        1.0,
        'Fill',
        400,
        200, // Landscape target
        0,
        'Auto',
        true
      );
      
      // Assert - Canvas should be exactly target size
      expect(mockCanvas.width).toBe(400);
      expect(mockCanvas.height).toBe(200);
      // drawImage should be called with source rect for cropping
      expect(context?.drawImage).toHaveBeenCalled();
    });
  });

  describe('Resize by Longest Edge', () => {
    // Test 1.22
    it('Given LongestEdge mode with landscape image, When resizing, Then longer side becomes target length', async () => {
      // Arrange
      const inputBytes = makePngBytes({ w: 800, h: 600 });
      const inputBlob = makeImageBlob(inputBytes, 'image/png');
      const targetLongestEdge = 400;
      
      setMockImageSize(800, 600);
      
      // Act
      await processor.processImage(
        inputBlob,
        'PNG',
        1.0,
        1.0,
        'LongestEdge',
        0,
        0,
        targetLongestEdge,
        'Auto',
        true
      );
      
      // Assert
      expect(mockCanvas.width).toBe(400); // Longest edge
      expect(mockCanvas.height).toBe(300); // Proportionally scaled
    });
  });

  describe('Resize by Shortest Edge', () => {
    // Test 1.23
    it('Given ShortestEdge mode with landscape image, When resizing, Then shorter side becomes target length', async () => {
      // Arrange
      const inputBytes = makePngBytes({ w: 800, h: 600 });
      const inputBlob = makeImageBlob(inputBytes, 'image/png');
      const targetShortestEdge = 300;
      
      setMockImageSize(800, 600);
      
      // Act
      await processor.processImage(
        inputBlob,
        'PNG',
        1.0,
        1.0,
        'ShortestEdge',
        0,
        0,
        targetShortestEdge,
        'Auto',
        true
      );
      
      // Assert
      expect(mockCanvas.height).toBe(300); // Shortest edge
      expect(mockCanvas.width).toBe(400); // Proportionally scaled
    });
  });

  describe('Resize by Width', () => {
    // Test 1.24
    it('Given Width mode, When resizing, Then width becomes target and height scales proportionally', async () => {
      // Arrange
      const inputBytes = makePngBytes({ w: 800, h: 600 });
      const inputBlob = makeImageBlob(inputBytes, 'image/png');
      const targetWidth = 400;
      
      setMockImageSize(800, 600);
      
      // Act
      await processor.processImage(
        inputBlob,
        'PNG',
        1.0,
        1.0,
        'Width',
        targetWidth,
        0, // Height ignored
        0,
        'Auto',
        true
      );
      
      // Assert
      expect(mockCanvas.width).toBe(400);
      expect(mockCanvas.height).toBe(300); // Proportionally scaled
    });
  });

  describe('Resize by Height', () => {
    // Test 1.25
    it('Given Height mode, When resizing, Then height becomes target and width scales proportionally', async () => {
      // Arrange
      const inputBytes = makePngBytes({ w: 800, h: 600 });
      const inputBlob = makeImageBlob(inputBytes, 'image/png');
      const targetHeight = 300;
      
      setMockImageSize(800, 600);
      
      // Act
      await processor.processImage(
        inputBlob,
        'PNG',
        1.0,
        1.0,
        'Height',
        0, // Width ignored
        targetHeight,
        0,
        'Auto',
        true
      );
      
      // Assert
      expect(mockCanvas.height).toBe(300);
      expect(mockCanvas.width).toBe(400); // Proportionally scaled
    });
  });

  describe('Resize None', () => {
    // Test 1.26
    it('Given None resize mode, When processing, Then no resizing applied', async () => {
      // Arrange
      const inputBytes = makePngBytes({ w: 800, h: 600 });
      const inputBlob = makeImageBlob(inputBytes, 'image/png');
      
      global.Image = vi.fn().mockImplementation(() => {
        const img = fakeImage({ width: 800, height: 600 });
        setTimeout(() => img.onload && img.onload(), 0);
        return img;
      }) as any;
      
      // Act
      await processor.processImage(
        inputBlob,
        'PNG',
        1.0,
        1.0,
        'None',
        400, // Should be ignored
        300, // Should be ignored
        0,
        'Auto',
        true
      );
      
      // Assert - With resize None, engine returns original bytes (no canvas operations)
      const result = await processor.processImage(
        inputBlob,
        'PNG',
        1.0,
        1.0,
        'None',
        400, // ignored
        300, // ignored
        0,
        'Auto',
        true
      );
      expect(result.byteLength).toBe(inputBytes.byteLength);
    });
  });

  describe('Enlarge/Reduce Modes', () => {
    // Test 1.27
    it('Given Auto mode, When resizing, Then uses computed target as-is', async () => {
      // Arrange
      const inputBytes = makePngBytes({ w: 200, h: 200 });
      const inputBlob = makeImageBlob(inputBytes, 'image/png');
      
      setMockImageSize(200, 200);
      
      // Act - Should enlarge
      await processor.processImage(
        inputBlob,
        'PNG',
        1.0,
        1.0,
        'Fit',
        400,
        400,
        0,
        'Auto', // Auto mode
        true
      );
      
      // Assert
      expect(mockCanvas.width).toBe(400);
      expect(mockCanvas.height).toBe(400);
    });

    // Test 1.28
    it('Given Reduce mode, When image smaller than target, Then no upscaling occurs', async () => {
      // Arrange
      const inputBytes = makePngBytes({ w: 200, h: 200 });
      const inputBlob = makeImageBlob(inputBytes, 'image/png');
      
      // Use standard MockImage with configured size for deterministic load behavior
      setMockImageSize(200, 200);
      
      // Act
      await processor.processImage(
        inputBlob,
        'PNG',
        1.0,
        1.0,
        'Fit',
        400,
        400,
        0,
        'Reduce', // Reduce mode - no upscaling
        true
      );
      
      // Assert - Should not upscale
      expect(mockCanvas.width).toBe(200);
      expect(mockCanvas.height).toBe(200);
    });

    it('Given Reduce mode, When image larger than target, Then downscaling occurs', async () => {
      // Arrange
      const inputBytes = makePngBytes({ w: 800, h: 800 });
      const inputBlob = makeImageBlob(inputBytes, 'image/png');
      
      setMockImageSize(800, 800);
      
      // Act
      await processor.processImage(
        inputBlob,
        'PNG',
        1.0,
        1.0,
        'Fit',
        400,
        400,
        0,
        'Reduce',
        true
      );
      
      // Assert - Should downscale
      expect(mockCanvas.width).toBe(400);
      expect(mockCanvas.height).toBe(400);
    });

    // Test 1.29
    it('Given Enlarge mode, When image larger than target, Then no downscaling occurs', async () => {
      // Arrange
      const inputBytes = makePngBytes({ w: 800, h: 800 });
      const inputBlob = makeImageBlob(inputBytes, 'image/png');
      
      setMockImageSize(800, 800);
      
      // Act
      await processor.processImage(
        inputBlob,
        'PNG',
        1.0,
        1.0,
        'Fit',
        400,
        400,
        0,
        'Enlarge', // Enlarge mode - no downscaling
        true
      );
      
      // Assert - Should not downscale
      expect(mockCanvas.width).toBe(800);
      expect(mockCanvas.height).toBe(800);
    });

    it('Given Enlarge mode, When image smaller than target, Then upscaling occurs', async () => {
      // Arrange
      const inputBytes = makePngBytes({ w: 200, h: 200 });
      const inputBlob = makeImageBlob(inputBytes, 'image/png');
      
      setMockImageSize(200, 200);
      
      // Act
      await processor.processImage(
        inputBlob,
        'PNG',
        1.0,
        1.0,
        'Fit',
        400,
        400,
        0,
        'Enlarge',
        true
      );
      
      // Assert - Should upscale
      expect(mockCanvas.width).toBe(400);
      expect(mockCanvas.height).toBe(400);
    });

    // Test 1.30
    it('Given image exactly equal to target, When any enlarge/reduce mode, Then remains unchanged', async () => {
      // Arrange
      const inputBytes = makePngBytes({ w: 400, h: 400 });
      const inputBlob = makeImageBlob(inputBytes, 'image/png');
      
      setMockImageSize(400, 400);
      
      // Test with each mode
      for (const mode of ['Auto', 'Reduce', 'Enlarge'] as const) {
        // Act
        await processor.processImage(
          inputBlob,
          'PNG',
          1.0,
          1.0,
          'Fit',
          400,
          400,
          0,
          mode,
          true
        );
        
        // Assert
        expect(mockCanvas.width).toBe(400);
        expect(mockCanvas.height).toBe(400);
      }
    });
  });
});
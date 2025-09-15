/* eslint-disable id-length */
/* eslint-disable no-undef */
/**
 * Factory functions for creating mock canvas objects
 * Provides testable canvas implementations for image processing tests
 */

import { vi } from 'vitest';
import { makePngBytes, makeJpegBytes, makeWebpBytes } from './image';

export interface MockCanvasOptions {
  w?: number;
  h?: number;
  toBlob?: (callback: (blob: Blob | null) => void, type?: string, quality?: number) => void;
  toDataURL?: (type?: string, quality?: number) => string;
  getContext?: () => CanvasRenderingContext2D | null;
}

/**
 * Create a mock canvas with configurable toBlob and toDataURL methods
 * @param options - Configuration for the mock canvas
 * @returns Mock HTMLCanvasElement
 */
export function fakeCanvas(options: MockCanvasOptions = {}): HTMLCanvasElement {
  let width = options.w ?? 100;
  let height = options.h ?? 100;
  let cached2DContext: CanvasRenderingContext2D | null = null;
  
  const canvas = {
    get width() { return width; },
    set width(value: number) { width = value; },
    get height() { return height; },
    set height(value: number) { height = value; },
    style: {} as CSSStyleDeclaration,
    
    toBlob: options.toBlob ?? vi.fn((callback: (blob: Blob | null) => void, type?: string, quality?: number) => {
      // Default implementation returns a blob based on requested type
      const mimeType = type || 'image/png';
      let bytes: ArrayBuffer;
      
      switch (mimeType) {
        case 'image/webp':
          bytes = makeWebpBytes({ w: width, h: height });
          break;
        case 'image/jpeg':
          bytes = makeJpegBytes({ w: width, h: height });
          break;
        case 'image/png':
        default:
          bytes = makePngBytes({ w: width, h: height });
          break;
      }
      
      const blob = new Blob([bytes], { type: mimeType });
      // Simulate async callback
      setTimeout(() => callback(blob), 0);
    }),
    
    toDataURL: options.toDataURL ?? vi.fn((type?: string, quality?: number) => {
      // Default implementation returns a data URL based on requested type
      const mimeType = type || 'image/png';
      let bytes: ArrayBuffer;
      
      switch (mimeType) {
        case 'image/webp':
          bytes = makeWebpBytes({ w: width, h: height });
          break;
        case 'image/jpeg':
          bytes = makeJpegBytes({ w: width, h: height });
          break;
        case 'image/png':
        default:
          bytes = makePngBytes({ w: width, h: height });
          break;
      }
      
      // Convert to base64
      const uint8Array = new Uint8Array(bytes);
      const base64 = btoa(String.fromCharCode(...uint8Array));
      return `data:${mimeType};base64,${base64}`;
    }),
    
getContext: options.getContext ?? vi.fn((contextType: string) => {
  if (contextType === '2d') {
    if (!cached2DContext) {
      cached2DContext = fakeContext2D({ canvas, width, height });
    }
    return cached2DContext as CanvasRenderingContext2D;
  }
  return null;
}),
    
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as HTMLCanvasElement;
  
  return canvas;
}

/**
 * Create a mock 2D rendering context
 * @param options - Configuration for the mock context
 * @returns Mock CanvasRenderingContext2D
 */
export function fakeContext2D(options: {
  canvas?: HTMLCanvasElement;
  width?: number;
  height?: number;
} = {}): CanvasRenderingContext2D {
  const width = options.width ?? 100;
  const height = options.height ?? 100;
  
  const context = {
    canvas: options.canvas ?? fakeCanvas({ w: width, h: height }),
    
    // Drawing methods
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    clearRect: vi.fn(),
    
    // Text methods
    fillText: vi.fn(),
    strokeText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
    
    // Path methods
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    
    // Transformation methods
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    translate: vi.fn(),
    transform: vi.fn(),
    setTransform: vi.fn(),
    
    // Image data methods
    getImageData: vi.fn((sx: number, sy: number, sw: number, sh: number) => {
      const data = new Uint8ClampedArray(sw * sh * 4);
      // Fill with dummy data
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 255;     // R
        data[i + 1] = 0;   // G
        data[i + 2] = 0;   // B
        data[i + 3] = 255; // A
      }
      return {
        data,
        width: sw,
        height: sh,
colorSpace: 'srgb' as any
      } as ImageData;
    }),
    
    putImageData: vi.fn(),
    createImageData: vi.fn((sw: number, sh: number) => {
      const data = new Uint8ClampedArray(sw * sh * 4);
      return {
        data,
        width: sw,
        height: sh,
        colorSpace: 'srgb' as PredefinedColorSpace
      } as ImageData;
    }),
    
    // Style properties
    fillStyle: '#000000',
    strokeStyle: '#000000',
    globalAlpha: 1,
globalCompositeOperation: 'source-over',
    lineWidth: 1,
lineCap: 'butt',
lineJoin: 'miter',
    miterLimit: 10,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    shadowBlur: 0,
    shadowColor: 'rgba(0, 0, 0, 0)',
    font: '10px sans-serif',
textAlign: 'start',
textBaseline: 'alphabetic',
    
    // Other methods
    clip: vi.fn(),
    isPointInPath: vi.fn(() => false),
    isPointInStroke: vi.fn(() => false),
  } as unknown as CanvasRenderingContext2D;
  
  return context;
}

/**
 * Create a mock Image element with configurable dimensions
 * @param options - Configuration for the mock image
 * @returns Mock HTMLImageElement
 */
export function fakeImage(options: {
  width?: number;
  height?: number;
  src?: string;
  onload?: () => void;
  onerror?: () => void;
} = {}): HTMLImageElement {
  const img = {
    width: options.width ?? 100,
    height: options.height ?? 100,
    naturalWidth: options.width ?? 100,
    naturalHeight: options.height ?? 100,
    src: options.src ?? '',
    alt: '',
    complete: true,
    crossOrigin: null as string | null,
    
    addEventListener: vi.fn((event: string, handler: () => void) => {
      if (event === 'load' && options.onload) {
        setTimeout(options.onload, 0);
      } else if (event === 'error' && options.onerror) {
        setTimeout(options.onerror, 0);
      }
    }),
    
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as HTMLImageElement;
  
  // Trigger onload if src is set
  if (options.src && options.onload) {
    setTimeout(options.onload, 0);
  }
  
  return img;
}

/**
 * Create a mock canvas with preset behavior for specific test scenarios
 */
export function createCanvasWithPresetBehavior(scenario: 'smallest-blob' | 'smallest-dataurl' | 'error'): HTMLCanvasElement {
  switch (scenario) {
    case 'smallest-blob':
      // Canvas where toBlob produces smaller output
      return fakeCanvas({
        toBlob: vi.fn((callback, type, quality) => {
          const bytes = makePngBytes({ w: 50, h: 50 }); // Smaller size
          callback(new Blob([bytes], { type: type || 'image/png' }));
        }),
        toDataURL: vi.fn((type, quality) => {
          const bytes = makePngBytes({ w: 100, h: 100 }); // Larger size
          const uint8Array = new Uint8Array(bytes);
          const base64 = btoa(String.fromCharCode(...uint8Array));
          return `data:${type || 'image/png'};base64,${base64}`;
        })
      });
      
    case 'smallest-dataurl':
      // Canvas where toDataURL produces smaller output
      return fakeCanvas({
        toBlob: vi.fn((callback, type, quality) => {
          const bytes = makePngBytes({ w: 100, h: 100 }); // Larger size
          callback(new Blob([bytes], { type: type || 'image/png' }));
        }),
        toDataURL: vi.fn((type, quality) => {
          const bytes = makePngBytes({ w: 50, h: 50 }); // Smaller size
          const uint8Array = new Uint8Array(bytes);
          const base64 = btoa(String.fromCharCode(...uint8Array));
          return `data:${type || 'image/png'};base64,${base64}`;
        })
      });
      
    case 'error':
      // Canvas that fails to encode
      return fakeCanvas({
        toBlob: vi.fn((callback) => callback(null)),
        toDataURL: vi.fn(() => 'data:,') // Empty data URL indicates error
      });
      
    default:
      return fakeCanvas();
  }
}
/**
 * Global test setup and configuration
 * Runs before all tests to configure the test environment
 */

import { vi, beforeEach, afterEach } from 'vitest';

let __IMAGE_SIZE__ = { w: 100, h: 100 };
let __IMAGE_FAIL_NEXT__ = false;

class MockImage {
  onload: ((e?: any) => void) | null = null;
  onerror: ((e?: any) => void) | null = null;
  alt = '';
  crossOrigin: string | null = null;
  complete = true;
  naturalWidth = __IMAGE_SIZE__.w;
  naturalHeight = __IMAGE_SIZE__.h;
  width = __IMAGE_SIZE__.w;
  height = __IMAGE_SIZE__.h;
  private _src = '';

  get src() { return this._src; }
  set src(v: string) {
    this._src = v;
    // Simulate async decode
    queueMicrotask(() => {
      // Refresh to current configured size at load time
      this.naturalWidth = __IMAGE_SIZE__.w;
      this.naturalHeight = __IMAGE_SIZE__.h;
      this.width = __IMAGE_SIZE__.w;
      this.height = __IMAGE_SIZE__.h;
      if (__IMAGE_FAIL_NEXT__) {
        __IMAGE_FAIL_NEXT__ = false;
        this.onerror?.({ type: 'error' });
      } else {
        this.onload?.({ type: 'load' });
      }
    });
  }

  addEventListener(type: string, handler: any) {
    if (type === 'load') this.onload = handler;
    if (type === 'error') this.onerror = handler;
  }
  removeEventListener = vi.fn();
  dispatchEvent = vi.fn();
}

export function setMockImageSize(w: number, h: number) {
  __IMAGE_SIZE__ = { w, h };
}
export function failNextImageLoad() {
  __IMAGE_FAIL_NEXT__ = true;
}

// Minimal ImageData polyfill for environments lacking it (e.g., happy-dom versions)
if (typeof (globalThis as any).ImageData === 'undefined') {
  class ImageDataPolyfill {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    colorSpace: any;
    constructor(data: Uint8ClampedArray | number, width?: number, height?: number) {
      if (typeof data === 'number' && typeof width === 'number' && typeof height === 'number') {
        const buf = new Uint8ClampedArray(data * width * height);
        this.data = buf;
        this.width = width;
        this.height = height;
      } else if (data instanceof Uint8ClampedArray && typeof width === 'number' && typeof height === 'number') {
        this.data = data;
        this.width = width;
        this.height = height;
      } else {
        this.data = new Uint8ClampedArray(0);
        this.width = (width as number) || 0;
        this.height = (height as number) || 0;
      }
      this.colorSpace = 'srgb';
    }
  }
  ;(globalThis as any).ImageData = ImageDataPolyfill as any;
}

// Setup global test environment
beforeEach(() => {
  // Reset all mocks before each test
  vi.clearAllMocks();
  
  // Setup global window object if needed
  if (typeof window !== 'undefined') {
    // Mock electron API if needed
    (window as any).electron = undefined;
    
    // Mock Obsidian-specific globals
    (window as any).app = undefined;
    (window as any).moment = undefined;
  }
  
  // Mock console methods to reduce noise in tests
  global.console = {
    ...console,
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn()
  } as any;

  // Reinstall stable Image mock each test (mockReset clears implementations)
  (global as any).Image = MockImage as any;

  // Reinstall FileReader mock each test (mockReset clears implementations)
  (global as any).FileReader = vi.fn().mockImplementation(() => {
    const reader = {
      result: null as string | ArrayBuffer | null,
      error: null,
      onload: null as ((event: any) => void) | null,
      onloadend: null as ((event: any) => void) | null,
      onerror: null as ((event: any) => void) | null,
      onabort: null,
      onprogress: null,
      readyState: 0,
      EMPTY: 0,
      LOADING: 1,
      DONE: 2,
      
      readAsDataURL: vi.fn(function(this: any, blob: Blob) {
        // Simulate async read
        Promise.resolve().then(() => {
          this.result = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
          this.readyState = 2; // DONE
          const event = { target: this };
          this.onload?.(event);
          this.onloadend?.(event);
        });
      }),
      
      readAsArrayBuffer: vi.fn(function(this: any, blob: Blob) {
        Promise.resolve().then(() => {
          // Create a simple ArrayBuffer
          const buffer = new ArrayBuffer(8);
          const view = new Uint8Array(buffer);
          view[0] = 0x89; // PNG signature start
          view[1] = 0x50;
          view[2] = 0x4E;
          view[3] = 0x47;
          this.result = buffer;
          this.readyState = 2;
          const event = { target: this };
          this.onload?.(event);
          this.onloadend?.(event);
        });
      }),
      
      readAsText: vi.fn(function(this: any, blob: Blob) {
        Promise.resolve().then(() => {
          this.result = 'mock text content';
          this.readyState = 2;
          const event = { target: this };
          this.onload?.(event);
          this.onloadend?.(event);
        });
      }),
      
      readAsBinaryString: vi.fn(),
      abort: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    };
    
    return reader;
  }) as any;

  // Reinstall URL mocks each test as well
  global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  global.URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  // Clean up after each test
  vi.restoreAllMocks();
  
  // Clear any fake timers if they were used
  if (vi.isFakeTimers()) {
    vi.useRealTimers();
  }
});

// Global test utilities
export function setupFakeTimers(date?: Date | string | number) {
  vi.useFakeTimers();
  if (date) {
    vi.setSystemTime(date);
  }
  return {
    advance: (ms: number) => vi.advanceTimersByTime(ms),
    runAll: () => vi.runAllTimers(),
    restore: () => vi.useRealTimers()
  };
}

// Export test utilities
export { vi };

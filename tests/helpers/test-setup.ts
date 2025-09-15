/**
 * Global test setup and configuration
 * Runs before all tests to configure the test environment
 */

import { vi, beforeEach, afterEach } from 'vitest';

let imageSize = { width: 100, height: 100 };
let imageFailNext = false;

class MockImage {
  onload: ((e?: any) => void) | null = null;
  onerror: ((e?: any) => void) | null = null;
  alt = '';
  crossOrigin: string | null = null;
  complete = true;
  naturalWidth = imageSize.width;
  naturalHeight = imageSize.height;
  width = imageSize.width;
  height = imageSize.height;
  private _src = '';

  get src() { return this._src; }
  set src(value: string) {
    this._src = value;
    // Simulate async decode
    queueMicrotask(() => {
      // Refresh to current configured size at load time
      this.naturalWidth = imageSize.width;
      this.naturalHeight = imageSize.height;
      this.width = imageSize.width;
      this.height = imageSize.height;
      if (imageFailNext) {
        imageFailNext = false;
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

export function setMockImageSize(width: number, height: number) {
  imageSize = { width, height };
}
export function failNextImageLoad() {
  imageFailNext = true;
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

  // Obsidian DOM helpers polyfill on HTMLElement
  const proto = HTMLElement.prototype as any;
  if (!proto.addClass) {
    proto.addClass = function (cls: string) { cls?.split(/\s+/).filter(Boolean).forEach((className: string) => this.classList.add(className)); return this; };
  }
  if (!proto.removeClass) {
    proto.removeClass = function (cls: string) { cls?.split(/\s+/).filter(Boolean).forEach((className: string) => this.classList.remove(className)); return this; };
  }
  if (!proto.toggleClass) {
    proto.toggleClass = function (cls: string, force?: boolean) { this.classList.toggle(cls, force); return this; };
  }
  if (!proto.empty) {
    proto.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); return this; };
  }
  if (!proto.setCssStyles) {
    proto.setCssStyles = function (styles: Record<string, string>) { Object.assign(this.style, styles); return this; };
  }
  if (!proto.createDiv) {
    proto.createDiv = function (clsOrOpts?: string | { cls?: string; text?: string }) {
      const el = document.createElement('div');
      if (typeof clsOrOpts === 'string') el.className = clsOrOpts;
      else if (clsOrOpts) {
        if (clsOrOpts.cls) el.className = clsOrOpts.cls;
        if ((clsOrOpts as any).text) el.textContent = (clsOrOpts as any).text;
      }
      this.appendChild(el);
      return el;
    };
  }
  if (!proto.createEl) {
    proto.createEl = function (tag: string, opts?: { cls?: string; text?: string; attr?: Record<string, string> }) {
      const el = document.createElement(tag);
      if (opts?.cls) el.className = opts.cls;
      if (opts?.text) el.textContent = opts.text;
      if (opts?.attr) {
        Object.entries(opts.attr).forEach(([key, value]) => el.setAttribute(key, String(value)));
      }
      this.appendChild(el);
      return el;
    };
  }
  if (!proto.createSpan) {
    proto.createSpan = function (opts?: { cls?: string; text?: string }) {
      const el = document.createElement('span');
      if (opts?.cls) el.className = opts.cls;
      if (opts?.text) el.textContent = opts.text;
      this.appendChild(el);
      return el;
    };
  }
  if (!proto.hide) {
    proto.hide = function () { this.style.display = 'none'; return this; };
  }
  if (!proto.show) {
    proto.show = function () { this.style.display = ''; return this; };
  }
  if (!proto.onClickEvent) {
    proto.onClickEvent = function (handler: (e: MouseEvent) => void) { this.addEventListener('click', handler); return this; };
  }
  if (!proto.setAttr) {
    proto.setAttr = function (name: string, value: string) { this.setAttribute(name, String(value)); return this; };
  }
  if (!proto.setText) {
    proto.setText = function (text: string) { this.textContent = String(text); return this; };
  }

  // Polyfills for DocumentFragment (used in settings summaries)
  const dfProto = DocumentFragment.prototype as any;
  if (!dfProto.createEl) {
    dfProto.createEl = function (tag: string, opts?: { cls?: string; text?: string; attr?: Record<string, string> }) {
      const el = document.createElement(tag);
      if (opts?.cls) el.className = opts.cls;
      if (opts?.text) el.textContent = opts.text;
      if (opts?.attr) {
        Object.entries(opts.attr).forEach(([key, value]) => el.setAttribute(key, String(value)));
      }
      this.appendChild(el);
      return el;
    };
  }
  if (!dfProto.createDiv) {
    dfProto.createDiv = function (clsOrOpts?: string | { cls?: string; text?: string }) {
      const el = document.createElement('div');
      if (typeof clsOrOpts === 'string') el.className = clsOrOpts;
      else if (clsOrOpts) {
        if (clsOrOpts.cls) el.className = clsOrOpts.cls;
        if ((clsOrOpts as any).text) el.textContent = (clsOrOpts as any).text;
      }
      this.appendChild(el);
      return el;
    };
  }
  if (!dfProto.createSpan) {
    dfProto.createSpan = function (opts?: { cls?: string; text?: string }) {
      const el = document.createElement('span');
      if (opts?.cls) el.className = opts.cls;
      if (opts?.text) el.textContent = opts.text;
      this.appendChild(el);
      return el;
    };
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

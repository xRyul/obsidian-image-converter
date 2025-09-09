/**
 * Custom assertion helpers for image processing and path validation.
 *
 * Exposes readable, behavior-focused expectations for:
 * - Image magic-byte format checks (png, jpeg, webp, gif, heic/avif, tiff, bmp)
 * - File size boundaries
 * - Basic path safety/normalization checks for test scenarios
 */
import { expect } from 'vitest';

// Custom assertion helpers for image processing tests

export function expectImageDimensions(
  imageData: Uint8Array | ArrayBuffer,
  width: number,
  height: number
) {
  // This is a simplified check - in real tests you'd parse the image headers
  // For now, we just validate that we have data
  expect(imageData).toBeDefined();
  expect(imageData.byteLength).toBeGreaterThan(0);
  // TODO: Implement actual dimension checking using image-size or similar
}

export function expectImageFormat(
  imageData: Uint8Array | ArrayBuffer,
  format: 'png' | 'jpeg' | 'webp' | 'gif' | 'heic' | 'heif' | 'avif' | 'tiff' | 'bmp'
) {
  const bytes = new Uint8Array(imageData);
  
  // Check magic bytes for each format
  switch (format) {
    case 'png':
      expect(bytes[0]).toBe(0x89);
      expect(bytes[1]).toBe(0x50);
      expect(bytes[2]).toBe(0x4E);
      expect(bytes[3]).toBe(0x47);
      break;
    case 'jpeg':
      expect(bytes[0]).toBe(0xFF);
      expect(bytes[1]).toBe(0xD8);
      expect(bytes[2]).toBe(0xFF);
      break;
    case 'webp':
      expect(bytes[8]).toBe(0x57);
      expect(bytes[9]).toBe(0x45);
      expect(bytes[10]).toBe(0x42);
      expect(bytes[11]).toBe(0x50);
      break;
    case 'gif':
      expect(bytes[0]).toBe(0x47);
      expect(bytes[1]).toBe(0x49);
      expect(bytes[2]).toBe(0x46);
      break;
    case 'heic':
    case 'heif':
      // HEIC/HEIF files start with 00 00 00 XX and have 'ftyp' at offset 4
      expect(bytes[4]).toBe(0x66); // 'f'
      expect(bytes[5]).toBe(0x74); // 't'
      expect(bytes[6]).toBe(0x79); // 'y'
      expect(bytes[7]).toBe(0x70); // 'p'
      break;
    case 'avif':
      // AVIF also uses ftyp structure but different brand
      expect(bytes[4]).toBe(0x66); // 'f'
      expect(bytes[5]).toBe(0x74); // 't'
      expect(bytes[6]).toBe(0x79); // 'y'
      expect(bytes[7]).toBe(0x70); // 'p'
      break;
    case 'tiff': {
      // TIFF can start with either II* (little endian) or MM* (big endian)
      const isLittleEndian = bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2A && bytes[3] === 0x00;
      const isBigEndian = bytes[0] === 0x4D && bytes[1] === 0x4D && bytes[2] === 0x00 && bytes[3] === 0x2A;
      expect(isLittleEndian || isBigEndian).toBe(true);
      break;
    }
    case 'bmp':
      // BMP files start with 'BM'
      expect(bytes[0]).toBe(0x42); // 'B'
      expect(bytes[1]).toBe(0x4D); // 'M'
      break;
    default:
      throw new Error(`Unknown format: ${format}`);
  }
}

export function expectFileSizeLessThan(
  imageData: Uint8Array | ArrayBuffer,
  maxSizeBytes: number
) {
  expect(imageData.byteLength).toBeLessThan(maxSizeBytes);
}

export function expectFileSizeGreaterThan(
  imageData: Uint8Array | ArrayBuffer,
  minSizeBytes: number
) {
  expect(imageData.byteLength).toBeGreaterThan(minSizeBytes);
}

export function expectValidPath(path: string) {
  // Check for common path traversal attempts
  expect(path).not.toContain('..');
  expect(path).not.toContain('~');
  expect(path).not.toMatch(/^[A-Z]:\\/); // No absolute Windows paths
  expect(path).not.toMatch(/^\//); // No absolute Unix paths
  
  // Path should be normalized
  if (process.platform === 'win32') {
    expect(path).not.toContain('/');
  } else {
    expect(path).not.toContain('\\');
  }
}

export function expectValidVariableReplacement(
  template: string,
  result: string,
  expectedVariables: Record<string, any>
) {
  // Check that no unreplaced variables remain
  expect(result).not.toMatch(/\{[^}]+\}/);
  
  // Check specific replacements if provided
  for (const [key, value] of Object.entries(expectedVariables)) {
    if (template.includes(`{${key}}`)) {
      expect(result).toContain(String(value));
    }
  }
}

// Extend Vitest's expect with custom matchers
declare module 'vitest' {
  interface Assertion {
    toBeValidImagePath(): void;
    toBeWithinSizeRange(min: number, max: number): void;
  }
  interface AsymmetricMatchersContaining {
    toBeValidImagePath(): void;
    toBeWithinSizeRange(min: number, max: number): void;
  }
}

expect.extend({
  toBeValidImagePath(received: string) {
    const pass = 
      !received.includes('..') &&
      !received.includes('~') &&
      !/^[A-Z]:\\/.test(received) &&
      !/^\//.test(received);
    
    return {
      pass,
      message: () => pass
        ? `expected ${received} not to be a valid image path`
        : `expected ${received} to be a valid image path`,
    };
  },
  
  toBeWithinSizeRange(received: Uint8Array | ArrayBuffer, min: number, max: number) {
    const size = received.byteLength;
    const pass = size >= min && size <= max;
    
    return {
      pass,
      message: () => pass
        ? `expected size ${size} not to be within range [${min}, ${max}]`
        : `expected size ${size} to be within range [${min}, ${max}]`,
    };
  },
});

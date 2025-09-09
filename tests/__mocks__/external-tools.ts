/**
 * Mock implementations for external image processing tools used by the plugin.
 * 
 * This file provides Vitest mocks for:
 * - FFmpeg (video/image conversion, AVIF support)
 * - PngQuant (PNG compression optimization)
 * - heic-to library (HEIC/HEIF format conversion)
 * - Node.js child_process module (for executing external tools)
 * 
 * All mocks simulate successful execution with realistic output data,
 * including proper magic bytes for different image formats. Used to test
 * image conversion logic without requiring actual external tool binaries.
 */
import { vi } from 'vitest';

// Mock external tool implementations

export const mockFfmpeg = {
  exec: vi.fn().mockImplementation((args: string[], callback: (error: any, stdout: string, stderr: string) => void) => {
    // Simulate successful ffmpeg execution
    setTimeout(() => {
      callback(null, 'ffmpeg mock output', '');
    }, 10);
  }),
  
  isAvailable: vi.fn().mockResolvedValue(true),
  
  getVersion: vi.fn().mockResolvedValue('5.1.2'),
  
  convertToAvif: vi.fn().mockImplementation(async (input: Uint8Array, quality: number) => {
    // Return a mock AVIF file (smaller than input to simulate compression)
    const outputSize = Math.floor(input.length * 0.7);
    const output = new Uint8Array(outputSize);
    // Add AVIF magic bytes (simplified)
    output[4] = 0x66; // f
    output[5] = 0x74; // t
    output[6] = 0x79; // y
    output[7] = 0x70; // p
    output[8] = 0x61; // a
    output[9] = 0x76; // v
    output[10] = 0x69; // i
    output[11] = 0x66; // f
    return output;
  }),
};

export const mockPngquant = {
  exec: vi.fn().mockImplementation((args: string[], callback: (error: any, stdout: string, stderr: string) => void) => {
    // Simulate successful pngquant execution
    setTimeout(() => {
      callback(null, 'pngquant mock output', '');
    }, 10);
  }),
  
  isAvailable: vi.fn().mockResolvedValue(true),
  
  getVersion: vi.fn().mockResolvedValue('2.17.0'),
  
  compress: vi.fn().mockImplementation(async (input: Uint8Array, quality: number) => {
    // Return a mock compressed PNG (smaller than input)
    const outputSize = Math.floor(input.length * (quality / 100));
    const output = new Uint8Array(outputSize);
    // Add PNG magic bytes
    output[0] = 0x89;
    output[1] = 0x50;
    output[2] = 0x4E;
    output[3] = 0x47;
    output[4] = 0x0D;
    output[5] = 0x0A;
    output[6] = 0x1A;
    output[7] = 0x0A;
    return output;
  }),
};

export const mockHeicConvert = {
  isAvailable: vi.fn().mockResolvedValue(false), // Usually not available in test env
  
  convert: vi.fn().mockImplementation(async (input: Uint8Array, outputFormat: string) => {
    // Return a mock converted image
    const output = new Uint8Array(input.length);
    
    // Add appropriate magic bytes based on output format
    if (outputFormat === 'jpeg') {
      output[0] = 0xFF;
      output[1] = 0xD8;
      output[2] = 0xFF;
    } else if (outputFormat === 'png') {
      output[0] = 0x89;
      output[1] = 0x50;
      output[2] = 0x4E;
      output[3] = 0x47;
    }
    
    return output;
  }),
};

// Mock child_process for external tool execution
export const mockChildProcess = {
  exec: vi.fn((command: string, options: any, callback: Function) => {
    // Parse command to determine which tool is being called
    if (command.includes('ffmpeg')) {
      mockFfmpeg.exec([], callback);
    } else if (command.includes('pngquant')) {
      mockPngquant.exec([], callback);
    } else {
      callback(new Error('Command not found'), '', '');
    }
  }),
  
  execSync: vi.fn((command: string) => {
    if (command.includes('--version')) {
      if (command.includes('ffmpeg')) {
        return 'ffmpeg version 5.1.2';
      }
      if (command.includes('pngquant')) {
        return 'pngquant 2.17.0';
      }
    }
    return '';
  }),
  
  spawn: vi.fn((command: string, args: string[]) => {
    return {
      stdout: {
        on: vi.fn(),
        pipe: vi.fn(),
      },
      stderr: {
        on: vi.fn(),
        pipe: vi.fn(),
      },
      on: vi.fn((event: string, callback: Function) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 10);
        }
      }),
      kill: vi.fn(),
    };
  }),
};

// Export for use in tests
export default {
  ffmpeg: mockFfmpeg,
  pngquant: mockPngquant,
  heicConvert: mockHeicConvert,
  childProcess: mockChildProcess,
};

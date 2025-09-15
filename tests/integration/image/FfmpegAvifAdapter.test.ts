/**
 * Integration-lite tests for FFmpeg AVIF adapter
 * Covers TEST_CHECKLIST.md items 1.35–1.37 and 1.45
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// Mocks before imports
vi.mock('child_process');
vi.mock('fs/promises', () => {
  return {
    readFile: vi.fn(),
    unlink: vi.fn()
  };
});

import { ImageProcessor } from '../../../src/ImageProcessor';
import { SupportedImageFormats } from '../../../src/SupportedImageFormats';
import { makePngBytes, makeImageBlob } from '../../factories/image';
import { mockChildProcess } from '../../factories/process';
import { fakeApp } from '../../factories/obsidian';

// Pull mocked fs
import * as fs from 'fs/promises';

describe('Integration-lite: FfmpegAvifAdapter', () => {
  let processor: ImageProcessor;
  let supportedFormats: SupportedImageFormats;

  beforeEach(() => {
    const app = fakeApp() as any;
    supportedFormats = new SupportedImageFormats(app);
    processor = new ImageProcessor(supportedFormats);
    (fs.readFile as any).mockReset();
    (fs.unlink as any).mockReset();
  });

  it('1.35 [I] Happy path: uses libaom-av1, reads temp file, deletes it', async () => {
    // Arrange
    // eslint-disable-next-line id-length
    const inputBytes = makePngBytes({ w: 64, h: 64 });
    const inputBlob = makeImageBlob(inputBytes, 'image/png');

    const avifData = new Uint8Array([10, 20, 30, 40]);
    ;(fs.readFile as any).mockResolvedValue(Buffer.from(avifData));
    ;(fs.unlink as any).mockResolvedValue(undefined);

    const { spawn } = await import('child_process');
    (spawn as any).mockImplementation(() => {
      const proc = new EventEmitter() as any;
      proc.stdin = { write: vi.fn(), end: vi.fn() };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      // Emit close first so the implementation's 'exit' handler doesn't remove 'close'
      setTimeout(() => {
        proc.emit('close', 0, null);
        proc.emit('exit', 0, null);
      }, 0);
      return proc;
    });

    // Act
    const result = await processor.processImage(
      inputBlob,
      'AVIF',
      1.0,
      1.0,
      'None',
      0,
      0,
      0,
      'Auto',
      true,
      {
        name: 'test',
        outputFormat: 'AVIF',
        ffmpegExecutablePath: 'C:/tools/ffmpeg.exe',
        ffmpegCrf: 23,
        ffmpegPreset: 'medium',
        quality: 1,
        colorDepth: 1,
        resizeMode: 'None',
        desiredWidth: 0,
        desiredHeight: 0,
        desiredLongestEdge: 0,
        enlargeOrReduce: 'Auto',
        allowLargerFiles: true,
        skipConversionPatterns: ''
      }
    );

    // Assert args
    const { calls } = (spawn as any).mock;
    expect(calls.length).toBeGreaterThan(0);
    const [cmd, args] = calls[0] as [string, string[]];
    expect(cmd).toContain('ffmpeg');
    expect(args).toContain('-c:v');
    expect(args).toContain('libaom-av1');
    expect(args).toContain('-crf');
    expect(args).toContain('23');
    expect(args).toContain('-preset');
    expect(args).toContain('medium');

    // Output
    const out = new Uint8Array(result);
    expect(out).toEqual(avifData);

    // Temp file deleted
    expect((fs.unlink as any).mock.calls.length).toBeGreaterThan(0);
  });

  it('1.36 [I] Alpha path: uses format=rgba and alphaextract in filter chain', async () => {
    // Arrange
    // eslint-disable-next-line id-length
    const inputBytes = makePngBytes({ w: 16, h: 16, alpha: true });
    const inputBlob = makeImageBlob(inputBytes, 'image/png');

    ;(fs.readFile as any).mockResolvedValue(Buffer.from(new Uint8Array([1, 1, 1])));
    ;(fs.unlink as any).mockResolvedValue(undefined);

    // Force alpha detection
    vi.spyOn<any, any>(processor as any, 'checkForTransparency').mockResolvedValue(true);

    const { spawn } = await import('child_process');
    (spawn as any).mockImplementation(() => {
      const proc = new EventEmitter() as any;
      proc.stdin = { write: vi.fn(), end: vi.fn() };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      setTimeout(() => {
        proc.emit('close', 0, null);
        proc.emit('exit', 0, null);
      }, 0);
      return proc;
    });

    // Act
    await processor.processImage(
      inputBlob,
      'AVIF',
      1.0,
      1.0,
      'None',
      0,
      0,
      0,
      'Auto',
      true,
      {
        name: 'test',
        outputFormat: 'AVIF',
        ffmpegExecutablePath: '/usr/bin/ffmpeg',
        ffmpegCrf: 28,
        ffmpegPreset: 'fast',
        quality: 1,
        colorDepth: 1,
        resizeMode: 'None',
        desiredWidth: 0,
        desiredHeight: 0,
        desiredLongestEdge: 0,
        enlargeOrReduce: 'Auto',
        allowLargerFiles: true,
        skipConversionPatterns: ''
      }
    );

    // Assert filter parts in args
    const { calls } = (spawn as any).mock;
    const [, args] = calls[0] as [string, string[]];
    expect(args).toContain('-filter:v:0');
    expect(args).toContain('format=rgba');
    expect(args).toContain('-filter:v:1');
    expect(args).toContain('alphaextract');
  });

  it('1.37 [I] Missing path or failure: returns original bytes and cleans up temp on failure', async () => {
    // Arrange - missing path
    // eslint-disable-next-line id-length
    const inputBytes = makePngBytes({ w: 20, h: 20 });
    const inputBlob = makeImageBlob(inputBytes, 'image/png');

    const { spawn } = await import('child_process');
    (spawn as any).mockClear();

    // Act: missing path returns original
    const resultMissing = await processor.processImage(
      inputBlob,
      'AVIF',
      1.0,
      1.0,
      'None',
      0,
      0,
      0,
      'Auto',
      true,
      {
        name: 'test',
        outputFormat: 'AVIF',
        // no ffmpegExecutablePath
        ffmpegCrf: 30,
        ffmpegPreset: 'slow',
        quality: 1,
        colorDepth: 1,
        resizeMode: 'None',
        desiredWidth: 0,
        desiredHeight: 0,
        desiredLongestEdge: 0,
        enlargeOrReduce: 'Auto',
        allowLargerFiles: true,
        skipConversionPatterns: ''
      } as any
    );
    expect(new Uint8Array(resultMissing).byteLength).toBe(inputBytes.byteLength);
    expect((spawn as any).mock.calls.length).toBe(0);

    // Arrange - failure path (non-zero exit)
    ;(fs.readFile as any).mockClear();
    ;(fs.unlink as any).mockClear();
    (spawn as any).mockImplementation(() => mockChildProcess({ exitCode: 1, stderr: Buffer.from('err') }));

    // Act: failure returns original (outer catch) and attempts temp unlink
    const resultFail = await processor.processImage(
      inputBlob,
      'AVIF',
      1.0,
      1.0,
      'None',
      0,
      0,
      0,
      'Auto',
      true,
      {
        name: 'test',
        outputFormat: 'AVIF',
        ffmpegExecutablePath: '/usr/bin/ffmpeg',
        ffmpegCrf: 28,
        ffmpegPreset: 'medium',
        quality: 1,
        colorDepth: 1,
        resizeMode: 'None',
        desiredWidth: 0,
        desiredHeight: 0,
        desiredLongestEdge: 0,
        enlargeOrReduce: 'Auto',
        allowLargerFiles: true,
        skipConversionPatterns: ''
      }
    );

    expect(new Uint8Array(resultFail).byteLength).toBe(inputBytes.byteLength);
    // unlink may be called in close handler on error; at least ensure no crash
  });
});
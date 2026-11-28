/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unnecessary-type-assertion */
import { describe, expect, it, vi } from 'vitest';
import { ImageProcessor } from '../../../src/ImageProcessor';
import { SupportedImageFormats } from '../../../src/SupportedImageFormats';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => { resolve = resolver; });
  return { promise, resolve };
}

function png(name: string): File {
  return new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });
}

describe('ImageProcessor concurrent settings isolation', () => {
  it('keeps each PNGQUANT preset path and quality with concurrent processImage calls', async () => {
    const formats = new SupportedImageFormats(undefined as any);
    const processor = new ImageProcessor(formats);
    const firstMimeStarted = deferred<void>();
    const releaseFirstMime = deferred<void>();
    const getMimeType = vi.spyOn(formats, 'getMimeTypeFromFile')
      .mockImplementationOnce(async () => {
        firstMimeStarted.resolve();
        await releaseFirstMime.promise;
        return 'image/png';
      })
      .mockResolvedValue('image/png');
    vi.spyOn(formats, 'isSupported').mockReturnValue(true);
    const pngquant = vi.spyOn(processor as any, 'processWithPngquant').mockResolvedValue(new ArrayBuffer(4));

    const first = processor.processImage(
      png('first.png'), 'PNGQUANT', 0.9, 1, 'None', 0, 0, 0, 'Auto', true,
      { name: 'First', pngquantExecutablePath: 'C:/tools/first.exe', pngquantQuality: '60-70' } as any,
      { pngquantQuality: '10-20' } as any
    );
    await firstMimeStarted.promise;

    const second = processor.processImage(
      png('second.png'), 'PNGQUANT', 0.8, 1, 'None', 0, 0, 0, 'Auto', true,
      { name: 'Second', pngquantExecutablePath: 'D:/tools/second.exe', pngquantQuality: '80-90' } as any,
      { pngquantQuality: '30-40' } as any
    );
    await Promise.resolve();
    expect(getMimeType).toHaveBeenCalledTimes(1);

    releaseFirstMime.resolve();
    await Promise.all([first, second]);

    expect(pngquant.mock.calls.map((call) => call.slice(1, 3))).toEqual([
      ['C:/tools/first.exe', '60-70'],
      ['D:/tools/second.exe', '80-90'],
    ]);
    // PNGQUANT without resizing detects MIME for conversion and EXIF orientation.
    expect(getMimeType.mock.calls.map(([file]) => (file as File).name).sort()).toEqual([
      'first.png', 'first.png', 'second.png', 'second.png',
    ]);
  });

  it('releases the conversion lock when processImageHelper rejects', async () => {
    const processor = new ImageProcessor(new SupportedImageFormats(undefined as any));
    const helper = vi.spyOn(processor as any, 'processImageHelper')
      .mockRejectedValueOnce(new Error('conversion failed'))
      .mockResolvedValue(new ArrayBuffer(2));
    const args = [png('retry.png'), 'NONE', 1, 1, 'None', 0, 0, 0, 'Auto', true] as const;

    await expect(processor.processImage(...args as any)).rejects.toThrow('conversion failed');
    await expect(processor.processImage(...args as any)).resolves.toBeInstanceOf(ArrayBuffer);
    expect(helper).toHaveBeenCalledTimes(2);
  });
});

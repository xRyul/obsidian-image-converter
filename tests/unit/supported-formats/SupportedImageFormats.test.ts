import { describe, it, expect } from 'vitest';
import { SupportedImageFormats } from '../../../src/SupportedImageFormats';
import { makePngBytes, makeJpegBytes, corruptedBytes, makeImageBlob } from '../../factories/image';
import { TFile, type App, type CachedMetadata, type MetadataCache } from 'obsidian';

function makeIsoBmffFtypBytes(majorBrand: string): ArrayBuffer {
  // Create a minimal ISO BMFF buffer: [size=0x00000018][ftyp][majorBrand][...]
  const buf = new ArrayBuffer(24);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);
  // size 24 bytes
  view.setUint32(0, 24, false);
  // 'ftyp'
  u8[4] = 'f'.charCodeAt(0);
  u8[5] = 't'.charCodeAt(0);
  u8[6] = 'y'.charCodeAt(0);
  u8[7] = 'p'.charCodeAt(0);
  // major brand (4 chars)
  u8[8] = majorBrand.charCodeAt(0);
  u8[9] = majorBrand.charCodeAt(1);
  u8[10] = majorBrand.charCodeAt(2);
  u8[11] = majorBrand.charCodeAt(3);
  // rest zeros are fine
  return buf;
}

function makeGifHeaderBytes(): ArrayBuffer {
  // 'GIF89a' header is common, but our detector only needs 'GIF8'
  const u8 = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  return u8.buffer;
}

function makeBmpHeaderBytes(): ArrayBuffer {
  // 'BM' at start
  const u8 = new Uint8Array([0x42, 0x4D, 0, 0, 0, 0]);
  return u8.buffer;
}

function makeTiffHeaderBytes(littleEndian: boolean): ArrayBuffer {
  // 'II' (0x49 0x49) or 'MM' (0x4D 0x4D)
  const u8 = new Uint8Array(8);
  if (littleEndian) {
    u8[0] = 0x49; u8[1] = 0x49;
  } else {
    u8[0] = 0x4D; u8[1] = 0x4D;
  }
  return u8.buffer;
}

function makeWebpHeaderBytes(): ArrayBuffer {
  // 'RIFF' + size + 'WEBP'
  const u8 = new Uint8Array(12);
  u8[0] = 0x52; u8[1] = 0x49; u8[2] = 0x46; u8[3] = 0x46; // RIFF
  // size (dummy)
  u8[4] = 0x00; u8[5] = 0x00; u8[6] = 0x00; u8[7] = 0x00;
  // 'WEBP'
  u8[8] = 0x57; u8[9] = 0x45; u8[10] = 0x42; u8[11] = 0x50;
  return u8.buffer;
}

function makeApp(opts?: { frontmatter?: Record<string, unknown> }): App {
  // Note: We intentionally do NOT try to implement the full Obsidian MetadataCache
  // interface here (it has many overloads, e.g. `on()` returns EventRef). We only
  // provide the members exercised by SupportedImageFormats, then cast.
  const metadataCache = {
    resolvedLinks: {},
    unresolvedLinks: {},
    getFileCache: () => ({ frontmatter: opts?.frontmatter } as unknown as CachedMetadata),
    getCache: () => ({}),
    getFirstLinkpathDest: () => null,
    on: () => ({}),
    off: () => {},
    trigger: () => {},
    tryTrigger: () => {},
  } as unknown as MetadataCache;

  const app = {
    vault: {},
    metadataCache,
    workspace: {},
    fileManager: {},
    internalPlugins: {},
    plugins: {},
    loadLocalStorage: () => null,
    saveLocalStorage: () => {},
  };

  return app as unknown as App;
}

describe('SupportedImageFormats — extension-based support (6.1–6.4, 6.10–6.11)', () => {
  const formats = new SupportedImageFormats(makeApp());

  it('Given JPEG filename .jpg/.jpeg (any case), When checked, Then isSupported returns true (6.1, 6.10)', () => {
    expect(formats.isSupported(undefined, 'photo.jpg')).toBe(true);
    expect(formats.isSupported(undefined, 'photo.JPEG')).toBe(true);
    expect(formats.isSupported(undefined, 'photo.Jpg')).toBe(true);
  });

  it('Given PNG filename .png, When checked, Then isSupported returns true (6.2)', () => {
    expect(formats.isSupported(undefined, 'img.png')).toBe(true);
  });

  it('Given WEBP filename .webp, When checked, Then isSupported returns true (6.3)', () => {
    expect(formats.isSupported(undefined, 'img.webp')).toBe(true);
  });

  it('Given GIF filename .gif, When checked, Then isSupported returns true (6.4)', () => {
    expect(formats.isSupported(undefined, 'anim.gif')).toBe(true);
  });

  it('Given invalid extension, When checked, Then isSupported returns false (6.11)', () => {
    expect(formats.isSupported(undefined, 'doc.txt')).toBe(false);
    expect(formats.isSupported(undefined, 'file.doc')).toBe(false);
  });

  it('Given conflicting MIME and extension, When MIME is supported and extension is not, Then MIME takes precedence (contract)', () => {
    expect(formats.isSupported('image/png', 'file.txt')).toBe(true);
  });
});

describe('SupportedImageFormats — getMimeTypeFromCache (frontmatter) (6.19–6.22)', () => {
  it('Given cache frontmatter mime is supported with surrounding whitespace, When read, Then returns trimmed mime (6.19)', () => {
    const formats = new SupportedImageFormats(makeApp({ frontmatter: { mime: ' image/png ' } }));
    expect(formats.getMimeTypeFromCache(new TFile())).toBe('image/png');
  });

  it('Given cache frontmatter mime is arbitrary string and type is supported, When read, Then ignores mime and returns supported type (6.20)', () => {
    const formats = new SupportedImageFormats(makeApp({ frontmatter: { mime: 'photo', type: 'image/jpeg' } }));
    expect(formats.getMimeTypeFromCache(new TFile())).toBe('image/jpeg');
  });

  it('Given cache frontmatter mime is syntactically valid but unsupported, When read, Then returns undefined (6.21)', () => {
    const formats = new SupportedImageFormats(makeApp({ frontmatter: { mime: 'image/unknown' } }));
    expect(formats.getMimeTypeFromCache(new TFile())).toBeUndefined();
  });

  it('Given cache frontmatter mime is empty/whitespace, When read, Then returns undefined (6.22)', () => {
    const formatsEmpty = new SupportedImageFormats(makeApp({ frontmatter: { mime: '' } }));
    expect(formatsEmpty.getMimeTypeFromCache(new TFile())).toBeUndefined();

    const formatsWhitespace = new SupportedImageFormats(makeApp({ frontmatter: { mime: '   ' } }));
    expect(formatsWhitespace.getMimeTypeFromCache(new TFile())).toBeUndefined();
  });
});

describe('SupportedImageFormats — header-based MIME detection (6.5–6.9, 6.18)', () => {
  const formats = new SupportedImageFormats(makeApp());

  it('Given PNG header, When detected from Blob, Then returns image/png (6.9)', async () => {
    const blob = makeImageBlob(makePngBytes({}), 'application/octet-stream');
    await expect(formats.getMimeTypeFromFile(blob)).resolves.toBe('image/png');
  });

  it('Given JPEG header, When detected from Blob, Then returns image/jpeg (6.9)', async () => {
    const blob = makeImageBlob(makeJpegBytes({}), 'application/octet-stream');
    await expect(formats.getMimeTypeFromFile(blob)).resolves.toBe('image/jpeg');
  });

  it('Given GIF header, When detected from Blob, Then returns image/gif (6.9)', async () => {
    const blob = makeImageBlob(makeGifHeaderBytes(), 'application/octet-stream');
    await expect(formats.getMimeTypeFromFile(blob)).resolves.toBe('image/gif');
  });

  it('Given BMP header, When detected from Blob, Then returns image/bmp (6.7, 6.9)', async () => {
    const blob = makeImageBlob(makeBmpHeaderBytes(), 'application/octet-stream');
    await expect(formats.getMimeTypeFromFile(blob)).resolves.toBe('image/bmp');
  });

  it('Given TIFF header II or MM, When detected from Blob, Then returns image/tiff (6.6, 6.9)', async () => {
    const blobII = makeImageBlob(makeTiffHeaderBytes(true), 'application/octet-stream');
    const blobMM = makeImageBlob(makeTiffHeaderBytes(false), 'application/octet-stream');
    await expect(formats.getMimeTypeFromFile(blobII)).resolves.toBe('image/tiff');
    await expect(formats.getMimeTypeFromFile(blobMM)).resolves.toBe('image/tiff');
  });

  it('Given WEBP RIFF header with WEBP signature, When detected, Then returns image/webp (6.9)', async () => {
    const blob = makeImageBlob(makeWebpHeaderBytes(), 'application/octet-stream');
    await expect(formats.getMimeTypeFromFile(blob)).resolves.toBe('image/webp');
  });

  it.each([
    'heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'
  ])('Given HEIC/HEIF ftyp=%s, When detected, Then returns image/heic (6.5)', async (brand) => {
    const blob = makeImageBlob(makeIsoBmffFtypBytes(brand), 'application/octet-stream');
    await expect(formats.getMimeTypeFromFile(blob)).resolves.toBe('image/heic');
  });

  it.each([
    'avif', 'avis'
  ])('Given AVIF ftyp=%s, When detected, Then returns image/avif (6.18)', async (brand) => {
    const blob = makeImageBlob(makeIsoBmffFtypBytes(brand), 'application/octet-stream');
    await expect(formats.getMimeTypeFromFile(blob)).resolves.toBe('image/avif');
  });
});

describe('SupportedImageFormats — SVG and Blob.type fallback (6.8, 6.12, 6.13)', () => {
  const formats = new SupportedImageFormats(makeApp());

  it('Given image/svg+xml type on Blob but unknown header, When detecting, Then returns image/svg+xml (6.8, 6.12)', async () => {
    const blob = makeImageBlob(new ArrayBuffer(10), 'image/svg+xml');
    await expect(formats.getMimeTypeFromFile(blob)).resolves.toBe('image/svg+xml');
  });

  it('Given recognizable header, When Blob.type is generic, Then header wins (6.12)', async () => {
    const blob = makeImageBlob(makeWebpHeaderBytes(), 'application/octet-stream');
    await expect(formats.getMimeTypeFromFile(blob)).resolves.toBe('image/webp');
  });

  it('Given unrecognized header and no Blob.type, When detecting, Then returns "unknown" (6.12)', async () => {
    const blob = makeImageBlob(corruptedBytes(24), '');
    await expect(formats.getMimeTypeFromFile(blob)).resolves.toBe('unknown');
  });

  it('Given very short/corrupted data and no type, When detecting, Then returns "unknown" and does not throw (6.13)', async () => {
    const blob = new Blob([new Uint8Array([0xFF])], { type: '' });
    await expect(formats.getMimeTypeFromFile(blob)).resolves.toBe('unknown');
  });

  it('Given .svg filename, When isSupported called, Then returns true (6.8)', () => {
    expect(formats.isSupported(undefined, 'vector.svg')).toBe(true);
  });
});

describe('SupportedImageFormats — Excalidraw detection (6.14–6.17)', () => {
  const formats = new SupportedImageFormats(makeApp());

  it('Given image element with Excalidraw-specific classes, When checked, Then isExcalidrawImage returns true (6.14)', () => {
    const classes = ['excalidraw-svg', 'excalidraw-embedded-img', 'excalidraw-canvas-immersive'];
    for (const cls of classes) {
      const img = document.createElement('img');
      img.classList.add(cls);
      expect(formats.isExcalidrawImage(img)).toBe(true);
    }
  });

  it('Given image inside .excalidraw-svg container, When checked, Then returns true (6.15)', () => {
    const container = document.createElement('div');
    container.className = 'excalidraw-svg';
    const img = document.createElement('img');
    container.appendChild(img);
    document.body.appendChild(container);
    expect(formats.isExcalidrawImage(img)).toBe(true);
    container.remove();
  });

  it('Given image within .internal-embed having src with "Excalidraw/", When checked, Then returns true (6.15)', () => {
    const embed = document.createElement('div');
    embed.className = 'internal-embed';
    embed.setAttribute('src', 'Some/Path/Excalidraw/file');
    const img = document.createElement('img');
    embed.appendChild(img);
    document.body.appendChild(embed);
    expect(formats.isExcalidrawImage(img)).toBe(true);
    embed.remove();
  });

  it('Given image with filesource pointing to Excalidraw file, When checked, Then returns true (6.16)', () => {
    const img1 = document.createElement('img');
    img1.setAttribute('filesource', '/vault/Excalidraw/image.png');
    expect(formats.isExcalidrawImage(img1)).toBe(true);

    const img2 = document.createElement('img');
    img2.setAttribute('filesource', '/vault/Image.excalidraw.md');
    expect(formats.isExcalidrawImage(img2)).toBe(true);
  });

  it('Given blob: src and Excalidraw context (filesource or container), When checked, Then returns true (6.17)', () => {
    // blob: + filesource
    const img1 = document.createElement('img');
    img1.setAttribute('src', 'blob:some-url');
    img1.setAttribute('filesource', '/vault/Excalidraw/image.png');
    expect(formats.isExcalidrawImage(img1)).toBe(true);

    // blob: + within container
    const container = document.createElement('div');
    container.className = 'excalidraw-svg';
    const img2 = document.createElement('img');
    img2.setAttribute('src', 'blob:another');
    container.appendChild(img2);
    document.body.appendChild(container);
    expect(formats.isExcalidrawImage(img2)).toBe(true);
    container.remove();
  });
});

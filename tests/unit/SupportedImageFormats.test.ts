/**
 * SupportedImageFormats unit tests
 *
 * Coverage mapping to memory-bank/TEST_CHECKLIST.md:
 * - 6.1 JPEG detection — Identify .jpg/.jpeg files
 * - 6.2 PNG detection — Identify .png files
 * - 6.3 WEBP detection — Identify .webp files
 * - 6.9 MIME type detection from header — Read magic bytes
 * - 6.10 Extension case insensitivity — Handle .JPG, .Jpg
 * - 6.11 Invalid format rejection — Reject .txt, .doc
 * - 6.13 Corrupted header handling — Handle bad magic bytes
 * - 6.14 Excalidraw image detection — Exclude via class names/containers/filesource/blob
 */
import { describe, it, expect } from 'vitest';
import { SupportedImageFormats } from '../../src/SupportedImageFormats';
import { App } from 'obsidian';

// Helper to ensure BlobPart gets a real ArrayBuffer
function toStrictArrayBuffer(u8: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(u8.byteLength);
  new Uint8Array(ab).set(u8);
  return ab;
}

describe('SupportedImageFormats', () => {
  let formats: SupportedImageFormats;

  beforeEach(() => {
    formats = new SupportedImageFormats(new App());
  });

  // 6.1 JPEG detection
  it('[6.1] Given mime image/jpeg, When checking support, Then returns true', () => {
    expect(formats.isSupported('image/jpeg')).toBe(true);
  });

  // 6.2 PNG detection
  it('[6.2] Given mime image/png, When checking support, Then returns true', () => {
    expect(formats.isSupported('image/png')).toBe(true);
  });

  // 6.3 WEBP detection
  it('[6.3] Given mime image/webp, When checking support, Then returns true', () => {
    expect(formats.isSupported('image/webp')).toBe(true);
  });

  // 6.10 Extension case insensitivity
  it('[6.10] Given filename Photo.JPG (no mime), When checking support, Then returns true', () => {
    expect(formats.isSupported(undefined, 'Photo.JPG')).toBe(true);
  });

  // 6.11 Invalid format rejection
  it('[6.11] Given filename notes.txt (no mime), When checking support, Then returns false', () => {
    expect(formats.isSupported(undefined, 'notes.txt')).toBe(false);
  });

  // 6.9 MIME type detection from header - PNG
  it('[6.9] Given PNG header bytes, When detecting mime from file, Then returns image/png', async () => {
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const blob = new Blob([toStrictArrayBuffer(pngHeader)]);
    await expect(formats.getMimeTypeFromFile(blob)).resolves.toBe('image/png');
  });

  // 6.9 MIME type detection from header - JPEG
  it('[6.9] Given JPEG header bytes, When detecting mime from file, Then returns image/jpeg', async () => {
    const jpegHeader = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]);
    const blob = new Blob([toStrictArrayBuffer(jpegHeader)]);
    await expect(formats.getMimeTypeFromFile(blob)).resolves.toBe('image/jpeg');
  });

  // 6.9 MIME type detection from header - WEBP
  it('[6.9] Given WEBP header bytes, When detecting mime from file, Then returns image/webp', async () => {
    const arr = new Uint8Array(12);
    arr[0] = 0x52; // R
    arr[1] = 0x49; // I
    arr[2] = 0x46; // F
    arr[3] = 0x46; // F
    arr[8] = 0x57; // W
    arr[9] = 0x45; // E
    arr[10] = 0x42; // B
    arr[11] = 0x50; // P
    const blob = new Blob([toStrictArrayBuffer(arr)]);
    await expect(formats.getMimeTypeFromFile(blob)).resolves.toBe('image/webp');
  });

  // 6.9 MIME type detection from header - HEIC
  it('[6.9] Given HEIC header bytes (ftyp heic), When detecting mime from file, Then returns image/heic', async () => {
    // size(0x00000018), 'ftyp', major_brand 'heic'
    const bytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, // size
      0x66, 0x74, 0x79, 0x70, // ftyp
      0x68, 0x65, 0x69, 0x63, // heic
    ]);
    const blob = new Blob([toStrictArrayBuffer(bytes)]);
    await expect(formats.getMimeTypeFromFile(blob)).resolves.toBe('image/heic');
  });

  // 6.13 Corrupted header handling
  it('[6.13] Given random bytes with no known header and no type, When detecting mime, Then returns unknown', async () => {
    const bytes = new Uint8Array([0x12, 0x34, 0x56, 0x78, 0x9A]);
    const blob = new Blob([toStrictArrayBuffer(bytes)]);
    await expect(formats.getMimeTypeFromFile(blob)).resolves.toBe('unknown');
  });

  // 6.14 Excalidraw image detection — direct classes
  it('[6.14] Given <img> with excalidraw-svg class, When checking, Then isExcalidrawImage returns true', () => {
    const img = document.createElement('img');
    img.classList.add('excalidraw-svg');
    expect(formats.isExcalidrawImage(img)).toBe(true);
  });

  // 6.14 Excalidraw container detection — closest(".excalidraw-svg")
  it('[6.14] Given <img> inside a .excalidraw-svg container, When checking, Then returns true', () => {
    const container = document.createElement('div');
    container.classList.add('excalidraw-svg');
    const img = document.createElement('img');
    container.appendChild(img);
    document.body.appendChild(container);
    expect(formats.isExcalidrawImage(img)).toBe(true);
    document.body.removeChild(container);
  });

  // 6.14 Excalidraw file path detection — filesource endswith .excalidraw.md
  it('[6.14] Given <img filesource=".../file.excalidraw.md">, When checking, Then returns true', () => {
    const img = document.createElement('img');
    img.setAttribute('filesource', 'Drawings/file.excalidraw.md');
    expect(formats.isExcalidrawImage(img)).toBe(true);
  });

  // 6.14 Excalidraw internal-embed src attr
  it('[6.14] Given <img> under .internal-embed[src*="Excalidraw/"], When checking, Then returns true', () => {
    const wrapper = document.createElement('div');
    wrapper.classList.add('internal-embed');
    wrapper.setAttribute('src', 'Excalidraw/diagram.md');
    const img = document.createElement('img');
    wrapper.appendChild(img);
    document.body.appendChild(wrapper);
    expect(formats.isExcalidrawImage(img)).toBe(true);
    document.body.removeChild(wrapper);
  });

  // 6.14 Excalidraw blob URL handling with filesource or container
  it('[6.14] Given <img src="blob:..." filesource set>, When checking, Then returns true', () => {
    const img = document.createElement('img');
    img.setAttribute('src', 'blob:abc');
    img.setAttribute('filesource', 'Excalidraw/diagram.md');
    expect(formats.isExcalidrawImage(img)).toBe(true);
  });
});


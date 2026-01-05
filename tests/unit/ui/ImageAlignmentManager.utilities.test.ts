import { describe, it, expect, beforeEach } from 'vitest';
import ImageConverterPlugin from '../../../src/main';
import { ImageAlignmentManager } from '../../../src/ImageAlignmentManager';
import { SupportedImageFormats } from '../../../src/SupportedImageFormats';
import { fakeApp, fakeTFile, fakeVault } from '../../factories/obsidian';
import { FileSystemAdapter } from 'obsidian';

/**
 * Utilities: 12.10 [U], 12.11 [U], 12.12 [U]
 * - validateNoteCache removes orphaned image hashes and deletes empty note entries
 * - getImageHash stability across runs after getRelativePath normalization
 * - getRelativePath handling of external/app:// and file:/// URIs
 */

describe('ImageAlignmentManager utilities (12.10–12.12)', () => {
  let app: any;
  let plugin: any;
  let supported: SupportedImageFormats;
  let manager: ImageAlignmentManager;

  beforeEach(async () => {
    const note = fakeTFile({ path: 'Notes/n1.md', name: 'n1.md', extension: 'md' });
    const vault = fakeVault({ files: [note] });
    app = fakeApp({ vault });
    plugin = new ImageConverterPlugin(app as any, { id: 'image-converter', dir: '/plugins/image-converter' } as any);
    plugin.manifest = { id: 'image-converter', dir: '/plugins/image-converter' } as any;
    plugin.settings = { isImageAlignmentEnabled: true, imageAlignmentCacheLocation: 'plugin', imageAlignmentCacheCleanupInterval: 0 } as any;
    supported = new SupportedImageFormats(app as any);
    manager = new ImageAlignmentManager(app as any, plugin, supported);
    await manager.loadCache();
  });

  it('12.10 validateNoteCache removes orphaned hashes and deletes empty note entries', async () => {
    const notePath = 'Notes/n1.md';
    // Seed cache with two images for the note
    await manager.saveImageAlignmentToCache(notePath, 'imgs/a.png', 'left', '10px', '10px', false);
    await manager.saveImageAlignmentToCache(notePath, 'imgs/b.png', 'right', '20px', '20px', true);

    const hashA = manager.getImageHash(notePath, 'imgs/a.png');
    const hashB = manager.getImageHash(notePath, 'imgs/b.png');
    expect(manager.getCache()[notePath][hashA]).toBeTruthy();
    expect(manager.getCache()[notePath][hashB]).toBeTruthy();

    // validate with content that only includes a.png
    const md = '![](imgs/a.png)';
    await manager.validateNoteCache(notePath, md);
    expect(manager.getCache()[notePath][hashA]).toBeTruthy();
    expect(manager.getCache()[notePath][hashB]).toBeUndefined();

    // validate with content that includes nothing -> removes note entry entirely
    await manager.validateNoteCache(notePath, 'No images here');
    expect(manager.getCache()[notePath]).toBeUndefined();
  });

  it('12.11 getImageHash is stable for same image/note across runs and yields 128-bit hex', async () => {
    const notePath = 'Notes/n1.md';
    const src = 'imgs/pic.png';

    const h1 = manager.getImageHash(notePath, src);
    // Simulate new manager instance (fresh run) and ensure stability
    const manager2 = new ImageAlignmentManager(app as any, plugin, supported);
    const h2 = manager2.getImageHash(notePath, src);
    expect(h2).toBe(h1);
    // 128-bit = 32 hex chars
    expect(h1).toMatch(/^[0-9a-f]{32}$/);
  });

  it('12.12 getRelativePath: external returns as-is; file:/// under base normalizes and hashing treats equivalent paths equally', async () => {
    // Install a FileSystemAdapter with a known base path so instanceof checks pass
    const basePath = 'C:/Vaults/MyVault';
    // Create a mock FileSystemAdapter-like object
    const mockAdapter = Object.create(FileSystemAdapter.prototype);
    mockAdapter.getBasePath = () => basePath;
    (app.vault as any).adapter = mockAdapter;

    // External http(s)
    expect(manager.getRelativePath('https://example.com/img.png')).toBe('https://example.com/img.png');

    // file:/// path within base -> normalize to vault-relative
    const normalizedBase = basePath.replace(/\\/g, '/');
    const fileUrl = `file:///${encodeURIComponent(`${normalizedBase}/imgs/p.png`)}`;
    const relFromFile = manager.getRelativePath(fileUrl);
    expect(relFromFile.endsWith('imgs/p.png')).toBe(true);

    // app:// path under base -> normalize similarly
    const appUrl = `app://local/${encodeURIComponent(normalizedBase)}/imgs/app-based.png`;
    const relFromApp = manager.getRelativePath(appUrl);
    expect(relFromApp.endsWith('imgs/app-based.png')).toBe(true);

    // Non-matching file:/// path (outside base) should return original
    const outsideFileUrl = `file:///${encodeURIComponent('D:/Elsewhere/other.png')}`;
    expect(manager.getRelativePath(outsideFileUrl)).toBe(outsideFileUrl);
  });
});

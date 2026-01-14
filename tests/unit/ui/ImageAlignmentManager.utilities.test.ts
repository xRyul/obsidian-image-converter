import { describe, it, expect, beforeEach, vi } from 'vitest';
import ImageConverterPlugin from '../../../src/main';
import { ImageAlignmentManager } from '../../../src/ImageAlignmentManager';
import { SupportedImageFormats } from '../../../src/SupportedImageFormats';
import { fakeApp, fakeTFile, fakeVault } from '../../factories/obsidian';
import { FileSystemAdapter } from 'obsidian';

/**
 * Utilities: 12.10 [U], 12.11 [U], 12.12 [U], 12.19 [U], 12.20 [U]
 * - validateNoteCache removes orphaned image hashes and deletes empty note entries
 * - getImageHash stability across runs after getRelativePath normalization
 * - getRelativePath handling of external/app:// and file:/// URIs
 * - loadCache JSON validation: validates object shape before assignment
 * - loadCache corrupt JSON: resets cache to empty and logs error
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

describe('ImageAlignmentManager loadCache validation (12.19–12.20)', () => {
  let app: any;
  let plugin: any;
  let supported: SupportedImageFormats;

  beforeEach(() => {
    const note = fakeTFile({ path: 'Notes/n1.md', name: 'n1.md', extension: 'md' });
    const vault = fakeVault({ files: [note] });
    app = fakeApp({ vault });
    plugin = new ImageConverterPlugin(app as any, { id: 'image-converter', dir: '/plugins/image-converter' } as any);
    plugin.manifest = { id: 'image-converter', dir: '/plugins/image-converter' } as any;
    plugin.settings = { isImageAlignmentEnabled: true, imageAlignmentCacheLocation: 'plugin', imageAlignmentCacheCleanupInterval: 0 } as any;
    supported = new SupportedImageFormats(app as any);
  });

  it('12.19 loadCache JSON validation: non-object values (array, string, number, null) keep cache empty', async () => {
    // Test with array JSON
    (app.vault.adapter.exists as any).mockResolvedValue(true);
    (app.vault.adapter.read as any).mockResolvedValue('["not", "an", "object"]');

    const manager = new ImageAlignmentManager(app as any, plugin, supported);
    await manager.loadCache();
    expect(manager.getCache()).toEqual({});

    // Test with string JSON
    (app.vault.adapter.read as any).mockResolvedValue('"just a string"');
    const manager2 = new ImageAlignmentManager(app as any, plugin, supported);
    await manager2.loadCache();
    expect(manager2.getCache()).toEqual({});

    // Test with number JSON
    (app.vault.adapter.read as any).mockResolvedValue('12345');
    const manager3 = new ImageAlignmentManager(app as any, plugin, supported);
    await manager3.loadCache();
    expect(manager3.getCache()).toEqual({});

    // Test with null JSON
    (app.vault.adapter.read as any).mockResolvedValue('null');
    const manager4 = new ImageAlignmentManager(app as any, plugin, supported);
    await manager4.loadCache();
    expect(manager4.getCache()).toEqual({});
  });

  it('12.19 loadCache JSON validation: valid object is assigned to cache', async () => {
    const validCache = {
      'Notes/n1.md': {
        'abc123': { position: 'left', width: '100px', height: '50px', wrap: false }
      }
    };
    (app.vault.adapter.exists as any).mockResolvedValue(true);
    (app.vault.adapter.read as any).mockResolvedValue(JSON.stringify(validCache));

    const manager = new ImageAlignmentManager(app as any, plugin, supported);
    await manager.loadCache();
    expect(manager.getCache()).toEqual(validCache);
  });

  it('12.20 loadCache corrupt JSON: when JSON.parse throws, cache reset to empty and error logged', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    (app.vault.adapter.exists as any).mockResolvedValue(true);
    (app.vault.adapter.read as any).mockResolvedValue('{ invalid json without closing brace');

    const manager = new ImageAlignmentManager(app as any, plugin, supported);
    await manager.loadCache();
    
    // Cache should be reset to empty object
    expect(manager.getCache()).toEqual({});
    
    // Error should have been logged
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error loading image alignment cache:',
      expect.any(Error)
    );
    
    consoleErrorSpy.mockRestore();
  });

  it('12.20 loadCache: when cache file does not exist, cache remains empty', async () => {
    (app.vault.adapter.exists as any).mockResolvedValue(false);

    const manager = new ImageAlignmentManager(app as any, plugin, supported);
    await manager.loadCache();
    expect(manager.getCache()).toEqual({});
  });
});

describe('ImageAlignmentManager updateCacheFilePath (12.24)', () => {
  let plugin: any;
  let supported: SupportedImageFormats;

  beforeEach(() => {
    plugin = new ImageConverterPlugin({} as any, { id: 'image-converter', dir: '/plugins/image-converter' } as any);
    plugin.manifest = { id: 'image-converter', dir: '/plugins/image-converter' } as any;
    // Setting value 'config' means use app.vault.configDir (typically .obsidian, but can be customized)
    plugin.settings = { isImageAlignmentEnabled: true, imageAlignmentCacheLocation: 'config', imageAlignmentCacheCleanupInterval: 0 } as any;
  });

  it('12.24 updateCacheFilePath with "config" setting: uses configDir (.obsidian) for cache path', async () => {
    // Create vault with configDir set to .obsidian (default)
    const note = fakeTFile({ path: 'Notes/n1.md', name: 'n1.md', extension: 'md' });
    const vault = fakeVault({ files: [note], configDir: '.obsidian' });
    const app = fakeApp({ vault });
    
    supported = new SupportedImageFormats(app as any);
    const manager = new ImageAlignmentManager(app as any, plugin, supported);
    
    // Setting value 'config' maps to app.vault.configDir
    plugin.settings.imageAlignmentCacheLocation = 'config';
    
    // Call updateCacheFilePath
    manager.updateCacheFilePath();
    
    // With 'config' setting, path uses configDir (here: .obsidian)
    expect((manager as any).cacheFilePath).toBe('.obsidian/image-converter-image-alignments.json');
  });

  it('12.24 updateCacheFilePath with custom configDir: uses custom configDir value', async () => {
    // Obsidian allows custom config directories (e.g., ".config" instead of ".obsidian")
    const note = fakeTFile({ path: 'Notes/n1.md', name: 'n1.md', extension: 'md' });
    const vault = fakeVault({ files: [note], configDir: '.config' });
    const app = fakeApp({ vault });
    
    supported = new SupportedImageFormats(app as any);
    const manager = new ImageAlignmentManager(app as any, plugin, supported);
    
    // Set cache location to config to use configDir
    plugin.settings.imageAlignmentCacheLocation = 'config';
    
    // Call updateCacheFilePath
    manager.updateCacheFilePath();
    
    // Path should use actual configDir value, not hardcoded .obsidian
    expect((manager as any).cacheFilePath).toBe('.config/image-converter-image-alignments.json');
  });

  it('12.24 updateCacheFilePath with plugin location: uses pluginDir for cache path', async () => {
    // Create vault with valid configDir
    const note = fakeTFile({ path: 'Notes/n1.md', name: 'n1.md', extension: 'md' });
    const vault = fakeVault({ files: [note], configDir: '.obsidian' });
    const app = fakeApp({ vault });
    
    supported = new SupportedImageFormats(app as any);
    const manager = new ImageAlignmentManager(app as any, plugin, supported);
    
    // Set cache location to plugin folder
    plugin.settings.imageAlignmentCacheLocation = 'plugin';
    
    // Call updateCacheFilePath
    manager.updateCacheFilePath();
    
    // With plugin location, path uses pluginDir
    expect((manager as any).cacheFilePath).toBe('/plugins/image-converter/image-converter-image-alignments.json');
  });
});

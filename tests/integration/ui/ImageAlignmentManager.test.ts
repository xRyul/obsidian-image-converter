import { describe, it, expect, beforeEach, vi } from 'vitest';
import ImageConverterPlugin from '../../../src/main';
import { ImageAlignmentManager } from '../../../src/ImageAlignmentManager';
import { ImageAlignment } from '../../../src/ImageAlignment';
import { SupportedImageFormats } from '../../../src/SupportedImageFormats';
import { fakeApp, fakeTFile, fakeVault } from '../../factories/obsidian';

function setupDomWithImage(src: string) {
  document.body.innerHTML = '';
  const container = document.createElement('div');
  container.className = 'markdown-preview-view';
  const embed = document.createElement('div');
  embed.className = 'internal-embed image-embed';
  embed.setAttribute('src', src);
  const img = document.createElement('img');
  img.setAttribute('src', src);
  embed.appendChild(img);
  container.appendChild(embed);
  document.body.appendChild(container);
  return { img, embed };
}

function setupDomWithImages(srcs: string[]) {
  document.body.innerHTML = '';
  const container = document.createElement('div');
  container.className = 'markdown-preview-view';
  srcs.forEach((src) => {
    const embed = document.createElement('div');
    embed.className = 'internal-embed image-embed';
    embed.setAttribute('src', src);
    const img = document.createElement('img');
    img.setAttribute('src', src);
    embed.appendChild(img);
    container.appendChild(embed);
  });
  document.body.appendChild(container);
}

describe('ImageAlignmentManager (integration-lite) — 12.x behaviors', () => {
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
    plugin.settings = {
      isImageAlignmentEnabled: true,
      imageAlignmentDefaultAlignment: 'none',
      imageAlignmentCacheLocation: 'plugin',
      imageAlignmentCacheCleanupInterval: 0,
    } as any;
    supported = new SupportedImageFormats(app as any);
    manager = new ImageAlignmentManager(app as any, plugin, supported);
    await manager.loadCache();
  });

  // ========== 12.1 Context menu actions ==========
  describe('12.1 Context menu actions', () => {
    it('12.1.a updateImageAlignment toggles left/none and saves cache', async () => {
      const note = 'Notes/n1.md';
      const src = 'imgs/pic.png';
      const { img } = setupDomWithImage(src);
      (app.workspace.getActiveFile as any) = vi.fn(() => fakeTFile({ path: note }));

      const alignment = new ImageAlignment(app as any, plugin, manager);
      plugin.ImageAlignmentManager = manager;

      // First click sets left
      await alignment.updateImageAlignment(img as HTMLImageElement, { align: 'left', wrap: false });
      const hash = manager.getImageHash(note, src);
      expect(manager.getCache()[note][hash].position).toBe('left');
      expect(img.classList.contains('image-position-left')).toBe(true);

      // Second click on the same should toggle to none (saves position='none' to block default reapplication)
      // Note: Disk persistence is verified separately in test 12.4
      await alignment.updateImageAlignment(img as HTMLImageElement, { align: 'none', wrap: false });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(manager.getCache()[note][hash].position).toBe('none');
      expect(manager.getCache()[note][hash].wrap).toBe(false);
      expect(img.classList.contains('image-position-left')).toBe(false);

      // Verify position='none' blocks default reapplication
      plugin.settings.imageAlignmentDefaultAlignment = 'center';
      await manager.applyAlignmentsToNote(note);
      expect(img.classList.contains('image-position-center')).toBe(false);
      expect(img.classList.contains('image-converter-aligned')).toBe(false);
    });

    it('12.1.b selecting center/right applies classes and persists; align=none removes them', async () => {
      const note = 'Notes/n1.md';
      const src = 'imgs/pic.png';
      const { img } = setupDomWithImage(src);
      (app.workspace.getActiveFile as any) = vi.fn(() => fakeTFile({ path: note }));

      const alignment = new ImageAlignment(app as any, plugin, manager);
      plugin.ImageAlignmentManager = manager;

      // Center
      await alignment.updateImageAlignment(img as HTMLImageElement, { align: 'center', wrap: false });
      let hash = manager.getImageHash(note, src);
      expect(manager.getCache()[note][hash].position).toBe('center');
      expect(img.classList.contains('image-position-center')).toBe(true);

      // Right
      await alignment.updateImageAlignment(img as HTMLImageElement, { align: 'right', wrap: true });
      await new Promise(resolve => setTimeout(resolve, 0));
      hash = manager.getImageHash(note, src);
      expect(manager.getCache()[note][hash].position).toBe('right');
      expect(manager.getCache()[note][hash].wrap).toBe(true);
      expect(img.classList.contains('image-position-right')).toBe(true);
      expect(img.classList.contains('image-wrap')).toBe(true);

      // None -> saves position='none' (to block default reapplication) and removes CSS classes
      await alignment.updateImageAlignment(img as HTMLImageElement, { align: 'none', wrap: false });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(manager.getCache()[note][hash].position).toBe('none');
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(img.classList.contains('image-position-right')).toBe(false);
      expect(img.classList.contains('image-wrap')).toBe(false);

      // Verify position='none' blocks default reapplication
      plugin.settings.imageAlignmentDefaultAlignment = 'left';
      await manager.applyAlignmentsToNote(note);
      expect(img.classList.contains('image-position-left')).toBe(false);
      expect(img.classList.contains('image-converter-aligned')).toBe(false);
    });
  });

  // ========== 12.2 Wrap toggle ==========
  describe('12.2 Wrap toggle', () => {
    it('12.2.a enabling adds image-wrap; disabling adds image-no-wrap', async () => {
      const note = 'Notes/n1.md';
      const src = 'imgs/pic.png';
      const { img } = setupDomWithImage(src);
      (app.workspace.getActiveFile as any) = vi.fn(() => fakeTFile({ path: note }));

      const alignment = new ImageAlignment(app as any, plugin, manager);
      plugin.ImageAlignmentManager = manager;

      await alignment.updateImageAlignment(img as HTMLImageElement, { align: 'left', wrap: true });
      expect(img.classList.contains('image-wrap')).toBe(true);
      expect(img.classList.contains('image-no-wrap')).toBe(false);

      await alignment.updateImageAlignment(img as HTMLImageElement, { align: 'left', wrap: false });
      expect(img.classList.contains('image-no-wrap')).toBe(true);
    });

    it('12.2.b defaults to left when enabling wrap from none (policy: align=left)', async () => {
      const note = 'Notes/n1.md';
      const src = 'imgs/new.png';
      const { img } = setupDomWithImage(src);
      (app.workspace.getActiveFile as any) = vi.fn(() => fakeTFile({ path: note }));

      const alignment = new ImageAlignment(app as any, plugin, manager);
      plugin.ImageAlignmentManager = manager;

      const current = alignment.getCurrentImageAlignment(img as HTMLImageElement);
      expect((current as any).align).toBe('none');

      await alignment.updateImageAlignment(img as HTMLImageElement, { align: 'left', wrap: true });

      expect(img.classList.contains('image-position-left')).toBe(true);
      expect(img.classList.contains('image-wrap')).toBe(true);

      const hash = manager.getImageHash(note, src);
      expect(manager.getCache()[note][hash].position).toBe('left');
      expect(manager.getCache()[note][hash].wrap).toBe(true);
    });
  });

  // ========== 12.3 Persistence to cache ==========
  it('12.3 cache persistence: saveImageAlignmentToCache stores by note+src hash and survives save/load', async () => {
    const note = 'Notes/n1.md';
    const src = 'imgs/pic.png';
    await manager.saveImageAlignmentToCache(note, src, 'left', '120px', '80px', true);
    const hash = manager.getImageHash(note, src);
    expect(manager.getCache()[note][hash]).toEqual({ position: 'left', width: '120px', height: '80px', wrap: true });
  });

  // ========== 12.4 Cache file location ==========
  it('12.4 Cache file location: writes under plugin dir, then under .obsidian when setting changes', async () => {
    const writeSpy = vi.spyOn((app.vault as any).adapter, 'write');

    await manager.saveImageAlignmentToCache('Notes/n1.md', 'imgs/pic.png', 'left', '100px', '80px', true);
    expect(writeSpy).toHaveBeenCalledWith('/plugins/image-converter/image-converter-image-alignments.json', expect.any(String));

    plugin.settings.imageAlignmentCacheLocation = '.obsidian';
    manager.updateCacheFilePath();
    await manager.saveImageAlignmentToCache('Notes/n1.md', 'imgs/pic2.png', 'right', '120px', '60px', false);
    expect(writeSpy).toHaveBeenCalledWith('.obsidian/image-converter-image-alignments.json', expect.any(String));
  });

  // ========== 12.5 Apply on note open/layout ==========
  it('12.5 applyAlignmentsToNote: applies classes and size to both image and parent embed', async () => {
    const note = 'Notes/n1.md';
    const src = 'imgs/pic.png';
    await manager.saveImageAlignmentToCache(note, src, 'center', '200px', '100px', false);

    const { img, embed } = setupDomWithImage(src);
    (app.workspace.getActiveFile as any) = vi.fn(() => fakeTFile({ path: note }));

    await manager.applyAlignmentsToNote(note);

    expect(img.classList.contains('image-converter-aligned')).toBe(true);
    expect(img.classList.contains('image-position-center')).toBe(true);
    expect(img.classList.contains('image-no-wrap')).toBe(true);
    expect((img as any).style.width).toBe('200px');
    expect((img as any).style.height).toBe('100px');

    expect(embed.classList.contains('image-position-center')).toBe(true);
    expect(embed.classList.contains('image-no-wrap')).toBe(true);
  });

  // ========== 12.6 Reading vs edit mode ==========
  it('12.6 Reading vs edit mode: classes applied to image and parent embed regardless of mode', async () => {
    const notePath = 'Notes/n1.md';
    const src = 'imgs/pic.png';
    await manager.saveImageAlignmentToCache(notePath, src, 'right', '111px', '77px', true);

    setupDomWithImages([src]);
    await manager.applyAlignmentsToNote(notePath);

    const img = document.querySelector('img') as HTMLImageElement;
    const embed = (img as any)!.matchParent('.internal-embed.image-embed')!;

    expect(img.classList.contains('image-position-right')).toBe(true);
    expect(embed.classList.contains('image-position-right')).toBe(true);
    expect(img.classList.contains('image-wrap')).toBe(true);
    expect(embed.classList.contains('image-wrap')).toBe(true);
    expect((img as any).style.width).toBe('111px');
    expect((img as any).style.height).toBe('77px');
  });

  // ========== 12.7 Multiple images ==========
  it('12.7 Multiple images: distinct cache entries applied per image', async () => {
    const notePath = 'Notes/n1.md';
    const srcA = 'imgs/a.png';
    const srcB = 'imgs/b.png';
    await manager.saveImageAlignmentToCache(notePath, srcA, 'left', '50px', '25px', false);
    await manager.saveImageAlignmentToCache(notePath, srcB, 'center', '60px', '30px', true);

    setupDomWithImages([srcA, srcB]);
    await manager.applyAlignmentsToNote(notePath);

    const [imgA, imgB] = Array.from(document.querySelectorAll('img')) as HTMLImageElement[];
    expect(imgA.classList.contains('image-position-left')).toBe(true);
    expect((imgA as any).style.width).toBe('50px');
    expect(imgB.classList.contains('image-position-center')).toBe(true);
    expect((imgB as any).style.width).toBe('60px');
  });

  // ========== 12.8 Rename/delete consistency ==========
  describe('12.8 Rename/delete consistency', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('12.8 remaps keys on image rename and removes entries on delete', async () => {
      const notePath = 'Notes/n1.md';
      const imgAPath = 'imgs/a.png';

      await manager.saveImageAlignmentToCache(notePath, imgAPath, 'left', '50px', '25px', false);
      const oldHash = manager.getImageHash(notePath, imgAPath);
      expect(manager.getCache()[notePath][oldHash]).toBeTruthy();

      const fileObj = fakeTFile({ path: imgAPath, name: 'a.png', extension: 'png' });
      ((app.vault as any).getFiles as any).mockReturnValue([fileObj]);
      const oldPath = fileObj.path;
      fileObj.path = 'imgs/a-renamed.png';
      fileObj.name = 'a-renamed.png';

      const onMock = (app.vault as any).on as any;
      const renameCall = onMock.mock.calls.find((callArgs: any[]) => callArgs[0] === 'rename');
      expect(renameCall).toBeTruthy();
      const renameHandler = renameCall[1] as (file: any, oldPath: string) => Promise<void> | void;
      await renameHandler(fileObj, oldPath);

      const newHash = manager.getImageHash(notePath, 'imgs/a-renamed.png');
      expect(manager.getCache()[notePath][newHash]).toBeTruthy();
      expect(manager.getCache()[notePath][oldHash]).toBeUndefined();

      const deleteCall = (app.vault as any).on.mock.calls.find((callArgs: any[]) => callArgs[0] === 'delete');
      expect(deleteCall).toBeTruthy();
      const deleteHandler = deleteCall[1] as (file: any) => Promise<void> | void;
      await (app.vault as any).delete(fileObj);
      ((app.vault as any).getFiles as any).mockReturnValue([]);
      await deleteHandler(fileObj);
      await manager.cleanCache();
      expect(manager.getCache()[notePath]?.[newHash]).toBeUndefined();
    });
  });

  // ========== 12.9 Cache cleanup ==========
  describe('12.9 Cache cleanup', () => {
    it('12.9.a removes entries whose images no longer exist in vault', async () => {
      const notePath = 'Notes/n1.md';
      const present = 'imgs/exists.png';
      const missing = 'imgs/missing.png';

      const realFile = fakeTFile({ path: present, name: 'exists.png', extension: 'png' });
      ((app.vault as any).getFiles as any).mockReturnValueOnce([realFile]).mockReturnValue([realFile]);

      await manager.saveImageAlignmentToCache(notePath, present, 'left', '10px', '10px', false);
      await manager.saveImageAlignmentToCache(notePath, missing, 'left', '10px', '10px', false);

      await manager.cleanCache();

      const noteCache = manager.getCache()[notePath];
      const remaining = Object.values(noteCache);
      expect(remaining.length).toBe(1);
      expect((remaining[0] as any).position).toBe('left');
    });

    it('12.9.b persists updated cache file after pruning', async () => {
      const writeSpy = vi.spyOn((app.vault as any).adapter, 'write');

      const notePath = 'Notes/n1.md';
      const missing = 'imgs/missing.png';

      await manager.saveImageAlignmentToCache(notePath, missing, 'left', '10px', '10px', false);
      ((app.vault as any).getFiles as any).mockReturnValue([]);

      await manager.cleanCache();

      expect(writeSpy).toHaveBeenCalled();
      expect(manager.getCache()[notePath]).toBeUndefined();
    });
  });

  // ========== 12.10-12.12 are unit tests in ImageAlignmentManager.utilities.test.ts ==========

  // ========== 12.13 ensureDefaultAlignment ==========
  describe('12.13 ensureDefaultAlignment', () => {
    it('12.13.a creates cache entry and returns true when no alignment exists for image', async () => {
      const notePath = 'Notes/n1.md';
      const src = 'imgs/new-image.png';

      const hash = manager.getImageHash(notePath, src);
      expect(manager.getCache()[notePath]?.[hash]).toBeUndefined();

      const result = await manager.ensureDefaultAlignment(notePath, src, 'center', false);

      expect(result).toBe(true);
      expect(manager.getCache()[notePath][hash]).toEqual({
        position: 'center',
        width: '',
        height: '',
        wrap: false,
      });
    });

    it('12.13.b returns false and does not overwrite when alignment already exists', async () => {
      const notePath = 'Notes/n1.md';
      const src = 'imgs/existing.png';

      await manager.saveImageAlignmentToCache(notePath, src, 'left', '100px', '50px', true);
      const hash = manager.getImageHash(notePath, src);
      const originalEntry = { ...manager.getCache()[notePath][hash] };

      const result = await manager.ensureDefaultAlignment(notePath, src, 'right', false);

      expect(result).toBe(false);
      expect(manager.getCache()[notePath][hash]).toEqual(originalEntry);
    });

    it('12.13.c returns false for empty notePath or imageSrc', async () => {
      expect(await manager.ensureDefaultAlignment('', 'imgs/pic.png', 'center')).toBe(false);
      expect(await manager.ensureDefaultAlignment('Notes/n1.md', '', 'center')).toBe(false);
    });

    it('12.13.d normalizes imageSrc via getRelativePath before checking/saving', async () => {
      const notePath = 'Notes/n1.md';
      const rawSrc = 'imgs/pic.png?v=123';
      const normalizedSrc = 'imgs/pic.png';

      const result = await manager.ensureDefaultAlignment(notePath, rawSrc, 'left', true);
      expect(result).toBe(true);

      const hash = manager.getImageHash(notePath, normalizedSrc);
      expect(manager.getCache()[notePath][hash]).toBeTruthy();
      expect(manager.getCache()[notePath][hash].position).toBe('left');
      expect(manager.getCache()[notePath][hash].wrap).toBe(true);
    });
  });

  // ========== 12.14-12.18 applyAlignmentsToNote default alignment behavior ==========
  describe('12.14-12.18 applyAlignmentsToNote default alignment behavior', () => {
    it('12.14 applies default alignment to images with no cache entry when defaults are enabled', async () => {
      const notePath = 'Notes/n1.md';
      const src = 'imgs/new-image.png';

      plugin.settings.isImageAlignmentEnabled = true;
      plugin.settings.imageAlignmentDefaultAlignment = 'center';

      const { img } = setupDomWithImage(src);
      (app.workspace.getActiveFile as any) = vi.fn(() => fakeTFile({ path: notePath }));

      const hash = manager.getImageHash(notePath, src);
      expect(manager.getCache()[notePath]?.[hash]).toBeUndefined();

      await manager.applyAlignmentsToNote(notePath);

      expect(img.classList.contains('image-converter-aligned')).toBe(true);
      expect(img.classList.contains('image-position-center')).toBe(true);
      expect(img.classList.contains('image-no-wrap')).toBe(true);
      expect(manager.getCache()[notePath][hash]).toBeTruthy();
      expect(manager.getCache()[notePath][hash].position).toBe('center');
    });

    it("12.15 does NOT apply default alignment when imageAlignmentDefaultAlignment is none", async () => {
		const notePath = "Notes/n1.md";
		const src = "imgs/another.png";

		plugin.settings.isImageAlignmentEnabled = true;
		plugin.settings.imageAlignmentDefaultAlignment = "none";

		const { img } = setupDomWithImage(src);
		(app.workspace.getActiveFile as any) = vi.fn(() =>
			fakeTFile({ path: notePath })
		);

		await manager.applyAlignmentsToNote(notePath);

		expect(img.classList.contains("image-converter-aligned")).toBe(false);
		expect(img.classList.contains("image-position-center")).toBe(false);
		expect(img.classList.contains("image-position-left")).toBe(false);
		expect(img.classList.contains("image-position-right")).toBe(false);
		const hash = manager.getImageHash(notePath, src);
		expect(manager.getCache()[notePath]?.[hash]).toBeUndefined();
	});

    it('12.16 does NOT apply default alignment when isImageAlignmentEnabled is false', async () => {
      const notePath = 'Notes/n1.md';
      const src = 'imgs/disabled.png';

      plugin.settings.isImageAlignmentEnabled = false;
      plugin.settings.imageAlignmentDefaultAlignment = 'center';

      const { img } = setupDomWithImage(src);
      (app.workspace.getActiveFile as any) = vi.fn(() => fakeTFile({ path: notePath }));

      await manager.applyAlignmentsToNote(notePath);

      expect(img.classList.contains('image-converter-aligned')).toBe(false);
      const hash = manager.getImageHash(notePath, src);
      expect(manager.getCache()[notePath]?.[hash]).toBeUndefined();
    });

    it('12.17 applies cached alignment when it exists, ignoring default setting', async () => {
      const notePath = 'Notes/n1.md';
      const src = 'imgs/cached.png';

      plugin.settings.isImageAlignmentEnabled = true;
      plugin.settings.imageAlignmentDefaultAlignment = 'center';

      await manager.saveImageAlignmentToCache(notePath, src, 'left', '100px', '50px', true);

      const { img } = setupDomWithImage(src);
      (app.workspace.getActiveFile as any) = vi.fn(() => fakeTFile({ path: notePath }));

      await manager.applyAlignmentsToNote(notePath);

      expect(img.classList.contains('image-position-left')).toBe(true);
      expect(img.classList.contains('image-position-center')).toBe(false);
      expect(img.classList.contains('image-wrap')).toBe(true);
      expect((img as any).style.width).toBe('100px');
    });

    it('12.18 applies different alignments to multiple images: cached and default', async () => {
      const notePath = 'Notes/n1.md';
      const srcCached = 'imgs/cached.png';
      const srcNew = 'imgs/new.png';

      plugin.settings.isImageAlignmentEnabled = true;
      plugin.settings.imageAlignmentDefaultAlignment = 'right';

      await manager.saveImageAlignmentToCache(notePath, srcCached, 'left', '80px', '40px', false);

      setupDomWithImages([srcCached, srcNew]);
      (app.workspace.getActiveFile as any) = vi.fn(() => fakeTFile({ path: notePath }));

      await manager.applyAlignmentsToNote(notePath);

      const [imgCached, imgNew] = Array.from(document.querySelectorAll('img')) as HTMLImageElement[];

      expect(imgCached.classList.contains('image-position-left')).toBe(true);
      expect((imgCached as any).style.width).toBe('80px');

      expect(imgNew.classList.contains('image-position-right')).toBe(true);
      const hashNew = manager.getImageHash(notePath, srcNew);
      expect(manager.getCache()[notePath][hashNew].position).toBe('right');
    });
  });

  // ========== 12.21 saveCache pluginDir guard ==========
  describe('12.21 saveCache pluginDir guard', () => {
    it('12.21 saveCache: when pluginDir is empty, returns early without writing', async () => {
      // Spy on console.error BEFORE creating the manager to capture all errors
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      // Create a manager with an empty pluginDir by mocking manifest.dir as undefined
      const note = fakeTFile({ path: 'Notes/n1.md', name: 'n1.md', extension: 'md' });
      const vault = fakeVault({ files: [note] });
      const testApp = fakeApp({ vault });
      const testPlugin = new ImageConverterPlugin(testApp as any, { id: 'image-converter', dir: undefined } as any);
      testPlugin.manifest = { id: 'image-converter', dir: undefined } as any;
      testPlugin.settings = {
        isImageAlignmentEnabled: true,
        imageAlignmentDefaultAlignment: 'none',
        imageAlignmentCacheLocation: 'plugin',
        imageAlignmentCacheCleanupInterval: 0,
      } as any;
      
      const testSupported = new SupportedImageFormats(testApp as any);
      const testManager = new ImageAlignmentManager(testApp as any, testPlugin, testSupported);
      
      // Verify console.error was called during construction (when getPluginDir fails)
      expect(consoleErrorSpy).toHaveBeenCalledWith('Could not determine plugin directory');
      
      const writeSpy = vi.spyOn((testApp.vault as any).adapter, 'write');
      
      // Manually set some cache data
      (testManager as any).cache = { 'Notes/n1.md': { 'hash123': { position: 'left', wrap: false } } };
      
      // Try to save - should return early because pluginDir is empty
      await testManager.saveCache();
      
      // Verify that write was NOT called due to empty pluginDir guard
      expect(writeSpy).not.toHaveBeenCalled();
      
      // Verify console.error was also called during saveCache (Plugin directory not found)
      expect(consoleErrorSpy).toHaveBeenCalledWith('Plugin directory not found');
      
      consoleErrorSpy.mockRestore();
    });
  });

  // ========== 12.22 initialize error handling ==========
  describe('12.22 initialize error handling', () => {
    it('12.22 when applyAlignmentsToNote throws, error is caught and logged, initialization completes', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      const note = fakeTFile({ path: 'Notes/n1.md', name: 'n1.md', extension: 'md' });
      const vault = fakeVault({ files: [note] });
      const testApp = fakeApp({ vault });
      
      // Mock getActiveFile to return a file so applyAlignmentsToNote will be called
      (testApp.workspace!.getActiveFile as any) = vi.fn(() => note);
      
      const testPlugin = new ImageConverterPlugin(testApp as any, { id: 'image-converter', dir: '/plugins/image-converter' } as any);
      testPlugin.manifest = { id: 'image-converter', dir: '/plugins/image-converter' } as any;
      testPlugin.settings = {
        isImageAlignmentEnabled: true,
        imageAlignmentDefaultAlignment: 'none',
        imageAlignmentCacheLocation: 'plugin',
        imageAlignmentCacheCleanupInterval: 0,
      } as any;
      
      const testSupported = new SupportedImageFormats(testApp as any);
      const testManager = new ImageAlignmentManager(testApp as any, testPlugin, testSupported);
      
      // Mock applyAlignmentsToNote to throw an error
      const testError = new Error('Test alignment error');
      vi.spyOn(testManager, 'applyAlignmentsToNote').mockRejectedValue(testError);
      
      // initialize() should complete without throwing due to .catch() pattern
      await expect(testManager.initialize()).resolves.toBeUndefined();
      
      // Give the promise a chance to settle and log
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Verify the error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to apply alignments:', testError);
      
      consoleErrorSpy.mockRestore();
    });
  });

  // ========== 12.23 event handler error handling ==========
  describe('12.23 event handler error handling', () => {
    it('12.23 when validateNoteCache throws during delete event, error does not propagate (void pattern)', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      const note = fakeTFile({ path: 'Notes/n1.md', name: 'n1.md', extension: 'md' });
      const imgFile = fakeTFile({ path: 'imgs/pic.png', name: 'pic.png', extension: 'png' });
      const vault = fakeVault({ files: [note, imgFile] });
      const testApp = fakeApp({ vault });
      
      // Setup getActiveFile to return note for validation
      (testApp.workspace!.getActiveFile as any) = vi.fn(() => note);
      // Setup cachedRead to return content
      (testApp.vault as any).cachedRead = vi.fn().mockResolvedValue('![](imgs/pic.png)');
      
      const testPlugin = new ImageConverterPlugin(testApp as any, { id: 'image-converter', dir: '/plugins/image-converter' } as any);
      testPlugin.manifest = { id: 'image-converter', dir: '/plugins/image-converter' } as any;
      testPlugin.settings = {
        isImageAlignmentEnabled: true,
        imageAlignmentDefaultAlignment: 'none',
        imageAlignmentCacheLocation: 'plugin',
        imageAlignmentCacheCleanupInterval: 0,
      } as any;
      
      const testSupported = new SupportedImageFormats(testApp as any);
      const testManager = new ImageAlignmentManager(testApp as any, testPlugin, testSupported);
      await testManager.loadCache();
      
      // Initialize to register events
      await testManager.initialize();
      
      // Mock validateNoteCache to throw an error
      const testError = new Error('Validation error');
      vi.spyOn(testManager, 'validateNoteCache').mockRejectedValue(testError);
      
      // Get the delete handler that was registered
      const onMock = (testApp.vault as any).on as any;
      const deleteCall = onMock.mock.calls.find((callArgs: any[]) => callArgs[0] === 'delete');
      expect(deleteCall).toBeTruthy();
      const deleteHandler = deleteCall[1] as (file: any) => Promise<void> | void;
      
      // Calling delete handler should NOT throw even though validateNoteCache throws
      // The void pattern means the promise rejection is intentionally ignored
      await expect(deleteHandler(imgFile)).resolves.toBeUndefined();
      
      consoleErrorSpy.mockRestore();
    });

    it('12.23 when validateNoteCache throws during rename event, error does not propagate (void pattern)', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      const note = fakeTFile({ path: 'Notes/n1.md', name: 'n1.md', extension: 'md' });
      const imgFile = fakeTFile({ path: 'imgs/pic.png', name: 'pic.png', extension: 'png' });
      const vault = fakeVault({ files: [note, imgFile] });
      const testApp = fakeApp({ vault });
      
      // Setup getActiveFile to return note for validation
      (testApp.workspace!.getActiveFile as any) = vi.fn(() => note);
      // Setup cachedRead to return content
      (testApp.vault as any).cachedRead = vi.fn().mockResolvedValue('![](imgs/pic.png)');
      
      const testPlugin = new ImageConverterPlugin(testApp as any, { id: 'image-converter', dir: '/plugins/image-converter' } as any);
      testPlugin.manifest = { id: 'image-converter', dir: '/plugins/image-converter' } as any;
      testPlugin.settings = {
        isImageAlignmentEnabled: true,
        imageAlignmentDefaultAlignment: 'none',
        imageAlignmentCacheLocation: 'plugin',
        imageAlignmentCacheCleanupInterval: 0,
      } as any;
      
      const testSupported = new SupportedImageFormats(testApp as any);
      const testManager = new ImageAlignmentManager(testApp as any, testPlugin, testSupported);
      await testManager.loadCache();
      
      // Initialize to register events
      await testManager.initialize();
      
      // Mock validateNoteCache to throw an error
      const testError = new Error('Validation error');
      vi.spyOn(testManager, 'validateNoteCache').mockRejectedValue(testError);
      
      // Get the rename handler that was registered
      const onMock = (testApp.vault as any).on as any;
      const renameCall = onMock.mock.calls.find((callArgs: any[]) => callArgs[0] === 'rename');
      expect(renameCall).toBeTruthy();
      const renameHandler = renameCall[1] as (file: any, oldPath: string) => Promise<void> | void;
      
      // Calling rename handler should NOT throw even though validateNoteCache throws
      const oldPath = imgFile.path;
      imgFile.path = 'imgs/pic-renamed.png';
      imgFile.name = 'pic-renamed.png';
      
      await expect(renameHandler(imgFile, oldPath)).resolves.toBeUndefined();
      
      consoleErrorSpy.mockRestore();
    });
  });

  // ========== 12.25-12.28 Rapid alignment changes and race condition tests ==========
  describe('12.25-12.28 Rapid alignment changes', () => {
    it('12.25 rapid toggle-off: getCurrentImageAlignment returns none immediately after toggle-off', async () => {
      const note = 'Notes/n1.md';
      const src = 'imgs/pic.png';
      const { img } = setupDomWithImage(src);
      (app.workspace.getActiveFile as any) = vi.fn(() => fakeTFile({ path: note }));

      const alignment = new ImageAlignment(app as any, plugin, manager);
      plugin.ImageAlignmentManager = manager;

      // Set alignment to center
      await alignment.updateImageAlignment(img as HTMLImageElement, { align: 'center', wrap: false });
      
      // Verify it's set
      let current = alignment.getCurrentImageAlignment(img as HTMLImageElement);
      expect(current.align).toBe('center');

      // Toggle off immediately (don't await - simulates fire-and-forget behavior)
      alignment.updateImageAlignment(img as HTMLImageElement, { align: 'none', wrap: false });
      
      // getCurrentImageAlignment should return 'none' immediately without waiting for disk save
      current = alignment.getCurrentImageAlignment(img as HTMLImageElement);
      expect(current.align).toBe('none');
    });

    it('12.26 rapid sequential changes: final state reflected in getCurrentImageAlignment', async () => {
      const note = 'Notes/n1.md';
      const src = 'imgs/pic.png';
      const { img } = setupDomWithImage(src);
      (app.workspace.getActiveFile as any) = vi.fn(() => fakeTFile({ path: note }));

      const alignment = new ImageAlignment(app as any, plugin, manager);
      plugin.ImageAlignmentManager = manager;

      // Rapid sequential changes without awaiting (simulates user clicking quickly)
      alignment.updateImageAlignment(img as HTMLImageElement, { align: 'left', wrap: false });
      alignment.updateImageAlignment(img as HTMLImageElement, { align: 'center', wrap: false });
      alignment.updateImageAlignment(img as HTMLImageElement, { align: 'right', wrap: true });
      
      // Final state should be reflected immediately
      const current = alignment.getCurrentImageAlignment(img as HTMLImageElement);
      expect(current.align).toBe('right');
      expect(current.wrap).toBe(true);
      
      // Also verify CSS classes match
      expect(img.classList.contains('image-position-right')).toBe(true);
      expect(img.classList.contains('image-wrap')).toBe(true);
    });

    it('12.27 toggle-off consistency: CSS and cache both reflect none in same tick', async () => {
      const note = 'Notes/n1.md';
      const src = 'imgs/pic.png';
      const { img } = setupDomWithImage(src);
      (app.workspace.getActiveFile as any) = vi.fn(() => fakeTFile({ path: note }));

      const alignment = new ImageAlignment(app as any, plugin, manager);
      plugin.ImageAlignmentManager = manager;

      // Set alignment first
      await alignment.updateImageAlignment(img as HTMLImageElement, { align: 'center', wrap: false });
      expect(img.classList.contains('image-position-center')).toBe(true);
      
      // Toggle off - CSS should be removed and getCurrentImageAlignment should return none
      alignment.updateImageAlignment(img as HTMLImageElement, { align: 'none', wrap: false });
      
      // Both should be consistent in the same tick
      expect(img.classList.contains('image-position-center')).toBe(false);
      expect(img.classList.contains('image-converter-aligned')).toBe(false);
      
      const current = alignment.getCurrentImageAlignment(img as HTMLImageElement);
      expect(current.align).toBe('none');
    });

    it('12.28 in-memory cache update is synchronous: getCache reflects new value before lock acquired', async () => {
      const note = 'Notes/n1.md';
      const src = 'imgs/pic.png';
      
      // Don't await - call and immediately check cache
      manager.saveImageAlignmentToCache(note, src, 'left', '100px', '50px', false);
      
      // Cache should be updated synchronously (before disk save completes)
      const hash = manager.getImageHash(note, src);
      expect(manager.getCache()[note]).toBeDefined();
      expect(manager.getCache()[note][hash]).toBeDefined();
      expect(manager.getCache()[note][hash].position).toBe('left');
      
      // Now test removal
      manager.removeImageFromCache(note, src);
      
      // Cache entry should be removed synchronously
      expect(manager.getCache()[note]?.[hash]).toBeUndefined();
    });

    it('12.28.b rapid-fire saves demonstrate last-write-wins behavior', async () => {
      const note = 'Notes/n1.md';
      const src = 'imgs/pic.png';
      
      // Rapid-fire saves without awaiting - simulates rapid user clicks
      manager.saveImageAlignmentToCache(note, src, 'left', '100px', '50px', false);
      manager.saveImageAlignmentToCache(note, src, 'center', '120px', '60px', true);
      manager.saveImageAlignmentToCache(note, src, 'right', '140px', '70px', false);
      
      // Cache should reflect the LAST call's values (last-write-wins)
      const hash = manager.getImageHash(note, src);
      expect(manager.getCache()[note][hash].position).toBe('right');
      expect(manager.getCache()[note][hash].width).toBe('140px');
      expect(manager.getCache()[note][hash].height).toBe('70px');
      expect(manager.getCache()[note][hash].wrap).toBe(false);
    });
  });

  // ========== 12.29-12.30 Bug regression tests with default alignment enabled ==========
  describe('12.29-12.30 Bug regression tests (default alignment enabled)', () => {
    it('12.29 Bug 1 regression: toggle-off persists after applyAlignmentsToNote when default enabled', async () => {
      const note = 'Notes/n1.md';
      const src = 'imgs/pic.png';
      const { img } = setupDomWithImage(src);
      (app.workspace.getActiveFile as any) = vi.fn(() => fakeTFile({ path: note }));

      // Enable default alignment (this is the key difference from other tests)
      plugin.settings.imageAlignmentDefaultAlignment = 'center';

      const alignment = new ImageAlignment(app as any, plugin, manager);
      plugin.ImageAlignmentManager = manager;

      // Set alignment to center
      await alignment.updateImageAlignment(img as HTMLImageElement, { align: 'center', wrap: false });
      expect(alignment.getCurrentImageAlignment(img as HTMLImageElement).align).toBe('center');

      // Toggle off to none
      await alignment.updateImageAlignment(img as HTMLImageElement, { align: 'none', wrap: false });
      expect(alignment.getCurrentImageAlignment(img as HTMLImageElement).align).toBe('none');

      // Simulate layout-change by calling applyAlignmentsToNote
      await manager.applyAlignmentsToNote(note);

      // BUG 1 CHECK: alignment should still be 'none', NOT 'center' (the default)
      // Before fix: would return 'center' because cache entry was deleted and default reapplied
      // After fix: returns 'none' because cache entry with position='none' blocks default
      const finalAlignment = alignment.getCurrentImageAlignment(img as HTMLImageElement);
      expect(finalAlignment.align).toBe('none');
    });

    it('12.30 Bug 2 regression: CSS state preserved after applyAlignmentsToNote when default enabled', async () => {
      const note = 'Notes/n1.md';
      const src = 'imgs/pic.png';
      const { img } = setupDomWithImage(src);
      (app.workspace.getActiveFile as any) = vi.fn(() => fakeTFile({ path: note }));

      // Enable default alignment
      plugin.settings.imageAlignmentDefaultAlignment = 'center';

      const alignment = new ImageAlignment(app as any, plugin, manager);
      plugin.ImageAlignmentManager = manager;

      // Set alignment to left first
      await alignment.updateImageAlignment(img as HTMLImageElement, { align: 'left', wrap: false });
      expect(img.classList.contains('image-position-left')).toBe(true);

      // Toggle off to none
      await alignment.updateImageAlignment(img as HTMLImageElement, { align: 'none', wrap: false });
      expect(img.classList.contains('image-position-left')).toBe(false);
      expect(img.classList.contains('image-position-center')).toBe(false);

      // Simulate layout-change (e.g., view mode switch)
      await manager.applyAlignmentsToNote(note);

      // BUG 2 CHECK: image should have NO alignment classes
      // Before fix: would have 'image-position-center' from default reapplication
      // After fix: no alignment classes because position='none' is preserved
      expect(img.classList.contains('image-position-left')).toBe(false);
      expect(img.classList.contains('image-position-center')).toBe(false);
      expect(img.classList.contains('image-position-right')).toBe(false);
      expect(img.classList.contains('image-converter-aligned')).toBe(false);
    });
  });

  // ========== 12.31 Stale DOM reference after view mode switch ==========
  describe('12.31 Stale DOM reference after view mode switch', () => {
    it('12.31.a alignment change with stale img reference after DOM re-render', async () => {
      const note = 'Notes/n1.md';
      const src = 'imgs/pic.png';
      
      // Step 1: Set up initial DOM and set alignment to center
      const { img: oldImg } = setupDomWithImage(src);
      (app.workspace.getActiveFile as any) = vi.fn(() => fakeTFile({ path: note }));

      const alignment = new ImageAlignment(app as any, plugin, manager);
      plugin.ImageAlignmentManager = manager;

      await alignment.updateImageAlignment(oldImg as HTMLImageElement, { align: 'center', wrap: false });
      expect(oldImg.classList.contains('image-position-center')).toBe(true);

      // Step 2: Simulate view mode switch - DOM is re-created (new img element)
      const { img: newImg } = setupDomWithImage(src);
      await manager.applyAlignmentsToNote(note);
      expect(newImg.classList.contains('image-position-center')).toBe(true);

      // Step 3: User changes alignment using OLD img reference (stale context menu)
      await alignment.updateImageAlignment(oldImg as HTMLImageElement, { align: 'left', wrap: false });
      
      // Cache should be updated correctly
      const hash = manager.getImageHash(note, src);
      expect(manager.getCache()[note][hash].position).toBe('left');

      // Wait for debounced re-application (50ms debounce + buffer for async lock)
      await new Promise(resolve => setTimeout(resolve, 100));

      // BUG CHECK: NEW img element should have 'left' alignment
      // This will FAIL if CSS was only applied to the stale oldImg
      expect(newImg.classList.contains('image-position-left')).toBe(true);
      expect(newImg.classList.contains('image-position-center')).toBe(false);
    });

    it('12.31.b quick succession with fresh DOM reference works correctly', async () => {
      const note = 'Notes/n1.md';
      const src = 'imgs/pic.png';
      
      // Set up and set alignment
      let { img } = setupDomWithImage(src);
      (app.workspace.getActiveFile as any) = vi.fn(() => fakeTFile({ path: note }));

      const alignment = new ImageAlignment(app as any, plugin, manager);
      plugin.ImageAlignmentManager = manager;

      await alignment.updateImageAlignment(img as HTMLImageElement, { align: 'center', wrap: false });

      // Simulate view mode switch - recreate DOM and get FRESH reference
      const result = setupDomWithImage(src);
      img = result.img;
      await manager.applyAlignmentsToNote(note);

      // Quick succession with FRESH reference should work
      await alignment.updateImageAlignment(img as HTMLImageElement, { align: 'right', wrap: false });
      expect(img.classList.contains('image-position-right')).toBe(true);

      await alignment.updateImageAlignment(img as HTMLImageElement, { align: 'left', wrap: false });
      expect(img.classList.contains('image-position-left')).toBe(true);
      expect(img.classList.contains('image-position-right')).toBe(false);
    });
  });
});

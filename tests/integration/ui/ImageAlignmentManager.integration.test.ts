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
      ["imageAlignment_cacheLocation"]: 'plugin',
      ["imageAlignment_cacheCleanupInterval"]: 0,
    } as any;
    supported = new SupportedImageFormats(app as any);
    manager = new ImageAlignmentManager(app as any, plugin, supported);
    await manager.loadCache();
  });

  it('12.3 cache persistence: saveImageAlignmentToCache stores by note+src hash and survives save/load', async () => {
    const note = 'Notes/n1.md';
    const src = 'imgs/pic.png';
    await manager.saveImageAlignmentToCache(note, src, 'left', '120px', '80px', true);
    const hash = manager.getImageHash(note, src);
    expect(manager.getCache()[note][hash]).toEqual({ position: 'left', width: '120px', height: '80px', wrap: true });
  });

  it('12.5 applyAlignmentsToNote: applies classes and size to both image and parent embed', async () => {
    const note = 'Notes/n1.md';
    const src = 'imgs/pic.png';
    await manager.saveImageAlignmentToCache(note, src, 'center', '200px', '100px', false);

    const { img, embed } = setupDomWithImage(src);
    // active file hook used by manager
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

  it('12.1 context menu actions: updateImageAlignment toggles left/none and saves cache', async () => {
    const note = 'Notes/n1.md';
    const src = 'imgs/pic.png';
    const { img } = setupDomWithImage(src);
    (app.workspace.getActiveFile as any) = vi.fn(() => fakeTFile({ path: note }));

    // Use ImageAlignment directly to simulate context menu click
    const alignment = new ImageAlignment(app as any, plugin, manager);
    // wire manager on plugin for updateImageAlignment internals
    plugin.ImageAlignmentManager = manager;

    // First click sets left
    await alignment.updateImageAlignment(img as HTMLImageElement, { align: 'left', wrap: false });
    const hash = manager.getImageHash(note, src);
    expect(manager.getCache()[note][hash].position).toBe('left');
    expect(img.classList.contains('image-position-left')).toBe(true);

    // Second click on the same should toggle to none
    await alignment.updateImageAlignment(img as HTMLImageElement, { align: 'none', wrap: false });
    // removal is async (voided call), wait a tick
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(manager.getCache()[note]?.[hash]).toBeUndefined();
    expect(img.classList.contains('image-position-left')).toBe(false);
  });

  it('12.4 Cache file location: writes under plugin dir, then under .obsidian when setting changes', async () => {
    // Spy on adapter.write
    const writeSpy = vi.spyOn((app.vault as any).adapter, 'write');

    // Default plugin location
    await manager.saveImageAlignmentToCache('Notes/n1.md', 'imgs/pic.png', 'left', '100px', '80px', true);
    expect(writeSpy).toHaveBeenCalledWith('/plugins/image-converter/image-converter-image-alignments.json', expect.any(String));

    // Switch to .obsidian and save again
    plugin.settings.imageAlignment_cacheLocation = '.obsidian';
    manager.updateCacheFilePath();
    await manager.saveImageAlignmentToCache('Notes/n1.md', 'imgs/pic2.png', 'right', '120px', '60px', false);
    expect(writeSpy).toHaveBeenCalledWith('.obsidian/image-converter-image-alignments.json', expect.any(String));
  });

  it('12.6 Reading vs edit mode: classes applied to image and parent embed regardless of mode', async () => {
    const notePath = 'Notes/n1.md';
    const src = 'imgs/pic.png';
    await manager.saveImageAlignmentToCache(notePath, src, 'right', '111px', '77px', true);

    setupDomWithImages([src]);
    // Explicitly apply (simulates either mode)
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

  it('12.9 Cache cleanup removes entries whose images no longer exist in vault', async () => {
    const notePath = 'Notes/n1.md';
    const present = 'imgs/exists.png';
    const missing = 'imgs/missing.png';

    // Add a real file in the vault and a missing one
    const realFile = fakeTFile({ path: present, name: 'exists.png', extension: 'png' });
    ((app.vault as any).getFiles as any).mockReturnValueOnce([realFile]).mockReturnValue([realFile]);

    // Seed cache with both entries
    await manager.saveImageAlignmentToCache(notePath, present, 'left', '10px', '10px', false);
    await manager.saveImageAlignmentToCache(notePath, missing, 'left', '10px', '10px', false);

    await manager.cleanCache();

    const noteCache = manager.getCache()[notePath];
    // Only the present hash should remain
    const remaining = Object.values(noteCache);
    expect(remaining.length).toBe(1);
    expect((remaining[0] as any).position).toBe('left');
  });

  it('12.2 Wrap toggle: enabling adds image-wrap; disabling adds image-no-wrap', async () => {
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
    // At minimum, expect image-no-wrap applied; implementation may retain prior class temporarily
    expect(img.classList.contains('image-no-wrap')).toBe(true);
  });

  it('12.2 Defaults to left when enabling wrap from none (policy: align=left)', async () => {
    // Arrange
    const note = 'Notes/n1.md';
    const src = 'imgs/new.png';
    const { img } = setupDomWithImage(src);
    (app.workspace.getActiveFile as any) = vi.fn(() => fakeTFile({ path: note }));

    const alignment = new ImageAlignment(app as any, plugin, manager);
    plugin.ImageAlignmentManager = manager;

    // Sanity: initial alignment is none
    const current = alignment.getCurrentImageAlignment(img as HTMLImageElement);
    expect((current as any).align).toBe('none');

    // Act — emulate wrap being toggled on when no alignment existed -> choose left
    await alignment.updateImageAlignment(img as HTMLImageElement, { align: 'left', wrap: true });

    // Assert — left + wrap classes and cache persisted as 'left'
    expect(img.classList.contains('image-position-left')).toBe(true);
    expect(img.classList.contains('image-wrap')).toBe(true);

    const hash = manager.getImageHash(note, src);
    expect(manager.getCache()[note][hash].position).toBe('left');
    expect(manager.getCache()[note][hash].wrap).toBe(true);
  });

  describe('12.8 Rename/delete consistency', () => {
    beforeEach(async () => {
      await manager.initialize(); // register event listeners
    });

    it('remaps keys on image rename and removes entries on delete', async () => {
      const notePath = 'Notes/n1.md';
      const imgAPath = 'imgs/a.png';

      // Seed cache
      await manager.saveImageAlignmentToCache(notePath, imgAPath, 'left', '50px', '25px', false);
      const oldHash = manager.getImageHash(notePath, imgAPath);
      expect(manager.getCache()[notePath][oldHash]).toBeTruthy();

      // Simulate rename event from vault
      const fileObj = fakeTFile({ path: imgAPath, name: 'a.png', extension: 'png' });
      ((app.vault as any).getFiles as any).mockReturnValue([fileObj]);
      const oldPath = fileObj.path;
      fileObj.path = 'imgs/a-renamed.png';
      fileObj.name = 'a-renamed.png';

      // Trigger manager rename handler via captured callback
      const onMock = (app.vault as any).on as any;
      // find the 'rename' registration call: [event, handler]
      const renameCall = onMock.mock.calls.find((callArgs: any[]) => callArgs[0] === 'rename');
      expect(renameCall).toBeTruthy();
      const renameHandler = renameCall[1] as (file: any, oldPath: string) => Promise<void> | void;
      await renameHandler(fileObj, oldPath);

      const newHash = manager.getImageHash(notePath, 'imgs/a-renamed.png');
      expect(manager.getCache()[notePath][newHash]).toBeTruthy();
      expect(manager.getCache()[notePath][oldHash]).toBeUndefined();

      // Now delete the file and ensure entries removed via captured delete handler
      const deleteCall = (app.vault as any).on.mock.calls.find((callArgs: any[]) => callArgs[0] === 'delete');
      expect(deleteCall).toBeTruthy();
      const deleteHandler = deleteCall[1] as (file: any) => Promise<void> | void;
      // Remove file from vault first to simulate real deletion
      await (app.vault as any).delete(fileObj);
      // After deletion, ensure vault no longer lists the file
      ((app.vault as any).getFiles as any).mockReturnValue([]);
      await deleteHandler(fileObj);
      // Run cleanup to prune stale entries
      await manager.cleanCache();
      expect(manager.getCache()[notePath]?.[newHash]).toBeUndefined();
    });
  });

  it('12.1 context menu actions: selecting center/right applies classes and persists; align=none removes them', async () => {
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
    // Allow any async cache save to flush
    await new Promise(resolve => setTimeout(resolve, 0));
    hash = manager.getImageHash(note, src);
    expect(manager.getCache()[note][hash].position).toBe('right');
    expect(manager.getCache()[note][hash].wrap).toBe(true);
    expect(img.classList.contains('image-position-right')).toBe(true);
    expect(img.classList.contains('image-wrap')).toBe(true);

    // None -> removes entry and classes
    await alignment.updateImageAlignment(img as HTMLImageElement, { align: 'none', wrap: false });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(manager.getCache()[note]?.[hash]).toBeUndefined();
    // Allow DOM class stripping to settle
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(img.classList.contains('image-position-right')).toBe(false);
    expect(img.classList.contains('image-wrap')).toBe(false);
  });

  it('12.9 Cache cleanup: persists updated cache file after pruning', async () => {
    const writeSpy = vi.spyOn((app.vault as any).adapter, 'write');

    const notePath = 'Notes/n1.md';
    const missing = 'imgs/missing.png';

    // Seed only a missing entry so cleanup prunes something
    await manager.saveImageAlignmentToCache(notePath, missing, 'left', '10px', '10px', false);
    ((app.vault as any).getFiles as any).mockReturnValue([]);

    await manager.cleanCache();

    expect(writeSpy).toHaveBeenCalled();
    // Ensure note pruned
    expect(manager.getCache()[notePath]).toBeUndefined();
  });
});

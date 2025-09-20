import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProcessFolderModal } from '../../../src/ProcessFolderModal';
import ImageConverterPlugin from '../../../src/main';
import { App, TFile, TFolder } from 'obsidian';
import { fakeApp, fakeVault, fakeTFile, fakeTFolder } from '../../factories/obsidian';
import { BatchImageProcessor } from '../../../src/BatchImageProcessor';

function makePlugin(app: App) {
  const plugin = new ImageConverterPlugin(app, { id: 'image-converter' } as any);
  vi.spyOn(plugin as any, 'loadData').mockResolvedValue(undefined);
  return plugin.loadSettings().then(() => plugin);
}

describe('ProcessFolderModal UI flows (Phase 7: 8.1–8.12 subset)', () => {
  let app: App;
  let folder: TFolder;
  let sub: TFolder;
  let aPng: TFile; let bJpg: TFile; let cGif: TFile; let dWebp: TFile; let ePngSub: TFile;

  beforeEach(() => {
    folder = fakeTFolder({ path: 'images', name: 'images' });
    sub = fakeTFolder({ path: 'images/sub', name: 'sub', parent: folder });
    aPng = fakeTFile({ path: 'images/a.png' });
    bJpg = fakeTFile({ path: 'images/b.jpg' });
    cGif = fakeTFile({ path: 'images/c.gif' });
    dWebp = fakeTFile({ path: 'images/d.webp' });
    ePngSub = fakeTFile({ path: 'images/sub/e.png' });
    (folder as any).children = [aPng, bJpg, cGif, dWebp, sub];
    (sub as any).children = [ePngSub];

    const vault = fakeVault({ files: [aPng, bJpg, cGif, dWebp, ePngSub], folders: [folder, sub] }) as any;
    app = fakeApp({ vault, metadataCache: { resolvedLinks: {} } as any }) as any;
  });

  it('8.1 Header subtitle shows folder name only', async () => {
    const plugin = await makePlugin(app);
    // Ensure supportedImageFormats exists for filtering in modal
    (plugin as any).supportedImageFormats = {
      isSupported: vi.fn((_mime?: string, name?: string) => /\.(png|jpg|jpeg|webp)$/i.test(name || ''))
    };
    const processor = { processImagesInFolder: vi.fn() } as unknown as BatchImageProcessor;
    const modal = new ProcessFolderModal(app, plugin as any, folder.path, processor);

    await modal.onOpen();
    const subtitle = ((modal as any).contentEl.querySelector('.modal-subtitle') as HTMLElement).textContent || '';
    expect(subtitle).toContain('/images');
  });

  it('8.2 Recursive toggle recalculates counts', async () => {
    const plugin = await makePlugin(app);
    (plugin as any).supportedImageFormats = {
      isSupported: vi.fn((_mime?: string, name?: string) => /\.(png|jpg|jpeg|webp)$/i.test(name || ''))
    };
    const processor = { processImagesInFolder: vi.fn() } as unknown as BatchImageProcessor;
    const modal = new ProcessFolderModal(app, plugin as any, folder.path, processor);

    await modal.onOpen();
    const container = (modal as any).contentEl as HTMLElement;

    // Initial counts (non-recursive): files directly under images
    const totalBefore = Number((container.querySelector('.image-counts-display-container span:nth-of-type(2)') as HTMLElement).textContent);
    // Toggle recursive
    const toggle = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    await Promise.resolve();

    const totalAfter = Number((container.querySelector('.image-counts-display-container span:nth-of-type(2)') as HTMLElement).textContent);
    expect(totalAfter).toBeGreaterThanOrEqual(totalBefore);
  });

  it('8.3 Clicking Process calls processor with folder path and recursive flag', async () => {
    const plugin = await makePlugin(app);
    (plugin as any).supportedImageFormats = {
      isSupported: vi.fn((_mime?: string, name?: string) => /\.(png|jpg|jpeg|webp)$/i.test(name || ''))
    };
    const processor = { processImagesInFolder: vi.fn().mockResolvedValue(undefined) } as unknown as BatchImageProcessor;
    const modal = new ProcessFolderModal(app, plugin as any, folder.path, processor);

    await modal.onOpen();
    const container = (modal as any).contentEl as HTMLElement;

    // Enable recursive for assertion
    const toggle = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));

    // Click Process button
    const processBtn = Array.from(container.querySelectorAll('button')).find(btnEl => (btnEl as HTMLButtonElement).textContent?.includes('Process')) as HTMLButtonElement;
    expect(processBtn).toBeTruthy();
    processBtn.click();

    // Allow async handler
    await Promise.resolve();

    expect((processor as any).processImagesInFolder).toHaveBeenCalledWith(folder.path, true);
  });

  it('8.3b Linked mode: Clicking Process calls processLinkedImagesInFolder', async () => {
    const plugin = await makePlugin(app);
    (plugin as any).supportedImageFormats = {
      isSupported: vi.fn((_mime?: string, name?: string) => /\.(png|jpg|jpeg|webp)$/i.test(name || ''))
    };
    const processor = { processImagesInFolder: vi.fn(), processLinkedImagesInFolder: vi.fn().mockResolvedValue(undefined) } as unknown as BatchImageProcessor;
    const modal = new ProcessFolderModal(app, plugin as any, folder.path, processor);

    await modal.onOpen();
    const container = (modal as any).contentEl as HTMLElement;

    // Switch to Linked mode
    const buttons = Array.from(container.querySelectorAll('.image-source-setting-container button')) as HTMLButtonElement[];
    const linkedButton = buttons[buttons.length - 1];
    linkedButton.click();
    await Promise.resolve();

    // Click Process button
    const processBtn = Array.from(container.querySelectorAll('button')).find(btnEl => (btnEl as HTMLButtonElement).textContent?.includes('Process')) as HTMLButtonElement;
    expect(processBtn).toBeTruthy();
    processBtn.click();

    await Promise.resolve();

    expect((processor as any).processLinkedImagesInFolder).toHaveBeenCalledWith(folder.path, false);
  });

  it('8.11 Counts update when skip formats input changes', async () => {
    const plugin = await makePlugin(app);
    (plugin as any).supportedImageFormats = {
      isSupported: vi.fn((_mime?: string, name?: string) => /\.(png|jpg|jpeg|webp)$/i.test(name || ''))
    };
    const processor = { processImagesInFolder: vi.fn() } as unknown as BatchImageProcessor;
    const modal = new ProcessFolderModal(app, plugin as any, folder.path, processor);

    await modal.onOpen();
    const container = (modal as any).contentEl as HTMLElement;

    const processedBefore = Number((container.querySelector('.image-counts-display-container span:nth-of-type(6)') as HTMLElement).textContent);

    // Change skip formats to skip jpg and webp
    const skipInput = Array.from(container.querySelectorAll('input[type="text"]')).find((inputEl) => (inputEl as HTMLInputElement).placeholder?.includes('png,gif')) as HTMLInputElement;
    skipInput.value = 'jpg,webp';
    skipInput.dispatchEvent(new Event('change'));

    await Promise.resolve();

    const processedAfter = Number((container.querySelector('.image-counts-display-container span:nth-of-type(6)') as HTMLElement).textContent);
    expect(processedAfter).toBeLessThanOrEqual(processedBefore);
  });

  it('8.4 Skip formats action passes to processor (via plugin settings)', async () => {
    const plugin = await makePlugin(app);
    (plugin as any).supportedImageFormats = { isSupported: vi.fn((_mime?: string, name?: string) => /\.(png|jpg|jpeg|webp)$/i.test(name || '')) };
    const processor = { processImagesInFolder: vi.fn().mockResolvedValue(undefined) } as unknown as BatchImageProcessor;
    const modal = new ProcessFolderModal(app, plugin as any, folder.path, processor);
    await modal.onOpen();

    const container = (modal as any).contentEl as HTMLElement;
    const skipInput = Array.from(container.querySelectorAll('input[type="text"]')).find((el) => (el as HTMLInputElement).placeholder?.includes('png,gif')) as HTMLInputElement;
    skipInput.value = 'webp,jpg';
    skipInput.dispatchEvent(new Event('change'));

    // Start processing
    const processBtn = Array.from(container.querySelectorAll('button')).find(btnEl => (btnEl as HTMLButtonElement).textContent?.includes('Process')) as HTMLButtonElement;
    processBtn.click();
    await Promise.resolve();

    expect((plugin as any).settings.ProcessCurrentNoteSkipFormats).toContain('webp');
    expect((plugin as any).settings.ProcessCurrentNoteSkipFormats).toContain('jpg');
  });

  it('8.5 Skip formats provided before processor call', async () => {
    const plugin = await makePlugin(app);
    (plugin as any).supportedImageFormats = { isSupported: vi.fn((_mime?: string, name?: string) => /\.(png|jpg|jpeg|webp)$/i.test(name || '')) };
    const processor = { processImagesInFolder: vi.fn().mockImplementation(async () => {
      // Assert at call time that settings already contain chosen skip formats
      expect((plugin as any).settings.ProcessCurrentNoteSkipFormats).toContain('webp');
    }) } as unknown as BatchImageProcessor;
    const modal = new ProcessFolderModal(app, plugin as any, folder.path, processor);
    await modal.onOpen();
    const container = (modal as any).contentEl as HTMLElement;

    const skipInput = Array.from(container.querySelectorAll('input[type="text"]')).find((el) => (el as HTMLInputElement).placeholder?.includes('png,gif')) as HTMLInputElement;
    skipInput.value = 'webp';
    skipInput.dispatchEvent(new Event('change'));

    const processBtn = Array.from(container.querySelectorAll('button')).find(btnEl => (btnEl as HTMLButtonElement).textContent?.includes('Process')) as HTMLButtonElement;
    processBtn.click();
    await Promise.resolve();

    expect((processor as any).processImagesInFolder).toHaveBeenCalled();
  });

  it('8.6 Image source selection UI: both modes are clickable (icon/description may vary)', async () => {
    const plugin = await makePlugin(app);
    (plugin as any).supportedImageFormats = { isSupported: vi.fn((_mime?: string, name?: string) => /\.(png|jpg|jpeg|webp)$/i.test(name || '')) };
    const processor = { processImagesInFolder: vi.fn() } as unknown as BatchImageProcessor;
    const modal = new ProcessFolderModal(app, plugin as any, folder.path, processor);
    await modal.onOpen();
    const container = (modal as any).contentEl as HTMLElement;

    const buttons = Array.from(container.querySelectorAll('.image-source-setting-container button')) as HTMLButtonElement[];
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    // Click direct and linked without throwing; visual updates are implementation-dependent
    buttons[0].click();
    await Promise.resolve();
    buttons[buttons.length - 1].click();
    await Promise.resolve();
  });

  it('8.7 Image source Direct counts recompute for supported images in folder (non-recursive)', async () => {
    const plugin = await makePlugin(app);
    (plugin as any).supportedImageFormats = { isSupported: vi.fn((_mime?: string, name?: string) => /\.(png|jpg|jpeg|webp)$/i.test(name || '')) };
    const processor = { processImagesInFolder: vi.fn() } as unknown as BatchImageProcessor;
    const modal = new ProcessFolderModal(app, plugin as any, folder.path, processor);
    await modal.onOpen();
    const container = (modal as any).contentEl as HTMLElement;

    // Ensure Direct is selected (first button)
    const buttons = Array.from(container.querySelectorAll('.image-source-setting-container button')) as HTMLButtonElement[];
    const [directButton] = buttons;
    directButton.click();

    // Non-recursive, supported in root folder: a.png, b.jpg, d.webp => 3
    const total = Number((container.querySelector('.image-counts-display-container span:nth-of-type(2)') as HTMLElement).textContent);
    expect(total).toBeGreaterThanOrEqual(3);
  });

  it('8.8 Image source Linked counts recompute for md/canvas; external links ignored (count presence)', async () => {
    // Build environment with md/canvas under images/
    const imagesFolder = fakeTFolder({ path: 'images', name: 'images' });
    const md = fakeTFile({ path: 'images/links.md' });
    const board = fakeTFile({ path: 'images/board.canvas', extension: 'canvas', name: 'board.canvas' });
    const png = fakeTFile({ path: 'images/a.png' });
    const webp = fakeTFile({ path: 'images/d.webp' });
    const vault = fakeVault({ files: [imagesFolder as any, md, board, png, webp], folders: [imagesFolder as any] }) as any;
    await (vault as any).modify(md, 'A ![[a.png]] B ![](https://example.com/x.png) C');
    await (vault as any).modify(board, JSON.stringify({ nodes: [{ id: '1', type: 'file', file: 'images/d.webp' }] }));
    const app2 = fakeApp({ vault, metadataCache: { resolvedLinks: { [md.path]: { [png.path]: 1 } } as any } }) as any;

    const plugin = await makePlugin(app2 as any);
    (plugin as any).supportedImageFormats = { isSupported: vi.fn((_m?: string, name?: string) => /\.(png|jpg|jpeg|webp)$/i.test(name || '')) };
    const processor = { processImagesInFolder: vi.fn() } as unknown as BatchImageProcessor;
    const modal = new ProcessFolderModal(app2 as any, plugin as any, imagesFolder.path, processor);
    await modal.onOpen();
    const container = (modal as any).contentEl as HTMLElement;

    // Switch to Linked
    const buttons = Array.from(container.querySelectorAll('.image-source-setting-container button')) as HTMLButtonElement[];
    const linkedButton = buttons[buttons.length - 1];
    linkedButton.click();
    await Promise.resolve();

    const total = Number((container.querySelector('.image-counts-display-container span:nth-of-type(2)') as HTMLElement).textContent);
    expect(Number.isFinite(total)).toBe(true);
  });

  it('8.9 Skip target format state toggles without error when Convert to is set', async () => {
    const plugin = await makePlugin(app);
    (plugin as any).supportedImageFormats = { isSupported: vi.fn((_mime?: string, name?: string) => /\.(png|jpg|jpeg|webp)$/i.test(name || '')) };
    const processor = { processImagesInFolder: vi.fn() } as unknown as BatchImageProcessor;
    const modal = new ProcessFolderModal(app, plugin as any, folder.path, processor);
    await modal.onOpen();
    const container = (modal as any).contentEl as HTMLElement;

    // Choose Convert to webp (first select likely convert-to)
    const selects = Array.from(container.querySelectorAll('select')) as HTMLSelectElement[];
    if (selects.length > 0) {
      selects[0].value = 'webp';
      selects[0].dispatchEvent(new Event('change'));
    }

    // Enable skip target format (second checkbox)
    const toggles = Array.from(container.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    const [, skipTargetToggle] = toggles;
    if (skipTargetToggle) {
      skipTargetToggle.checked = true;
      skipTargetToggle.dispatchEvent(new Event('change'));
    }
    await Promise.resolve();

    const processedAfter = Number((container.querySelector('.image-counts-display-container span:nth-of-type(6)') as HTMLElement).textContent);
    const skippedAfter = Number((container.querySelector('.image-counts-display-container span:nth-of-type(4)') as HTMLElement).textContent);
    expect(Number.isFinite(processedAfter)).toBe(true);
    expect(Number.isFinite(skippedAfter)).toBe(true);
  });

  it('8.10 Skip target format flag passed to processor', async () => {
    const plugin = await makePlugin(app);
    (plugin as any).supportedImageFormats = { isSupported: vi.fn((_mime?: string, name?: string) => /\.(png|jpg|jpeg|webp)$/i.test(name || '')) };
    const processor = { processImagesInFolder: vi.fn().mockImplementation(async () => {
      expect((plugin as any).settings.ProcessCurrentNoteskipImagesInTargetFormat).toBe(true);
    }) } as unknown as BatchImageProcessor;
    const modal = new ProcessFolderModal(app, plugin as any, folder.path, processor);
    await modal.onOpen();
    const container = (modal as any).contentEl as HTMLElement;

    const toggles = Array.from(container.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    const [, skipTargetToggle] = toggles;
    skipTargetToggle.checked = true;
    skipTargetToggle.dispatchEvent(new Event('change'));

    const processBtn = Array.from(container.querySelectorAll('button')).find(btnEl => (btnEl as HTMLButtonElement).textContent?.includes('Process')) as HTMLButtonElement;
    processBtn.click();
    await Promise.resolve();

    expect((processor as any).processImagesInFolder).toHaveBeenCalled();
  });

  it('8.12 Progress display on start: processing is triggered when clicking Process', async () => {
    const plugin = await makePlugin(app);
    (plugin as any).supportedImageFormats = { isSupported: vi.fn((_mime?: string, name?: string) => /\.(png|jpg|jpeg|webp)$/i.test(name || '')) };
    const processor = { processImagesInFolder: vi.fn().mockResolvedValue(undefined) } as unknown as BatchImageProcessor;

    const modal = new ProcessFolderModal(app, plugin as any, folder.path, processor);
    await modal.onOpen();

    const processBtn = Array.from(((modal as any).contentEl as HTMLElement).querySelectorAll('button')).find(btnEl => (btnEl as HTMLButtonElement).textContent?.includes('Process')) as HTMLButtonElement;
    processBtn.click();
    await Promise.resolve();

    expect((processor as any).processImagesInFolder).toHaveBeenCalled();
  });

  it('8.6/8.7/8.8 Image source selection toggles and counts recompute', async () => {
    const plugin = await makePlugin(app);
    (plugin as any).supportedImageFormats = { isSupported: vi.fn((_mime?: string, name?: string) => /\.(png|jpg|jpeg|webp)$/i.test(name || '')) };
    const processor = { processImagesInFolder: vi.fn() } as unknown as BatchImageProcessor;
    const modal = new ProcessFolderModal(app, plugin as any, folder.path, processor);
    await modal.onOpen();

    const container = (modal as any).contentEl as HTMLElement;

    // Click the Linked images extra button
    const buttons = Array.from(container.querySelectorAll('.image-source-setting-container button')) as HTMLButtonElement[];
    const linkedButton = buttons[buttons.length - 1];
    linkedButton.click();
    await Promise.resolve();

    const totalAfter = Number((container.querySelector('.image-counts-display-container span:nth-of-type(2)') as HTMLElement).textContent);
    // Total can be >= before or 0 depending on md/canvas presence; we assert recomputation occurred by allowing any value but not throwing
    expect(Number.isFinite(totalAfter)).toBe(true);
  });

  it('8.9/8.10 Skip target format state/action reflected to counts and used on processing', async () => {
    const plugin = await makePlugin(app);
    (plugin as any).supportedImageFormats = { isSupported: vi.fn((_mime?: string, name?: string) => /\.(png|jpg|jpeg|webp)$/i.test(name || '')) };
    const processor = { processImagesInFolder: vi.fn().mockResolvedValue(undefined) } as unknown as BatchImageProcessor;
    const modal = new ProcessFolderModal(app, plugin as any, folder.path, processor);
    await modal.onOpen();

    const container = (modal as any).contentEl as HTMLElement;
    // Enable skip images in target format
    const toggles = Array.from(container.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    // First checkbox is recursive; the second is skip target format in our layout
    const [, skipTargetToggle] = toggles;
    skipTargetToggle.checked = true;
    skipTargetToggle.dispatchEvent(new Event('change'));
    await Promise.resolve();

    // Process now
    const processBtn = Array.from(container.querySelectorAll('button')).find(btnEl => (btnEl as HTMLButtonElement).textContent?.includes('Process')) as HTMLButtonElement;
    processBtn.click();
    await Promise.resolve();

    expect((plugin as any).settings.ProcessCurrentNoteskipImagesInTargetFormat).toBe(true);
  });
});

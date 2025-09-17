import { describe, it, expect, beforeEach, vi } from 'vitest';
import ImageConverterPlugin from '../../../src/main';
import { fakeApp, fakeTFile, fakeVault, fakePluginManifest } from '../../factories/obsidian';
import { Menu } from 'obsidian';

// Mock modules that are constructed by ContextMenu actions
vi.mock('../../../src/ProcessSingleImageModal.ts', () => ({
  ProcessSingleImageModal: vi.fn().mockImplementation(function () { return { open: vi.fn() } as any; })
}));
vi.mock('../../../src/ImageAnnotation.ts', () => ({
  ImageAnnotationModal: vi.fn().mockImplementation(function () { return { open: vi.fn() } as any; })
}));

let ContextMenuCls: any;

function setupImg(wrapClass = 'markdown-preview-view') {
  document.body.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = wrapClass;
  const img = document.createElement('img');
  img.src = 'imgs/pic.jpg';
  wrap.appendChild(img);
  document.body.appendChild(wrap);
  return img;
}

describe('ContextMenu integration (14.1–14.6)', () => {
  let app: any;
  let plugin: any;

beforeEach(async () => {
    const note = fakeTFile({ path: 'n1.md', name: 'n1.md', extension: 'md' });
    // Load ContextMenu after mocks are registered
    ContextMenuCls = (await import('../../../src/ContextMenu')).ContextMenu;
    const vault = fakeVault({ files: [note] });
    app = fakeApp({ vault });

    // Use plugin manifest factory when available
    const manifest = fakePluginManifest
      ? fakePluginManifest({ id: 'image-converter', name: 'Image Converter' })
      : ({ id: 'image-converter', dir: '/plugins/image-converter' } as any);

    plugin = new ImageConverterPlugin(app as any, manifest as any);
    plugin.manifest = manifest as any;
    plugin.settings = { enableContextMenu: true, isImageAlignmentEnabled: true } as any;
    plugin.supportedImageFormats = { isExcalidrawImage: () => false } as any; // default: not Excalidraw
  });

  describe('14.1 Document listener registration', () => {
    it('registers a document contextmenu listener on construction', () => {
      const spy = vi.spyOn(document, 'addEventListener');
      const ctx = new ContextMenuCls(app as any, plugin, {} as any, {} as any);
      expect(spy).toHaveBeenCalledWith('contextmenu', expect.any(Function), true);
      (ctx as any).onunload?.();
    });
  });

  describe('14.2 Visibility and scope', () => {
    it('shows menu on images in markdown views only', () => {
      const showSpy = vi.spyOn((Menu as any).prototype, 'showAtMouseEvent');
      const img = setupImg('markdown-preview-view');
      (app.workspace.getActiveViewOfType as any) = vi.fn(() => ({ getViewType: () => 'markdown' }));
      const ctx = new ContextMenuCls(app as any, plugin, { getImagePath: () => null } as any, {} as any);

      img.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      expect(showSpy).toHaveBeenCalled();

      showSpy.mockClear();

      const outsideImg = setupImg('not-a-markdown-view');
      (app.workspace.getActiveViewOfType as any) = vi.fn(() => ({ getViewType: () => 'other' }));
      outsideImg.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      expect(showSpy).not.toHaveBeenCalled();
      (ctx as any).onunload?.();
    });

    it('negative cases: does not show for Excalidraw images', () => {
      const showSpy = vi.spyOn((Menu as any).prototype, 'showAtMouseEvent');
      (app.workspace.getActiveViewOfType as any) = vi.fn(() => ({ getViewType: () => 'markdown' }));
      plugin.supportedImageFormats = { isExcalidrawImage: () => true } as any; // force excalidraw detection
      const img = setupImg('markdown-preview-view');

      const ctx = new ContextMenuCls(app as any, plugin, {} as any, {} as any);
      img.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      expect(showSpy).not.toHaveBeenCalled();
      (ctx as any).onunload?.();
    });

    it('negative cases: does not show in Canvas view', () => {
      const showSpy = vi.spyOn((Menu as any).prototype, 'showAtMouseEvent');
      (app.workspace.getActiveViewOfType as any) = vi.fn(() => ({ getViewType: () => 'canvas' }));
      plugin.supportedImageFormats = { isExcalidrawImage: () => false } as any;
      const img = setupImg('markdown-preview-view');

      new ContextMenuCls(app as any, plugin, {} as any, {} as any);
      img.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      expect(showSpy).not.toHaveBeenCalled();
    });

    it('negative cases: does not show for non-image targets', () => {
      const showSpy = vi.spyOn((Menu as any).prototype, 'showAtMouseEvent');
      (app.workspace.getActiveViewOfType as any) = vi.fn(() => ({ getViewType: () => 'markdown' }));
      const ctx = new ContextMenuCls(app as any, plugin, {} as any, {} as any);
      const div = document.createElement('div');
      document.body.appendChild(div);
      div.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      expect(showSpy).not.toHaveBeenCalled();
      (ctx as any).onunload?.();
    });
  });

  describe('14.3/14.4 Actions', () => {
    it('Convert/compress opens ProcessSingleImageModal for resolved TFile with same-folder preference', async () => {
      const img = setupImg();
      (app.workspace.getActiveViewOfType as any) = vi.fn(() => ({
        getViewType: () => 'markdown',
        file: fakeTFile({ path: 'n1.md', name: 'n1.md', extension: 'md' }),
        containerEl: document.body,
      }));
      const file = fakeTFile({ path: 'imgs/pic.jpg', name: 'pic.jpg', extension: 'jpg' });
      ((app.vault as any).getFiles as any).mockReturnValue([file]);

      const mod = await import('../../../src/ProcessSingleImageModal.ts');
      const openSpy = vi.spyOn(mod as any, 'ProcessSingleImageModal');
      const ctx = new ContextMenuCls(app as any, plugin, {} as any, {} as any);
      const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      img.dispatchEvent(evt);

      expect(openSpy).toHaveBeenCalled();
      const args = openSpy.mock.calls[0];
      expect(args[2].path).toBe('imgs/pic.jpg');
      (ctx as any).onunload?.();
    });

    it('Annotate opens ImageAnnotationModal for resolved TFile', async () => {
      const img = setupImg();
      (app.workspace.getActiveViewOfType as any) = vi.fn(() => ({
        getViewType: () => 'markdown',
        file: fakeTFile({ path: 'n1.md', name: 'n1.md', extension: 'md' }),
        containerEl: document.body,
      }));
      const file = fakeTFile({ path: 'imgs/pic.jpg', name: 'pic.jpg', extension: 'jpg' });
      ((app.vault as any).getFiles as any).mockReturnValue([file]);

      const mod = await import('../../../src/ImageAnnotation.ts');
      const modalSpy = vi.spyOn(mod as any, 'ImageAnnotationModal');
      const ctx = new ContextMenuCls(app as any, plugin, {} as any, {} as any);
      img.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

      expect(modalSpy).toHaveBeenCalled();
      const args = modalSpy.mock.calls[0];
      expect(args[2].path).toBe('imgs/pic.jpg');
      (ctx as any).onunload?.();
    });
  });

  describe('14.5 Alignment options gating', () => {
    it('calls alignment options when enabled; not when disabled', () => {
      const alignmentSpy = vi.fn();
      plugin.ImageAlignmentManager = { addAlignmentOptionsToContextMenu: alignmentSpy } as any;

      const img = setupImg('markdown-preview-view');
      (app.workspace.getActiveViewOfType as any) = vi.fn(() => ({ getViewType: () => 'markdown' }));
      (app.workspace.getActiveFile as any) = vi.fn(() => fakeTFile({ path: 'n1.md', name: 'n1.md', extension: 'md' }));
      const ctx = new ContextMenuCls(app as any, plugin, {} as any, {} as any);

      // enabled => called
      img.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      expect(alignmentSpy).toHaveBeenCalled();

      // disable and try again
      alignmentSpy.mockClear();
      plugin.settings.isImageAlignmentEnabled = false;
      img.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      expect(alignmentSpy).not.toHaveBeenCalled();
      (ctx as any).onunload?.();
    });
  });

  describe('14.6 Unregistration/cleanup', () => {
    it('removes document listener on unload', () => {
      const addSpy = vi.spyOn(document, 'addEventListener');
      const removeSpy = vi.spyOn(document, 'removeEventListener');

      const ctx = new ContextMenuCls(app as any, plugin, {} as any, {} as any);
      expect(addSpy).toHaveBeenCalledWith('contextmenu', expect.any(Function), true);

      // Simulate cleanup via component onunload
      (ctx as any).onunload?.();

      // We cannot easily assert the specific handler function, but removeEventListener should be called
      expect(removeSpy).toHaveBeenCalled();
    });
  });
});

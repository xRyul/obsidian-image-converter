import { describe, it, expect, beforeEach, vi } from 'vitest';
import ImageConverterPlugin from '../../../src/main';
import { fakeApp, fakeTFile, fakeVault, fakePluginManifest } from '../../factories/obsidian';
import { Menu, Platform } from 'obsidian';

// Mock modules that are constructed by ContextMenu actions
vi.mock('../../../src/ProcessSingleImageModal.ts', () => ({
  ProcessSingleImageModal: vi.fn().mockImplementation(() => ({ open: vi.fn() } as any))
}));
vi.mock('../../../src/ImageAnnotation', () => ({
  ImageAnnotationModal: vi.fn().mockImplementation(() => ({ open: vi.fn() } as any))
}));

let contextMenuCls: any;

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
    contextMenuCls = (await import('../../../src/ContextMenu')).ContextMenu;
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
      const ctx = new contextMenuCls(app as any, plugin, {} as any, {} as any);
      expect(spy).toHaveBeenCalledWith('contextmenu', expect.any(Function), true);
      (ctx as any).onunload?.();
    });
  });

  describe('14.2 Visibility and scope', () => {
    it('shows menu on images in markdown views only', () => {
      const showSpy = vi.spyOn((Menu as any).prototype, 'showAtMouseEvent');
      const img = setupImg('markdown-preview-view');
      (app.workspace.getActiveViewOfType as any) = vi.fn(() => ({ getViewType: () => 'markdown' }));
const ctx = new contextMenuCls(app as any, plugin, { getImagePath: () => null } as any, {} as any);

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

      const ctx = new contextMenuCls(app as any, plugin, {} as any, {} as any);
      img.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      expect(showSpy).not.toHaveBeenCalled();
      (ctx as any).onunload?.();
    });

    it('negative cases: does not show in Canvas view', () => {
      const showSpy = vi.spyOn((Menu as any).prototype, 'showAtMouseEvent');
      (app.workspace.getActiveViewOfType as any) = vi.fn(() => ({ getViewType: () => 'canvas' }));
      plugin.supportedImageFormats = { isExcalidrawImage: () => false } as any;
      const img = setupImg('markdown-preview-view');

      new contextMenuCls(app as any, plugin, {} as any, {} as any);
      img.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      expect(showSpy).not.toHaveBeenCalled();
    });

    it('negative cases: does not show for non-image targets', () => {
      const showSpy = vi.spyOn((Menu as any).prototype, 'showAtMouseEvent');
      (app.workspace.getActiveViewOfType as any) = vi.fn(() => ({ getViewType: () => 'markdown' }));
      const ctx = new contextMenuCls(app as any, plugin, {} as any, {} as any);
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
const ctx = new contextMenuCls(app as any, plugin, {} as any, {} as any);
      const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      img.dispatchEvent(evt);

expect(openSpy).toHaveBeenCalled();
      const [[, , thirdArg]] = openSpy.mock.calls as unknown[][];
      expect((thirdArg as any).path).toBe('imgs/pic.jpg');
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

      const mod = await import('../../../src/ImageAnnotation');
      const modalSpy = vi.spyOn(mod as any, 'ImageAnnotationModal');
      const ctx = new contextMenuCls(app as any, plugin, {} as any, {} as any);
      img.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

expect(modalSpy).toHaveBeenCalled();
      const [[, , thirdArg]] = modalSpy.mock.calls as unknown[][];
      expect((thirdArg as any).path).toBe('imgs/pic.jpg');
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
      const ctx = new contextMenuCls(app as any, plugin, {} as any, {} as any);

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

  describe('Mobile gating (Phase 9: 25.4/25.5)', () => {
    it('does not add desktop-only items when Platform.isMobile=true', async () => {
      // Arrange
      Platform.isMobile = true;
      const ctx = new contextMenuCls(app as any, plugin, {} as any, {} as any);

      const openInNewWindowSpy = vi.spyOn(ctx as any, 'addOpenInNewWindowMenuItem');
      const cutImageSpy = vi.spyOn(ctx as any, 'addCutImageMenuItem');

      const img = document.createElement('img');
      img.setAttribute('src', '/images/a.png');
      const active = fakeTFile({ path: 'notes/n.md' });

      // Act
      (ctx as any).createContextMenuItems({ addSeparator: () => {}, addItem: () => {} } as any, img, active as any, new MouseEvent('contextmenu'));

      // Assert
      expect(openInNewWindowSpy).not.toHaveBeenCalled();
      expect(cutImageSpy).not.toHaveBeenCalled();

      // Cleanup
      Platform.isMobile = false;
      (ctx as any).onunload?.();
    });
  });

  describe('14.6 Unregistration/cleanup', () => {
    it('removes document listener on unload', () => {
      const addSpy = vi.spyOn(document, 'addEventListener');
      const removeSpy = vi.spyOn(document, 'removeEventListener');

      const ctx = new contextMenuCls(app as any, plugin, {} as any, {} as any);
      expect(addSpy).toHaveBeenCalledWith('contextmenu', expect.any(Function), true);

      // Simulate cleanup via component onunload
      (ctx as any).onunload?.();

      // We cannot easily assert the specific handler function, but removeEventListener should be called
      expect(removeSpy).toHaveBeenCalled();
    });
  });
});

describe('14.7–14.10 ContextMenu caption edit in tables (pipe escaping)', () => {
  let app: any;
  let plugin: any;
  let contextMenuCls: any;

  beforeEach(async () => {
    const note = fakeTFile({ path: 'n1.md', name: 'n1.md', extension: 'md' });
    contextMenuCls = (await import('../../../src/ContextMenu')).ContextMenu;
    const vault = fakeVault({ files: [note] });
    app = fakeApp({ vault });

    const manifest = fakePluginManifest
      ? fakePluginManifest({ id: 'image-converter', name: 'Image Converter' })
      : ({ id: 'image-converter', dir: '/plugins/image-converter' } as any);

    plugin = new ImageConverterPlugin(app as any, manifest as any);
    plugin.manifest = manifest as any;
    plugin.settings = { enableContextMenu: true, isImageAlignmentEnabled: true } as any;
    plugin.supportedImageFormats = { isExcalidrawImage: () => false } as any;
  });

  const countUnescapedPipes = (s: string) => {
    let count = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '|' && (i === 0 || s[i - 1] !== '\\')) count++;
    }
    return count;
  };

  describe('14.7 [I] Wiki-style link in table: delimiter pipes ESCAPED to prevent column split', () => {
    it('escapes wiki-link delimiter pipes in tables because table parser runs before wikilink parser', async () => {
      // Arrange
      const ctx = new contextMenuCls(app as any, plugin, {} as any, {} as any);
      const mockEditor = {
        getDoc: () => ({ lineCount: () => 1 }),
        // Input: table row with wikilink
        getLine: (_n: number) => '| ![[image.webp|caption|100x100]] |',
        setLine: vi.fn(),
      };
      const match = {
        lineNumber: 0,
        line: '| ![[image.webp|caption|100x100]] |',
      };

      // Act
      const result = await (ctx as any).updateImageLinkWithDimensions(
        mockEditor,
        match,
        'Hello',
        '282',
        '212'
      );

      // Assert
      // Wikilink delimiter pipes MUST be escaped in tables to prevent table column split
      // ImageCaptionManager will strip the trailing backslash from rendered caption
      expect(result).toContain('![[image.webp\\|Hello\\|282x212]]');
      // Table has only 2 unescaped pipes (table delimiters), wikilink pipes are escaped
      expect(countUnescapedPipes(result)).toBe(2);

      (ctx as any).onunload?.();
    });
  });

  describe('14.8 [I] Markdown-style link in table: delimiter pipe escaped (table-safe)', () => {
    it('escapes markdown image delimiter pipe so the table does not gain extra columns', async () => {
      // Arrange
      const ctx = new contextMenuCls(app as any, plugin, {} as any, {} as any);
      const mockEditor = {
        getDoc: () => ({ lineCount: () => 1 }),
        // already table-safe input form
        getLine: (_n: number) => '| ![caption\\|100x100](image.webp) |',
        setLine: vi.fn(),
      };
      const match = {
        lineNumber: 0,
        line: '| ![caption\\|100x100](image.webp) |',
      };

      // Act
      const result = await (ctx as any).updateImageLinkWithDimensions(
        mockEditor,
        match,
        'Hello',
        '300',
        '200'
      );

      // Assert
      expect(result).toContain('![Hello\\|300x200](image.webp)');
      expect(countUnescapedPipes(result)).toBe(2);

      (ctx as any).onunload?.();
    });
  });

  describe('14.9 [I] Non-table context: do not escape delimiter pipes', () => {
    it('keeps standard (unescaped) delimiters outside tables', async () => {
      // Arrange
      const ctx = new contextMenuCls(app as any, plugin, {} as any, {} as any);
      const mockEditor = {
        getDoc: () => ({ lineCount: () => 1 }),
        getLine: (_n: number) => '![[image.webp|caption|100x100]]',
        setLine: vi.fn(),
      };
      const match = {
        lineNumber: 0,
        line: '![[image.webp|caption|100x100]]',
      };

      // Act
      const result = await (ctx as any).updateImageLinkWithDimensions(
        mockEditor,
        match,
        'Hello',
        '282',
        '212'
      );

      // Assert
      expect(result).toContain('![[image.webp|Hello|282x212]]');
      expect(result).not.toContain('\\|');

      (ctx as any).onunload?.();
    });
  });

  describe('14.10 [I] Caption loading: escaped pipes within caption unescaped for display', () => {
    it('loads caption containing escaped pipe character and unescapes \\| for display', async () => {
      // Arrange
      const note = fakeTFile({ path: 'n1.md', name: 'n1.md', extension: 'md' });
      (app.workspace.getActiveFile as any) = vi.fn(() => note);

      const mockEditor = {
        getDoc: () => ({ lineCount: () => 1 }),
        // Wikilink in table: delimiter pipes are NOT escaped (wikilinks are self-contained)
        // Only the pipe INSIDE the caption "Hello|World" is escaped as \|
        getLine: (_n: number) => '| ![[image.webp|Hello\\|World|282x212]] |',
      };

      (app.workspace.getActiveViewOfType as any) = vi.fn(() => ({ editor: mockEditor }));

      const img = document.createElement('img');
      const folderAndFilenameManagement = { getImagePath: () => 'image.webp' } as any;
      const ctx = new contextMenuCls(app as any, plugin, folderAndFilenameManagement, {} as any);

      // Act
      const caption = await (ctx as any).loadCurrentCaption(img, note);
      const dims = await (ctx as any).loadCurrentDimensions(img, note);

      // Assert
      // Caption should have the escaped pipe unescaped for display
      expect(caption).toBe('Hello|World');
      expect(dims).toEqual({ width: '282', height: '212' });

      (ctx as any).onunload?.();
    });
  });

  describe('14.11 [I] Caption loading: width-only dimension not returned as caption', () => {
    it('given wiki-style link with width-only dimension (e.g., |450), when loading caption, then returns empty string', async () => {
      // Arrange
      const note = fakeTFile({ path: 'n1.md', name: 'n1.md', extension: 'md' });
      (app.workspace.getActiveFile as any) = vi.fn(() => note);

      const mockEditor = {
        getDoc: () => ({ lineCount: () => 1 }),
        // Width-only dimension: ![[path|450]] (no caption, no height)
        getLine: (_n: number) => '![[_attachments/Pasted image 20251004160543.webp|450]]',
      };

      (app.workspace.getActiveViewOfType as any) = vi.fn(() => ({ editor: mockEditor }));

      const img = document.createElement('img');
      const folderAndFilenameManagement = { getImagePath: () => '_attachments/Pasted image 20251004160543.webp' } as any;
      const ctx = new contextMenuCls(app as any, plugin, folderAndFilenameManagement, {} as any);

      // Act
      const caption = await (ctx as any).loadCurrentCaption(img, note);
      const dims = await (ctx as any).loadCurrentDimensions(img, note);

      // Assert
      // Bug: caption incorrectly returns "450" because isDimensions check uses /\d+x\d+/ (requires both width and height)
      // Expected: caption should be empty, dimensions should have width=450 and height=""
      expect(caption).toBe('');
      expect(dims).toEqual({ width: '450', height: '' });

      (ctx as any).onunload?.();
    });
  });

  describe('14.12 [I] Caption loading: numeric caption with dimensions', () => {
    it('given wiki-style link with numeric caption and dimensions (e.g., |100|450), when loading, then caption returns "100" and dimensions returns width=450', async () => {
      // Arrange
      const note = fakeTFile({ path: 'n1.md', name: 'n1.md', extension: 'md' });
      (app.workspace.getActiveFile as any) = vi.fn(() => note);

      const mockEditor = {
        getDoc: () => ({ lineCount: () => 1 }),
        // Numeric caption with dimension: ![[path|100|450]] where 100 is caption, 450 is width
        getLine: (_n: number) => '![[_attachments/Pasted image 20251004160543.webp|100|450]]',
      };

      (app.workspace.getActiveViewOfType as any) = vi.fn(() => ({ editor: mockEditor }));

      const img = document.createElement('img');
      const folderAndFilenameManagement = { getImagePath: () => '_attachments/Pasted image 20251004160543.webp' } as any;
      const ctx = new contextMenuCls(app as any, plugin, folderAndFilenameManagement, {} as any);

      // Act
      const caption = await (ctx as any).loadCurrentCaption(img, note);
      const dims = await (ctx as any).loadCurrentDimensions(img, note);

      // Assert
      // Bug: caption returns "" because isDimensions("100") is true, so it's mistakenly treated as dimension
      // Expected: when third part exists and is dimension, second part is ALWAYS caption regardless of format
      expect(caption).toBe('100');
      expect(dims).toEqual({ width: '450', height: '' });

      (ctx as any).onunload?.();
    });
  });

  describe('14.13 [I] Caption loading: width-only dimension in table not returned as caption', () => {
    it('given wiki-style link in table with width-only dimension (e.g., |450), when loading caption, then returns empty string', async () => {
      // Arrange
      const note = fakeTFile({ path: 'n1.md', name: 'n1.md', extension: 'md' });
      (app.workspace.getActiveFile as any) = vi.fn(() => note);

      const mockEditor = {
        getDoc: () => ({ lineCount: () => 1 }),
        // Table row with wiki-style link and width-only dimension (delimiter NOT escaped for wikilinks)
        getLine: (_n: number) => '| ![[_attachments/Pasted image 20251002174642.webp|450]] |',
      };

      (app.workspace.getActiveViewOfType as any) = vi.fn(() => ({ editor: mockEditor }));

      const img = document.createElement('img');
      const folderAndFilenameManagement = { getImagePath: () => '_attachments/Pasted image 20251002174642.webp' } as any;
      const ctx = new contextMenuCls(app as any, plugin, folderAndFilenameManagement, {} as any);

      // Act
      const caption = await (ctx as any).loadCurrentCaption(img, note);
      const dims = await (ctx as any).loadCurrentDimensions(img, note);

      // Assert
      // Caption should be empty (450 is a dimension, not a caption)
      // Dimensions should have width=450
      expect(caption).toBe('');
      expect(dims).toEqual({ width: '450', height: '' });

      (ctx as any).onunload?.();
    });
  });

  describe('14.14 [I] Caption loading: Obsidian-escaped wikilink format in tables', () => {
    it('given wikilink with Obsidian-escaped delimiters (\\|), when loading caption, then correctly parses caption and dimensions', async () => {
      // Arrange
      // This tests the case where Obsidian has auto-escaped the pipes in a table
      // The file contains: ![[path\|caption\|450]] (escaped format)
      const note = fakeTFile({ path: 'n1.md', name: 'n1.md', extension: 'md' });
      (app.workspace.getActiveFile as any) = vi.fn(() => note);

      const mockEditor = {
        getDoc: () => ({ lineCount: () => 1 }),
        // Obsidian-escaped format in table (all delimiters escaped)
        getLine: (_n: number) => '| ![[image.webp\\|sample\\|450]] |',
      };

      (app.workspace.getActiveViewOfType as any) = vi.fn(() => ({ editor: mockEditor }));

      const img = document.createElement('img');
      const folderAndFilenameManagement = { getImagePath: () => 'image.webp' } as any;
      const ctx = new contextMenuCls(app as any, plugin, folderAndFilenameManagement, {} as any);

      // Act
      const caption = await (ctx as any).loadCurrentCaption(img, note);
      const dims = await (ctx as any).loadCurrentDimensions(img, note);

      // Assert
      // Should correctly parse the escaped format
      expect(caption).toBe('sample');
      expect(dims).toEqual({ width: '450', height: '' });

      (ctx as any).onunload?.();
    });
  });

  describe('14.15 [I] Caption update in table with pipe in caption content', () => {
    it('given wiki-style link in table with caption containing pipe, when caption updated, then ALL pipes are escaped', async () => {
      // Arrange
      const ctx = new contextMenuCls(app as any, plugin, {} as any, {} as any);
      const mockEditor = {
        getDoc: () => ({ lineCount: () => 1 }),
        getLine: (_n: number) => '| ![[image.webp]] |',
        setLine: vi.fn(),
      };
      const match = {
        lineNumber: 0,
        line: '| ![[image.webp]] |',
      };

      // Act - update caption to "Hello|World" (caption contains a pipe)
      const result = await (ctx as any).updateImageLinkWithDimensions(
        mockEditor,
        match,
        'Hello|World',
        '300',
        '200'
      );

      // Assert
      // Both delimiter pipes AND the caption content pipe are escaped
      expect(result).toContain('![[image.webp\\|Hello\\|World\\|300x200]]');
      // Only 2 unescaped pipes (table delimiters)
      expect(countUnescapedPipes(result)).toBe(2);

      (ctx as any).onunload?.();
    });
  });

  describe('14.16 [I] Add dimensions to bare wikilink in table (no extra columns)', () => {
    it('given bare wikilink in table, when only dimensions added (no caption), then table structure preserved via escaped pipe', async () => {
      // Arrange
      // BUG: Adding width to a bare link in table caused extra column:
      // Input:  | ![[path.webp]] | became | ![[path.webp | 450]] | (broken)
      // FIX: Escape the pipe to prevent table column split
      const ctx = new contextMenuCls(app as any, plugin, {} as any, {} as any);
      const mockEditor = {
        getDoc: () => ({ lineCount: () => 1 }),
        // Bare link in table - no caption, no dimensions
        getLine: (_n: number) => '| ![[_attachments/Pasted image 20251004160543.webp]] |',
        setLine: vi.fn(),
      };
      const match = {
        lineNumber: 0,
        line: '| ![[_attachments/Pasted image 20251004160543.webp]] |',
      };

      // Act - add only dimensions (450), no caption
      const result = await (ctx as any).updateImageLinkWithDimensions(
        mockEditor,
        match,
        '', // empty caption
        '450',
        ''
      );

      // Assert
      // Pipe must be escaped to prevent table column split
      expect(result).toContain('![[_attachments/Pasted image 20251004160543.webp\\|450]]');
      // Should NOT have unescaped pipe in wikilink (that would break table)
      expect(result).not.toContain('webp|450');
      // Table should have only 2 unescaped pipes (table delimiters)
      expect(countUnescapedPipes(result)).toBe(2);

      (ctx as any).onunload?.();
    });
  });
});

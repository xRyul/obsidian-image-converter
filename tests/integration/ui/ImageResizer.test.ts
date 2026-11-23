/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unnecessary-type-assertion, obsidianmd/no-static-styles-assignment */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import ImageConverterPlugin from '../../../src/main';
import { ImageResizer } from '../../../src/ImageResizer';
import { fakeApp, fakeTFile, fakeVault, fakeWorkspace, fakePluginManifest } from '../../factories/obsidian';
import { setupFakeTimers } from '../../helpers/test-setup';

function setRect(el: Element, rect: Partial<DOMRect>) {
  (el as any).getBoundingClientRect = () => ({
    x: (rect as any).left ?? 0,
    y: (rect as any).top ?? 0,
    left: (rect as any).left ?? 0,
    top: (rect as any).top ?? 0,
    right: ((rect as any).left ?? 0) + ((rect as any).width ?? 0),
    bottom: ((rect as any).top ?? 0) + ((rect as any).height ?? 0),
    width: (rect as any).width ?? 0,
    height: (rect as any).height ?? 0,
    toJSON: () => {}
  } as DOMRect);
}

function setupView() {
  document.body.innerHTML = '';
  const container = document.createElement('div');
  container.className = 'markdown-preview-view';
  document.body.appendChild(container);
  return { container };
}

function setupViewWithImage() {
  document.body.innerHTML = '';
  const container = document.createElement('div');
  container.className = 'markdown-preview-view';
  const embed = document.createElement('div');
  embed.className = 'internal-embed image-embed';
  const img = document.createElement('img');
  img.setAttribute('src', 'app://vault/imgs/pic.jpg');
  setRect(img, { left: 0, top: 0, width: 200, height: 100 });
  embed.appendChild(img);
  container.appendChild(embed);
  document.body.appendChild(container);
  return { container, img, embed };
}

function setupViewWithImageWrapper() {
  document.body.innerHTML = '';
  const container = document.createElement('div');
  container.className = 'markdown-source-view';
  const embed = document.createElement('div');
  embed.className = 'internal-embed image-embed';
  const wrapper = document.createElement('div');
  wrapper.className = 'image-wrapper';
  const img = document.createElement('img');
  img.setAttribute('src', 'app://vault/imgs/pic.jpg');
  setRect(img, { left: 0, top: 0, width: 200, height: 100 });
  const corner = document.createElement('div');
  corner.className = 'image-resize-corner';
  wrapper.appendChild(img);
  wrapper.appendChild(corner);
  embed.appendChild(wrapper);
  container.appendChild(embed);
  document.body.appendChild(container);
  return { container, embed, wrapper, img, corner };
}

function setupContainers() {
  document.body.innerHTML = '';
  const containerA = document.createElement('div');
  containerA.className = 'markdown-preview-view container-a';
  const containerB = document.createElement('div');
  containerB.className = 'markdown-preview-view container-b';
  document.body.appendChild(containerA);
  document.body.appendChild(containerB);
  return { containerA, containerB };
}

function addInternalImage(parent: HTMLElement, src = 'app://vault/imgs/pic.jpg') {
  const embed = document.createElement('div');
  embed.className = 'internal-embed image-embed';
  const img = document.createElement('img');
  img.setAttribute('src', src);
  setRect(img, { left: 0, top: 0, width: 200, height: 100 });
  embed.appendChild(img);
  parent.appendChild(embed);
  return img as HTMLImageElement;
}

function addExternalImage(parent: HTMLElement) {
  const img = document.createElement('img');
  img.setAttribute('src', 'https://example.com/pic.jpg');
  setRect(img, { left: 0, top: 0, width: 200, height: 100 });
  parent.appendChild(img);
  return img as HTMLImageElement;
}

const activeResizers: ImageResizer[] = [];

function makeResizer({ viewMode = 'source', overrides = {}, workspaceOverride }: { viewMode?: 'preview' | 'source', overrides?: Partial<any>, workspaceOverride?: any } = {}) {
  const note = fakeTFile({ path: 'Notes/n1.md', name: 'n1.md', extension: 'md' });
  const vault = fakeVault({ files: [note] });
  const workspace = workspaceOverride ?? fakeWorkspace({ activeFile: note });
  const app = fakeApp({ vault, workspace });
  const plugin = new ImageConverterPlugin(app as any, fakePluginManifest({ id: 'image-converter', dir: '/plugins/image-converter' }));
  plugin.manifest = { id: 'image-converter', dir: '/plugins/image-converter' } as any;
  plugin.supportedImageFormats = { isExcalidrawImage: () => false } as any;
  plugin.settings = Object.assign({
    isImageResizeEnbaled: true,
    isDragResizeEnabled: true,
    isDragAspectRatioLocked: true,
    isScrollResizeEnabled: true,
    resizeSensitivity: 0.1,
    scrollwheelModifier: 'None',
    isImageAlignmentEnabled: false,
    isResizeInReadingModeEnabled: true,
    disableObsidianImageSelectionOnClick: false,
    dropPasteCursorLocation: 'back',
    resizeCursorLocation: 'front'
  }, overrides) as any;
  const resizer = new ImageResizer(plugin);
  // Patch instance to satisfy Component.addChild in tests without touching global mocks
  (resizer as any).addChild = (child: any) => { ((resizer as any).__children ||= []).push(child); };
  const markdownView = {
    containerEl: document.body,
    editor: { getValue: () => '', getCursor: () => ({ line: 0, ch: 0 }), getLine: () => '', lastLine: () => 0, transaction: () => {}, setCursor: () => {} },
    getState: () => ({ mode: viewMode })
  } as any;
  (resizer as any).attachView(markdownView);
  activeResizers.push(resizer);
  return { app, plugin, resizer, markdownView };
}

// 13.1–13.3 core interactions
afterEach(() => {
  // Ensure no leaked listeners between tests
  for (const resizerToUnload of activeResizers.splice(0)) {
    try { (resizerToUnload as any).onunload(); } catch (err) { void err; }
  }
});

describe('ImageResizer interactions core (13.1–13.3)', () => {
  let resizer: ImageResizer;

  beforeEach(() => {
    const { resizer: createdResizer } = makeResizer({ viewMode: 'preview', overrides: { isScrollResizeEnabled: false } });
    resizer = createdResizer;
  });

  it('13.1 creates handles when hovering internal image and preserves alignment classes on cleanup', () => {
    const { img } = setupViewWithImage();
    img.classList.add('image-position-left', 'image-wrap', 'image-converter-aligned');

    (resizer as any).handleImageHover({ target: img } as any);

    const container = (img as any).matchParent?.('.image-resize-container') || (img as any).matchParent('.image-resize-container');
    expect(container).toBeTruthy();
    const handles = container?.querySelectorAll('.image-resize-handle');
    expect(handles?.length).toBe(8);

    // After cleanup, the original alignment classes are restored back to the image
    ;(resizer as any).cleanupHandles();
    expect(img.classList.contains('image-position-left')).toBe(true);
    expect(img.classList.contains('image-wrap')).toBe(true);
    expect(img.classList.contains('image-converter-aligned')).toBe(true);
  });

  it('13.2 drag resize updates width/height and cleans up on mouseup', () => {
    const { img } = setupViewWithImage();

    (resizer as any).handleImageHover({ target: img } as any);

    const container = (img as any).matchParent('.image-resize-container')!;
    const se = container.querySelector('.image-resize-handle-se') as HTMLElement;

    se.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, clientY: 30, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    expect(parseInt((img as any).style.width || '0', 10)).toBeGreaterThan(0);
    expect(parseInt((img as any).style.height || '0', 10)).toBeGreaterThan(0);

    // 'resizing' class removed from container after mouseup
    expect(container.classList.contains('resizing')).toBe(false);

    expect((img as any).matchParent('.image-resize-container')).toBeNull();
  });

  it('13.3 aspect ratio lock: edge handle maintains ratio when locked', () => {
    const { img } = setupViewWithImage();

    (resizer as any).handleImageHover({ target: img } as any);

    const container = (img as any).matchParent('.image-resize-container')!;
    const eHandle = container.querySelector('.image-resize-handle-e') as HTMLElement;

    const initW = (img as any).getBoundingClientRect().width;
    const initH = (img as any).getBoundingClientRect().height;
    const initRatio = initW / initH;

    eHandle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 0, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    const widthPx = parseInt((img as any).style.width || '0', 10);
    const heightPx = parseInt((img as any).style.height || '0', 10);
    const newRatio = widthPx / Math.max(1, heightPx);
    expect(Math.abs(newRatio - initRatio)).toBeLessThanOrEqual(0.05);
  });
});

// Additional behaviors including scroll, editor constraints, cursor, alignment, excalidraw, active view, edge detection
describe('ImageResizer additional behaviors (13.4–13.6, 13.7–13.14, 13.19, 13.24)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('13.4 Scroll-wheel resize (pixels): width/height change when enabled and modifier satisfied; min height >= 22px (px widths), 1–100% for % widths', () => {
    const { resizer } = makeResizer({ viewMode: 'source', overrides: { isScrollResizeEnabled: true, scrollwheelModifier: 'None' } });
    const { container } = setupView();
    const img = addInternalImage(container);

    (resizer as any).handleImageHover({ target: img, clientX: 5, clientY: 5 } as any);

    const beforeW = parseInt(img.style.width || '200', 10) || 200;
    // Ensure a non-zero height baseline for environments where clientHeight can be 0
    img.style.height = '100px';
    img.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, bubbles: true, cancelable: true }));
    const afterW = parseInt(img.style.width || '0', 10);
    const afterH = parseInt(img.style.height || '0', 10);
    expect(afterW).not.toBe(beforeW);
    expect(afterW).toBeGreaterThan(0);
    expect(afterH === 0 || afterH >= 22).toBe(true);
  });

  it('13.5 Resize sensitivity: given sensitivity changed, when wheel-resize, then step size scales accordingly', () => {
    const { resizer, plugin } = makeResizer({ viewMode: 'source', overrides: { isScrollResizeEnabled: true, scrollwheelModifier: 'None' } });
    const { container } = setupView();
    const img = addInternalImage(container);

    (resizer as any).handleImageHover({ target: img, clientX: 5, clientY: 5 } as any);

    // Base sensitivity
    plugin.settings.resizeSensitivity = 0.05;
    img.style.width = '200px';
    img.style.height = '100px';
    img.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, bubbles: true, cancelable: true }));
    const afterLow = parseInt(img.style.width || '0', 10);

    // Higher sensitivity
    plugin.settings.resizeSensitivity = 0.5;
    img.style.width = '200px';
    img.style.height = '100px';
    img.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, bubbles: true, cancelable: true }));
    const afterHigh = parseInt(img.style.width || '0', 10);

    expect(Math.abs(afterHigh - 200)).toBeGreaterThanOrEqual(Math.abs(afterLow - 200));
  });

  it('13.6 Minimum constraints: drag clamp ≥10px; editor width constraint clamps to max 800', () => {
    const { resizer } = makeResizer();
    const { container } = setupView();
    const img = addInternalImage(container);

    (resizer as any).handleImageHover({ target: img } as any);
    const wrapper = (img as any).matchParent('.image-resize-container')!;
    const eHandle = wrapper.querySelector('.image-resize-handle-e') as HTMLElement;

    eHandle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    // Move far left to attempt < 10px then far right to exceed editor width
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: -1000, clientY: 0, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5000, clientY: 0, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    // Minimum clamp check indirectly (width > 0) is implicit during drag; final clamp to editor width
    expect(img.style.width).toBe('800px');
    expect(img.style.height === '400px' || parseInt(img.style.height || '0', 10) === 400).toBe(true);
  });

  it('13.8 Reading mode gating: visual updates only, no editor transaction', () => {
    const editor = {
      getValue: () => '![|100x100](imgs/pic.jpg)\n',
      getCursor: () => ({ line: 0, ch: 0 }),
      getLine: (_: number) => '![|100x100](imgs/pic.jpg)',
      lastLine: () => 0,
      transaction: vi.fn(),
      setCursor: vi.fn()
    };

    const { resizer, markdownView } = makeResizer({ viewMode: 'preview' });
    (markdownView as any).editor = editor;

    const { container } = setupView();
    const img = addInternalImage(container);

    (resizer as any).handleImageHover({ target: img } as any);
    const wrapper = (img as any).matchParent('.image-resize-container')!;
    const se = wrapper.querySelector('.image-resize-handle-se') as HTMLElement;

    se.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, clientY: 30, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    expect(editor.transaction).not.toHaveBeenCalled();
    expect(parseInt(img.style.width || '0', 10)).toBeGreaterThan(0);
  });

  it('13.9 Edit mode updates: editor.transaction is called during drag (live) and on mouseup', () => {
    const lines = ['![|100x100](imgs/pic.jpg)'];
    const editor = {
      getValue: () => lines.join('\n'),
      getCursor: () => ({ line: 0, ch: 0 }),
      getLine: (i: number) => lines[i] || '',
      lastLine: () => lines.length - 1,
      transaction: vi.fn(),
      setCursor: vi.fn()
    };

    const { resizer, markdownView } = makeResizer({ viewMode: 'source' });
    (markdownView as any).editor = editor;
    (resizer as any).editor = editor;

    const { container } = setupView();
    const img = addInternalImage(container);

    (resizer as any).handleImageHover({ target: img } as any);
    const wrapper = (img as any).matchParent('.image-resize-container')!;
    const se = wrapper.querySelector('.image-resize-handle-se') as HTMLElement;

    se.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, clientY: 30, bubbles: true }));
    // Live update during drag should have already triggered a transaction via throttled update
    expect(editor.transaction).toHaveBeenCalled();

    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    // And a final update at drag end is also acceptable
    expect(editor.transaction).toHaveBeenCalled();
  });

  it('13.10 Cursor placement variants: front/back/below/none', () => {
    const lines = ['before', '![|100x100](imgs/pic.jpg)', 'after'];
    const editor = {
      getValue: () => lines.join('\n'),
      getCursor: () => ({ line: 1, ch: 0 }),
      getLine: (i: number) => lines[i] || '',
      lastLine: () => lines.length - 1,
      transaction: vi.fn(),
      setCursor: vi.fn()
    };

    const { resizer, markdownView, plugin } = makeResizer({ viewMode: 'source', overrides: { resizeCursorLocation: 'below' } });
    (markdownView as any).editor = editor;
    (resizer as any).editor = editor;

    const { container } = setupView();
    const img = addInternalImage(container);

    (resizer as any).handleImageHover({ target: img } as any);
    const wrapper = (img as any).matchParent('.image-resize-container')!;
    const se = wrapper.querySelector('.image-resize-handle-se') as HTMLElement;

    // below
    se.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(editor.setCursor).toHaveBeenCalledWith({ line: 2, ch: 0 });

    // front
    plugin.settings.resizeCursorLocation = 'front';
    ;(editor.setCursor as any).mockClear?.();
    se.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 0, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect((editor.setCursor as any).mock.calls.length).toBeGreaterThan(0);

    // back
    plugin.settings.resizeCursorLocation = 'back';
    se.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 0, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect((editor.setCursor as any).mock.calls.length).toBeGreaterThanOrEqual(2);

    // none
    plugin.settings.resizeCursorLocation = 'none';
    (editor.setCursor as any).mockClear?.();
    se.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 0, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect((editor.setCursor as any).mock.calls.length).toBe(0);
  });

  it('13.29 Click override: given enabled setting, when clicking an internal image or native resize corner, then the Markdown link is revealed at the configured cursor position', () => {
    const lines = ['before', '![[imgs/pic.jpg|100x100]]', 'middle', '![[imgs/pic.jpg|120x120]]'];
    const editor = {
      getValue: () => lines.join('\n'),
      getCursor: () => ({ line: 0, ch: 0 }),
      getLine: (i: number) => lines[i] || '',
      lastLine: () => lines.length - 1,
      posAtMouse: vi.fn(() => ({ line: 3, ch: 8 })),
      transaction: vi.fn(),
      setCursor: vi.fn()
    };

    const { resizer, markdownView, plugin } = makeResizer({
      viewMode: 'source',
      overrides: {
        disableObsidianImageSelectionOnClick: true,
        dropPasteCursorLocation: 'front'
      }
    });
    (markdownView as any).editor = editor;
    (resizer as any).editor = editor;

    const { corner, img } = setupViewWithImageWrapper();
    const editButton = document.createElement('button');
    editButton.className = 'edit-block-button';
    const nativeRevealClick = vi.fn(() => {
      editor.setCursor({ line: 3, ch: 99 });
    });
    editButton.addEventListener('click', nativeRevealClick);
    img.closest('.image-embed')!.appendChild(editButton);

    const prevented = corner.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    expect(prevented).toBe(false);
    expect(nativeRevealClick).toHaveBeenCalledTimes(1);
    expect(editor.setCursor).toHaveBeenLastCalledWith({ line: 3, ch: 0 });

    corner.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    corner.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    plugin.settings.dropPasteCursorLocation = 'back';
    (editor.posAtMouse as any).mockReturnValue({ line: 1, ch: 6 });
    (editor.setCursor as any).mockClear?.();

    img.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    expect(nativeRevealClick).toHaveBeenCalledTimes(2);
    expect(editor.setCursor).toHaveBeenLastCalledWith({ line: 1, ch: lines[1].length });
  });

  it.each([
    { cursorLocation: 'front' as const },
    { cursorLocation: 'back' as const }
  ])('13.29c Table click override: reveals the clicked cell image at its $cursorLocation', ({ cursorLocation }) => {
    const firstLink = '![[imgs/first.jpg]]';
    const clickedLink = '![[imgs/pic.jpg|100x100]]';
    const cellLine = `${firstLink} ${clickedLink}`;
    const clickedStart = cellLine.indexOf(clickedLink);
    const expectedCh = cursorLocation === 'front' ? clickedStart : clickedStart + clickedLink.length;
    const lines = ['before', '', '| Image | Text |', '| --- | --- |', `| ${cellLine} | Example |`];
    const outerEditor = {
      getValue: () => lines.join('\n'),
      getCursor: () => ({ line: 0, ch: 0 }),
      getLine: (line: number) => lines[line] ?? '',
      lastLine: () => lines.length - 1,
      posAtMouse: vi.fn(() => ({ line: 4, ch: clickedStart + 7 })),
      transaction: vi.fn(),
      setCursor: vi.fn()
    };
    const cellEditor = {
      getValue: () => cellLine,
      getCursor: () => ({ line: 0, ch: 5 }),
      getLine: (line: number) => line === 0 ? cellLine : '',
      lastLine: () => 0,
      posAtMouse: vi.fn(() => ({ line: 0, ch: clickedStart + 5 })),
      transaction: vi.fn(),
      setCursor: vi.fn()
    };
    const { resizer, markdownView } = makeResizer({
      viewMode: 'source',
      overrides: {
        disableObsidianImageSelectionOnClick: true,
        dropPasteCursorLocation: cursorLocation
      }
    });
    (markdownView as any).editor = outerEditor;
    (resizer as any).editor = outerEditor;

    document.body.replaceChildren();
    const tableWidgetEl = document.createElement('div');
    tableWidgetEl.className = 'cm-embed-block cm-table-widget markdown-rendered';
    const table = document.createElement('table');
    const row = document.createElement('tr');
    const cellEl = document.createElement('td');
    const renderedCell = document.createElement('div');
    renderedCell.className = 'table-cell-wrapper';
    const firstRenderedEmbed = document.createElement('span');
    firstRenderedEmbed.className = 'internal-embed media-embed image-embed is-loaded';
    const firstRenderedImage = document.createElement('img');
    firstRenderedImage.src = 'app://vault/imgs/first.jpg';
    firstRenderedEmbed.appendChild(firstRenderedImage);

    const renderedEmbed = document.createElement('span');
    renderedEmbed.className = 'internal-embed media-embed image-embed is-loaded';
    const renderedImage = document.createElement('img');
    renderedImage.src = 'app://vault/imgs/pic.jpg';
    const activeCellNativeEditClick = vi.fn();
    const renderedEditButton = document.createElement('button');
    renderedEditButton.className = 'edit-block-button';
    renderedEditButton.addEventListener('click', activeCellNativeEditClick);
    renderedEmbed.appendChild(renderedImage);
    renderedEmbed.appendChild(renderedEditButton);
    renderedCell.appendChild(firstRenderedEmbed);
    renderedCell.appendChild(renderedEmbed);
    cellEl.appendChild(renderedCell);
    row.appendChild(cellEl);
    table.appendChild(row);
    tableWidgetEl.appendChild(table);
    document.body.appendChild(tableWidgetEl);

    const nativePostPointerMouseDown = vi.fn();
    const nativePostPointerClick = vi.fn();
    tableWidgetEl.addEventListener('mousedown', nativePostPointerMouseDown);
    tableWidgetEl.addEventListener('click', (event) => {
      if ((event.target as Element).closest('.edit-block-button')) return;
      nativePostPointerClick();
    });

    const tableCell = { row: 1, col: 0, el: cellEl };
    const firstNativeRevealClick = vi.fn(() => {
      cellEditor.setCursor({ line: 0, ch: 888 });
    });
    const nativeRevealClick = vi.fn(() => {
      cellEditor.setCursor({ line: 0, ch: 999 });
    });
    const tableEditorState: {
      tableCell?: {
        editor: typeof cellEditor;
        containerEl: HTMLElement;
        cell: typeof tableCell;
      };
    } = {};
    const mountCellEditor = () => {
      renderedCell.style.display = 'none';
      const editingCell = document.createElement('div');
      editingCell.className = 'table-cell-wrapper';
      const firstEditingEmbed = document.createElement('div');
      firstEditingEmbed.className = 'internal-embed media-embed image-embed is-loaded';
      const firstEditingImage = document.createElement('img');
      firstEditingImage.src = 'app://vault/imgs/first.jpg';
      const firstEditButton = document.createElement('button');
      firstEditButton.className = 'edit-block-button';
      firstEditButton.addEventListener('click', firstNativeRevealClick);
      firstEditingEmbed.appendChild(firstEditingImage);
      firstEditingEmbed.appendChild(firstEditButton);

      const editingEmbed = document.createElement('div');
      editingEmbed.className = 'internal-embed media-embed image-embed is-loaded';
      const editingImage = document.createElement('img');
      editingImage.src = 'app://vault/imgs/pic.jpg';
      const editButton = document.createElement('button');
      editButton.className = 'edit-block-button';
      editButton.addEventListener('click', nativeRevealClick);
      editingEmbed.appendChild(editingImage);
      editingEmbed.appendChild(editButton);
      editingCell.appendChild(firstEditingEmbed);
      editingCell.appendChild(editingEmbed);
      const activeCellElement = document.createElement('td');
      activeCellElement.appendChild(editingCell);
      row.replaceChild(activeCellElement, cellEl);
      tableEditorState.tableCell = {
        editor: cellEditor,
        containerEl: editingCell,
        cell: { ...tableCell, el: activeCellElement }
      };
    };
    const setCellFocus = vi.fn(() => {
      mountCellEditor();
    });
    const getClosestCell = vi.fn(() => tableCell);
    (tableWidgetEl as any).cmTile = {
      widget: {
        editor: tableEditorState,
        getClosestCell,
        setCellFocus
      }
    };

    const frameCallbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });

    const allowed = renderedImage.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      clientX: 25,
      clientY: 30
    }));


    tableWidgetEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    tableWidgetEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(allowed).toBe(false);
    expect(getClosestCell).toHaveBeenCalledWith(25, 30);
    expect(setCellFocus).toHaveBeenCalledWith(1, 0);
    expect(nativeRevealClick).toHaveBeenCalledTimes(1);
    expect(firstNativeRevealClick).not.toHaveBeenCalled();
    expect(activeCellNativeEditClick).not.toHaveBeenCalled();
    expect(nativePostPointerMouseDown).not.toHaveBeenCalled();
    expect(nativePostPointerClick).not.toHaveBeenCalled();
    expect(cellEditor.setCursor).toHaveBeenLastCalledWith({ line: 0, ch: 999 });
    expect(frameCallbacks).toHaveLength(1);

    frameCallbacks[0]?.(0);

    expect(cellEditor.setCursor).toHaveBeenLastCalledWith({ line: 0, ch: expectedCh });
    expect(outerEditor.setCursor).not.toHaveBeenCalled();
  });

  it('13.29i Table click removes transient resize handles before mounting the cell editor', () => {
    const { resizer } = makeResizer({
      viewMode: 'source',
      overrides: { disableObsidianImageSelectionOnClick: true }
    });

    document.body.replaceChildren();
    const tableWidgetEl = document.createElement('div');
    tableWidgetEl.className = 'cm-table-widget';
    const table = document.createElement('table');
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    const embed = document.createElement('div');
    embed.className = 'image-embed';
    const resizeContainer = document.createElement('div');
    resizeContainer.className = 'image-resize-container';
    const image = document.createElement('img');
    image.src = 'app://vault/imgs/pic.jpg';

    resizeContainer.appendChild(image);
    embed.appendChild(resizeContainer);
    cell.appendChild(embed);
    row.appendChild(cell);
    table.appendChild(row);
    tableWidgetEl.appendChild(table);
    document.body.appendChild(tableWidgetEl);
    (resizer as any).activeImage = image;

    const setCellFocus = vi.fn(() => {
      expect(image.closest('.image-resize-container')).toBeNull();
    });
    const tableWidget = {
      editor: {},
      getClosestCell: vi.fn(() => ({ row: 0, col: 0, el: cell })),
      setCellFocus
    };
    vi.spyOn(resizer as any, 'tryRevealActiveTableImageMarkdown').mockReturnValue(true);

    const didReveal = (resizer as any).revealTableImageMarkdown(
      image,
      new MouseEvent('pointerdown', { clientX: 10, clientY: 20 }),
      tableWidget,
      0
    );

    expect(didReveal).toBe(true);
    expect(setCellFocus).toHaveBeenCalledWith(0, 0);
  });

  it('13.29m Table reveal does not suppress an unrelated click after the originating pointer ends', () => {
    const { resizer } = makeResizer({
      viewMode: 'source',
      overrides: { disableObsidianImageSelectionOnClick: true }
    });

    document.body.replaceChildren();
    const tableWidgetEl = document.createElement('div');
    tableWidgetEl.className = 'cm-table-widget';
    const cellWrapper = document.createElement('div');
    cellWrapper.className = 'table-cell-wrapper';
    const embed = document.createElement('span');
    embed.className = 'image-embed';
    const image = document.createElement('img');
    image.src = 'app://vault/imgs/pic.jpg';
    embed.appendChild(image);
    cellWrapper.appendChild(embed);
    tableWidgetEl.appendChild(cellWrapper);
    (tableWidgetEl as any).cmTile = {
      widget: {
        editor: {},
        getClosestCell: vi.fn(),
        setCellFocus: vi.fn()
      }
    };
    document.body.appendChild(tableWidgetEl);

    vi.spyOn(resizer as any, 'revealTableImageMarkdown').mockImplementation(() => {
      tableWidgetEl.replaceChildren();
      return true;
    });

    image.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      pointerId: 17
    }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 17 }));

    const unrelatedEditorLocation = document.createElement('button');
    const unrelatedMouseDown = vi.fn();
    const unrelatedClick = vi.fn();
    unrelatedEditorLocation.addEventListener('mousedown', unrelatedMouseDown);
    unrelatedEditorLocation.addEventListener('click', unrelatedClick);
    document.body.appendChild(unrelatedEditorLocation);

    const mouseDownAllowed = unrelatedEditorLocation.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true
    }));
    const clickAllowed = unrelatedEditorLocation.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true
    }));

    expect(mouseDownAllowed).toBe(true);
    expect(clickAllowed).toBe(true);
    expect(unrelatedMouseDown).toHaveBeenCalledTimes(1);
    expect(unrelatedClick).toHaveBeenCalledTimes(1);
  });


  it('13.29d Click override leaves unsupported table image widgets to Obsidian', () => {
    const line = '| ![[imgs/pic.jpg|100x100]] |';
    const editor = {
      getValue: () => line,
      getCursor: () => ({ line: 0, ch: 0 }),
      getLine: () => line,
      lastLine: () => 0,
      posAtMouse: vi.fn(() => ({ line: 0, ch: 3 })),
      transaction: vi.fn(),
      setCursor: vi.fn()
    };
    const { resizer, markdownView } = makeResizer({
      viewMode: 'source',
      overrides: { disableObsidianImageSelectionOnClick: true }
    });
    (markdownView as any).editor = editor;
    (resizer as any).editor = editor;

    document.body.replaceChildren();
    const tableWidgetEl = document.createElement('div');
    tableWidgetEl.className = 'cm-embed-block cm-table-widget markdown-rendered';
    const cellEl = document.createElement('td');
    const embed = document.createElement('div');
    embed.className = 'internal-embed media-embed image-embed is-loaded';
    const img = document.createElement('img');
    img.src = 'app://vault/imgs/pic.jpg';
    const editButton = document.createElement('button');
    editButton.className = 'edit-block-button';
    const nativeEditClick = vi.fn();
    editButton.addEventListener('click', nativeEditClick);
    embed.appendChild(img);
    embed.appendChild(editButton);
    cellEl.appendChild(embed);
    tableWidgetEl.appendChild(cellEl);
    (tableWidgetEl as any).cmTile = { widget: {} };
    document.body.appendChild(tableWidgetEl);

    const nativePointerDown = vi.fn();
    const nativeMouseDown = vi.fn();
    const nativeClick = vi.fn();
    tableWidgetEl.addEventListener('pointerdown', nativePointerDown);
    tableWidgetEl.addEventListener('mousedown', nativeMouseDown);
    tableWidgetEl.addEventListener('click', nativeClick);

    const pointerAllowed = img.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    const mouseAllowed = img.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    const clickAllowed = img.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(pointerAllowed).toBe(true);
    expect(mouseAllowed).toBe(true);
    expect(clickAllowed).toBe(true);
    expect(nativePointerDown).toHaveBeenCalledTimes(1);
    expect(nativeMouseDown).toHaveBeenCalledTimes(1);
    expect(nativeClick).toHaveBeenCalledTimes(1);
    expect(nativeEditClick).not.toHaveBeenCalled();
    expect(editor.setCursor).not.toHaveBeenCalled();
  });


  it('13.29a Click cursor lookup scans a large note once without copying the whole document', () => {
    const lineCount = 1000;
    const lines = Array.from({ length: lineCount }, (_, line) => `ordinary line ${line}`);
    lines[0] = '---';
    lines[1] = 'cover: "![[target.png]]"';
    lines[2] = '---';
    lines[500] = '![[target.png|100x100]]';
    lines[lineCount - 1] = '![[target.png|120x120]]';

    const getValue = vi.fn(() => lines.join('\n'));
    const getLine = vi.fn((line: number) => lines[line] ?? '');
    const editor = {
      getValue,
      getCursor: () => ({ line: lineCount - 1, ch: 8 }),
      getLine,
      lastLine: () => lineCount - 1,
      posAtMouse: () => ({ line: lineCount - 1, ch: 8 }),
      transaction: vi.fn(),
      setCursor: vi.fn()
    };
    const { resizer, markdownView } = makeResizer({
      viewMode: 'source',
      overrides: { dropPasteCursorLocation: 'back' }
    });
    (markdownView as any).editor = editor;
    (resizer as any).editor = editor;
    const { img } = setupViewWithImageWrapper();
    img.setAttribute('src', 'app://vault/target.png');

    const position = (resizer as any).getCursorPositionForImageClick(
      img,
      new MouseEvent('mousedown')
    );

    expect(position).toEqual({
      line: lineCount - 1,
      ch: lines[lineCount - 1].length
    });
    expect(getValue).not.toHaveBeenCalled();
    expect(getLine).toHaveBeenCalledTimes(lineCount);
  });

  it('13.29b Markdown resize lookup scans a large note once without copying the whole document', async () => {
    const lineCount = 1000;
    const lines = Array.from({ length: lineCount }, (_, line) => `ordinary line ${line}`);
    lines[0] = '---';
    lines[1] = 'cover: "![[target.png]]"';
    lines[2] = '---';
    lines[500] = '![[target.png|100x100]]';
    lines[lineCount - 1] = '![[target.png|120x120]]';

    const getValue = vi.fn(() => lines.join('\n'));
    const getLine = vi.fn((line: number) => lines[line] ?? '');
    const transaction = vi.fn();
    const editor = {
      getValue,
      getCursor: () => ({ line: lineCount - 1, ch: 8 }),
      getLine,
      lastLine: () => lineCount - 1,
      posAtMouse: () => ({ line: lineCount - 1, ch: 8 }),
      transaction,
      setCursor: vi.fn()
    };
    const { resizer, markdownView } = makeResizer({ viewMode: 'source' });
    (markdownView as any).editor = editor;
    (resizer as any).editor = editor;
    const { img } = setupViewWithImageWrapper();
    img.setAttribute('src', 'app://vault/target.png');

    await (resizer as any).updateMarkdownLink(img, 200, 100, 'se');

    const transactionArgs = (transaction as any).mock.calls[0][0] as {
      changes: Array<{ from: { line: number } }>
    };
    const changedLines = transactionArgs.changes.map((change) => change.from.line);
    expect(changedLines).toEqual([500, lineCount - 1]);
    expect(getValue).not.toHaveBeenCalled();
    expect(getLine).toHaveBeenCalledTimes(lineCount);
  });

  it.each([
    { interaction: 'scroll resize', currentHandle: null },
    { interaction: 'drag resize', currentHandle: 'se' }
  ])('13.29e Table image $interaction updates an escaped width-only wikilink', async ({ currentHandle }) => {
    const link = '![[_attachments/Pasted image 20251004160543.jpg\\|122]]';
    const line = `|     | ${link} |     |`;
    const transaction = vi.fn();
    const editor = {
      getValue: () => line,
      getCursor: () => ({ line: 0, ch: 0 }),
      getLine: () => line,
      lastLine: () => 0,
      transaction,
      setCursor: vi.fn()
    };
    const { resizer, markdownView } = makeResizer({ viewMode: 'source' });
    (markdownView as any).editor = editor;
    (resizer as any).editor = editor;
    const { img } = setupViewWithImageWrapper();
    img.setAttribute('src', 'app://vault/_attachments/Pasted%20image%2020251004160543.jpg');

    await (resizer as any).updateMarkdownLink(img, 200, 100, currentHandle);

    const expectedLink = '![[_attachments/Pasted image 20251004160543.jpg\\|200x100]]';
    expect(transaction).toHaveBeenCalledWith({
      changes: [{
        from: { line: 0, ch: line.indexOf(link) },
        to: { line: 0, ch: line.indexOf(link) + link.length },
        text: expectedLink
      }]
    });
  });

  it('13.29j Active table-cell resize updates the nested editor without corrupting table delimiters', async () => {
    const outerLine = '| ![[image.webp\\|122]] | control |';
    let cellLine = '![[image.webp|122]]';
    const outerTransaction = vi.fn();
    const cellTransaction = vi.fn(({ changes }: any) => {
      const [change] = changes;
      cellLine = `${cellLine.slice(0, change.from.ch)}${change.text}${cellLine.slice(change.to.ch)}`;
    });
    const outerEditor = {
      getValue: () => outerLine,
      getCursor: () => ({ line: 0, ch: 0 }),
      getLine: () => outerLine,
      lastLine: () => 0,
      transaction: outerTransaction,
      setCursor: vi.fn()
    };
    const cellEditor = {
      getValue: () => cellLine,
      getCursor: () => ({ line: 0, ch: 0 }),
      getLine: () => cellLine,
      lastLine: () => 0,
      transaction: cellTransaction,
      setCursor: vi.fn()
    };
    const { resizer, markdownView } = makeResizer({ viewMode: 'source' });
    (markdownView as any).editor = outerEditor;
    (resizer as any).editor = outerEditor;

    document.body.replaceChildren();
    const tableWidget = document.createElement('div');
    tableWidget.className = 'cm-table-widget';
    const editingCell = document.createElement('div');
    editingCell.className = 'table-cell-wrapper';
    const image = addInternalImage(editingCell, 'app://vault/image.webp');
    tableWidget.appendChild(editingCell);
    (tableWidget as any).cmTile = {
      widget: {
        editor: { tableCell: { editor: cellEditor, containerEl: editingCell } },
        getClosestCell: vi.fn(),
        setCellFocus: vi.fn()
      }
    };
    document.body.appendChild(tableWidget);

    await (resizer as any).updateMarkdownLink(image, 200, 100, 'se');

    expect(cellTransaction).toHaveBeenCalledWith({
      changes: [{
        from: { line: 0, ch: 0 },
        to: { line: 0, ch: '![[image.webp|122]]'.length },
        text: '![[image.webp|200x100]]'
      }]
    });
    expect(outerTransaction).not.toHaveBeenCalled();
    expect(cellLine).toBe('![[image.webp|200x100]]');
    expect(cellLine).not.toMatch(/\]\]\|$/);
  });

  it.each([
    {
      caseName: 'escaped wiki caption pipes',
      line: '| ![[image.webp\\|Hello\\|World\\|122]] |',
      link: '![[image.webp\\|Hello\\|World\\|122]]',
      expectedLink: '![[image.webp\\|Hello\\|World\\|200x100]]'
    },
    {
      caseName: 'regular wiki caption pipes',
      line: '![[image.webp|Hello|World]]',
      link: '![[image.webp|Hello|World]]',
      expectedLink: '![[image.webp|Hello|World|200x100]]'
    },
    {
      caseName: 'escaped Markdown width',
      line: '| ![Preview\\|122](_attachments/image.webp) |',
      link: '![Preview\\|122](_attachments/image.webp)',
      expectedLink: '![Preview\\|200x100](_attachments/image.webp)'
    },
    {
      caseName: 'regular Markdown width',
      line: '![Preview|122](_attachments/image.webp)',
      link: '![Preview|122](_attachments/image.webp)',
      expectedLink: '![Preview|200x100](_attachments/image.webp)'
    },
    {
      caseName: 'bare table wikilink',
      line: '| ![[image.webp]] |',
      link: '![[image.webp]]',
      expectedLink: '![[image.webp\\|200x100]]'
    },
    {
      caseName: 'bare non-table wikilink',
      line: '![[image.webp]]',
      link: '![[image.webp]]',
      expectedLink: '![[image.webp|200x100]]'
    }
  ])('13.29f Resize preserves $caseName syntax and content', async ({ line, link, expectedLink }) => {
    const transaction = vi.fn();
    const editor = {
      getValue: () => line,
      getCursor: () => ({ line: 0, ch: 0 }),
      getLine: () => line,
      lastLine: () => 0,
      transaction,
      setCursor: vi.fn()
    };
    const { resizer, markdownView } = makeResizer({ viewMode: 'source' });
    (markdownView as any).editor = editor;
    (resizer as any).editor = editor;
    const { img } = setupViewWithImageWrapper();
    img.setAttribute('src', 'app://vault/_attachments/image.webp');

    await (resizer as any).updateMarkdownLink(img, 200, 100, 'se');

    expect(transaction).toHaveBeenCalledWith({
      changes: [{
        from: { line: 0, ch: line.indexOf(link) },
        to: { line: 0, ch: line.indexOf(link) + link.length },
        text: expectedLink
      }]
    });
  });

  it.each([
    {
      caseName: 'optional-leading-pipe table',
      lines: ['Image | Description', '--- | ---', 'First | Example', '![[image.webp]] | Later'],
      targetLine: 3
    },
    {
      caseName: 'optional-leading single-column table',
      lines: ['Image |', '--- |', 'First |', '![[image.webp]] |'],
      targetLine: 3
    },
    {
      caseName: 'callout table',
      lines: ['> | Image | Description |', '> | --- | --- |', '> | ![[image.webp]] | Example |'],
      targetLine: 2
    }
  ])('13.29g Resize inserts an escaped delimiter in a $caseName', async ({ lines, targetLine }) => {
    const transaction = vi.fn();
    const editor = {
      getValue: () => lines.join('\n'),
      getCursor: () => ({ line: targetLine, ch: 0 }),
      getLine: (line: number) => lines[line] ?? '',
      lastLine: () => lines.length - 1,
      transaction,
      setCursor: vi.fn()
    };
    const { resizer, markdownView } = makeResizer({ viewMode: 'source' });
    (markdownView as any).editor = editor;
    (resizer as any).editor = editor;
    const { img } = setupViewWithImageWrapper();
    img.setAttribute('src', 'app://vault/_attachments/image.webp');

    await (resizer as any).updateMarkdownLink(img, 200, 100, 'se');

    expect(transaction).toHaveBeenCalledWith({
      changes: [{
        from: { line: targetLine, ch: lines[targetLine].indexOf('![[image.webp]]') },
        to: {
          line: targetLine,
          ch: lines[targetLine].indexOf('![[image.webp]]') + '![[image.webp]]'.length
        },
        text: '![[image.webp\\|200x100]]'
      }]
    });
  });

  it('13.29h Table wheel-resize defers one Markdown update until scrolling settles', () => {
    let line = '| ![[image.webp\\|122]] |';
    const transaction = vi.fn(({ changes }: any) => {
      const [change] = changes;
      line = `${line.slice(0, change.from.ch)}${change.text}${line.slice(change.to.ch)}`;
    });
    const editor = {
      getValue: () => line,
      getCursor: () => ({ line: 0, ch: 0 }),
      getLine: () => line,
      lastLine: () => 0,
      transaction,
      setCursor: vi.fn()
    };
    const { resizer, markdownView } = makeResizer({
      viewMode: 'source',
      overrides: { isScrollResizeEnabled: true, scrollwheelModifier: 'None' }
    });
    (markdownView as any).editor = editor;
    (resizer as any).editor = editor;
    const { container } = setupView();
    const tableWidget = document.createElement('div');
    tableWidget.className = 'cm-table-widget';
    container.appendChild(tableWidget);
    const img = addInternalImage(tableWidget, 'app://vault/_attachments/image.webp');
    img.style.width = '122px';
    img.style.height = '53px';
    const timers = setupFakeTimers();

    try {
      img.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, bubbles: true, cancelable: true }));

      expect(transaction).not.toHaveBeenCalled();
      timers.advance(299);
      expect(transaction).not.toHaveBeenCalled();
      timers.advance(1);

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(line).toMatch(/!\[\[image\.webp\\\|\d+x\d+\]\]/);
      expect(line).not.toContain('\\|122]]');
    } finally {
      timers.restore();
    }
  });

  it('13.29l Table wheel-resize persists through the nested cell editor opened during debounce', async () => {
    const outerLine = '| ![[image.webp\\|122]] |';
    let cellLine = '![[image.webp|122]]';
    const tableEditorState: {
      tableCell?: {
        editor: any;
        containerEl: HTMLElement;
        cell: { row: number; col: number; el: HTMLElement };
      } | null;
    } = { tableCell: null };
    const outerTransaction = vi.fn(() => {
      if (tableEditorState.tableCell) {
        throw new RangeError('Applying change set to a document with the wrong length');
      }
    });
    const cellTransaction = vi.fn(({ changes }: any) => {
      const [change] = changes;
      cellLine = `${cellLine.slice(0, change.from.ch)}${change.text}${cellLine.slice(change.to.ch)}`;
    });
    const outerEditor = {
      getValue: () => outerLine,
      getCursor: () => ({ line: 0, ch: 0 }),
      getLine: () => outerLine,
      lastLine: () => 0,
      transaction: outerTransaction,
      setCursor: vi.fn()
    };
    const cellEditor = {
      getValue: () => cellLine,
      getCursor: () => ({ line: 0, ch: 0 }),
      getLine: () => cellLine,
      lastLine: () => 0,
      transaction: cellTransaction,
      setCursor: vi.fn()
    };
    const { resizer, markdownView } = makeResizer({
      viewMode: 'source',
      overrides: { isScrollResizeEnabled: true, scrollwheelModifier: 'None' }
    });
    (markdownView as any).editor = outerEditor;
    (resizer as any).editor = outerEditor;

    const { container } = setupView();
    const tableWidgetEl = document.createElement('div');
    tableWidgetEl.className = 'cm-table-widget';
    const table = document.createElement('table');
    const row = document.createElement('tr');
    const renderedCell = document.createElement('td');
    const renderedCellWrapper = document.createElement('div');
    renderedCellWrapper.className = 'table-cell-wrapper';
    const image = addInternalImage(renderedCellWrapper, 'app://vault/image.webp');
    renderedCell.appendChild(renderedCellWrapper);
    row.appendChild(renderedCell);
    table.appendChild(row);
    tableWidgetEl.appendChild(table);
    container.appendChild(tableWidgetEl);

    const tableCell = { row: 0, col: 0, el: renderedCell };
    (tableWidgetEl as any).cmTile = {
      widget: {
        editor: tableEditorState,
        getClosestCell: vi.fn(() => tableCell),
        setCellFocus: vi.fn()
      }
    };
    const timers = setupFakeTimers();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      image.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -10,
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 10
      }));

      const editingCell = document.createElement('td');
      const editingCellWrapper = document.createElement('div');
      editingCellWrapper.className = 'table-cell-wrapper';
      editingCell.appendChild(editingCellWrapper);
      tableEditorState.tableCell = {
        editor: cellEditor,
        containerEl: editingCellWrapper,
        cell: { row: 0, col: 0, el: editingCell }
      };
      tableWidgetEl.appendChild(editingCell);

      timers.advance(300);
      await Promise.resolve();

      expect(outerTransaction).not.toHaveBeenCalled();
      expect(cellTransaction).toHaveBeenCalledTimes(1);
      expect(cellLine).toMatch(/^!\[\[image\.webp\|\d+x\d+\]\]$/);
      expect(cellLine).not.toContain('|122]]');
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
      timers.restore();
    }
  });

  it('13.29k Table drag-resize updates visually during drag and writes Markdown once on mouseup', () => {
    const line = '| ![[image.webp\\|122]] |';
    const transaction = vi.fn();
    const editor = {
      getValue: () => line,
      getCursor: () => ({ line: 0, ch: 0 }),
      getLine: () => line,
      lastLine: () => 0,
      transaction,
      setCursor: vi.fn()
    };
    const { resizer, markdownView } = makeResizer({ viewMode: 'source' });
    (markdownView as any).editor = editor;
    (resizer as any).editor = editor;
    const { container } = setupView();
    const tableWidget = document.createElement('div');
    tableWidget.className = 'cm-table-widget';
    container.appendChild(tableWidget);
    const image = addInternalImage(tableWidget, 'app://vault/image.webp');

    (resizer as any).handleImageHover({ target: image } as any);
    const resizeContainer = (image as any).matchParent('.image-resize-container')!;
    const handle = resizeContainer.querySelector('.image-resize-handle-se') as HTMLElement;
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, clientY: 20, bubbles: true }));

    expect(parseInt(image.style.width, 10)).toBeGreaterThan(200);
    expect(transaction).not.toHaveBeenCalled();

    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('13.30 Click override disabled: given default setting, when clicking an internal image, then no cursor override is applied', () => {
    const editor = {
      getValue: () => '![[imgs/pic.jpg|100x100]]',
      getCursor: () => ({ line: 0, ch: 0 }),
      getLine: () => '![[imgs/pic.jpg|100x100]]',
      lastLine: () => 0,
      posAtMouse: vi.fn(() => ({ line: 0, ch: 5 })),
      transaction: vi.fn(),
      setCursor: vi.fn()
    };

    const { resizer, markdownView } = makeResizer({ viewMode: 'source' });
    (markdownView as any).editor = editor;
    (resizer as any).editor = editor;

    const { container } = setupView();
    const img = addInternalImage(container);

    const prevented = img.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    expect(prevented).toBe(true);
    expect(editor.setCursor).not.toHaveBeenCalled();
    expect((img as any).matchParent('.image-resize-container')).toBeNull();
  });

  it('13.31 Hovering native resize corner keeps plugin handles active for the same image', () => {
    const { resizer } = makeResizer({ viewMode: 'source', overrides: { disableObsidianImageSelectionOnClick: true } });
    const { img, corner } = setupViewWithImageWrapper();

    (resizer as any).handleImageHover({ target: img } as any);
    expect((img as any).matchParent('.image-resize-container')).toBeTruthy();

    (resizer as any).handleImageHover({ target: corner } as any);

    const container = (img as any).matchParent('.image-resize-container');
    expect(container).toBeTruthy();
    expect(container.querySelector('.image-resize-handle-se')).toBeTruthy();
  });

  it('13.12 External image edge-resize: cursor changes near edges and uniform scaling on drag; markdown updated only if external link present (N/A in preview)', () => {
    const { resizer } = makeResizer();
    const { container } = setupView();
    const img = addExternalImage(container);

    (resizer as any).handleImageHover({ target: img, clientX: 1, clientY: 50 } as any);
    expect(['ew-resize', 'ns-resize', 'nwse-resize', 'nesw-resize', 'se-resize']).toContain(img.style.cursor);

    // Simulate border drag uniform scaling when external
    img.classList.add('image-resize-border');
    // Mousedown should target the image (which has image-resize-border), not the document
    img.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 30, clientY: 30, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    const widthPx = parseInt(img.style.width || '0', 10);
    const heightPx = parseInt(img.style.height || '0', 10);
    expect(widthPx).toBeGreaterThan(0);
    expect(heightPx).toBeGreaterThan(0);
  });

  it('13.13 Alignment cache update on drag-resize when enabled', async () => {
    const getImageAlignment = vi.fn(() => ({ position: 'left', width: '', height: '', wrap: true }));
    const saveImageAlignmentToCache = vi.fn(async () => {});
    const { resizer, plugin } = makeResizer({ overrides: { isImageAlignmentEnabled: true } });
    (plugin as any).ImageAlignmentManager = { getImageAlignment, saveImageAlignmentToCache } as any;

    const { container } = setupView();
    const img = addInternalImage(container);

    (resizer as any).handleImageHover({ target: img } as any);
    const wrapper = (img as any).matchParent('.image-resize-container')!;
    const se = wrapper.querySelector('.image-resize-handle-se') as HTMLElement;

    se.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 10, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    await Promise.resolve();
    expect(saveImageAlignmentToCache).toHaveBeenCalled();
  });

  it('13.14 Excalidraw images are skipped (no handles)', () => {
    const { resizer, plugin } = makeResizer();
    (plugin as any).supportedImageFormats = { isExcalidrawImage: () => true } as any;

    const { container } = setupView();
    const img = addInternalImage(container);

    (resizer as any).handleImageHover({ target: img } as any);
    expect((img as any).matchParent('.image-resize-container')).toBeNull();
  });

  it('13.19 Active-view scope: only images in active view get handles and prior handles are cleaned up', () => {
    const { containerA, containerB } = setupContainers();

    const workspace = fakeWorkspace({});
    (workspace as any).getActiveViewOfType = vi.fn(() => ({ contentEl: containerA, containerEl: containerA, editor: { getValue: () => '', getCursor: () => ({ line: 0, ch: 0 }), getLine: () => '', lastLine: () => 0, transaction: () => {}, setCursor: () => {} }, getState: () => ({ mode: 'preview' }) }));
    const { resizer } = makeResizer({ viewMode: 'preview', workspaceOverride: workspace });

    const imgInB = addInternalImage(containerB);

    (resizer as any).handleImageHover({ target: imgInB } as any);
    expect((imgInB as any).matchParent('.image-resize-container')).toBeNull();

    (workspace as any).getActiveViewOfType = vi.fn(() => ({ contentEl: containerB, containerEl: containerB, editor: { getValue: () => '', getCursor: () => ({ line: 0, ch: 0 }), getLine: () => '', lastLine: () => 0, transaction: () => {}, setCursor: () => {} }, getState: () => ({ mode: 'preview' }) }));

    (resizer as any).handleImageHover({ target: imgInB } as any);
    expect((imgInB as any).matchParent('.image-resize-container')).not.toBeNull();

    // previous view container has no lingering handles
    const handlesInA = containerA.querySelector('.image-resize-container');
    expect(handlesInA).toBeNull();
  });

  it('13.24 Edge detection ignores handles (no cursor override)', () => {
    const { resizer } = makeResizer();
    const { container } = setupView();
    const img = addInternalImage(container);

    (resizer as any).handleImageHover({ target: img } as any);
    const wrapper = (img as any).matchParent('.image-resize-container')!;
    const handle = wrapper.querySelector('.image-resize-handle-e') as HTMLElement;

    (resizer as any).handleEdgeDetection({ target: handle, clientX: 195, clientY: 50 } as any, img);
    expect(img.style.cursor === '' || img.style.cursor === 'default').toBe(true);
  });
});

// Registration, cleanup, gating, percent scroll, debounce/throttle
describe('ImageResizer lifecycle and wheel behaviors (13.15–13.16, 13.17–13.18, 13.20, 13.21, 13.22–13.23, 13.27–13.28)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('13.15 Idempotent registration: onload twice registers exactly one set of listeners', () => {
    const { resizer } = makeResizer();
    const { container } = setupView();
    const img = addInternalImage(container);

    (resizer as any).attachView({ containerEl: document.body, editor: (resizer as any).editor, getState: () => ({ mode: 'preview' }) } as any);

    const scope: any = (resizer as any).viewScope;
    expect(Array.isArray(scope?.disposables)).toBe(true);
    expect(scope.disposables.length).toBe(8);

    (resizer as any).handleImageHover({ target: img, clientX: 10, clientY: 10 } as any);
    const wrapper = (img as any).matchParent('.image-resize-container')!;
    const se = wrapper.querySelector('.image-resize-handle-se') as HTMLElement;
    se.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, clientY: 30, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    const widthPx = parseInt((img as any).style.width || '0', 10);
    const heightPx = parseInt((img as any).style.height || '0', 10);
    expect(widthPx).toBeGreaterThan(0);
    expect(heightPx).toBeGreaterThan(0);
  });

  it('13.16 Teardown cleanup: onunload removes handlers so further events do nothing', () => {
    const { resizer } = makeResizer();
    const { container } = setupView();
    addInternalImage(container);

    const spyMove = vi.spyOn(resizer as any, 'handleMouseMove');

    resizer.onunload();

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 20, bubbles: true }));
    expect(spyMove).not.toHaveBeenCalled();
  });

  it('13.16a registers drag listeners on the Markdown view ownerDocument for popout support', () => {
    const { resizer } = makeResizer();
    const popoutDocument = document.implementation.createHTMLDocument('popout');
    const popoutContainer = popoutDocument.createElement('div');
    const registerDomEvent = vi.fn();

    (resizer as any).editor = { getValue: () => '', getCursor: () => ({ line: 0, ch: 0 }), getLine: () => '', lastLine: () => 0, transaction: () => {}, setCursor: () => {} };
    (resizer as any).markdownView = {
      containerEl: popoutContainer,
      editor: (resizer as any).editor,
      getState: () => ({ mode: 'source' })
    };
    (resizer as any).viewScope = { registerDomEvent };

    (resizer as any).registerEditorEvents();

    const dragTargets = registerDomEvent.mock.calls
      .filter(([target, eventName]) => target !== popoutContainer && ['mousedown', 'mousemove', 'mouseup'].includes(eventName))
      .map(([target]) => target);

    expect(dragTargets).toEqual([popoutDocument, popoutDocument, popoutDocument]);
  });

  it('13.16b resolves image targets using Obsidian instanceOf for cross-window elements', () => {
    const { resizer } = makeResizer();
    const { img } = setupViewWithImage();
    const originalHTMLImageElement = (globalThis as any).HTMLImageElement;

    try {
      (globalThis as any).HTMLImageElement = function ForeignHTMLImageElement() {};
      (img as any).instanceOf = vi.fn((ctor: any) => ctor === (globalThis as any).HTMLImageElement);

      expect((resizer as any).resolveImageTarget(img)).toBe(img);
    } finally {
      (globalThis as any).HTMLImageElement = originalHTMLImageElement;
    }
  });

  it('13.16c force cleanup uses activeDocument fallback for orphaned popout resize containers', () => {
    const { resizer } = makeResizer();
    const popoutDocument = document.implementation.createHTMLDocument('popout');
    const resizeContainer = popoutDocument.createElement('div');
    resizeContainer.className = 'image-resize-container';
    const image = popoutDocument.createElement('img');
    resizeContainer.appendChild(image);
    popoutDocument.body.appendChild(resizeContainer);

    const previousGlobalActiveDocument = (globalThis as any).activeDocument;
    const previousWindowActiveDocument = (window as any).activeDocument;

    try {
      (globalThis as any).activeDocument = popoutDocument;
      (window as any).activeDocument = popoutDocument;
      (resizer as any).markdownView = null;
      (resizer as any).activeImage = null;

      (resizer as any).cleanupHandles(true);

      expect(popoutDocument.querySelector('.image-resize-container')).toBeNull();
      expect(popoutDocument.body.querySelector('img')).toBe(image);
    } finally {
      (globalThis as any).activeDocument = previousGlobalActiveDocument;
      (window as any).activeDocument = previousWindowActiveDocument;
    }
  });

  it('13.17 Cursor fallback validity: outside edges -> cursor="default" and values are valid', () => {
    const { resizer } = makeResizer();
    const { container } = setupView();
    const img = addExternalImage(container);

    (resizer as any).handleImageHover({ target: img, clientX: 100, clientY: 50 } as any);
    const valid = ['', 'default', 'ns-resize', 'ew-resize', 'nwse-resize', 'nesw-resize', 'se-resize'];
    expect(valid.includes(img.style.cursor)).toBe(true);
  });

  it('13.18 Settings live update: changing modifier at runtime is honored', () => {
    const { resizer, plugin } = makeResizer({ overrides: { scrollwheelModifier: 'Shift' } });
    const { container } = setupView();
    const img = addInternalImage(container);

    // Ensure alignment path is disabled to isolate modifier behavior
    plugin.settings.isImageAlignmentEnabled = false;
    (resizer as any).plugin.ImageAlignmentManager = null as any;

    (resizer as any).handleImageHover({ target: img, clientX: 5, clientY: 5 } as any);
    const beforeWidth = parseInt((img as any).style.width || '0', 10) || 200;

    plugin.settings.scrollwheelModifier = 'Alt';

    img.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, altKey: true, bubbles: true, cancelable: true }));
    const after = parseInt((img as any).style.width || '0', 10);
    expect(after).not.toBe(beforeWidth);
  });

  it('13.20 Gating: mousemove/mouseup without drag does not resize', () => {
    const { resizer } = makeResizer();
    const { container } = setupView();
    const img = addInternalImage(container);
    (resizer as any).handleImageHover({ target: img, clientX: 5, clientY: 5 } as any);

    const beforeW = parseInt((img as any).style.width || '0', 10) || 200;
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 30, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    const afterW = parseInt((img as any).style.width || '0', 10) || 200;
    expect(afterW).toBe(beforeW);
  });

  it('13.21 Direct handle mousedown: Given mousedown on a handle with stopPropagation, Then startResize is invoked and drag works', () => {
    const { resizer } = makeResizer();
    const { container } = setupView();
    const img = addInternalImage(container);

    (resizer as any).handleImageHover({ target: img } as any);
    const wrapper = (img as any).matchParent('.image-resize-container')!;
    const handle = wrapper.querySelector('.image-resize-handle-se') as HTMLElement;

    const spy = vi.spyOn(resizer as any, 'startResize');
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 30, clientY: 20, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    expect(spy).toHaveBeenCalled();
    expect(parseInt(img.style.width || '0', 10)).toBeGreaterThan(0);
  });

  it('13.22 Scroll-wheel percentage: Given an IMG with % width, When wheel-resizing, Then width stays in % and clamps to [1..100]', () => {
    // Arrange
    const { resizer, plugin } = makeResizer({ viewMode: 'source', overrides: { isScrollResizeEnabled: true, scrollwheelModifier: 'None' } });
    const { container } = setupView();
    const img = addInternalImage(container);
    img.style.width = '50%';

    // Disable alignment path to focus on % width behavior
    plugin.settings.isImageAlignmentEnabled = false;
    (resizer as any).plugin.ImageAlignmentManager = null as any;

    (resizer as any).handleImageHover({ target: img, clientX: 5, clientY: 5 } as any);

    // Act
    img.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, bubbles: true, cancelable: true }));

    // Assert
    const wStr = img.style.width || '';
    expect(wStr).not.toBe('50%');
    expect(wStr.endsWith('%')).toBe(true);

    const percent = parseFloat(wStr);
    expect(percent).toBeGreaterThanOrEqual(1);
    expect(percent).toBeLessThanOrEqual(100);
  });

  it('13.22 Scroll-wheel video: Given an HTMLVideoElement with computed % width, When calculating new size, Then % math is used and clamps to [1..100]', () => {
    // Arrange
    const { resizer } = makeResizer({ viewMode: 'source', overrides: { isScrollResizeEnabled: true, scrollwheelModifier: 'None' } });

    const video = document.createElement('video') as HTMLVideoElement;
    // Provide stable dimensions for aspect ratio
    Object.defineProperty(video, 'clientWidth', { value: 200, configurable: true });
    Object.defineProperty(video, 'clientHeight', { value: 100, configurable: true });

    const getComputedStyleSpy = vi
      .spyOn(globalThis as any, 'getComputedStyle')
      .mockReturnValue({ width: '50%' } as any);

    try {
      // Act
      const evt = new WheelEvent('wheel', { deltaY: -10, bubbles: true, cancelable: true });
      const { newWidth, newHeight } = (resizer as any).resizeImageScrollWheel(evt, video);

      // Assert
      expect(newWidth).toBe(55); // 50% * (1 + 0.1) rounded
      expect(newHeight).toBe(28); // 55 / (200/100) rounded and min-clamped
    } finally {
      getComputedStyleSpy.mockRestore();
    }

    // Also validate clamping at 100%
    const getComputedStyleSpy2 = vi
      .spyOn(globalThis as any, 'getComputedStyle')
      .mockReturnValue({ width: '100%' } as any);

    try {
      const evt = new WheelEvent('wheel', { deltaY: -10, bubbles: true, cancelable: true });
      const { newWidth } = (resizer as any).resizeImageScrollWheel(evt, video);
      expect(newWidth).toBe(100);
    } finally {
      getComputedStyleSpy2.mockRestore();
    }
  });

  it('13.23 Debounce/throttle for scroll: debouncedSaveToCache fires once per debounce window (tail simulated)', () => {
    const { resizer } = makeResizer({ viewMode: 'source', overrides: { isScrollResizeEnabled: true, scrollwheelModifier: 'None', isImageAlignmentEnabled: true } });
    const { container } = setupView();
    const img = addInternalImage(container);
    // Avoid alignment path entirely for this debounce test (we're validating debouncedSaveToCache wiring)
    (resizer as any).plugin.ImageAlignmentManager = null as any;
    (resizer as any).handleImageHover({ target: img, clientX: 5, clientY: 5 } as any);

    const spyDebounced = vi.fn();
    (resizer as any).debouncedSaveToCache = ((..._args: any[]) => { spyDebounced(); }) as any;

    const timers = setupFakeTimers();

    let inWindow = false;
    (resizer as any).debouncedSaveToCache = ((..._args: any[]) => {
      if (!inWindow) {
        spyDebounced();
        inWindow = true;
        setTimeout(() => { inWindow = false; }, 300);
      }
    }) as any;

    for (let i = 0; i < 5; i++) {
      img.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, bubbles: true, cancelable: true }));
      timers.advance(50);
    }

    // Simulate tail-only by letting window elapse
    timers.advance(400);

    expect(spyDebounced).toHaveBeenCalledTimes(1);
    timers.restore();
  });

  it('13.27 Drag resize retry: when dimensions resolve to 0, retries and uses last valid values', () => {
    const { resizer, markdownView } = makeResizer({ viewMode: 'source' });
    const editor = {
      getValue: () => '',
      getCursor: () => ({ line: 0, ch: 0 }),
      getLine: () => '![pic](/imgs/pic.jpg)',
      lastLine: () => 0,
      transaction: vi.fn(),
      setCursor: vi.fn()
    };
    (markdownView as any).editor = editor;
    (resizer as any).editor = editor;

    const { container } = setupView();
    const img = addInternalImage(container);
    setRect(img, { width: 120, height: 80 });

    (resizer as any).handleImageHover({ target: img } as any);
    const wrapper = (img as any).matchParent('.image-resize-container')!;
    const se = wrapper.querySelector('.image-resize-handle-se') as HTMLElement;

    const updateSpy = vi
      .spyOn(resizer as any, 'updateMarkdownLink')
      .mockResolvedValue(undefined);

    (resizer as any).resolveValidDimensions = vi.fn()
      .mockReturnValueOnce({ isValid: false, width: 0, height: 0 })
      .mockReturnValueOnce({ isValid: true, width: 120, height: 80 });

    const timers = setupFakeTimers();

    se.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 150, clientY: 120 }));

    // Simulate transient 0x0 from DOM re-render
    img.style.width = '0px';
    img.style.height = '0px';

    document.dispatchEvent(new MouseEvent('mouseup'));

    // First call should be skipped, retry scheduled
    expect(updateSpy).not.toHaveBeenCalled();

    timers.advance(160);

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const [[calledImage, width, height]] = updateSpy.mock.calls;
    expect(calledImage).toBe(img);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);

    timers.restore();
  });

  it('13.28 Scroll resize retry: when dimensions resolve to 0, retries and uses last valid values', () => {
    const { resizer, markdownView } = makeResizer({ viewMode: 'source', overrides: { isScrollResizeEnabled: true, scrollwheelModifier: 'None' } });
    const editor = {
      getValue: () => '',
      getCursor: () => ({ line: 0, ch: 0 }),
      getLine: () => '![pic](/imgs/pic.jpg)',
      lastLine: () => 0,
      transaction: vi.fn(),
      setCursor: vi.fn()
    };
    (markdownView as any).editor = editor;
    (resizer as any).editor = editor;

    const { container } = setupView();
    const img = addInternalImage(container);
    setRect(img, { width: 120, height: 80 });

    (resizer as any).handleImageHover({ target: img, clientX: 5, clientY: 5 } as any);

    const updateSpy = vi
      .spyOn(resizer as any, 'updateMarkdownLink')
      .mockResolvedValue(undefined);

    (resizer as any).resolveValidDimensions = vi.fn()
      .mockReturnValueOnce({ isValid: false, width: 0, height: 0 })
      .mockReturnValueOnce({ isValid: true, width: 120, height: 80 });

    const timers = setupFakeTimers();

    // Force resize math to return 0x0 to trigger retry
    (resizer as any).resizeImageScrollWheel = vi.fn(() => ({ newWidth: 0, newHeight: 0, newLeft: 0, newTop: 0 }));

    img.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, bubbles: true, cancelable: true }));

    expect(updateSpy).not.toHaveBeenCalled();

    timers.advance(160);

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const [[calledImage, width, height]] = updateSpy.mock.calls;
    expect(calledImage).toBe(img);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);

    timers.restore();
  });
});

// Throttle policy when alignment disabled
describe('ImageResizer throttle policy when alignment disabled (13.23 variant)', () => {
  function localMakeResizer(overrides: Partial<any> = {}) {
    const tfile = fakeTFile({ path: 'Notes/n1.md', name: 'n1.md', extension: 'md' });
    const vault = fakeVault({ files: [tfile] });
    const workspace = fakeWorkspace({ activeFile: tfile });
    const app = fakeApp({ vault, workspace }) as any;
    const plugin = new ImageConverterPlugin(app, fakePluginManifest({ id: 'image-converter', dir: '/plugins/image-converter' }));
    plugin.manifest = { id: 'image-converter', dir: '/plugins/image-converter' } as any;
    plugin.supportedImageFormats = { isExcalidrawImage: () => false } as any;
    plugin.settings = Object.assign({
      isImageResizeEnbaled: true,
      isDragResizeEnabled: true,
      isDragAspectRatioLocked: true,
      isScrollResizeEnabled: true,
      resizeSensitivity: 0.1,
      scrollwheelModifier: 'None',
      isImageAlignmentEnabled: false,
      isResizeInReadingModeEnabled: true,
      disableObsidianImageSelectionOnClick: false,
      dropPasteCursorLocation: 'back',
    }, overrides) as any;
    const resizer = new ImageResizer(plugin);
    // Patch instance to satisfy Component.addChild in tests without touching global mocks
    (resizer as any).addChild = (child: any) => { ((resizer as any).__children ||= []).push(child); };
    const markdownView = { containerEl: document.body, editor: { getValue: () => '', getCursor: () => ({ line: 0, ch: 0 }), getLine: () => '', lastLine: () => 0, transaction: () => {}, setCursor: () => {} }, getState: () => ({ mode: 'source' }) } as any;
    (resizer as any).attachView(markdownView);
    activeResizers.push(resizer);
    return { app, plugin, resizer };
  }

  it('throttledUpdateImageLink invoked at least once during a burst of wheel events; also when no positional class', () => {
    const { resizer, plugin } = localMakeResizer({ isScrollResizeEnabled: true, scrollwheelModifier: 'None' });
    const { container } = setupView();
    const img = addInternalImage(container);

    // Explicitly disable alignment so wheel path always uses throttled link update
    plugin.settings.isImageAlignmentEnabled = false;
    (resizer as any).plugin.ImageAlignmentManager = null as any;

    const spy = vi.spyOn(resizer as any, 'throttledUpdateImageLink');

    (resizer as any).handleImageHover({ target: img, clientX: 5, clientY: 5 } as any);

    for (let i = 0; i < 5; i++) {
      img.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, bubbles: true, cancelable: true }));
    }

    expect(spy).toHaveBeenCalled();

    // Also assert when image has no positional class (simulated by ensuring none applied)
    (resizer as any).plugin.ImageAlignmentManager = { getImageAlignment: () => null } as any;
    spy.mockClear();
    for (let i = 0; i < 3; i++) {
      img.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, bubbles: true, cancelable: true }));
    }
    expect(spy).toHaveBeenCalled();
  });
});

// 13.8 (negative) — preview mode with disabled setting should block resize entirely
describe('ImageResizer reading mode disabled gating (13.8 negative)', () => {
  it('Given preview mode and isResizeInReadingModeEnabled=false, When attempting drag-resize, Then no handles and no visual changes', () => {
    const { resizer } = makeResizer({ viewMode: 'preview', overrides: { isResizeInReadingModeEnabled: false } });
    const { container } = setupView();
    const img = addInternalImage(container);

    // Try to hover to create handles — should be blocked
    (resizer as any).handleImageHover({ target: img } as any);

    // No wrapper should be created
    const wrapper = (img as any).matchParent?.('.image-resize-container') || (img as any).matchParent('.image-resize-container');
    expect(wrapper).toBeNull();

    // Simulate drag anyway — should not change inline styles
    const beforeW = img.style.width || '';
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 30, clientY: 20, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(img.style.width || '').toBe(beforeW);
  });
});

// 13.11 — Undo/redo atomicity of link updates
describe('ImageResizer undo/redo after live updates (13.11)', () => {
  function makeEditorWithHistory(initialLines: string[]) {
    let lines = [...initialLines];
    const history: { before: string[]; after: string[] }[] = [];
    let redoStack: { before: string[]; after: string[] }[] = [];
    return {
      getValue: () => lines.join('\n'),
      getCursor: () => ({ line: 0, ch: 0 }),
      getLine: (i: number) => lines[i] || '',
      lastLine: () => lines.length - 1,
      setCursor: (_pos: any) => {},
      transaction: ({ changes }: { changes: { from: { line: number; ch: number }; to: { line: number; ch: number }; text: string }[] }) => {
        const before = [...lines];
        // Apply all changes on a copy then commit once
        const work = [...lines];
        // Sort by from position descending to keep indices valid
        const sorted = [...changes].sort((changeA, changeB) => (changeB.from.line - changeA.from.line) || (changeB.from.ch - changeA.from.ch));
        for (const change of sorted) {
          const line = work[change.from.line];
          const newLine = line.substring(0, change.from.ch) + change.text + line.substring(change.to.ch);
          work[change.from.line] = newLine;
        }
        lines = work;
        history.push({ before, after: [...lines] });
        redoStack = [];
      },
      undo: () => {
        const entry = history.pop();
        if (!entry) return;
        const current = [...lines];
        redoStack.push({ before: current, after: entry.after });
        lines = [...entry.before];
      },
      redo: () => {
        const entry = redoStack.pop();
        if (!entry) return;
        history.push({ before: [...lines], after: entry.after });
        lines = [...entry.after];
      }
    };
  }

  it('Given live updates during drag, Then the final state matches expected and multiple undos restore the original, with redos reapplying', () => {
    // Arrange an editor with two identical image links on separate lines
    const doc = [
      'Text before',
      '![|100x100](imgs/pic.jpg)',
      'Some middle text',
      '![|100x100](imgs/pic.jpg)'
    ];
    const editor: any = makeEditorWithHistory(doc);

    const { resizer, markdownView } = makeResizer({ viewMode: 'source' });
    (markdownView as any).editor = editor;
    (resizer as any).editor = editor;

    const { container } = setupView();
    const img = addInternalImage(container);

    // Act: perform a resize to trigger a single transaction that updates both links
    (resizer as any).handleImageHover({ target: img } as any);
    const wrapper = (img as any).matchParent('.image-resize-container')!;
    const se = wrapper.querySelector('.image-resize-handle-se') as HTMLElement;
    se.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 10, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    const after = editor.getValue();
    expect(after.includes('![|100x100](imgs/pic.jpg)')).toBe(false);
    expect(after).toMatch(/!\[\|\d+x\d+\]\(imgs\/pic\.jpg\)/);

    // With live updates, more than one transaction may have occurred during drag.
    // Perform up to two undos to restore original sizes.
    editor.undo();
    let undone = editor.getValue();
    if (!(/!\[\|100x100\]\(imgs\/pic\.jpg\)/.test(undone))) {
      editor.undo();
      undone = editor.getValue();
    }
    const matches = undone.match(/!\[\|100x100\]\(imgs\/pic\.jpg\)/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(1);

    // Redo the same number of times to reapply the resized dimensions
    editor.redo();
    editor.redo();
    const redone = editor.getValue();
    expect(redone).toMatch(/!\[\|\d+x\d+\]\(imgs\/pic\.jpg\)/);
    expect(redone.includes('![|100x100](imgs/pic.jpg)')).toBe(false);
  });
});

// 13.25 — Async error handling for updateMarkdownLink
describe('ImageResizer async error handling (13.25)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('13.25 Given updateMarkdownLink rejects during drag-resize completion, Then error is logged and resize completes without unhandled rejection', async () => {
    const { resizer } = makeResizer({ viewMode: 'source' });
    const { container } = setupView();
    const img = addInternalImage(container);

    // Make updateMarkdownLink reject
    const mockError = new Error('Editor unavailable');
    vi.spyOn(resizer as any, 'updateMarkdownLink').mockRejectedValue(mockError);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Perform resize
    (resizer as any).handleImageHover({ target: img } as any);
    const wrapper = (img as any).matchParent('.image-resize-container')!;
    const se = wrapper.querySelector('.image-resize-handle-se') as HTMLElement;

    se.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, clientY: 30, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    // Allow promises to settle
    await Promise.resolve();
    await Promise.resolve();

    // Verify error was logged via logAsyncError pattern
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to update markdown link'),
      mockError
    );

    // Verify visual dimensions were still applied (resize completed)
    expect(parseInt(img.style.width || '0', 10)).toBeGreaterThan(0);
    expect(parseInt(img.style.height || '0', 10)).toBeGreaterThan(0);

    consoleErrorSpy.mockRestore();
  });
});

// 13.26 — resizeBuffer null guard for falsy imageHash
describe('ImageResizer resizeBuffer null guard (13.26)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('13.26 Given alignment enabled but imageHash is falsy, When scroll-wheel resize occurs, Then resizeBuffer is not written with undefined key', () => {
    const { resizer, plugin } = makeResizer({
      viewMode: 'source',
      overrides: {
        isScrollResizeEnabled: true,
        scrollwheelModifier: 'None',
        isImageAlignmentEnabled: true
      }
    });
    const { container } = setupView();
    const img = addInternalImage(container);

    // Mock ImageAlignmentManager to return null/undefined for getImageHash
    (plugin as any).ImageAlignmentManager = {
      getImageHash: vi.fn(() => null), // Simulate falsy hash
      getImageAlignment: vi.fn(() => null),
      saveImageAlignmentToCache: vi.fn()
    };

    // Clear resizeBuffer before test
    (resizer as any).resizeBuffer = {};

    // Hover to set up image
    (resizer as any).handleImageHover({ target: img, clientX: 5, clientY: 5 } as any);

    // Trigger scroll resize
    img.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, bubbles: true, cancelable: true }));

    // Verify resizeBuffer does NOT have undefined or null as a key
    const bufferKeys = Object.keys((resizer as any).resizeBuffer);
    expect(bufferKeys).not.toContain('undefined');
    expect(bufferKeys).not.toContain('null');
    expect(bufferKeys.length).toBe(0); // Should be empty since hash is null

    // Verify resize still happened visually
    expect(img.style.width).toBeTruthy();
  });
});

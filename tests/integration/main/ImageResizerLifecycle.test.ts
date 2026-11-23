/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MarkdownView } from 'obsidian';
import ImageConverterPlugin from '../../../src/main';
import { fakeApp, fakePluginManifest, fakeTFile, fakeVault } from '../../factories/obsidian';

function makeEditor() {
  return {
    getValue: () => '',
    getCursor: () => ({ line: 0, ch: 0 }),
    getLine: () => '',
    lastLine: () => 0,
    transaction: vi.fn(),
    setCursor: vi.fn()
  };
}

function makeMarkdownView(note: any, className: string) {
  const containerEl = document.createElement('div');
  containerEl.className = className;
  document.body.appendChild(containerEl);

  const view = new (MarkdownView as any)();
  view.file = note;
  view.containerEl = containerEl;
  view.contentEl = containerEl;
  view.editor = makeEditor();
  view.getState = () => ({ mode: 'source' });
  view.getViewType = () => 'markdown';
  return view;
}

function makeWorkspaceController() {
  const handlers = new Map<string, Array<(...args: any[]) => void>>();
  let activeFile: any = null;
  let activeView: any = null;

  const workspace = {
    getActiveFile: vi.fn(() => activeFile),
    getActiveViewOfType: vi.fn(() => activeView),
    onLayoutReady: vi.fn((cb: () => void) => cb()),
    on: vi.fn((eventName: string, callback: (...args: any[]) => void) => {
      const callbacks = handlers.get(eventName) ?? [];
      callbacks.push(callback);
      handlers.set(eventName, callbacks);
      return { eventName, callback };
    }),
    off: vi.fn(),
    trigger: vi.fn(),
    tryTrigger: vi.fn(),
    getLeaf: vi.fn(() => ({ view: activeView, openFile: vi.fn() })),
    getMostRecentLeaf: vi.fn(() => ({ view: activeView })),
  };

  return {
    workspace,
    setActive(note: any, view: any) {
      activeFile = note;
      activeView = view;
    },
    emit(eventName: string, ...args: any[]) {
      for (const callback of handlers.get(eventName) ?? []) {
        callback(...args);
      }
    },
    handlerCount(eventName: string) {
      return handlers.get(eventName)?.length ?? 0;
    }
  };
}

async function makeLoadedPlugin(initialActive?: { note: any; view: any }) {
  const noteA = fakeTFile({ path: 'Notes/a.md', name: 'a.md', extension: 'md' });
  const noteB = fakeTFile({ path: 'Notes/b.md', name: 'b.md', extension: 'md' });
  const vault = fakeVault({ files: [noteA, noteB] });
  const controller = makeWorkspaceController();
  if (initialActive) {
    controller.setActive(initialActive.note, initialActive.view);
  }

  const app = fakeApp({ vault, workspace: controller.workspace as any });
  const plugin = new ImageConverterPlugin(app as any, fakePluginManifest({ id: 'image-converter', dir: '/plugins/image-converter' }));
  vi.spyOn(plugin as any, 'loadData').mockResolvedValue({
    isImageResizeEnbaled: true,
    isImageAlignmentEnabled: false,
    enableContextMenu: false,
    enableImageCaptions: false,
  });

  await plugin.onload();

  return { plugin, controller, noteA, noteB };
}

describe('ImageConverterPlugin image resizer lifecycle', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('attaches image resize listeners when a Markdown file opens after plugin load', async () => {
    const noteA = fakeTFile({ path: 'Notes/a.md', name: 'a.md', extension: 'md' });
    const viewA = makeMarkdownView(noteA, 'view-a');
    const { plugin, controller } = await makeLoadedPlugin();

    expect(plugin.imageResizer).toBeTruthy();
    expect(plugin.imageResizer?.markdownView).toBeNull();
    expect(controller.handlerCount('file-open')).toBeGreaterThanOrEqual(1);

    controller.setActive(noteA, viewA);
    controller.emit('file-open', noteA);

    expect(plugin.imageResizer?.markdownView).toBe(viewA);
  });

  it('reattaches image resize listeners on active leaf changes without waiting for layout-change', async () => {
    const noteA = fakeTFile({ path: 'Notes/a.md', name: 'a.md', extension: 'md' });
    const viewA = makeMarkdownView(noteA, 'view-a');
    const { plugin, controller, noteB } = await makeLoadedPlugin({ note: noteA, view: viewA });
    const viewB = makeMarkdownView(noteB, 'view-b');

    expect(plugin.imageResizer?.markdownView).toBe(viewA);
    expect(controller.handlerCount('active-leaf-change')).toBeGreaterThanOrEqual(1);

    controller.setActive(noteB, viewB);
    controller.emit('active-leaf-change', { view: viewB });

    expect(plugin.imageResizer?.markdownView).toBe(viewB);
  });
});

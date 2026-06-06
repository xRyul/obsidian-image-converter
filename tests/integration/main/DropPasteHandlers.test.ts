/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ImageConverterPlugin from '../../../src/main';
import { fakeApp, fakeVault, fakeTFile, fakePluginManifest } from '../../factories/obsidian';
import { Platform } from 'obsidian';

function makeAppWithNote() {
  const note = fakeTFile({ path: 'Notes/n.md', name: 'n.md', extension: 'md' });
  const vault = fakeVault({ files: [note] }) as any;
  const app = fakeApp({ vault, metadataCache: { resolvedLinks: {} } as any }) as any;
  // Workspace.getActiveFile should return our note for drop/paste flows
  (app.workspace.getActiveFile as any) = vi.fn(() => note);
  return { app, note };
}

function makePluginForDropPaste() {
  const { app } = makeAppWithNote();
  const plugin = new ImageConverterPlugin(app as any, fakePluginManifest({ id: 'image-converter' }));
  (plugin as any).settings = { neverProcessFilenames: [] };
  (plugin as any).supportedImageFormats = { isSupported: vi.fn(() => true) };
  (plugin as any).folderAndFilenameManagement = { matchesPatterns: vi.fn(() => false) };
  return { app, plugin };
}

function getRegisteredWorkspaceHandler(app: any, eventName: string) {
  const calls = (app.workspace.on as any).mock.calls as any[];
  const call = calls.find((callArgs) => callArgs[0] === eventName);
  expect(call, `expected ${eventName} handler to be registered`).toBeTruthy();
  return call[1] as (...args: any[]) => Promise<void>;
}

function makeImageFile() {
  return new File([new Uint8Array([137, 80, 78, 71])], 'already-handled.png', { type: 'image/png' });
}

describe('Platform-specific registration of drop/paste handlers (Phase 9: 25.4/25.5)', () => {
  let originalMobile: boolean;

  beforeEach(() => {
    originalMobile = Platform.isMobile;
  });

  afterEach(() => {
    Platform.isMobile = originalMobile;
  });

  it('When Platform.isMobile=true, Then editor-drop/editor-paste handlers are NOT registered', async () => {
    const { app } = makeAppWithNote();
    Platform.isMobile = true;

    const plugin = new ImageConverterPlugin(app as any, fakePluginManifest({ id: 'image-converter' }));
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue(undefined);
    await plugin.loadSettings();

    // onload registers handlers
    await plugin.onload();

    const calls = (app.workspace.on as any).mock.calls as any[];
    const events = calls.map((callArgs) => callArgs[0]);
    expect(events.includes('editor-drop')).toBe(false);
    expect(events.includes('editor-paste')).toBe(false);
  });

  it('When Platform.isMobile=false, Then editor-drop/editor-paste handlers ARE registered', async () => {
    const { app } = makeAppWithNote();
    Platform.isMobile = false;

    const plugin = new ImageConverterPlugin(app as any, fakePluginManifest({ id: 'image-converter' }));
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue(undefined);
    await plugin.loadSettings();

    await plugin.onload();

    const calls = (app.workspace.on as any).mock.calls as any[];
    const events = calls.map((callArgs) => callArgs[0]);
    expect(events.filter((e: string) => e === 'editor-drop').length).toBeGreaterThanOrEqual(1);
    expect(events.filter((e: string) => e === 'editor-paste').length).toBeGreaterThanOrEqual(1);
  });
});

describe('editor-drop/editor-paste defaultPrevented guard', () => {
  let originalMobile: boolean;

  beforeEach(() => {
    originalMobile = Platform.isMobile;
    Platform.isMobile = false;
  });

  afterEach(() => {
    Platform.isMobile = originalMobile;
  });

  it('does not handle or prevent an editor-drop event Obsidian already handled', async () => {
    const { app, plugin } = makePluginForDropPaste();
    const handleDrop = vi.fn().mockResolvedValue(undefined);
    (plugin as any).handleDrop = handleDrop;

    (plugin as any).dropPasteRegisterEvents();
    const handler = getRegisteredWorkspaceHandler(app, 'editor-drop');
    const imageFile = makeImageFile();
    const event = {
      defaultPrevented: true,
      dataTransfer: { files: [imageFile] },
      preventDefault: vi.fn(),
    };
    const editor = { posAtMouse: vi.fn(() => ({ line: 0, ch: 0 })) };

    await handler(event, editor);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(handleDrop).not.toHaveBeenCalled();
  });

  it('does not handle or prevent an editor-paste event Obsidian already handled', async () => {
    const { app, plugin } = makePluginForDropPaste();
    const handlePaste = vi.fn().mockResolvedValue(undefined);
    (plugin as any).handlePaste = handlePaste;

    (plugin as any).dropPasteRegisterEvents();
    const handler = getRegisteredWorkspaceHandler(app, 'editor-paste');
    const imageFile = makeImageFile();
    const event = {
      defaultPrevented: true,
      clipboardData: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => imageFile }],
      },
      preventDefault: vi.fn(),
    };
    const editor = { getCursor: vi.fn(() => ({ line: 0, ch: 0 })) };

    await handler(event, editor);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(handlePaste).not.toHaveBeenCalled();
  });
});

describe('activeDocument body state compatibility', () => {
  afterEach(() => {
    (globalThis as any).activeDocument = document;
    (window as any).activeDocument = document;
    document.body.classList.remove('image-converter-disable-native-image-selection');
  });

  it('applies body state classes to activeDocument instead of the inactive main document', async () => {
    const { app } = makeAppWithNote();
    const popoutDocument = document.implementation.createHTMLDocument('popout');
    (globalThis as any).activeDocument = popoutDocument;
    (window as any).activeDocument = popoutDocument;

    const plugin = new ImageConverterPlugin(app as any, fakePluginManifest({ id: 'image-converter' }));
    (plugin as any).saveData = vi.fn().mockResolvedValue(undefined);
    (plugin as any).settings = { disableObsidianImageSelectionOnClick: true };

    await plugin.saveSettings();

    expect(popoutDocument.body.classList.contains('image-converter-disable-native-image-selection')).toBe(true);
    expect(document.body.classList.contains('image-converter-disable-native-image-selection')).toBe(false);
  });

  it('removes body state classes from activeDocument on unload', async () => {
    const { app } = makeAppWithNote();
    const popoutDocument = document.implementation.createHTMLDocument('popout');
    popoutDocument.body.classList.add(
      'image-converter-disable-native-image-selection',
      'image-captions-enabled'
    );
    (globalThis as any).activeDocument = popoutDocument;
    (window as any).activeDocument = popoutDocument;

    const plugin = new ImageConverterPlugin(app as any, fakePluginManifest({ id: 'image-converter' }));

    await plugin.onunload();

    expect(popoutDocument.body.classList.contains('image-converter-disable-native-image-selection')).toBe(false);
    expect(popoutDocument.body.classList.contains('image-captions-enabled')).toBe(false);
  });
});

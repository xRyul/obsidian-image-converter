/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ImageConverterPlugin from '../../../src/main';
import { fakeApp, fakeVault, fakeTFile, fakePluginManifest } from '../../factories/obsidian';
import { Notice, Platform } from 'obsidian';

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
    Notice.instances.length = 0;
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

  it('does not consume the one-shot skip request for an event Obsidian already handled', async () => {
    const { app, plugin } = makePluginForDropPaste();
    const handlePaste = vi.fn().mockResolvedValue(undefined);
    (plugin as any).handlePaste = handlePaste;
    (plugin as any).dropPasteRegisterEvents();
    (plugin as any).imageProcessingPauseState.armSkipNextPaste();
    const handler = getRegisteredWorkspaceHandler(app, 'editor-paste');
    const imageFile = makeImageFile();

    await handler({
      defaultPrevented: true,
      clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => imageFile }] },
      preventDefault: vi.fn(),
    }, { getCursor: vi.fn(() => ({ line: 0, ch: 0 })) });

    await handler({
      defaultPrevented: false,
      clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => imageFile }] },
      preventDefault: vi.fn(),
    }, { getCursor: vi.fn(() => ({ line: 0, ch: 0 })) });

    expect(handlePaste).toHaveBeenCalledTimes(1);
    expect(handlePaste.mock.calls[0][3]).toBe(imageFile);
  });

  it('consumes one-shot skip only on a supported image paste and skips just the first supported image', async () => {
    const { app, plugin } = makePluginForDropPaste();
    const firstImage = makeImageFile();
    const secondImage = new File([new Uint8Array([1, 2, 3])], 'second.png', { type: 'image/png' });
    const handlePaste = vi.fn().mockResolvedValue(undefined);
    (plugin as any).handlePaste = handlePaste;
    (plugin as any).supportedImageFormats.isSupported = vi.fn((_type: string, name: string) => name.endsWith('.png'));
    (plugin as any).dropPasteRegisterEvents();
    (plugin as any).imageProcessingPauseState.armSkipNextPaste();
    const handler = getRegisteredWorkspaceHandler(app, 'editor-paste');
    const editor = { getCursor: vi.fn(() => ({ line: 0, ch: 0 })) };

    const textOnlyPaste = { defaultPrevented: false, clipboardData: { items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] }, preventDefault: vi.fn() };
    await handler(textOnlyPaste, editor);
    expect(textOnlyPaste.preventDefault).not.toHaveBeenCalled();
    expect(handlePaste).not.toHaveBeenCalled();
    expect(Notice.instances).toHaveLength(0);

    const spreadsheetPaste = {
      defaultPrevented: false,
      clipboardData: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => firstImage }],
        getData: (type: string) => type === 'text/html' ? '<table></table>' : '',
      },
      preventDefault: vi.fn(),
    };
    await handler(spreadsheetPaste, editor);
    expect(spreadsheetPaste.preventDefault).not.toHaveBeenCalled();
    expect(handlePaste).not.toHaveBeenCalled();

    const imagePaste = {
      defaultPrevented: false,
      clipboardData: { items: [
        { kind: 'file', type: 'image/png', getAsFile: () => firstImage },
        { kind: 'file', type: 'image/png', getAsFile: () => secondImage },
      ] },
      preventDefault: vi.fn(),
    };
    await handler(imagePaste, editor);
    expect(imagePaste.preventDefault).toHaveBeenCalledOnce();
    expect(handlePaste.mock.calls[0][3]).toBe(firstImage);
    expect(Notice.instances).toHaveLength(1);
    expect(Notice.instances[0].message).toContain('Automatic processing resumes with the next image');

    await handler({
      defaultPrevented: false,
      clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => secondImage }] },
      preventDefault: vi.fn(),
    }, editor);
    expect(handlePaste.mock.calls[1][3]).toBeUndefined();
    expect(Notice.instances).toHaveLength(1);
  });

  it('keeps one-shot skip armed after unsupported and never-process image pastes', async () => {
    const { app, plugin } = makePluginForDropPaste();
    const skippedImage = new File([new Uint8Array([1])], 'skip.png', { type: 'image/png' });
    const eligibleImage = makeImageFile();
    const handlePaste = vi.fn().mockResolvedValue(undefined);
    (plugin as any).handlePaste = handlePaste;
    (plugin as any).supportedImageFormats.isSupported = vi.fn((_type: string, name: string) => name.endsWith('.png'));
    (plugin as any).folderAndFilenameManagement.matchesPatterns = vi.fn((name: string) => name === 'skip.png');
    (plugin as any).dropPasteRegisterEvents();
    (plugin as any).imageProcessingPauseState.armSkipNextPaste();
    const handler = getRegisteredWorkspaceHandler(app, 'editor-paste');
    const editor = { getCursor: vi.fn(() => ({ line: 0, ch: 0 })) };

    for (const [name, file, type] of [
      ['unsupported.gif', new File([new Uint8Array([1])], 'unsupported.gif', { type: 'image/gif' }), 'image/gif'],
      ['skip.png', skippedImage, 'image/png'],
    ] as const) {
      const event = {
        defaultPrevented: false,
        clipboardData: { items: [{ kind: 'file', type, getAsFile: () => file }] },
        preventDefault: vi.fn(),
      };
      await handler(event, editor);
      expect(event.preventDefault, name).not.toHaveBeenCalled();
    }

    await handler({
      defaultPrevented: false,
      clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => eligibleImage }] },
      preventDefault: vi.fn(),
    }, editor);
    expect(handlePaste).toHaveBeenCalledOnce();
    expect(handlePaste.mock.calls[0][3]).toBe(eligibleImage);
  });

  it('consumes one-shot skip synchronously across overlapping paste events', async () => {
    const { app, plugin } = makePluginForDropPaste();
    const handlePaste = vi.fn(() => new Promise<void>(() => undefined));
    (plugin as any).handlePaste = handlePaste;
    (plugin as any).dropPasteRegisterEvents();
    (plugin as any).imageProcessingPauseState.armSkipNextPaste();
    const handler = getRegisteredWorkspaceHandler(app, 'editor-paste');
    const editor = { getCursor: vi.fn(() => ({ line: 0, ch: 0 })) };
    const eventFor = (file: File) => ({
      defaultPrevented: false,
      clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] },
      preventDefault: vi.fn(),
    });

    void handler(eventFor(makeImageFile()), editor);
    void handler(eventFor(new File([new Uint8Array([2])], 'second.png', { type: 'image/png' })), editor);

    expect(handlePaste).toHaveBeenCalledTimes(2);
    expect(handlePaste.mock.calls[0][3]).toBeTruthy();
    expect(handlePaste.mock.calls[1][3]).toBeUndefined();
  });

  it('leaves paste and drop to Obsidian while persistent automatic processing is paused', async () => {
    const { app, plugin } = makePluginForDropPaste();
    (plugin as any).settings.autoImageProcessingPaused = true;
    const handlePaste = vi.fn().mockResolvedValue(undefined);
    const handleDrop = vi.fn().mockResolvedValue(undefined);
    (plugin as any).handlePaste = handlePaste;
    (plugin as any).handleDrop = handleDrop;
    (plugin as any).dropPasteRegisterEvents();

    const paste = { defaultPrevented: false, clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => makeImageFile() }] }, preventDefault: vi.fn() };
    const drop = { defaultPrevented: false, dataTransfer: { files: [makeImageFile()] }, preventDefault: vi.fn() };
    await getRegisteredWorkspaceHandler(app, 'editor-paste')(paste, { getCursor: vi.fn(() => ({ line: 0, ch: 0 })) });
    await getRegisteredWorkspaceHandler(app, 'editor-drop')(drop, { posAtMouse: vi.fn(() => ({ line: 0, ch: 0 })) });

    expect(paste.preventDefault).not.toHaveBeenCalled();
    expect(drop.preventDefault).not.toHaveBeenCalled();
    expect(handlePaste).not.toHaveBeenCalled();
    expect(handleDrop).not.toHaveBeenCalled();
    expect(Notice.instances.map(notice => notice.message)).toEqual([
      'Automatic image processing is paused. Images will be added without compression.',
      'Automatic image processing is paused. Images will be added without compression.',
    ]);
  });

  it('does not show paused notices for text or unsupported imports', async () => {
    const { app, plugin } = makePluginForDropPaste();
    (plugin as any).settings.autoImageProcessingPaused = true;
    (plugin as any).supportedImageFormats.isSupported = vi.fn(() => false);
    (plugin as any).dropPasteRegisterEvents();
    const paste = getRegisteredWorkspaceHandler(app, 'editor-paste');
    const drop = getRegisteredWorkspaceHandler(app, 'editor-drop');
    const preventDefault = vi.fn();
    await paste({ defaultPrevented: false, clipboardData: { items: [{ kind: 'string', type: 'text/plain' }] }, preventDefault }, {});
    await paste({ defaultPrevented: false, clipboardData: { items: [{ kind: 'file', type: 'application/pdf', getAsFile: () => new File(['pdf'], 'test.pdf') }] }, preventDefault }, {});
    await drop({ defaultPrevented: false, dataTransfer: { files: [new File(['pdf'], 'test.pdf')] }, preventDefault }, {});
    expect(Notice.instances).toHaveLength(0);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('explicit pause and resume commands persist their state without toggling on repeated calls', async () => {
    const { app } = makeAppWithNote();
    const plugin = new ImageConverterPlugin(app as any, fakePluginManifest({ id: 'image-converter' }));
    let savedData: any;
    const savedStates: boolean[] = [];
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue(undefined);
    vi.spyOn(plugin as any, 'saveData').mockImplementation(async (data: any) => {
      savedData = structuredClone(data);
      savedStates.push(data.autoImageProcessingPaused);
    });
    const commands: any[] = [];
    (plugin as any).addCommand = vi.fn((command: any) => commands.push(command));
    await plugin.onload();
    savedStates.length = 0;
    const pause = commands.find(command => command.id === 'pause-auto-image-processing');
    const resume = commands.find(command => command.id === 'resume-auto-image-processing');
    expect(pause).toBeTruthy();
    expect(resume).toBeTruthy();
    for (const [command, expected] of [[pause, true], [pause, true], [resume, false], [resume, false]] as const) {
      await command.callback();
      expect(plugin.settings.autoImageProcessingPaused).toBe(expected);
      expect(savedData.autoImageProcessingPaused).toBe(expected);
    }
    expect(savedStates).toEqual([true, true, false, false]);

    const reloadedPlugin = new ImageConverterPlugin(app as any, fakePluginManifest({ id: 'image-converter' }));
    vi.spyOn(reloadedPlugin as any, 'loadData').mockImplementation(async () => savedData);
    await reloadedPlugin.loadSettings();
    expect(reloadedPlugin.settings.autoImageProcessingPaused).toBe(false);
  });

  it('persists the automatic processing toggle across settings reloads', async () => {
    const { app } = makeAppWithNote();
    const plugin = new ImageConverterPlugin(app as any, fakePluginManifest({ id: 'image-converter' }));
    let savedData: any;
    vi.spyOn(plugin as any, 'loadData').mockImplementation(async () => savedData ?? null);
    vi.spyOn(plugin as any, 'saveData').mockImplementation(async (data: any) => { savedData = structuredClone(data); });
    const commands: any[] = [];
    (plugin as any).addCommand = vi.fn((command: any) => commands.push(command));

    await plugin.onload();
    const toggleCommand = commands.find((command) => command.id === 'toggle-auto-image-processing');
    expect(toggleCommand).toBeTruthy();
    await toggleCommand.callback();
    expect(savedData.autoImageProcessingPaused).toBe(true);

    const reloadedPlugin = new ImageConverterPlugin(app as any, fakePluginManifest({ id: 'image-converter' }));
    vi.spyOn(reloadedPlugin as any, 'loadData').mockImplementation(async () => savedData);
    await reloadedPlugin.loadSettings();
    expect((reloadedPlugin as any).settings.autoImageProcessingPaused).toBe(true);
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

describe('editor-paste spreadsheet table fallthrough (issues #311/#440)', () => {
  let originalMobile: boolean;

  beforeEach(() => {
    originalMobile = Platform.isMobile;
    Platform.isMobile = false;
  });

  afterEach(() => {
    Platform.isMobile = originalMobile;
  });

  function makePasteEvent(clipboardData: any) {
    return {
      defaultPrevented: false,
      clipboardData,
      preventDefault: vi.fn(),
    };
  }

  function makeEditor() {
    return { getCursor: vi.fn(() => ({ line: 0, ch: 0 })) };
  }

  function makeClipboardData(getDataImpl: (type: string) => string) {
    const imageFile = makeImageFile();
    return {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => imageFile }],
      getData: getDataImpl,
    };
  }

  it('Given clipboard has image + HTML table, When pasting, Then the plugin does NOT intercept', async () => {
    const { app, plugin } = makePluginForDropPaste();
    const handlePaste = vi.fn().mockResolvedValue(undefined);
    (plugin as any).handlePaste = handlePaste;
    (plugin as any).dropPasteRegisterEvents();
    const handler = getRegisteredWorkspaceHandler(app, 'editor-paste');

    const event = makePasteEvent(makeClipboardData((type: string) =>
      type === 'text/html' ? '<table><tr><td>a</td><td>b</td></tr></table>' : ''
    ));
    await handler(event, makeEditor());

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(handlePaste).not.toHaveBeenCalled();
  });

  it('Given clipboard has image + tab-separated text, When pasting, Then the plugin does NOT intercept', async () => {
    const { app, plugin } = makePluginForDropPaste();
    const handlePaste = vi.fn().mockResolvedValue(undefined);
    (plugin as any).handlePaste = handlePaste;
    (plugin as any).dropPasteRegisterEvents();
    const handler = getRegisteredWorkspaceHandler(app, 'editor-paste');

    const event = makePasteEvent(makeClipboardData((type: string) =>
      type === 'text/plain' ? 'col1\tcol2\nval1\tval2' : ''
    ));
    await handler(event, makeEditor());

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(handlePaste).not.toHaveBeenCalled();
  });

  it('Given clipboard has image + non-table HTML (browser copy image), When pasting, Then the plugin DOES intercept', async () => {
    const { app, plugin } = makePluginForDropPaste();
    const handlePaste = vi.fn().mockResolvedValue(undefined);
    (plugin as any).handlePaste = handlePaste;
    (plugin as any).dropPasteRegisterEvents();
    const handler = getRegisteredWorkspaceHandler(app, 'editor-paste');

    const event = makePasteEvent(makeClipboardData((type: string) =>
      type === 'text/html' ? '<img src="https://example.com/cat.png">' : ''
    ));
    await handler(event, makeEditor());

    expect(event.preventDefault).toHaveBeenCalled();
    expect(handlePaste).toHaveBeenCalled();
  });

  it('Given clipboard has image only, When pasting, Then the plugin DOES intercept', async () => {
    const { app, plugin } = makePluginForDropPaste();
    const handlePaste = vi.fn().mockResolvedValue(undefined);
    (plugin as any).handlePaste = handlePaste;
    (plugin as any).dropPasteRegisterEvents();
    const handler = getRegisteredWorkspaceHandler(app, 'editor-paste');

    const event = makePasteEvent(makeClipboardData(() => ''));
    await handler(event, makeEditor());

    expect(event.preventDefault).toHaveBeenCalled();
    expect(handlePaste).toHaveBeenCalled();
  });
});

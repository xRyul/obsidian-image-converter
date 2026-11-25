/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unnecessary-type-assertion */
import { describe, it, expect, vi } from 'vitest';
import ImageConverterPlugin from '../../../src/main';
import { fakeApp, fakeVault, fakeTFile, fakePluginManifest } from '../../factories/obsidian';
import { buildWebpLossy } from '../../factories/containers/webp';

function makeFile(name: string, bytes = [1, 2, 3]): File {
  return new File([new Uint8Array(bytes)], name, { type: 'image/png' });
}

async function makeConfiguredPlugin() {
  const activeNote = fakeTFile({ path: 'Active/current.md', name: 'current.md', extension: 'md' });
  const noteA = fakeTFile({ path: 'Articles/A/current.md', name: 'current.md', extension: 'md' });
  const noteB = fakeTFile({ path: 'Articles/B/current.md', name: 'current.md', extension: 'md' });
  const vault = fakeVault({ files: [activeNote, noteA, noteB] }) as any;
  const app = fakeApp({ vault, metadataCache: { resolvedLinks: {} as any } as any }) as any;
  app.workspace.getActiveFile = vi.fn(() => activeNote);

  const plugin = new ImageConverterPlugin(app, fakePluginManifest({ id: 'image-converter' }));
  vi.spyOn(plugin as any, 'loadData').mockResolvedValue(undefined);
  await plugin.loadSettings();
  await plugin.onload();

  const settings = (plugin as any).settings;
  settings.modalBehavior = 'never';
  settings.folderPresetRules = [
    { folderPath: 'Articles/A', globalPreset: 'Folder A', enabled: true },
    { folderPath: 'Articles/B', globalPreset: 'Folder B', enabled: true },
  ];
  settings.globalPresets = [
    {
      name: 'Folder A', folderPreset: 'Same folder as current note', filenamePreset: 'Keep original name',
      conversionPreset: 'WEBP (75, no resizing)', linkFormatPreset: 'Default (Wikilink, Shortest)', resizePreset: 'Default (No Resize)',
    },
    {
      name: 'Folder B', folderPreset: 'Same folder as current note', filenamePreset: 'Keep original name',
      conversionPreset: 'None', linkFormatPreset: 'Default (Wikilink, Shortest)', resizePreset: 'Default (No Resize)',
    },
  ];
  (plugin as any).imageProcessor = {
    processImage: vi.fn(async (file: File, format: string) =>
      format === 'WEBP' ? Uint8Array.from(buildWebpLossy()).buffer : file.arrayBuffer()),
  };
  (plugin as any).linkFormatter = { formatLink: vi.fn(async () => '![](/mock)') };
  (plugin as any).showSizeComparisonNotification = vi.fn();

  const workspaceCalls = app.workspace.on.mock.calls as any[];
  const getHandler = (eventName: string) => {
    const registration = workspaceCalls.find((args) => args[0] === eventName);
    expect(registration, `${eventName} handler should be registered`).toBeTruthy();
    return registration[1] as (...args: any[]) => Promise<void>;
  };
  const editor = {
    getCursor: () => ({ line: 0, ch: 0 }),
    posAtMouse: () => ({ line: 0, ch: 0 }),
    replaceRange: vi.fn(),
    setCursor: vi.fn(),
  };

  return { app, plugin, noteA, noteB, getHandler, editor };
}

describe('folder preset rules integration', () => {
  it('uses each event file note for concurrent paste/drop destination and conversion', async () => {
    const { app, noteA, noteB, getHandler, editor } = await makeConfiguredPlugin();
    const pasteFile = makeFile('paste-a.png');
    const dropFile = makeFile('drop-b.png');
    const pasteEvent = {
      defaultPrevented: false,
      clipboardData: { items: [{ kind: 'file', type: pasteFile.type, getAsFile: () => pasteFile }] },
      preventDefault: vi.fn(),
    };
    const dropEvent = {
      defaultPrevented: false,
      dataTransfer: { files: [dropFile] },
      preventDefault: vi.fn(),
    };

    await Promise.all([
      getHandler('editor-paste')(pasteEvent, editor, { file: noteA }),
      getHandler('editor-drop')(dropEvent, editor, { file: noteB }),
    ]);

    const paths = (app.vault.createBinary as any).mock.calls.map((call: any[]) => call[0]);
    expect(paths).toContain('Articles/A/paste-a.webp');
    expect(paths).toContain('Articles/B/drop-b.png');
    expect(paths).not.toContain('Active/paste-a.webp');
    expect(paths).not.toContain('Active/drop-b.png');
  });

  it.each(['editor-paste', 'editor-drop'])('applies the external file preset for %s without using a vault fallback', async eventName => {
    const { app, plugin, getHandler, editor } = await makeConfiguredPlugin();
    const externalNote = fakeTFile({ path: 'file:D:/Apps/Su/读我.md', name: '读我.md', extension: 'md' });
    const settings = (plugin as any).settings;
    settings.folderPresets.push({ name: 'External assets', type: 'CUSTOM', customTemplate: 'ExternalAssets' });
    settings.globalPresets[0].folderPreset = 'External assets';
    settings.folderPresetRules = [
      { folderPath: '/', globalPreset: 'Folder B', enabled: true },
      { folderPath: 'file:', globalPreset: 'Folder A', enabled: true },
    ];
    const file = makeFile('external.png');
    const event = {
      defaultPrevented: false,
      clipboardData: { items: [{ kind: 'file', type: file.type, getAsFile: () => file }] },
      dataTransfer: { files: [file] },
      preventDefault: vi.fn(),
    };
    await getHandler(eventName)(event, editor, { file: externalNote });
    expect(app.vault.createBinary).toHaveBeenCalledWith('ExternalAssets/external.webp', expect.any(ArrayBuffer));
    expect((plugin as any).imageProcessor.processImage).toHaveBeenCalled();
    expect(settings.selectedGlobalPreset).toBe('WebP 75');
  });
});

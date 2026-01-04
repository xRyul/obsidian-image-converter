import { describe, it, expect, vi } from 'vitest';
import ImageConverterPlugin from '../../../src/main';
import { fakeApp, fakeVault, fakeTFile, fakePluginManifest } from '../../factories/obsidian';

function makeFile(name: string, type: string, size = 8): File {
  const buf = new Uint8Array(size).map((_, i) => (i % 256));
  return new File([buf], name, { type });
}

function setupPluginWithNote(extraFiles: any[] = []) {
  const note = fakeTFile({ path: 'Notes/n.md', name: 'n.md', extension: 'md' });
  const vault = fakeVault({ files: [note, ...extraFiles] }) as any;
  const app = fakeApp({ vault, metadataCache: { resolvedLinks: { [note.path]: {} } as any } }) as any;
  (app.workspace.getActiveFile as any) = vi.fn(() => note);

  const plugin = new ImageConverterPlugin(app as any, fakePluginManifest({ id: 'image-converter' }));
  vi.spyOn(plugin as any, 'loadData').mockResolvedValue(undefined);

  return { app, note, plugin };
}

describe('Conflict resolution and overwrite safety (Phase 9: 27.2)', () => {
  it('27.2 increment: when destination already exists, then handleNameConflicts is used and no overwrite occurs', async () => {
    const existing = fakeTFile({ path: 'images/dup.webp', name: 'dup.webp', extension: 'webp' });
    const { app, plugin } = setupPluginWithNote([existing]);

    await plugin.loadSettings();
    await plugin.onload();

    // Force settings-driven (no modal) flow
    (plugin as any).settings.modalBehavior = 'never';
    (plugin as any).settings.selectedConversionPreset = 'WEBP (75, no resizing)';
    (plugin as any).settings.selectedFilenamePreset = 'Keep original name'; // increment by default

    // Avoid LinkFormatter internals
    (plugin as any).linkFormatter = { formatLink: vi.fn(async (path: string) => `![](/${path})`) };
    (plugin as any).imageProcessor = { processImage: vi.fn(async () => new ArrayBuffer(8)) };
    (plugin as any).showSizeComparisonNotification = vi.fn();

    // Destination is the conflicting name
    vi.spyOn((plugin as any).folderAndFilenameManagement, 'determineDestination').mockResolvedValue({
      destinationPath: 'images',
      newFilename: 'dup.webp'
    });

    // Force conflict resolution to increment
    vi.spyOn((plugin as any).folderAndFilenameManagement, 'handleNameConflicts').mockResolvedValue('dup-1.webp');

    const editor = {
      getCursor: () => ({ line: 0, ch: 0 }),
      replaceRange: vi.fn(),
      setCursor: vi.fn(),
    } as any;

    const items = [{ kind: 'file', type: 'image/png', file: makeFile('x.png', 'image/png') }];

    await (plugin as any).handlePaste(items, editor, { line: 0, ch: 0 });

    // Assert: existing file still present, and new file created with incremented name
    expect(app.vault.getAbstractFileByPath('images/dup.webp')).toBeTruthy();
    expect(app.vault.getAbstractFileByPath('images/dup-1.webp')).toBeTruthy();

    // CreateBinary should be called with the incremented path
    const createdPaths = (app.vault.createBinary as any).mock.calls.map((callArgs: any[]) => callArgs[0] as string);
    expect(createdPaths).toEqual(['images/dup-1.webp']);
  });

  it('27.2 reuse: when destination already exists, then no createBinary occurs and link points to existing file', async () => {
    const existing = fakeTFile({ path: 'images/dup.webp', name: 'dup.webp', extension: 'webp' });
    const { app, plugin } = setupPluginWithNote([existing]);

    await plugin.loadSettings();
    await plugin.onload();

    (plugin as any).settings.modalBehavior = 'never';
    (plugin as any).settings.selectedConversionPreset = 'WEBP (75, no resizing)';

    // Add a reuse preset and select it
    (plugin as any).settings.filenamePresets.push({
      name: 'Reuse Existing',
      customTemplate: '{imagename}',
      skipRenamePatterns: '',
      conflictResolution: 'reuse'
    });
    (plugin as any).settings.selectedFilenamePreset = 'Reuse Existing';

    const formatLink = vi.fn(async (path: string) => `![](/${path})`);
    (plugin as any).linkFormatter = { formatLink };

    // Destination is the conflicting name
    vi.spyOn((plugin as any).folderAndFilenameManagement, 'determineDestination').mockResolvedValue({
      destinationPath: 'images',
      newFilename: 'dup.webp'
    });

    const editor = {
      getCursor: () => ({ line: 0, ch: 0 }),
      replaceRange: vi.fn(),
      setCursor: vi.fn(),
    } as any;

    const items = [{ kind: 'file', type: 'image/png', file: makeFile('x.png', 'image/png') }];

    await (plugin as any).handlePaste(items, editor, { line: 0, ch: 0 });

    expect((app.vault.createBinary as any).mock.calls.length).toBe(0);
    expect(formatLink).toHaveBeenCalledWith('images/dup.webp', expect.anything(), expect.anything(), expect.anything(), expect.anything());
    expect((editor.replaceRange as any).mock.calls.length).toBe(1);
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unnecessary-type-assertion */
import { describe, it, expect, vi } from 'vitest';
import ImageConverterPlugin from '../../../src/main';
import { fakeApp, fakeVault, fakeTFile, fakePluginManifest } from '../../factories/obsidian';
import { exifBlockFrom } from '../../factories/exif';
import { makeJpegBytes } from '../../factories/image';
import { readExif as readJpegExif } from '../../../src/metadata/containers/jpeg';

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

  it('22.11 minimum savings: when savings below threshold, then original bytes are written with the extension of the original', async () => {
    const { app, plugin } = setupPluginWithNote();

    await plugin.loadSettings();
    await plugin.onload();

    (plugin as any).settings.modalBehavior = 'never';
    (plugin as any).settings.selectedConversionPreset = 'WEBP (75, no resizing)';
    const selectedPreset = (plugin as any).settings.conversionPresets.find((preset: any) => preset.name === 'WEBP (75, no resizing)');
    selectedPreset.revertToOriginalIfLarger = true;
    selectedPreset.minimumCompressionSavingsInKB = 1;

    const processedBuffer = new ArrayBuffer(1500);
    (plugin as any).imageProcessor = { processImage: vi.fn(async () => processedBuffer) };
    (plugin as any).showSizeComparisonNotification = vi.fn();
    (plugin as any).linkFormatter = { formatLink: vi.fn(async (path: string) => `![](/${path})`) };

    vi.spyOn((plugin as any).folderAndFilenameManagement, 'determineDestination').mockResolvedValue({
      destinationPath: 'images',
      newFilename: 'x.webp'
    });

    const editor = {
      getCursor: () => ({ line: 0, ch: 0 }),
      replaceRange: vi.fn(),
      setCursor: vi.fn(),
    } as any;

    const file = makeFile('x.png', 'image/png', 2000);
    const items = [{ kind: 'file', type: 'image/png', file }];

    await (plugin as any).handlePaste(items, editor, { line: 0, ch: 0 });

    const [pathArg, bufferArg] = (app.vault.createBinary as any).mock.calls[0] as [string, ArrayBuffer];
    expect(pathArg).toBe('images/x.png');
    expect(bufferArg.byteLength).toBe(file.size);
    expect(bufferArg.byteLength).toBeGreaterThan(processedBuffer.byteLength);
  });

  it('Given the setting to remove all metadata, When the original is used because savings are too small, Then the saved original has no EXIF', async () => {
    const { app, plugin } = setupPluginWithNote();

    await plugin.loadSettings();
    await plugin.onload();

    (plugin as any).settings.modalBehavior = 'never';
    (plugin as any).settings.metadataMode = 'strip-all';
    (plugin as any).settings.selectedConversionPreset = 'WEBP (75, no resizing)';
    const selectedPreset = (plugin as any).settings.conversionPresets.find((preset: any) => preset.name === 'WEBP (75, no resizing)');
    selectedPreset.revertToOriginalIfLarger = true;
    selectedPreset.minimumCompressionSavingsInKB = 1;

    const original = new Uint8Array(makeJpegBytes({ w: 10, h: 10, exif: exifBlockFrom({ make: 'TestCamera', gpsLatitudeRef: 'N' }) }));
    (plugin as any).imageProcessor = { processImage: vi.fn(async () => new ArrayBuffer(original.length)) };
    (plugin as any).showSizeComparisonNotification = vi.fn();
    (plugin as any).linkFormatter = { formatLink: vi.fn(async (path: string) => `![](/${path})`) };

    vi.spyOn((plugin as any).folderAndFilenameManagement, 'determineDestination').mockResolvedValue({
      destinationPath: 'images',
      newFilename: 'x.webp'
    });

    const editor = {
      getCursor: () => ({ line: 0, ch: 0 }),
      replaceRange: vi.fn(),
      setCursor: vi.fn(),
    } as any;

    const file = new File([original], 'x.jpg', { type: 'image/jpeg' });
    const items = [{ kind: 'file', type: 'image/jpeg', file }];

    await (plugin as any).handlePaste(items, editor, { line: 0, ch: 0 });

    const [, bufferArg] = (app.vault.createBinary as any).mock.calls[0] as [string, ArrayBuffer];
    expect(readJpegExif(new Uint8Array(bufferArg))).toBeNull();
  });
});

// Issue #347: the original image must not be saved under the extension of the converted one.
describe('Revert to original if larger: the saved file keeps the extension of the original', () => {
  async function setupRevert(options: { existing?: string[]; reuse?: boolean; processedSize?: number } = {}) {
    const existing = (options.existing ?? []).map((path) => fakeTFile({ path }));
    const { app, plugin } = setupPluginWithNote(existing);

    await plugin.loadSettings();
    await plugin.onload();

    const { settings } = plugin as any;
    settings.modalBehavior = 'never';
    settings.selectedConversionPreset = 'WEBP (75, no resizing)';
    const conversionPreset = settings.conversionPresets.find((preset: any) => preset.name === 'WEBP (75, no resizing)');
    conversionPreset.revertToOriginalIfLarger = true;
    conversionPreset.minimumCompressionSavingsInKB = 0;

    settings.selectedFilenamePreset = 'Keep original name'; // increment
    if (options.reuse) {
      if (!settings.filenamePresets.some((preset: any) => preset.name === 'Reuse Existing')) {
        settings.filenamePresets.push({ name: 'Reuse Existing', customTemplate: '{imagename}', skipRenamePatterns: '', conflictResolution: 'reuse' });
      }
      settings.selectedFilenamePreset = 'Reuse Existing';
    }

    // By default the converted image is larger than the 2,000-byte original.
    (plugin as any).imageProcessor = { processImage: vi.fn(async () => new ArrayBuffer(options.processedSize ?? 5000)) };
    (plugin as any).showSizeComparisonNotification = vi.fn();
    const formatLink = vi.fn(async (path: string) => `![](/${path})`);
    (plugin as any).linkFormatter = { formatLink };

    vi.spyOn((plugin as any).folderAndFilenameManagement, 'determineDestination').mockResolvedValue({
      destinationPath: 'images',
      newFilename: 'x.webp'
    });

    const editor = {
      getCursor: () => ({ line: 0, ch: 0 }),
      replaceRange: vi.fn(),
      setCursor: vi.fn(),
    } as any;

    return { app, plugin, editor, formatLink };
  }

  async function addImage(flow: 'drop' | 'paste', plugin: ImageConverterPlugin, editor: any, file: File) {
    if (flow === 'drop') {
      await (plugin as any).handleDrop([{ name: file.name, type: file.type, file }], editor, new Event('drop'), { line: 0, ch: 0 });
      return;
    }
    await (plugin as any).handlePaste([{ kind: 'file', type: file.type, file }], editor, { line: 0, ch: 0 });
  }

  const createdPaths = (app: any): string[] => ((app.vault.createBinary as any).mock.calls as any[][]).map((callArgs) => callArgs[0] as string);

  it.each(['drop', 'paste'] as const)('Given a PNG and a WEBP preset, When the original is used on %s, Then it is saved as .png and the link points to it', async (flow) => {
    const { app, plugin, editor, formatLink } = await setupRevert();
    const file = makeFile('x.png', 'image/png', 2000);

    await addImage(flow, plugin, editor, file);

    expect(createdPaths(app)).toEqual(['images/x.png']);
    const [, bufferArg] = (app.vault.createBinary as any).mock.calls[0] as [string, ArrayBuffer];
    expect(bufferArg.byteLength).toBe(file.size);
    expect(formatLink).toHaveBeenCalledWith('images/x.png', expect.anything(), expect.anything(), expect.anything(), expect.anything());
    expect((editor.replaceRange as any).mock.calls.length).toBe(1);
  });

  it.each(['drop', 'paste'] as const)('Given a PNG and a WEBP preset, When the converted image is used on %s, Then it is saved as .webp', async (flow) => {
    const { app, plugin, editor } = await setupRevert({ processedSize: 100 });

    await addImage(flow, plugin, editor, makeFile('x.png', 'image/png', 2000));

    expect(createdPaths(app)).toEqual(['images/x.webp']);
  });

  it.each(['drop', 'paste'] as const)('Given a file already has the name of the original, When the original is used on %s with "increment", Then the name gets a number', async (flow) => {
    const { app, plugin, editor, formatLink } = await setupRevert({ existing: ['images/x.png'] });

    await addImage(flow, plugin, editor, makeFile('x.png', 'image/png', 2000));

    expect(createdPaths(app)).toEqual(['images/x-1.png']);
    expect(formatLink).toHaveBeenCalledWith('images/x-1.png', expect.anything(), expect.anything(), expect.anything(), expect.anything());
  });

  it.each(['drop', 'paste'] as const)('Given a file already has the name of the original, When the original is used on %s with "reuse", Then nothing is written and the link points to that file', async (flow) => {
    const { app, plugin, editor, formatLink } = await setupRevert({ existing: ['images/x.png'], reuse: true });

    await addImage(flow, plugin, editor, makeFile('x.png', 'image/png', 2000));

    expect(createdPaths(app)).toEqual([]);
    expect(formatLink).toHaveBeenCalledWith('images/x.png', expect.anything(), expect.anything(), expect.anything(), expect.anything());
    expect((editor.replaceRange as any).mock.calls.length).toBe(1);
  });

  it('Given an original that already has the extension of the preset, When the original is used, Then the name does not change', async () => {
    const { app, plugin, editor } = await setupRevert();

    await addImage('paste', plugin, editor, makeFile('x.webp', 'image/webp', 2000));

    expect(createdPaths(app)).toEqual(['images/x.webp']);
  });
});

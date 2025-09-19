import { describe, it, expect, vi } from 'vitest';
import ImageConverterPlugin from '../../../src/main';
import { fakeApp, fakeVault, fakeTFile, fakePluginManifest } from '../../factories/obsidian';

function makePluginWithNote() {
  const note = fakeTFile({ path: 'Notes/n.md', name: 'n.md', extension: 'md' });
  const vault = fakeVault({ files: [note] }) as any;
  const app = fakeApp({ vault, metadataCache: { resolvedLinks: { [note.path]: {} } as any } }) as any;
  (app.workspace.getActiveFile as any) = vi.fn(() => note);

  const plugin = new ImageConverterPlugin(app as any, fakePluginManifest({ id: 'image-converter' }));
  vi.spyOn(plugin as any, 'loadData').mockResolvedValue(undefined);
  return { app, note, plugin };
}

function makeFile(name: string, type: string, size = 8): File {
  const buf = new Uint8Array(size).map((_, i) => (i % 256));
  return new File([buf], name, { type });
}

describe('Concurrent drop/paste handling (Phase 9: 26.9, 26.10 subset)', () => {
  it('Given multiple files dropped, When handled concurrently, Then creates all files and inserts links without duplication', async () => {
    const { app, plugin } = makePluginWithNote();
    await plugin.loadSettings();
    await plugin.onload();

    // Force modalBehavior=never for automation
    (plugin as any).settings.modalBehavior = 'never';

    // Bypass LinkFormatter internals to avoid resource lookups in tests
    (plugin as any).linkFormatter = { formatLink: vi.fn(async () => '![](/mock)') };

    // Stub processor to avoid heavy image work
    (plugin as any).imageProcessor = { processImage: vi.fn(async () => new ArrayBuffer(16)) } as any;
    (plugin as any).showSizeComparisonNotification = vi.fn();

    // Unique destination/newFilename per file
    const destinations: Array<{ destinationPath: string; newFilename: string }> = [
      { destinationPath: 'images', newFilename: 'a.webp' },
      { destinationPath: 'images', newFilename: 'b.webp' },
      { destinationPath: 'images', newFilename: 'c.webp' }
    ];
    const detSpy = vi.spyOn((plugin as any).folderAndFilenameManagement, 'determineDestination').mockImplementation(async () => destinations.shift()!);

    const editor = {
      posAtMouse: () => ({ line: 0, ch: 0 }),
      replaceRange: vi.fn(),
      setCursor: vi.fn()
    } as any;

    const files = [
      { name: 'a.png', type: 'image/png', file: makeFile('a.png', 'image/png') },
      { name: 'b.jpg', type: 'image/jpeg', file: makeFile('b.jpg', 'image/jpeg') },
      { name: 'c.webp', type: 'image/webp', file: makeFile('c.webp', 'image/webp') }
    ];

    // Call private handler directly
    await (plugin as any).handleDrop(files, editor, new Event('drop') as any, { line: 0, ch: 0 });

    // Assert: one createBinary and one replaceRange per file
    expect((app.vault.createBinary as any).mock.calls.length).toBe(3);
    expect((editor.replaceRange as any).mock.calls.length).toBe(3);
    expect(detSpy).toHaveBeenCalledTimes(3);
  });

  it('Given rapid successive pastes, When handled, Then processes all without crash and accumulates creates', async () => {
    const { app, plugin } = makePluginWithNote();
    await plugin.loadSettings();
    await plugin.onload();
    (plugin as any).settings.modalBehavior = 'never';
    (plugin as any).imageProcessor = { processImage: vi.fn(async () => new ArrayBuffer(8)) } as any;
    (plugin as any).showSizeComparisonNotification = vi.fn();
    (plugin as any).linkFormatter = { formatLink: vi.fn(async () => '![](/mock)') };

    // Determine unique targets
    const detSpy = vi.spyOn((plugin as any).folderAndFilenameManagement, 'determineDestination').mockImplementationOnce(async () => ({ destinationPath: 'images', newFilename: 'p1.webp' }))
      .mockImplementationOnce(async () => ({ destinationPath: 'images', newFilename: 'p2.webp' }))
      .mockImplementationOnce(async () => ({ destinationPath: 'images', newFilename: 'p3.webp' }))
      .mockImplementationOnce(async () => ({ destinationPath: 'images', newFilename: 'p4.webp' }));

    const editor = {
      getCursor: () => ({ line: 0, ch: 0 }),
      replaceRange: vi.fn(),
      setCursor: vi.fn()
    } as any;

    const pasteBatch = (names: string[]) => names.map((filename) => ({ kind: 'file', type: filename.endsWith('.png') ? 'image/png' : 'image/jpeg', file: makeFile(filename, filename.endsWith('.png') ? 'image/png' : 'image/jpeg') }));

    await (plugin as any).handlePaste(pasteBatch(['p1.png', 'p2.jpg']), editor, { line: 0, ch: 0 });
    await (plugin as any).handlePaste(pasteBatch(['p3.jpg', 'p4.png']), editor, { line: 0, ch: 0 });

    expect((app.vault.createBinary as any).mock.calls.length).toBeGreaterThanOrEqual(4);
    expect((editor.replaceRange as any).mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(detSpy).toHaveBeenCalledTimes(4);
  });
});
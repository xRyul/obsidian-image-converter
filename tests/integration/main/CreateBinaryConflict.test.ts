import { describe, it, expect, vi } from 'vitest';
import ImageConverterPlugin from '../../../src/main';
import { fakeApp, fakeVault, fakeTFile, fakePluginManifest } from '../../factories/obsidian';

function setup() {
  const note = fakeTFile({ path: 'Notes/n.md', name: 'n.md', extension: 'md' });
  const vault = fakeVault({ files: [note] }) as any;
  const app = fakeApp({ vault, metadataCache: { resolvedLinks: { [note.path]: {} } as any } }) as any;
  (app.workspace.getActiveFile as any) = vi.fn(() => note);

  const plugin = new ImageConverterPlugin(app as any, fakePluginManifest({ id: 'image-converter' }));
  vi.spyOn(plugin as any, 'loadData').mockResolvedValue(undefined);
  return { app, note, plugin };
}

function makeFile(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

describe('CreateBinary conflict handling during paste (Phase 9: 27.2 partial)', () => {
  it('Given conflict on createBinary (File already exists), When pasting two files, Then one is inserted and the conflicting one is skipped with error handling', async () => {
    const { app, plugin } = setup();
    await plugin.loadSettings();
    await plugin.onload();

    (plugin as any).settings.modalBehavior = 'never';
    (plugin as any).imageProcessor = { processImage: vi.fn(async () => new ArrayBuffer(8)) } as any;
    (plugin as any).showSizeComparisonNotification = vi.fn();
    (plugin as any).linkFormatter = { formatLink: vi.fn(async () => '![](/mock)') };

    // First paste target will throw, second will succeed
    const detSpy = vi.spyOn((plugin as any).folderAndFilenameManagement, 'determineDestination')
      .mockImplementationOnce(async () => ({ destinationPath: 'images', newFilename: 'conflict.webp' }))
      .mockImplementationOnce(async () => ({ destinationPath: 'images', newFilename: 'ok.webp' }));

    // Throw on first createBinary
    (app.vault.createBinary as any)
      .mockImplementationOnce(async () => { throw new Error('File already exists'); })
      .mockImplementationOnce(async (pathStr: string, _data: ArrayBuffer) => {
        const file = fakeTFile({ path: pathStr });
        return file as any;
      });

    const editor = { getCursor: () => ({ line: 0, ch: 0 }), replaceRange: vi.fn(), setCursor: vi.fn() } as any;

    const items = [
      { kind: 'file', type: 'image/png', file: makeFile('a.png', 'image/png') },
      { kind: 'file', type: 'image/jpeg', file: makeFile('b.jpg', 'image/jpeg') }
    ];

    await (plugin as any).handlePaste(items, editor, { line: 0, ch: 0 });

    // One failure + one success
    expect((app.vault.createBinary as any).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect((editor.replaceRange as any).mock.calls.length).toBe(1);
    expect(detSpy).toHaveBeenCalledTimes(2);
  });
});
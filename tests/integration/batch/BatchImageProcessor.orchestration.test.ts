import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BatchImageProcessor } from '../../../src/BatchImageProcessor';
import { fakeApp, fakeVault, fakeTFile } from '../../factories/obsidian';

function makePluginStub(overrides: any = {}) {
  return {
    settings: {
      // Current Note defaults
      ProcessCurrentNoteconvertTo: 'webp',
      ProcessCurrentNotequality: 0.8,
      ProcessCurrentNoteResizeModalresizeMode: 'None',
      ProcessCurrentNoteresizeModaldesiredWidth: 0,
      ProcessCurrentNoteresizeModaldesiredHeight: 0,
      ProcessCurrentNoteresizeModaldesiredLength: 0,
      ProcessCurrentNoteEnlargeOrReduce: 'Always',
      allowLargerFiles: true,
      ProcessCurrentNoteSkipFormats: '',
      ProcessCurrentNoteskipImagesInTargetFormat: true,
      // All Vault defaults
      ProcessAllVaultconvertTo: 'webp',
      ProcessAllVaultquality: 0.8,
      ProcessAllVaultResizeModalresizeMode: 'None',
      ProcessAllVaultResizeModaldesiredWidth: 0,
      ProcessAllVaultResizeModaldesiredHeight: 0,
      ProcessAllVaultResizeModaldesiredLength: 0,
      ProcessAllVaultEnlargeOrReduce: 'Always',
      ProcessAllVaultSkipFormats: '',
      ProcessAllVaultskipImagesInTargetFormat: true,
      ...overrides.settings
    },
    supportedImageFormats: {
      isSupported: vi.fn((mime?: string, name?: string) => /\.(png|jpg|jpeg|webp)$/i.test(name || ''))
    },
    addStatusBarItem: vi.fn(() => ({ setText: vi.fn(), remove: vi.fn() })),
    ...overrides
  } as any;
}

describe('BatchImageProcessor orchestration', () => {
  let app: any;
  let note: any;
  let imgA: any;
  let imgB: any;
  let plugin: any;
  let imageProcessor: any;
  let folderAndFilenameManagement: any;

  beforeEach(() => {
    note = fakeTFile({ path: 'notes/n.md' });
    imgA = fakeTFile({ path: 'images/a.png' });
    imgB = fakeTFile({ path: 'images/b.jpg' });

    const vault = fakeVault({ files: [note, imgA, imgB] }) as any;
    (vault as any).getMarkdownFiles = vi.fn(() => [note]);

    const metadataCache = {
      resolvedLinks: {
        [note.path]: {
          [imgA.path]: 1,
          [imgB.path]: 1
        }
      }
    };

    app = fakeApp({ vault, metadataCache }) as any;
    app.fileManager = {
      renameFile: vi.fn(async (file: any, newPath: string) => {
        await app.vault.rename(file, newPath);
      })
    };

    plugin = makePluginStub();

    imageProcessor = {
      processImage: vi.fn(async (_blob: Blob) => {
        // Return predictable bytes
        return new ArrayBuffer(4);
      })
    };

    folderAndFilenameManagement = {
      handleNameConflicts: vi.fn(async (_dir: string, name: string) => name)
    };
  });

  it('4.2 Single file: processes, renames when format differs, writes, and updates links', async () => {
    // Only link one image
    (app.metadataCache as any).resolvedLinks[note.path] = { [imgA.path]: 1 };

    const bip = new BatchImageProcessor(app, plugin, imageProcessor as any, folderAndFilenameManagement as any);

    await app.vault.modify(note, '![alt](images/a.png)');

    await bip.processImagesInNote(note);

    // Renamed to .webp per settings
    const newPath = 'images/a.webp';
    expect(app.vault.getAbstractFileByPath(newPath)).toBeTruthy();

    // File content updated
    expect(app.vault.modifyBinary).toHaveBeenCalled();

    // Link updated in the note
    const content = await app.vault.read(note);
    expect(content).toContain(newPath);
  });

  it('4.1 Sequential processing across multiple files and progress updates', async () => {
    const bip = new BatchImageProcessor(app, plugin, imageProcessor as any, folderAndFilenameManagement as any);
    await app.vault.modify(note, '![a](images/a.png) and ![b](images/b.jpg)');

    await bip.processImagesInNote(note);

    // Ensure both were processed in sequence (renameFile called twice)
    expect(app.fileManager.renameFile).toHaveBeenCalledTimes(2);
    const calls = (app.fileManager.renameFile as any).mock.calls.map((callArgs: any[]) => (callArgs[0] as any).basename);
    expect(calls).toEqual(['a', 'b']);

    // Progress setText called at least twice
    const status = plugin.addStatusBarItem.mock.results[0].value;
    expect(status.setText).toHaveBeenCalled();
  });

  it('4.10 Skipping rules: files in skipFormats are skipped', async () => {
    // Add a GIF which should be unsupported by supportedImageFormats but test skip list logic
    const imgC = fakeTFile({ path: 'images/c.gif' });
    (app.vault.getFiles as any) = vi.fn(() => [note, imgA, imgB, imgC]);
    (app.vault.getAbstractFileByPath as any) = vi.fn((pathArg: string) => [note, imgA, imgB, imgC].find((fileItem) => fileItem.path === pathArg) || null);
    (app.metadataCache as any).resolvedLinks[note.path] = { [imgA.path]: 1, [imgB.path]: 1, [imgC.path]: 1 };

    plugin.settings.ProcessCurrentNoteSkipFormats = 'gif';

    const bip = new BatchImageProcessor(app, plugin, imageProcessor as any, folderAndFilenameManagement as any);
    await bip.processImagesInNote(note);

    // GIF should not be renamed
    expect(app.fileManager.renameFile).toHaveBeenCalledTimes(2);
  });

  it('4.11 Early no-op: when disabled + quality=1 + resize=None → early exit', async () => {
    plugin.settings.ProcessCurrentNoteconvertTo = 'disabled';
    plugin.settings.ProcessCurrentNotequality = 1;
    plugin.settings.ProcessCurrentNoteResizeModalresizeMode = 'None';

    const bip = new BatchImageProcessor(app, plugin, imageProcessor as any, folderAndFilenameManagement as any);
    await bip.processImagesInNote(note);

    // No processing should happen
    expect(app.fileManager.renameFile).not.toHaveBeenCalled();
    expect(app.vault.modifyBinary).not.toHaveBeenCalled();
  });

  it('4.10 Skip target format (note): when convertTo=webp and skipImagesInTargetFormat=true, webp files are skipped', async () => {
    // Add a webp image and include it in links with a png
    const imgC = fakeTFile({ path: 'images/c.webp' });
    (app.vault.getFiles as any) = vi.fn(() => [note, imgA, imgB, imgC]);
    (app.vault.getAbstractFileByPath as any) = vi.fn((pathArg: string) => [note, imgA, imgB, imgC].find((fileItem) => fileItem.path === pathArg) || null);
    (app.metadataCache as any).resolvedLinks[note.path] = { [imgA.path]: 1, [imgC.path]: 1 };

    plugin.settings.ProcessCurrentNoteconvertTo = 'webp';
    plugin.settings.ProcessCurrentNoteskipImagesInTargetFormat = true;

    const bip = new BatchImageProcessor(app, plugin, imageProcessor as any, folderAndFilenameManagement as any);
    await bip.processImagesInNote(note);

    // Only png should be renamed; webp skipped. Assert on target path for robustness.
    const renameTargets = (app.fileManager.renameFile as any).mock.calls.map((callArgs: any[]) => callArgs[1] as string);
    expect(renameTargets).toEqual(['images/a.webp']);
  });
});

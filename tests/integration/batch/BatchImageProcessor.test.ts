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

// Suite: Orchestration behaviors
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

// Suite: Progress, scope, and error behaviors
describe('BatchImageProcessor — Progress, scope, and error behaviors', () => {
  let app: any;
  let note1: any;
  let note2: any;
  let imgA: any;
  let imgB: any;
  let plugin: any;
  let imageProcessor: any;
  let folderAndFilenameManagement: any;

  beforeEach(() => {
    // Arrange common vault
    note1 = fakeTFile({ path: 'notes/n1.md' });
    note2 = fakeTFile({ path: 'notes/n2.md' });
    imgA = fakeTFile({ path: 'images/a.png' });
    imgB = fakeTFile({ path: 'images/b.jpg' });

    const vault = fakeVault({ files: [note1, note2, imgA, imgB] }) as any;
    (vault as any).getMarkdownFiles = vi.fn(() => [note1, note2]);

    const metadataCache = {
      resolvedLinks: {
        [note1.path]: { [imgA.path]: 1, [imgB.path]: 1 },
        [note2.path]: { [imgA.path]: 1 }
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
      processImage: vi.fn(async (_blob: Blob) => new ArrayBuffer(4))
    };

    folderAndFilenameManagement = {
      handleNameConflicts: vi.fn(async (_dir: string, name: string) => name)
    };
  });

  it('4.3 Given multiple files, When processing runs, Then progress shows "Processing image X of N"', async () => {
    // Arrange
    const bip = new BatchImageProcessor(app, plugin, imageProcessor as any, folderAndFilenameManagement as any);
    await app.vault.modify(note1, '![a](images/a.png) and ![b](images/b.jpg)');
    vi.useFakeTimers();

    // Act
    await bip.processImagesInNote(note1);

    // Assert
    const status = plugin.addStatusBarItem.mock.results[0].value;
    const calls = (status.setText as any).mock.calls.map((callArgs: any[]) => callArgs[0] as string);
    expect(calls.some((text: string) => /Processing image \d+ of 2/.test(text))).toBe(true);

    // Cleanup remove after timeout
    vi.advanceTimersByTime(5000);
    expect(status.remove).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('4.6 Given two notes link an image, When processing current note, Then only that note\'s links are updated', async () => {
    // Arrange
    const bip = new BatchImageProcessor(app, plugin, imageProcessor as any, folderAndFilenameManagement as any);
    await app.vault.modify(note1, '![a](images/a.png)');
    await app.vault.modify(note2, '![a](images/a.png)');

    // Act
    await bip.processImagesInNote(note1);

    // Assert (note1 updated to .webp)
    const content1 = await app.vault.read(note1);
    expect(content1).toContain('images/a.webp');
    // note2 untouched
    const content2 = await app.vault.read(note2);
    expect(content2).toBe('![a](images/a.png)');
  });

  it('4.8 Given a run, When completed, Then status item removed after delay', async () => {
    const bip = new BatchImageProcessor(app, plugin, imageProcessor as any, folderAndFilenameManagement as any);
    await app.vault.modify(note1, '![a](images/a.png)');

    vi.useFakeTimers();
    await bip.processImagesInNote(note1);

    const status = plugin.addStatusBarItem.mock.results[0].value;
    expect(status.setText).toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(status.remove).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('4.8 Completion summary: shows "Finished processing X images, total time: Y seconds"', async () => {
    const bip = new BatchImageProcessor(app, plugin, imageProcessor as any, folderAndFilenameManagement as any);
    await app.vault.modify(note1, '![a](images/a.png) and ![b](images/b.jpg)');

    await bip.processImagesInNote(note1);

    const status = plugin.addStatusBarItem.mock.results[0].value;
    const calls = (status.setText as any).mock.calls.map((callArgs: any[]) => callArgs[0] as string);
    expect(calls.some((text: string) => text.startsWith('Finished processing ') && text.includes(' images, total time: '))).toBe(true);
  });

  it('4.9 Given renamed file cannot be retrieved, When continuing, Then skip that file and continue others', async () => {
    // Arrange: force getAbstractFileByPath to return null for newPath once
    const originalGet = app.vault.getAbstractFileByPath as any;
    let failedOnce = false;
    (app.vault.getAbstractFileByPath as any) = vi.fn((path: string) => {
      if (/\.webp$/i.test(path) && !failedOnce) {
        failedOnce = true;
        return null; // simulate a single failure retrieving the first renamed file
      }
      return originalGet(path);
    });

    const bip = new BatchImageProcessor(app, plugin, imageProcessor as any, folderAndFilenameManagement as any);
    await app.vault.modify(note1, '![a](images/a.png) and ![b](images/b.jpg)');

    // Act
    await bip.processImagesInNote(note1);

    // Assert: rename attempted twice, modifyBinary only for the second image
    expect(app.fileManager.renameFile).toHaveBeenCalledTimes(2);
    expect(app.vault.modifyBinary).toHaveBeenCalledTimes(1);
  });

  it('4.9 Given per-file exception, When thrown, Then outer catch aborts the run and shows Notice (no further processing)', async () => {
    // Arrange: throw on first processImage
    imageProcessor.processImage.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const bip = new BatchImageProcessor(app, plugin, imageProcessor as any, folderAndFilenameManagement as any);
    await app.vault.modify(note1, '![a](images/a.png) and ![b](images/b.jpg)');

    // Act
    await bip.processImagesInNote(note1);

    // Assert: no renames performed, run aborted early
    expect(app.fileManager.renameFile).not.toHaveBeenCalled();
  });
});

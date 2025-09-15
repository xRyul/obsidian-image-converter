import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BatchImageProcessor } from '../../../src/BatchImageProcessor';
import { fakeApp, fakeVault, fakeTFile, fakeTFolder } from '../../factories/obsidian';

function makePluginStub(overrides: any = {}) {
  return {
    settings: {
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
      ...overrides.settings
    },
    supportedImageFormats: {
      isSupported: vi.fn((_mime?: string, name?: string) => /\.(png|jpg|jpeg|webp)$/i.test(name || ''))
    },
    addStatusBarItem: vi.fn(() => ({ setText: vi.fn(), remove: vi.fn() })),
    ...overrides
  } as any;
}

describe('BatchImageProcessor — Folder processing (recursive, skipFormats)', () => {
  let app: any;
  let plugin: any;
  let imageProcessor: any;
  let folderAndFilenameManagement: any;
  let folderA: any;
  let subA1: any;
  let note: any;
  let aPng: any; let aJpg: any; let aGif: any; let aWebp: any; let aPngSub: any;

  beforeEach(() => {
    // Folder structure: /images, /images/sub
    folderA = fakeTFolder({ path: 'images', name: 'images' });
    subA1 = fakeTFolder({ path: 'images/sub', name: 'sub', parent: folderA });

    aPng = fakeTFile({ path: 'images/a.png' });
    aJpg = fakeTFile({ path: 'images/b.jpg' });
    aGif = fakeTFile({ path: 'images/c.gif' }); // unsupported by supportedImageFormats fn
    aWebp = fakeTFile({ path: 'images/d.webp' });
    aPngSub = fakeTFile({ path: 'images/sub/e.png' });
    note = fakeTFile({ path: 'notes/n.md' });

    const files = [aPng, aJpg, aGif, aWebp, aPngSub, note];
    const folders = [folderA, subA1];

    // Wire children for stronger TFolder semantics (not strictly required after prefix scan change)
    (folderA as any).children = [aPng, aJpg, aGif, aWebp, subA1];
    (subA1 as any).children = [aPngSub];

    const vault = fakeVault({ files, folders }) as any;

    app = fakeApp({ vault, metadataCache: { resolvedLinks: {} } as any }) as any;
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

  it('4.4 Given processImagesInFolder, When skipFormats set, Then those extensions are skipped and links are not updated', async () => {
    // Arrange
    const bip = new BatchImageProcessor(app, plugin, imageProcessor as any, folderAndFilenameManagement as any);
    plugin.settings.ProcessCurrentNoteSkipFormats = 'webp,jpg';

    // Act
    await bip.processImagesInFolder('images', false);

    // Assert
    // webp and jpg skipped, png processed, gif not supported
    const renameCalls = (app.fileManager.renameFile as any).mock.calls.map((callArgs: any[]) => (callArgs[0] as any).basename);
    expect(renameCalls).toEqual(['a']); // Non-recursive: only images/a.png

    // Link updates should not occur in folder processing
    expect(app.vault.modify).not.toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/n.md' }), expect.any(String));
  });

  it('4.5 Given recursive flag, When true vs false, Then subfolder files are included only when true', async () => {
    // Build a fresh environment for non-recursive
    let fA = fakeTFolder({ path: 'images', name: 'images' });
    let fSub = fakeTFolder({ path: 'images/sub', name: 'sub', parent: fA });
    const files1 = [fakeTFile({ path: 'images/a.png' }), fakeTFile({ path: 'images/b.jpg' }), fakeTFile({ path: 'images/d.webp' }), fakeTFile({ path: 'images/sub/e.png' })];
    (fA as any).children = [files1[0], files1[1], files1[2], fSub];
    (fSub as any).children = [files1[3]];
    const vault1 = fakeVault({ files: [...files1], folders: [fA, fSub] }) as any;
    const app1 = fakeApp({ vault: vault1, metadataCache: { resolvedLinks: {} } as any }) as any;
    app1.fileManager = { renameFile: vi.fn(async (file: any, newPath: string) => { await app1.vault.rename(file, newPath); }) };
    const plugin1 = makePluginStub();
    const imageProcessor1 = { processImage: vi.fn(async (_blob: Blob) => new ArrayBuffer(4)) };
    const ffm1 = { handleNameConflicts: vi.fn(async (_dir: string, name: string) => name) };
    const bip1 = new BatchImageProcessor(app1, plugin1, imageProcessor1 as any, ffm1 as any);

    await bip1.processImagesInFolder('images', false);
    const nonRecursiveRenames = (app1.fileManager.renameFile as any).mock.calls.length;

    // Fresh environment for recursive
    fA = fakeTFolder({ path: 'images', name: 'images' });
    fSub = fakeTFolder({ path: 'images/sub', name: 'sub', parent: fA });
    const files2 = [fakeTFile({ path: 'images/a.png' }), fakeTFile({ path: 'images/b.jpg' }), fakeTFile({ path: 'images/d.webp' }), fakeTFile({ path: 'images/sub/e.png' })];
    (fA as any).children = [files2[0], files2[1], files2[2], fSub];
    (fSub as any).children = [files2[3]];
    const vault2 = fakeVault({ files: [...files2], folders: [fA, fSub] }) as any;
    const app2 = fakeApp({ vault: vault2, metadataCache: { resolvedLinks: {} } as any }) as any;
    app2.fileManager = { renameFile: vi.fn(async (file: any, newPath: string) => { await app2.vault.rename(file, newPath); }) };
    const plugin2 = makePluginStub();
    const imageProcessor2 = { processImage: vi.fn(async (_blob: Blob) => new ArrayBuffer(4)) };
    const ffm2 = { handleNameConflicts: vi.fn(async (_dir: string, name: string) => name) };
    const bip2 = new BatchImageProcessor(app2, plugin2, imageProcessor2 as any, ffm2 as any);

    await bip2.processImagesInFolder('images', true);
    const recursiveRenames = (app2.fileManager.renameFile as any).mock.calls.length;

    expect(recursiveRenames).toBeGreaterThan(nonRecursiveRenames);
  });
});
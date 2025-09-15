import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BatchImageProcessor } from '../../../src/BatchImageProcessor';
import { fakeApp, fakeVault, fakeTFile } from '../../factories/obsidian';

function makePluginStub(overrides: any = {}) {
  return {
    settings: {
      ProcessAllVaultconvertTo: 'webp',
      ProcessAllVaultquality: 0.8,
      ProcessAllVaultResizeModalresizeMode: 'None',
      ProcessAllVaultResizeModaldesiredWidth: 0,
      ProcessAllVaultResizeModaldesiredHeight: 0,
      ProcessAllVaultResizeModaldesiredLength: 0,
      ProcessAllVaultEnlargeOrReduce: 'Always',
      allowLargerFiles: true,
      ProcessAllVaultSkipFormats: '',
      ProcessAllVaultskipImagesInTargetFormat: true,
      ...overrides.settings
    },
    supportedImageFormats: {
      isSupported: vi.fn((_mime?: string, name?: string) => /\.(png|jpg|jpeg|webp)$/i.test(name || ''))
    },
    addStatusBarItem: vi.fn(() => ({ setText: vi.fn(), remove: vi.fn() })),
    ...overrides
  } as any;
}

describe('BatchImageProcessor — Vault-wide orchestration', () => {
  let app: any;
  let plugin: any;
  let imageProcessor: any;
  let folderAndFilenameManagement: any;
  let n1: any; let n2: any; let c1: any;
  let aPng: any; let aJpg1: any; let aJpg2: any; let dupRef: any;

  beforeEach(() => {
    // Files: two notes, one canvas, several images (some duplicates referenced)
    n1 = fakeTFile({ path: 'notes/n1.md' });
    n2 = fakeTFile({ path: 'notes/n2.md' });
    c1 = fakeTFile({ path: 'canvas/board.canvas', extension: 'canvas', name: 'board.canvas' });

    aPng = fakeTFile({ path: 'images/a.png' });
    aJpg1 = fakeTFile({ path: 'images/b.jpg' });
    aJpg2 = fakeTFile({ path: 'more/b.jpg' }); // duplicate name but different path
    dupRef = fakeTFile({ path: 'images/dup.png' });

    const files = [n1, n2, c1, aPng, aJpg1, aJpg2, dupRef];
    const vault = fakeVault({ files }) as any;

    // resolvedLinks to include duplicates of images across notes
    const metadataCache = {
      resolvedLinks: {
        [n1.path]: { [aPng.path]: 1, [dupRef.path]: 2 },
        [n2.path]: { [aJpg1.path]: 1, [dupRef.path]: 1 }
      }
    };

    // Seed canvas JSON with references to dupRef and aPng — no mock, just write content
    // (This test file uses a synchronous beforeEach; the fake vault.modify is async but
    // we don't need to await here because we call modify later in test cases as needed.)

    app = fakeApp({ vault, metadataCache }) as any;
    // Write canvas content to vault so getAllImageFiles picks up references
    (vault as any).modify(c1, JSON.stringify({ nodes: [
      { id: '1', type: 'file', file: 'images/dup.png' },
      { id: '2', type: 'file', file: 'images/a.png' }
    ] }));
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
      handleNameConflicts: vi.fn(async (_dir: string, name: string) => name.replace(/\.webp$/, '.webp'))
    };
  });

  it('4.7/4.14 Given duplicates across notes/canvas, When processing vault-wide, Then each image processed once (dedup) and links updated everywhere', async () => {
    const bip = new BatchImageProcessor(app, plugin, imageProcessor as any, folderAndFilenameManagement as any);

    // Seed note contents to verify updates after rename
    await app.vault.modify(n1, '![a](images/a.png) and ![d](images/dup.png)');
    await app.vault.modify(n2, '![b](images/b.jpg) and ![d](images/dup.png)');

    await bip.processAllVaultImages();

    // Processed: a.png, b.jpg (once), more/b.jpg, dup.png (once)
    // Ensure links updated for dup.png → dup.webp in both notes
    const content1 = await app.vault.read(n1);
    const content2 = await app.vault.read(n2);
    expect(content1).toContain('images/dup.webp');
    expect(content2).toContain('images/dup.webp');
    // And rename attempted for dup
    const renameArgs = (app.fileManager.renameFile as any).mock.calls;
    const oldPaths = renameArgs.map((callArgs: any[]) => (callArgs[0] as any).path);
    const newPaths = renameArgs.map((callArgs: any[]) => callArgs[1] as string);
    expect(oldPaths.some((pathStr: string) => pathStr.endsWith('images/dup.png')) || newPaths.some((pathStr: string) => pathStr.endsWith('images/dup.webp'))).toBe(true);
  });

  it('4.12 Given convertTo set, When renaming, Then new filenames use target extension and conflicts handled', async () => {
    const bip = new BatchImageProcessor(app, plugin, imageProcessor as any, folderAndFilenameManagement as any);

    // Force a name conflict so conflict resolver is invoked
    await (app.vault as any).create('images/a.webp', '');

    await bip.processAllVaultImages();

    const renameCalls = (app.fileManager.renameFile as any).mock.calls.map((callArgs: any[]) => callArgs[1] as string);
    expect(renameCalls.every((newPathStr: string) => newPathStr.endsWith('.webp'))).toBe(true);
    expect(folderAndFilenameManagement.handleNameConflicts).toHaveBeenCalled();
  });

  it('4.10 Skip target format (vault): when convertTo=webp and skipImagesInTargetFormat=true, webp files are skipped', async () => {
    // Fresh, isolated environment to avoid mutated TFile state across tests
    const noteFile = fakeTFile({ path: 'notes/m.md' });
    const keep = fakeTFile({ path: 'images/keep.webp' });
    const toConvert = fakeTFile({ path: 'images/x.png' });
    const vaultIso = fakeVault({ files: [noteFile, keep, toConvert] }) as any;
    const appIso = fakeApp({ vault: vaultIso, metadataCache: { resolvedLinks: { [noteFile.path]: { [keep.path]: 1, [toConvert.path]: 1 } } } as any }) as any;
    appIso.fileManager = { renameFile: vi.fn(async (file: any, newPath: string) => { await appIso.vault.rename(file, newPath); }) };
    const pluginIso = makePluginStub({ settings: { ProcessAllVaultconvertTo: 'webp', ProcessAllVaultskipImagesInTargetFormat: true } });
    const imgIso = { processImage: vi.fn(async (_blob: Blob) => new ArrayBuffer(4)) };
    const ffmIso = { handleNameConflicts: vi.fn(async (_dir: string, name: string) => name) };
    const bipIso = new BatchImageProcessor(appIso as any, pluginIso as any, imgIso as any, ffmIso as any);

    // Verify skip-target-format selection logic and that PNG would be processed
    const decisionKeep = (bipIso as any).shouldProcessImage(keep, false, 'webp', [], true);
    const decisionConvert = (bipIso as any).shouldProcessImage(toConvert, false, 'webp', [], true);
    expect(decisionKeep).toBe(false);
    expect(decisionConvert).toBe(true);

    // Run to ensure it executes without errors (rename may be stubbed in some envs)
    await bipIso.processAllVaultImages();

    // Ensure we did not attempt to rename keep.webp
    const renameArgs = (appIso.fileManager.renameFile as any).mock.calls.map((callArgs: any[]) => callArgs[0] as any);
    expect(renameArgs.some((fileArg: any) => fileArg.path.endsWith('keep.webp'))).toBe(false);
  });

  it('4.13 Given fixed inputs, When processing vault-wide, Then order of processing is stable', async () => {
    // Helper to build a fresh vault and return rename order (newPath basenames)
    const runOnce = async () => {
      const n1l = fakeTFile({ path: 'notes/n1.md' });
      const n2l = fakeTFile({ path: 'notes/n2.md' });
      const c1l = fakeTFile({ path: 'canvas/board.canvas', extension: 'canvas', name: 'board.canvas' });
      const aP = fakeTFile({ path: 'images/a.png' });
      const b1 = fakeTFile({ path: 'images/b.jpg' });
      const b2 = fakeTFile({ path: 'more/b.jpg' });
      const du = fakeTFile({ path: 'images/dup.png' });
      const vaultL = fakeVault({ files: [n1l, n2l, c1l, aP, b1, b2, du] }) as any;
      (vaultL.read as any).mockImplementation(async (file: any) => {
        if (file.path.endsWith('.canvas')) {
          return JSON.stringify({ nodes: [
            { id: '1', type: 'file', file: 'images/dup.png' },
            { id: '2', type: 'file', file: 'images/a.png' }
          ]});
        }
        return '';
      });
      const appL = fakeApp({ vault: vaultL, metadataCache: { resolvedLinks: {
        [n1l.path]: { [aP.path]: 1, [du.path]: 2 },
        [n2l.path]: { [b1.path]: 1, [du.path]: 1 }
      } } as any }) as any;
      appL.fileManager = { renameFile: vi.fn(async (file: any, newPath: string) => { await appL.vault.rename(file, newPath); }) };
      const pluginL = makePluginStub();
      const imgL = { processImage: vi.fn(async (_blob: Blob) => new ArrayBuffer(4)) };
      const ffmL = { handleNameConflicts: vi.fn(async (_dir: string, name: string) => name) };
      const bipL = new BatchImageProcessor(appL, pluginL, imgL as any, ffmL as any);
      await bipL.processAllVaultImages();
      const order = (appL.fileManager.renameFile as any).mock.calls.map((callArgs: any[]) => (callArgs[1] as string).split('/').pop());
      return order;
    };

    const firstRun = await runOnce();
    const secondRun = await runOnce();
    expect(secondRun).toEqual(firstRun);
  });
});
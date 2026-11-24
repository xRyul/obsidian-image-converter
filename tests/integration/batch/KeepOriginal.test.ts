/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Notice } from 'obsidian';
import { BatchImageProcessor } from '../../../src/BatchImageProcessor';
import { fakeApp, fakeVault, fakeTFile, fakeTFolder } from '../../factories/obsidian';
import { makeImageBytesOfSize } from '../../factories/image';

const ORIGINAL_SIZE = 100;
const NOTE_TEXT = '![a](images/a.png) and ![b](images/b.jpg)';

function makePluginStub(options: { preset?: any; settings?: any } = {}) {
  return {
    settings: {
      // Current note and folder
      ProcessCurrentNoteconvertTo: 'webp',
      ProcessCurrentNotequality: 0.8,
      ProcessCurrentNoteResizeModalresizeMode: 'None',
      ProcessCurrentNoteresizeModaldesiredWidth: 0,
      ProcessCurrentNoteresizeModaldesiredHeight: 0,
      ProcessCurrentNoteresizeModaldesiredLength: 0,
      ProcessCurrentNoteEnlargeOrReduce: 'Always',
      ProcessCurrentNoteSkipFormats: '',
      ProcessCurrentNoteskipImagesInTargetFormat: true,
      // All vault
      ProcessAllVaultconvertTo: 'webp',
      ProcessAllVaultquality: 0.8,
      ProcessAllVaultResizeModalresizeMode: 'None',
      ProcessAllVaultResizeModaldesiredWidth: 0,
      ProcessAllVaultResizeModaldesiredHeight: 0,
      ProcessAllVaultResizeModaldesiredLength: 0,
      ProcessAllVaultEnlargeOrReduce: 'Always',
      ProcessAllVaultSkipFormats: '',
      ProcessAllVaultskipImagesInTargetFormat: true,
      allowLargerFiles: true,
      // "Revert to original if larger" is a value of the conversion preset.
      // The plugin-wide value is for presets saved before they had it.
      revertToOriginalIfLarger: false,
      minimumCompressionSavingsInKB: 30,
      selectedConversionPreset: 'Selected',
      conversionPresets: [
        { name: 'Not selected', revertToOriginalIfLarger: true, minimumCompressionSavingsInKB: 0 },
        { name: 'Selected', revertToOriginalIfLarger: false, minimumCompressionSavingsInKB: 0, ...options.preset },
      ],
      ...options.settings
    },
    supportedImageFormats: {
      isSupported: vi.fn((_mime?: string, name?: string) => /\.(png|jpg|jpeg|webp)$/i.test(name || ''))
    },
    addStatusBarItem: vi.fn(() => ({ setText: vi.fn(), remove: vi.fn() })),
  } as any;
}

// Issue #347 and issue #456: a batch command must not overwrite an image with
// a file that is larger, or with bytes that are not in the requested format.
describe('BatchImageProcessor — the original image is kept', () => {
  let app: any;
  let note: any;
  let plugin: any;
  let binaryContents: Map<string, ArrayBuffer>;
  let folderAndFilenameManagement: any;

  const commands = {
    note: (bip: BatchImageProcessor) => bip.processImagesInNote(note),
    folder: (bip: BatchImageProcessor) => bip.processImagesInFolder('images', false),
    linkedInFolder: (bip: BatchImageProcessor) => bip.processLinkedImagesInFolder('images', false),
    vault: (bip: BatchImageProcessor) => bip.processAllVaultImages(),
  };
  const commandNames = Object.keys(commands) as (keyof typeof commands)[];

  /** A vault with a.png and b.jpg of 100 bytes each, and a note that links both. */
  function setup(options: { preset?: any; settings?: any } = {}) {
    const folder = fakeTFolder({ path: 'images', name: 'images' });
    note = fakeTFile({ path: 'images/n.md' });
    const aPng = fakeTFile({ path: 'images/a.png' });
    const bJpg = fakeTFile({ path: 'images/b.jpg' });

    binaryContents = new Map<string, ArrayBuffer>([
      ['images/a.png', makeImageBytesOfSize('PNG', ORIGINAL_SIZE)],
      ['images/b.jpg', makeImageBytesOfSize('JPEG', ORIGINAL_SIZE)],
    ]);
    const fileContents = new Map<string, string>([[note.path, NOTE_TEXT]]);

    const vault = fakeVault({ files: [note, aPng, bJpg], folders: [folder], binaryContents, fileContents }) as any;
    const metadataCache = { resolvedLinks: { [note.path]: { [aPng.path]: 1, [bJpg.path]: 1 } } };
    app = fakeApp({ vault, metadataCache }) as any;
    app.fileManager = {
      renameFile: vi.fn(async (file: any, newPath: string) => {
        await app.vault.rename(file, newPath);
      })
    };

    plugin = makePluginStub(options);
    folderAndFilenameManagement = {
      handleNameConflicts: vi.fn(async (_dir: string, name: string) => name)
    };
  }

  /** A converter that gives an image in the requested format, of one size for a.png and one for b.jpg. */
  function converterGiving(sizes: { png: number; jpg: number }) {
    return {
      processImage: vi.fn(async (blob: Blob, format: string) =>
        makeImageBytesOfSize(format, blob.type === 'image/png' ? sizes.png : sizes.jpg))
    };
  }

  async function run(command: keyof typeof commands, imageProcessor: any) {
    const bip = new BatchImageProcessor(app, plugin, imageProcessor, folderAndFilenameManagement);
    await commands[command](bip);
  }

  const noticeMessages = (): string[] => ((Notice as any).instances as { message: string }[]).map((notice) => notice.message);

  beforeEach(() => {
    ((Notice as any).instances as unknown[]).length = 0;
  });

  it.each(commandNames)('Given "Revert to original if larger" in the selected preset, When "%s" converts an image to a larger file, Then that image is left as it is', async (command) => {
    setup({ preset: { revertToOriginalIfLarger: true } });

    // a.png becomes larger (200 bytes). b.jpg becomes smaller (20 bytes).
    await run(command, converterGiving({ png: 200, jpg: 20 }));

    expect(app.vault.getAbstractFileByPath('images/a.png')).toBeTruthy();
    expect(app.vault.getAbstractFileByPath('images/a.webp')).toBeNull();
    expect(binaryContents.get('images/a.png')?.byteLength).toBe(ORIGINAL_SIZE);
    expect(binaryContents.get('images/b.webp')?.byteLength).toBe(20);
    expect(await app.vault.read(note)).toContain('images/a.png');
    expect(noticeMessages()).toEqual(expect.arrayContaining([
      expect.stringMatching(/^1 image left unchanged: the converted file was larger\.$/),
    ]));
  });

  it.each(commandNames)('Given a minimum saving of 30 KB in the selected preset, When "%s" saves less on every image, Then no image is changed', async (command) => {
    setup({ preset: { revertToOriginalIfLarger: true, minimumCompressionSavingsInKB: 30 } });

    await run(command, converterGiving({ png: 20, jpg: 20 }));

    expect(app.fileManager.renameFile).not.toHaveBeenCalled();
    expect(app.vault.modifyBinary).not.toHaveBeenCalled();
    expect(await app.vault.read(note)).toBe(NOTE_TEXT);
    expect(noticeMessages()).toEqual(expect.arrayContaining([
      expect.stringMatching(/^2 images left unchanged: the conversion saved less than 30 KB\.$/),
    ]));
  });

  it.each(commandNames)('Given the selected preset has "Revert to original if larger" off, When "%s" converts an image to a larger file, Then the larger file is written', async (command) => {
    // The plugin-wide value is on. The value of the preset is the one that counts.
    setup({ preset: { revertToOriginalIfLarger: false }, settings: { revertToOriginalIfLarger: true } });

    await run(command, converterGiving({ png: 200, jpg: 20 }));

    expect(binaryContents.get('images/a.webp')?.byteLength).toBe(200);
    expect(binaryContents.get('images/b.webp')?.byteLength).toBe(20);
    expect(app.vault.getAbstractFileByPath('images/a.png')).toBeNull();
  });

  it.each(commandNames)('Given a converter that returns the original bytes for one image, When "%s" runs, Then that image keeps its name and its content', async (command) => {
    setup();
    // The image processor returns the original bytes when it cannot convert.
    const imageProcessor = {
      processImage: vi.fn(async (blob: Blob, format: string) =>
        (blob.type === 'image/png' ? blob.arrayBuffer() : makeImageBytesOfSize(format, 20)))
    };

    await run(command, imageProcessor);

    // a.png must not become a .webp file that holds PNG data.
    expect(app.vault.getAbstractFileByPath('images/a.png')).toBeTruthy();
    expect(app.vault.getAbstractFileByPath('images/a.webp')).toBeNull();
    expect(binaryContents.get('images/a.png')?.byteLength).toBe(ORIGINAL_SIZE);
    expect(app.vault.modifyBinary).toHaveBeenCalledTimes(1);
    expect(binaryContents.get('images/b.webp')?.byteLength).toBe(20);
    expect(await app.vault.read(note)).toContain('images/a.png');
    expect(noticeMessages()).toEqual(expect.arrayContaining([
      expect.stringMatching(/^1 image left unchanged: the conversion to WEBP did not work\.$/),
    ]));
  });

  it.each(commandNames)('Given "JPG" is selected in the window, When "%s" runs, Then the converter is asked for JPEG and the file is named .jpg', async (command) => {
    // The windows save "jpg". The image processor knows this format as JPEG only.
    setup({ settings: { ProcessCurrentNoteconvertTo: 'jpg', ProcessAllVaultconvertTo: 'jpg' } });
    const imageProcessor = converterGiving({ png: 20, jpg: 20 });

    await run(command, imageProcessor);

    const requestedFormats = (imageProcessor.processImage.mock.calls as unknown[][]).map((callArgs) => callArgs[1]);
    expect(requestedFormats.length).toBeGreaterThan(0);
    expect(new Set(requestedFormats)).toEqual(new Set(['JPEG']));

    const saved = new Uint8Array(binaryContents.get('images/a.jpg') ?? new ArrayBuffer(0));
    expect(Array.from(saved.slice(0, 3))).toEqual([0xff, 0xd8, 0xff]);
    expect(app.vault.getAbstractFileByPath('images/a.png')).toBeNull();
  });
});

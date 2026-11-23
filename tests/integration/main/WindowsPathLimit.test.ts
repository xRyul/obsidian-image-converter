/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unnecessary-type-assertion */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileSystemAdapter, Notice, Platform } from 'obsidian';
import ImageConverterPlugin from '../../../src/main';
import { fakeApp, fakePluginManifest, fakeTFile, fakeVault } from '../../factories/obsidian';

const WINDOWS_MAX_PATH = 260;
const VAULT_BASE_PATH = 'D:\\plugin-testing-vault';
const LONG_DESTINATION_PATH = '001-Meta/attachments/png/2026-08-04/ENERGISE - Projects - Report Library with upload download search sort and filtering functionality-v2';

function makeImageFile(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/webp' });
}

function getAbsoluteWindowsPath(
  destinationPath: string,
  filename: string,
  vaultBasePath = VAULT_BASE_PATH,
): string {
  return `${vaultBasePath}\\${destinationPath.replaceAll('/', '\\')}\\${filename}`;
}

function makeTargetWithAbsoluteLength(
  length: number,
  vaultBasePath = VAULT_BASE_PATH,
): { destinationPath: string; filename: string } {
  const destinationPath = 'images';
  const extension = '.webp';
  const prefix = `${vaultBasePath}\\${destinationPath}\\`;
  const basenameLength = length - prefix.length - extension.length;

  return {
    destinationPath,
    filename: `${'a'.repeat(basenameLength)}${extension}`,
  };
}

async function setup(
  destinationPath: string,
  newFilename: string,
  vaultBasePath = VAULT_BASE_PATH,
) {
  const note = fakeTFile({ path: 'Notes/n.md', name: 'n.md', extension: 'md' });
  const vault = fakeVault({ files: [note] }) as any;
  const app = fakeApp({ vault, metadataCache: { resolvedLinks: { [note.path]: {} } as any } }) as any;
  (app.workspace.getActiveFile as any) = vi.fn(() => note);

  const fileSystemAdapter = Object.assign(new FileSystemAdapter(), app.vault.adapter);
  (fileSystemAdapter as any).getBasePath = () => vaultBasePath;
  app.vault.adapter = fileSystemAdapter;

  const plugin = new ImageConverterPlugin(app as any, fakePluginManifest({ id: 'image-converter' }));
  vi.spyOn(plugin as any, 'loadData').mockResolvedValue(undefined);
  await plugin.loadSettings();
  await plugin.onload();

  (plugin as any).settings.modalBehavior = 'never';
  (plugin as any).settings.selectedConversionPreset = 'None';
  (plugin as any).settings.selectedFilenamePreset = 'Keep original name';
  (plugin as any).imageProcessor = { processImage: vi.fn(async (file: File) => file.arrayBuffer()) };
  (plugin as any).showSizeComparisonNotification = vi.fn();
  (plugin as any).linkFormatter = { formatLink: vi.fn(async () => '![](/mock)') };
  vi.spyOn((plugin as any).folderAndFilenameManagement, 'determineDestination').mockResolvedValue({
    destinationPath,
    newFilename,
  });

  (app.vault.createBinary as any).mockClear();
  (app.vault.createFolder as any).mockClear();

  const editor = {
    getCursor: vi.fn(() => ({ line: 0, ch: 0 })),
    replaceRange: vi.fn(),
    setCursor: vi.fn(),
  } as any;

  return { app, plugin, editor };
}

async function processImage(
  flow: 'drop' | 'paste',
  plugin: ImageConverterPlugin,
  editor: any,
  filename: string,
): Promise<void> {
  const file = makeImageFile(filename);

  if (flow === 'drop') {
    await (plugin as any).handleDrop(
      [{ name: filename, type: file.type, file }],
      editor,
      new Event('drop'),
      { line: 0, ch: 0 },
    );
    return;
  }

  await (plugin as any).handlePaste(
    [{ kind: 'file', type: file.type, file }],
    editor,
    { line: 0, ch: 0 },
  );
}

function getNoticeMessages(): string[] {
  return ((Notice as any).instances as Array<{ message: string }>).map((notice) => notice.message);
}

describe('Windows attachment path safety', () => {
  const originalIsWin = Platform.isWin;

  beforeEach(() => {
    Platform.isWin = true;
    ((Notice as any).instances as unknown[]).length = 0;
  });

  afterEach(() => {
    Platform.isWin = originalIsWin;
    ((Notice as any).instances as unknown[]).length = 0;
  });

  it.each([
    ['drop', 'ENERGISE - Projects - Report Library with upload download search sort and filtering functionality-v2-20260804094915055.webp'],
    ['paste', 'ENERGISE - Projects - Report Library with upload download search sort and filtering functionality-v2-202608040949624242.webp'],
  ] as const)('blocks the reported long Windows path during %s before mutating the vault', async (flow, filename) => {
    const absolutePath = getAbsoluteWindowsPath(LONG_DESTINATION_PATH, filename);
    const { app, plugin, editor } = await setup(LONG_DESTINATION_PATH, filename);

    await processImage(flow, plugin, editor, filename);

    expect(absolutePath.length).toBeGreaterThanOrEqual(WINDOWS_MAX_PATH);
    expect(app.vault.createFolder).not.toHaveBeenCalled();
    expect(app.vault.createBinary).not.toHaveBeenCalled();
    expect((plugin as any).imageProcessor.processImage).not.toHaveBeenCalled();
    expect(editor.replaceRange).not.toHaveBeenCalled();
    expect(getNoticeMessages()).toEqual(expect.arrayContaining([
      expect.stringMatching(/image not added.*too long.*windows/is),
    ]));
    expect(getNoticeMessages().join('\n')).toContain(absolutePath);
  });

  it('allows a Windows absolute path containing 259 characters', async () => {
    const { destinationPath, filename } = makeTargetWithAbsoluteLength(WINDOWS_MAX_PATH - 1);
    const { app, plugin, editor } = await setup(destinationPath, filename);

    expect(getAbsoluteWindowsPath(destinationPath, filename)).toHaveLength(WINDOWS_MAX_PATH - 1);

    await processImage('paste', plugin, editor, filename);

    expect(app.vault.createBinary).toHaveBeenCalledTimes(1);
    expect(editor.replaceRange).toHaveBeenCalledTimes(1);
  });

  it('blocks a Windows absolute path containing exactly 260 characters', async () => {
    const { destinationPath, filename } = makeTargetWithAbsoluteLength(WINDOWS_MAX_PATH);
    const { app, plugin, editor } = await setup(destinationPath, filename);

    expect(getAbsoluteWindowsPath(destinationPath, filename)).toHaveLength(WINDOWS_MAX_PATH);

    await processImage('paste', plugin, editor, filename);

    expect(app.vault.createFolder).not.toHaveBeenCalled();
    expect(app.vault.createBinary).not.toHaveBeenCalled();
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });

  it('measures a namespaced Windows adapter path using the conventional 260-character path', async () => {
    const { destinationPath, filename } = makeTargetWithAbsoluteLength(WINDOWS_MAX_PATH);
    const namespacedBasePath = `\\\\?\\${VAULT_BASE_PATH}`;
    const { app, plugin, editor } = await setup(destinationPath, filename, namespacedBasePath);

    await processImage('paste', plugin, editor, filename);

    const noticeText = getNoticeMessages().join('\n');
    expect(app.vault.createFolder).not.toHaveBeenCalled();
    expect(app.vault.createBinary).not.toHaveBeenCalled();
    expect(editor.replaceRange).not.toHaveBeenCalled();
    expect(noticeText).toContain(`${WINDOWS_MAX_PATH} characters`);
    expect(noticeText).toContain(getAbsoluteWindowsPath(destinationPath, filename));
    expect(noticeText).not.toContain('\\\\?\\');
  });

  it('allows a namespaced Windows adapter path whose conventional path is 259 characters', async () => {
    const { destinationPath, filename } = makeTargetWithAbsoluteLength(WINDOWS_MAX_PATH - 1);
    const namespacedBasePath = `\\\\?\\${VAULT_BASE_PATH}`;
    const { app, plugin, editor } = await setup(destinationPath, filename, namespacedBasePath);

    await processImage('paste', plugin, editor, filename);

    expect(app.vault.createBinary).toHaveBeenCalledTimes(1);
    expect(editor.replaceRange).toHaveBeenCalledTimes(1);
  });

  it('does not apply the Windows path limit on other platforms', async () => {
    Platform.isWin = false;
    const filename = 'ENERGISE - Projects - Report Library with upload download search sort and filtering functionality-v2-20260804094915055.webp';
    const { app, plugin, editor } = await setup(LONG_DESTINATION_PATH, filename);

    await processImage('paste', plugin, editor, filename);

    expect(app.vault.createBinary).toHaveBeenCalledTimes(1);
    expect(editor.replaceRange).toHaveBeenCalledTimes(1);
  });

  it('blocks the original image when its own extension makes the Windows path too long', async () => {
    // The converted name ends in .png and fits (259). The original is a .jpeg: one character more.
    const { destinationPath, filename } = makeTargetWithAbsoluteLength(WINDOWS_MAX_PATH);
    const convertedName = filename.replace(/\.webp$/, '.png');
    const { app, plugin, editor } = await setup(destinationPath, convertedName);
    const preset = (plugin as any).settings.conversionPresets.find((candidate: any) => candidate.name === 'None');
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.jpeg', { type: 'image/jpeg' });

    expect(getAbsoluteWindowsPath(destinationPath, convertedName)).toHaveLength(WINDOWS_MAX_PATH - 1);

    preset.revertToOriginalIfLarger = true;
    try {
      await (plugin as any).handlePaste([{ kind: 'file', type: file.type, file }], editor, { line: 0, ch: 0 });
    } finally {
      preset.revertToOriginalIfLarger = false;
    }

    expect((plugin as any).imageProcessor.processImage).toHaveBeenCalledTimes(1);
    expect(app.vault.createBinary).not.toHaveBeenCalled();
    expect(editor.replaceRange).not.toHaveBeenCalled();
    expect(getNoticeMessages()).toEqual(expect.arrayContaining([
      expect.stringMatching(/image not added.*too long.*windows/is),
    ]));
  });
});

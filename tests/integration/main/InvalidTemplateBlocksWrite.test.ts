import { describe, it, expect, vi } from 'vitest';
import ImageConverterPlugin from '../../../src/main';
import { fakeApp, fakeVault, fakeTFile, fakePluginManifest, fakeNotice } from '../../factories/obsidian';

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

/**
 * Phase 9: 27.4 / 23.4 — Input sanitization & template validation failure halts writes
 *
 * We simulate determineDestination throwing a validation error and assert no writes occur.
 */

describe('Invalid template validation halts writes (27.4 / 23.4)', () => {
  it('Given CUSTOM template invalid (grandparent required), When pasting, Then no createBinary call occurs', async () => {
    const { app, plugin } = setup();
    ;(globalThis as any).Notice = fakeNotice();

    await plugin.loadSettings();
    await plugin.onload();

    // Skip modal for automation
    (plugin as any).settings.modalBehavior = 'never';

    // Stub processImage to return bytes to reach destination logic
    (plugin as any).imageProcessor = { processImage: vi.fn(async () => new ArrayBuffer(8)) } as any;
    (plugin as any).linkFormatter = { formatLink: vi.fn(async () => '![](/mock)') };

    // Force determineDestination to throw validation error
    const detSpy = vi.spyOn((plugin as any).folderAndFilenameManagement, 'determineDestination')
      .mockRejectedValue(new Error('validation failed: {grandparentfolder} requires a real grandparent'));

    const editor = { getCursor: () => ({ line: 0, ch: 0 }), replaceRange: vi.fn(), setCursor: vi.fn() } as any;

    const items = [
      { kind: 'file', type: 'image/png', file: makeFile('x.png', 'image/png') }
    ];

    await (plugin as any).handlePaste(items, editor, { line: 0, ch: 0 });

    // Assert: no file was created and destination logic attempted once
    expect((app.vault.createBinary as any).mock.calls.length).toBe(0);
    expect(detSpy).toHaveBeenCalled();
  });
});
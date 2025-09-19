import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ImageConverterPlugin from '../../../src/main';
import { fakeApp, fakeVault, fakeTFile, fakePluginManifest } from '../../factories/obsidian';
import { Platform } from 'obsidian';

function makeAppWithNote() {
  const note = fakeTFile({ path: 'Notes/n.md', name: 'n.md', extension: 'md' });
  const vault = fakeVault({ files: [note] }) as any;
  const app = fakeApp({ vault, metadataCache: { resolvedLinks: {} } as any }) as any;
  // Workspace.getActiveFile should return our note for drop/paste flows
  (app.workspace.getActiveFile as any) = vi.fn(() => note);
  return { app, note };
}

describe('Platform-specific registration of drop/paste handlers (Phase 9: 25.4/25.5)', () => {
  let originalMobile: boolean;

  beforeEach(() => {
    originalMobile = Platform.isMobile;
  });

  afterEach(() => {
    Platform.isMobile = originalMobile;
  });

  it('When Platform.isMobile=true, Then editor-drop/editor-paste handlers are NOT registered', async () => {
    const { app } = makeAppWithNote();
    Platform.isMobile = true;

    const plugin = new ImageConverterPlugin(app as any, fakePluginManifest({ id: 'image-converter' }));
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue(undefined);
    await plugin.loadSettings();

    // onload registers handlers
    await plugin.onload();

    const calls = (app.workspace.on as any).mock.calls as any[];
    const events = calls.map((callArgs) => callArgs[0]);
    expect(events.includes('editor-drop')).toBe(false);
    expect(events.includes('editor-paste')).toBe(false);
  });

  it('When Platform.isMobile=false, Then editor-drop/editor-paste handlers ARE registered', async () => {
    const { app } = makeAppWithNote();
    Platform.isMobile = false;

    const plugin = new ImageConverterPlugin(app as any, fakePluginManifest({ id: 'image-converter' }));
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue(undefined);
    await plugin.loadSettings();

    await plugin.onload();

    const calls = (app.workspace.on as any).mock.calls as any[];
    const events = calls.map((callArgs) => callArgs[0]);
    expect(events.filter((e: string) => e === 'editor-drop').length).toBeGreaterThanOrEqual(1);
    expect(events.filter((e: string) => e === 'editor-paste').length).toBeGreaterThanOrEqual(1);
  });
});
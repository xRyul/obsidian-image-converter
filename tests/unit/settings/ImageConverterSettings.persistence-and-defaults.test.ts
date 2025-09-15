import { describe, it, expect, vi } from 'vitest';
import ImageConverterPlugin from '../../../src/main';
import { DEFAULT_SETTINGS } from '../../../src/ImageConverterSettings';
import { App } from 'obsidian';

function makeAppWithStorage() {
  const storage: Record<string, any> = {};
  const app = {
    vault: {
      adapter: {
        read: vi.fn(), readBinary: vi.fn(), write: vi.fn(), writeBinary: vi.fn(),
        exists: vi.fn(), stat: vi.fn(), list: vi.fn(), mkdir: vi.fn(), rmdir: vi.fn(), remove: vi.fn(), rename: vi.fn(), copy: vi.fn(), append: vi.fn()
      }
    },
    metadataCache: {} as any,
    workspace: {
      getActiveFile: vi.fn(),
      getLeaf: vi.fn(), getLeavesOfType: vi.fn(), on: vi.fn(), off: vi.fn(), trigger: vi.fn(), tryTrigger: vi.fn()
    } as any,
    fileManager: { getNewFileParent: vi.fn(), generateMarkdownLink: vi.fn(), renameFile: vi.fn() } as any,
    internalPlugins: {}, plugins: {},
    loadLocalStorage: vi.fn((k: string) => storage[k] ?? null),
    saveLocalStorage: vi.fn((k: string, value: string) => (storage[k] = value))
  } as unknown as App;
  return app;
}

describe('Settings defaults and persistence (11.1–11.2)', () => {
  it('Given no saved data, When loadSettings, Then merges with DEFAULT_SETTINGS (11.1)', async () => {
    const app = makeAppWithStorage();
    // Create minimal manifest, Plugin base mock in tests/__mocks__/obsidian.ts handles save/load
    const manifest = { id: 'image-converter' } as any;
    const plugin = new ImageConverterPlugin(app, manifest);

    // Stub plugin.loadData to return undefined to simulate first run
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue(undefined);

    await plugin.loadSettings();

    // Expect required keys present and equal to DEFAULTS for absense
    expect(plugin.settings.selectedFolderPreset).toBe(DEFAULT_SETTINGS.selectedFolderPreset);
    expect(plugin.settings.conversionPresets.length).toBeGreaterThan(0);
    expect(plugin.settings.linkFormatSettings.selectedLinkFormatPreset)
      .toBe(DEFAULT_SETTINGS.linkFormatSettings.selectedLinkFormatPreset);
    expect(plugin.settings.nonDestructiveResizeSettings.selectedResizePreset)
      .toBe(DEFAULT_SETTINGS.nonDestructiveResizeSettings.selectedResizePreset);
  });

  it('Given a change, When saveSettings then reload, Then values persist (11.2)', async () => {
    const app = makeAppWithStorage();
    const manifest = { id: 'image-converter' } as any;
    const plugin = new ImageConverterPlugin(app, manifest);

    // Start with defaults
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue(undefined);
    await plugin.loadSettings();

    // Change a few values
    plugin.settings.selectedFolderPreset = DEFAULT_SETTINGS.folderPresets[0].name;
    plugin.settings.selectedFilenamePreset = DEFAULT_SETTINGS.filenamePresets[0].name;
    plugin.settings.showSpaceSavedNotification = !DEFAULT_SETTINGS.showSpaceSavedNotification;

const saveDataSpy = vi.spyOn(plugin as any, 'saveData').mockResolvedValue(undefined);
    await plugin.saveSettings();
    expect(saveDataSpy).toHaveBeenCalledWith(plugin.settings);

    // Simulate reload returning saved settings
    (plugin.loadData as any).mockResolvedValue(plugin.settings);
    await plugin.loadSettings();

    expect(plugin.settings.selectedFolderPreset).toBe(DEFAULT_SETTINGS.folderPresets[0].name);
    expect(plugin.settings.selectedFilenamePreset).toBe(DEFAULT_SETTINGS.filenamePresets[0].name);
    expect(plugin.settings.showSpaceSavedNotification).toBe(!DEFAULT_SETTINGS.showSpaceSavedNotification);
  });
});

describe('getPresetByName fallback (part of 11.1/11.4)', () => {
  it('Given missing preset name, When getPresetByName, Then returns first preset and warns', async () => {
    const app = makeAppWithStorage();
    const manifest = { id: 'image-converter' } as any;
    const plugin = new ImageConverterPlugin(app, manifest);

    vi.spyOn(plugin as any, 'loadData').mockResolvedValue(undefined);
    await plugin.loadSettings();

    const warnSpy = vi.spyOn(global.console, 'warn');

    const conv = plugin.getPresetByName('does-not-exist', plugin.settings.conversionPresets, 'Conversion');
    expect(conv).toBe(plugin.settings.conversionPresets[0]);
    expect(warnSpy).toHaveBeenCalled();
  });
});

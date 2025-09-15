import { describe, it, expect, vi, beforeEach } from 'vitest';
import ImageConverterPlugin from '../../../src/main';
import { ImageConverterSettingTab, DEFAULT_SETTINGS } from '../../../src/ImageConverterSettings';
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

function changeSelect(sel: HTMLSelectElement, value: string) {
  sel.value = value;
  sel.dispatchEvent(new Event('change'));
}

describe('Settings defaults, global preset application, and field constraints (11.6, 11.7, 11.8)', () => {
  let app: App;
  let plugin: ImageConverterPlugin;
  let tab: ImageConverterSettingTab;

  beforeEach(async () => {
    app = makeAppWithStorage();
    plugin = new ImageConverterPlugin(app, { id: 'image-converter' } as any);
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue(undefined);
    await plugin.loadSettings();
    tab = new ImageConverterSettingTab(app, plugin);
  });

  it('11.7 Global preset application: selecting and resetting via dropdown updates selected presets', async () => {
    tab.display();
    const container = tab.containerEl.querySelector('.image-converter-global-preset-container') as HTMLElement;
    expect(container).toBeTruthy();

    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select).toBeTruthy();

    // Apply built-in global preset "WebP 75"
    changeSelect(select, 'WebP 75');

    expect(plugin.settings.selectedFolderPreset).toBe('Default (Obsidian setting)');
    expect(plugin.settings.selectedFilenamePreset).toBe('NoteName-Timestamp');
    expect(plugin.settings.selectedConversionPreset).toBe('WEBP (75, no resizing)');
    expect(plugin.settings.linkFormatSettings.selectedLinkFormatPreset).toBe(DEFAULT_SETTINGS.linkFormatSettings.selectedLinkFormatPreset);
    expect(plugin.settings.nonDestructiveResizeSettings.selectedResizePreset).toBe(DEFAULT_SETTINGS.nonDestructiveResizeSettings.selectedResizePreset);

    // Reset to None
    changeSelect(select, '');
    expect(plugin.settings.selectedFolderPreset).toBe(DEFAULT_SETTINGS.selectedFolderPreset);
    expect(plugin.settings.selectedFilenamePreset).toBe(DEFAULT_SETTINGS.selectedFilenamePreset);
    expect(plugin.settings.selectedConversionPreset).toBe(DEFAULT_SETTINGS.selectedConversionPreset);
    expect(plugin.settings.linkFormatSettings.selectedLinkFormatPreset).toBe(DEFAULT_SETTINGS.linkFormatSettings.selectedLinkFormatPreset);
    expect(plugin.settings.nonDestructiveResizeSettings.selectedResizePreset).toBe(DEFAULT_SETTINGS.nonDestructiveResizeSettings.selectedResizePreset);
  });

  it('11.6 Field constraints: sliders have correct min/max and accept sanitized values', async () => {
    tab.display();

    // Image alignment cache cleanup interval slider (0..120 minutes)
    const alignSection = tab.containerEl.querySelector('.image-alignment-settings-section') as HTMLElement;
    const alignSlider = alignSection?.querySelector('input[type="range"]') as HTMLInputElement;
    expect(alignSlider?.min).toBe('0');
    expect(alignSlider?.max).toBe('120');

    // Scroll-wheel resize sensitivity slider (0.01..1)
    const scrollSection = tab.containerEl.querySelector('.scroll-resize-settings') as HTMLElement;
    const sensSlider = scrollSection?.querySelector('input[type="range"]') as HTMLInputElement;
    expect(sensSlider?.min).toBe('0.01');
    expect(sensSlider?.max).toBe('1');
  });

  it('11.8 Safe defaults on missing fields: shallow merge preserves defaults for unspecified fields', async () => {
    // Simulate stored settings with only a couple of overrides
    const app2 = makeAppWithStorage();
    const plugin2 = new ImageConverterPlugin(app2, { id: 'image-converter' } as any);
    vi.spyOn(plugin2 as any, 'loadData').mockResolvedValue({
      selectedFolderPreset: 'Root folder',
      showSpaceSavedNotification: false
      // Intentionally omit many fields
    });
    await plugin2.loadSettings();

    // Provided overrides applied
    expect(plugin2.settings.selectedFolderPreset).toBe('Root folder');
    expect(plugin2.settings.showSpaceSavedNotification).toBe(false);

    // Unspecified fields fall back to defaults
    expect(plugin2.settings.selectedConversionPreset).toBe(DEFAULT_SETTINGS.selectedConversionPreset);
    expect(plugin2.settings.linkFormatSettings.selectedLinkFormatPreset).toBe(DEFAULT_SETTINGS.linkFormatSettings.selectedLinkFormatPreset);
    expect(plugin2.settings.nonDestructiveResizeSettings.selectedResizePreset).toBe(DEFAULT_SETTINGS.nonDestructiveResizeSettings.selectedResizePreset);
  });
});
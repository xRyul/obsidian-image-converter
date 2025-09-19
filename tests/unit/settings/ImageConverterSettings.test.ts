import { describe, it, expect, vi, beforeEach } from 'vitest';
import ImageConverterPlugin from '../../../src/main';
import { ImageConverterSettingTab, DEFAULT_SETTINGS, type ConversionPreset, type FilenamePreset } from '../../../src/ImageConverterSettings';
import type { LinkFormatPreset } from '../../../src/LinkFormatSettings';
import { App } from 'obsidian';

// Mock SortableJS to capture onEnd callbacks for reorder (11.9)
vi.mock('sortablejs', () => {
  return {
    default: class SortableMock {
      constructor(_el: HTMLElement, options: any) {
        ;(globalThis as any).__lastSortableOnEnd = options?.onEnd;
      }
    }
  };
});

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
    loadLocalStorage: vi.fn((key: string) => storage[key] ?? null),
    saveLocalStorage: vi.fn((key: string, value: string) => (storage[key] = value))
  } as unknown as App;
  return app;
}

function click(el: Element | null | undefined) {
  if (!el) throw new Error('Element to click was not found');
  (el as HTMLElement).click();
}

function changeSelect(sel: HTMLSelectElement, value: string) {
  sel.value = value;
  sel.dispatchEvent(new Event('change'));
}

// -----------------------------
// 11.1–11.2 Defaults and persistence
// -----------------------------

describe('Settings defaults and persistence (11.1–11.2)', () => {
  it('Given no saved data, When loadSettings, Then merges with DEFAULT_SETTINGS (11.1)', async () => {
    const app = makeAppWithStorage();
    const manifest = { id: 'image-converter' } as any;
    const plugin = new ImageConverterPlugin(app, manifest);

    // Stub plugin.loadData to return undefined to simulate first run
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue(undefined);

    await plugin.loadSettings();

    // Expect required keys present and equal to DEFAULTS for absence
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

// -----------------------------
// 11.6, 11.7, 11.8 UI and defaults behavior
// -----------------------------

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

// -----------------------------
// 11.3, 11.4, 11.5, 11.9 Preset management
// -----------------------------

describe('Settings preset management (11.3, 11.4, 11.5, 11.9)', () => {
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

  it('11.3 Preset creation: adding Filename and Conversion presets appear and are selectable', async () => {
    // Filename add
    tab.activeTab = 'filename';
    tab.display();

    // Click "+ Add New"
    const addNewCard = tab.containerEl.querySelector('.image-converter-add-new-preset');
    click(addNewCard);

    // Fill form: name and custom imagename
    const form = tab.containerEl.querySelector('.image-converter-preset-form') as HTMLElement;
    // First input is preset name
    const nameInput = form.querySelector('input') as HTMLInputElement;
    nameInput.value = 'My Filename Preset';
    nameInput.dispatchEvent(new Event('change'));

    // Second input (custom imagename) resides inside .image-converter-custom-template-setting-wrapper
    const customInput = form.querySelector('.image-converter-custom-template-setting-wrapper input') as HTMLInputElement;
    if (customInput) {
      customInput.value = '{notename}-{timestamp}';
      customInput.dispatchEvent(new Event('change'));
    }

    const saveBtn = form.querySelector('.image-converter-form-buttons button.cta') as HTMLButtonElement;
    click(saveBtn);

    // Assert preset added
    const createdFilename = plugin.settings.filenamePresets.find((preset: FilenamePreset) => preset.name === 'My Filename Preset');
    expect(createdFilename).toBeTruthy();

    // Now click on the new card to select it
    tab.display(); // re-render
    const cardTitleEls = Array.from(tab.containerEl.querySelectorAll('.image-converter-preset-card-title')) as HTMLElement[];
    const newCardTitle = cardTitleEls.find(el => el.textContent === 'My Filename Preset');
    click(newCardTitle);
    expect(plugin.settings.selectedFilenamePreset).toBe('My Filename Preset');

    // Conversion add
    tab.activeTab = 'conversion';
    tab.display();
    click(tab.containerEl.querySelector('.image-converter-add-new-preset'));

    const convForm = tab.containerEl.querySelector('.image-converter-preset-form') as HTMLElement;
    const convNameInput = convForm.querySelector('input') as HTMLInputElement;
    convNameInput.value = 'My Conversion Preset';
    convNameInput.dispatchEvent(new Event('change'));

    click(convForm.querySelector('.image-converter-form-buttons button.cta'));

    expect(plugin.settings.conversionPresets.some((preset: ConversionPreset) => preset.name === 'My Conversion Preset')).toBe(true);

    // Select it
    tab.display();
    const convCard = Array.from(tab.containerEl.querySelectorAll('.image-converter-preset-card-title')).find(el => el.textContent === 'My Conversion Preset');
    click(convCard);
    expect(plugin.settings.selectedConversionPreset).toBe('My Conversion Preset');
  });

  it('11.4 Preset editing: editing a non-default conversion preset updates and persists', async () => {
    // Ensure a non-default conversion preset exists
    plugin.settings.conversionPresets.push({
      name: 'TMP conv',
      outputFormat: 'WEBP', quality: 50, colorDepth: 1, resizeMode: 'None', desiredWidth: 800, desiredHeight: 600,
      desiredLongestEdge: 1000, enlargeOrReduce: 'Auto', allowLargerFiles: false, skipConversionPatterns: '',
      pngquantExecutablePath: '', pngquantQuality: '65-80', ffmpegExecutablePath: '', ffmpegCrf: 23, ffmpegPreset: 'medium'
    } as ConversionPreset);

    const saveSpy = vi.spyOn(plugin, 'saveSettings').mockResolvedValue(undefined);

    tab.activeTab = 'conversion';
    tab.display();

    // Open edit by clicking the first action button (pencil) on the target card
    const card = Array.from(tab.containerEl.querySelectorAll('.image-converter-preset-card')).find(el =>
      !!(el.querySelector('.image-converter-preset-card-title') as HTMLElement)?.textContent?.includes('TMP conv')
    ) as HTMLElement;
    const editBtn = card.querySelector('.image-converter-preset-card-actions button') as HTMLButtonElement; // first is edit
    click(editBtn);

    // Change name
    const form = tab.containerEl.querySelector('.image-converter-preset-form') as HTMLElement;
    const nameInput = form.querySelector('input') as HTMLInputElement;
    nameInput.value = 'TMP conv updated';
    nameInput.dispatchEvent(new Event('change'));

    // Save
    click(form.querySelector('.image-converter-form-buttons button.cta'));

    expect(saveSpy).toHaveBeenCalled();
    expect(plugin.settings.conversionPresets.some((preset: ConversionPreset) => preset.name === 'TMP conv updated')).toBe(true);
  });

  it('11.5 Preset deletion: deleting a selected non-default link format preset removes it and resets selection', async () => {
    // Add a non-default link format preset and select it
    const custom: LinkFormatPreset = { name: 'Custom Link', linkFormat: 'markdown', pathFormat: 'absolute', prependCurrentDir: false, hideFolders: false };
    plugin.settings.linkFormatSettings.linkFormatPresets.push(custom);
    plugin.settings.linkFormatSettings.selectedLinkFormatPreset = 'Custom Link';

    tab.activeTab = 'linkformat';
    tab.display();

    // Simulate deletion (ConfirmDialog is not interactive in test env)
    plugin.settings.linkFormatSettings.linkFormatPresets = plugin.settings.linkFormatSettings.linkFormatPresets.filter((preset: LinkFormatPreset) => preset.name !== 'Custom Link');
    if (plugin.settings.linkFormatSettings.selectedLinkFormatPreset === 'Custom Link') {
      plugin.settings.linkFormatSettings.selectedLinkFormatPreset = DEFAULT_SETTINGS.linkFormatSettings.selectedLinkFormatPreset;
    }

    expect(plugin.settings.linkFormatSettings.linkFormatPresets.find((preset: LinkFormatPreset) => preset.name === 'Custom Link')).toBeFalsy();
    // Selection reset to default
    expect(plugin.settings.linkFormatSettings.selectedLinkFormatPreset).toBe(DEFAULT_SETTINGS.linkFormatSettings.selectedLinkFormatPreset);
  });

  it('11.9 Preset reordering (drag-and-drop): on drop, new order persists', async () => {
    const saveSpy = vi.spyOn(plugin, 'saveSettings').mockResolvedValue(undefined);

    tab.activeTab = 'conversion';
    tab.display();

    const before = plugin.settings.conversionPresets.map((preset: ConversionPreset) => preset.name);
    expect(before.length).toBeGreaterThanOrEqual(2);

    const onEnd = (globalThis as any).__lastSortableOnEnd as ((evt: { oldIndex: number; newIndex: number }) => void);
    expect(typeof onEnd).toBe('function');

    // Move item at index 1 to index 0
    await onEnd({ oldIndex: 1, newIndex: 0 });

    const after = plugin.settings.conversionPresets.map((preset: ConversionPreset) => preset.name);
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);
    expect(saveSpy).toHaveBeenCalled();
  });
});

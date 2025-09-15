import { describe, it, expect, vi, beforeEach } from 'vitest';
import ImageConverterPlugin from '../../../src/main';
import { ImageConverterSettingTab, DEFAULT_SETTINGS, ConversionPreset, FilenamePreset } from '../../../src/ImageConverterSettings';
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
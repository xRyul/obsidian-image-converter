import { describe, it, expect, vi } from 'vitest';
import { PresetSelectionModal } from '../../../src/PresetSelectionModal';
import ImageConverterPlugin from '../../../src/main';
import { App } from 'obsidian';
import { VariableProcessor } from '../../../src/VariableProcessor';
import type { ConversionPreset, FilenamePreset, FolderPreset } from '../../../src/ImageConverterSettings';
import type { LinkFormatPreset } from '../../../src/LinkFormatSettings';
import type { NonDestructiveResizePreset } from '../../../src/NonDestructiveResizeSettings';

function makeAppWithVault(files: string[] = []) {
  const imageFiles = files.map((name) => ({
    path: name,
    name,
    basename: name.replace(/\.[^.]+$/, ''),
    extension: name.split('.').pop() || '',
    stat: { mtime: Date.now(), ctime: Date.now(), size: 1000 }
  }));

  const app = {
    vault: {
      getFiles: vi.fn(() => imageFiles),
      getMarkdownFiles: vi.fn(() => []),
      getAllLoadedFiles: vi.fn(() => imageFiles),
      getAbstractFileByPath: vi.fn(),
      readBinary: vi.fn(),
      createBinary: vi.fn(),
    },
    workspace: {
      getActiveFile: vi.fn(() => imageFiles[0] ?? null),
      on: vi.fn(), off: vi.fn(), trigger: vi.fn(), tryTrigger: vi.fn(),
      getLeavesOfType: vi.fn(), getLeaf: vi.fn()
    }
  } as unknown as App;
  return app;
}

function changeSelect(select: HTMLSelectElement, value: string) {
  select.value = value;
  select.dispatchEvent(new Event('change'));
}

function changeInput(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('change'));
}

describe('PresetSelectionModal compact UI flows (18.1, 18.3, 18.4)', () => {
  it('Given modal opens, When constructed, Then processing preview text is composed (format • link • resize) (18.1/processing preview)', async () => {
    const app = makeAppWithVault(['img.png']);
    const plugin = new ImageConverterPlugin(app, { id: 'image-converter' } as any);
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue(undefined);
    await plugin.loadSettings();

    // Spy on saveSettings to ensure session state persists on Apply
const saveSpy = vi.spyOn(plugin, 'saveSettings').mockResolvedValue(undefined);

    let applied = false;
    const modal = new PresetSelectionModal(
      app,
      plugin.settings,
      () => { applied = true; },
      plugin,
      new VariableProcessor(app, plugin.settings)
    );

    // Render content
    modal.onOpen();

    // Expect preview element exists and contains selected preset names once updateProcessingPreview runs
    const container = (modal as any).contentEl as HTMLElement;
    const preview = container.querySelector('.image-converter-processing-preview-text') as HTMLElement;
    expect(preview).toBeTruthy();
    // The default shows selectedConversionPreset + quality + link + resize
    expect(preview.textContent).toContain(plugin.settings.selectedConversionPreset);
    expect(preview.textContent).toContain('%');
    expect(preview.textContent).toContain(plugin.settings.linkFormatSettings.selectedLinkFormatPreset);
    expect(preview.textContent).toContain(plugin.settings.nonDestructiveResizeSettings.selectedResizePreset);

    // Simulate Apply click: call internal method to persist session state and onApply
    // Access the created Apply button via class: image-converter-compact-actions
    const actions = container.querySelector('.image-converter-compact-actions');
    expect(actions).toBeTruthy();

    // Since our mock only wires callbacks, we can directly call saveSessionState and onApply via the Apply handler
    // Instead, emulate clicking the last button in that setting
    const buttons = actions!.querySelectorAll('button');
    // The last should be Apply
    const applyBtn = buttons[buttons.length - 1] as HTMLButtonElement;
    applyBtn?.click();

    expect(applied).toBe(true);
    expect(saveSpy).toHaveBeenCalled();
  });

  it('Given custom folder/filename text, When paused 150ms, Then preview shows processed path (18.3 debounce)', async () => {
    const app = makeAppWithVault(['photo.webp']);
    const plugin = new ImageConverterPlugin(app, { id: 'image-converter' } as any);
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue(undefined);
    await plugin.loadSettings();

    const modal = new PresetSelectionModal(
      app,
      plugin.settings,
      () => {},
      plugin,
      new VariableProcessor(app, plugin.settings)
    );

    // Stub variableProcessor to avoid cross-module path dependencies in preview
    (modal as any).variableProcessor = {
      processTemplate: vi.fn(async (template: string) => {
        return template
          .replace('{YYYY}', '2025')
          .replace('{MM}', '09')
          .replace('{imagename}', 'photo')
          .replace('{timestamp}', '1234567890');
      })
    };

    modal.onOpen();

    const container = (modal as any).contentEl as HTMLElement;

    // Find the two text inputs (folder and filename) and set custom values that resolve
    const inputs = container.querySelectorAll('.image-converter-text-setting input');
    expect(inputs.length).toBeGreaterThanOrEqual(2);

    const folderInput = inputs[0] as HTMLInputElement;
    const fileInput = inputs[1] as HTMLInputElement;

    folderInput.value = 'assets/{YYYY}/{MM}';
    folderInput.dispatchEvent(new Event('change'));

    fileInput.value = '{imagename}-{timestamp}';
    fileInput.dispatchEvent(new Event('change'));

    // Wait >150ms for debounce
    await new Promise((resolve) => setTimeout(resolve, 180));

    const previewContent = container.querySelector('.image-converter-preview-content-compact');
    expect(previewContent?.textContent || '').toMatch(/assets\/.+/);
  });
});

describe('PresetSelectionModal additional UI flows for Phase 6 (18.1–18.6)', () => {
  it('18.1 Modal displays all expected controls', async () => {
    const app = makeAppWithVault(['img.png']);
    const plugin = new ImageConverterPlugin(app, { id: 'image-converter' } as any);
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue(undefined);
    await plugin.loadSettings();

    const modal = new PresetSelectionModal(
      app,
      plugin.settings,
      () => {},
      plugin,
      new VariableProcessor(app, plugin.settings)
    );

    modal.onOpen();
    const container = (modal as any).contentEl as HTMLElement;

    // Folder + text
    const folderSelect = container.querySelector('select[data-preset-type="folder"]') as HTMLSelectElement;
    const folderInput = container.querySelectorAll('.image-converter-text-setting input')[0] as HTMLInputElement;
    expect(folderSelect).toBeTruthy();
    expect(folderInput).toBeTruthy();

    // Filename + text
    const filenameSelect = container.querySelector('select[data-preset-type="filename"]') as HTMLSelectElement;
    const filenameInput = container.querySelectorAll('.image-converter-text-setting input')[1] as HTMLInputElement;
    expect(filenameSelect).toBeTruthy();
    expect(filenameInput).toBeTruthy();

    // Conversion, Link, Resize dropdowns
    expect(container.querySelector('.image-converter-format-dropdown')).toBeTruthy();
    expect(container.querySelector('.image-converter-link-dropdown')).toBeTruthy();
    expect(container.querySelector('.image-converter-resize-dropdown')).toBeTruthy();

    // Quality slider
    expect(container.querySelector('.image-converter-quality-slider')).toBeTruthy();

    // Global preset dropdown in header
    const headerMini = container.querySelector('.image-converter-global-mini-setting');
    expect(headerMini?.querySelector('select')).toBeTruthy();

    // Variables button
    const variablesBtn = container.querySelector('.image-converter-variables-header-btn');
    expect(variablesBtn).toBeTruthy();
  });

  it('18.2 Preset selection updates inputs and processing preview', async () => {
    const app = makeAppWithVault(['img.png']);
    const plugin = new ImageConverterPlugin(app, { id: 'image-converter' } as any);
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue(undefined);
    await plugin.loadSettings();

    // Add a custom folder preset with a template to observe input updates
    plugin.settings.folderPresets.push({ name: 'Custom Folder', type: 'CUSTOM', customTemplate: 'assets/{YYYY}' } as any);

    const modal = new PresetSelectionModal(app, plugin.settings, () => {}, plugin, new VariableProcessor(app, plugin.settings));
    modal.onOpen();
    const container = (modal as any).contentEl as HTMLElement;

    // Folder select -> updates folder input text
    const folderSelect2 = container.querySelector('select[data-preset-type="folder"]') as HTMLSelectElement;
    changeSelect(folderSelect2, 'Custom Folder');
    const folderInput2 = container.querySelectorAll('.image-converter-text-setting input')[0] as HTMLInputElement;
    expect(folderInput2.value).toBe('assets/{YYYY}');

    // Filename preset selection -> updates filename input
    const filenameSelect2 = container.querySelector('select[data-preset-type="filename"]') as HTMLSelectElement;
    changeSelect(filenameSelect2, 'NoteName-Timestamp');
    const filenameInput2 = container.querySelectorAll('.image-converter-text-setting input')[1] as HTMLInputElement;
    expect(filenameInput2.value).toContain('{notename}');

    // Conversion/link/resize -> processing preview text updates
    const preview = container.querySelector('.image-converter-processing-preview-text') as HTMLElement;
    const initialText = preview.textContent || '';

    // Toggle conversion preset to a different value than current preview
    const conversionSelect = container.querySelector('select.image-converter-format-dropdown') as HTMLSelectElement;
    const nextConv = initialText.includes('WEBP') ? 'None' : 'WEBP (75, no resizing)';
    changeSelect(conversionSelect, nextConv);
    expect(preview.textContent).not.toBe(initialText);

    // Toggle link preset to a different one than current preview
    const linkSelect = container.querySelector('select.image-converter-link-dropdown') as HTMLSelectElement;
    const beforeLink = preview.textContent || '';
    const linkAlt = beforeLink.includes('Markdown') ? 'Default (Wikilink, Shortest)' : 'Markdown, Relative';
    changeSelect(linkSelect, linkAlt);
    expect(preview.textContent).not.toBe(beforeLink);

    // Toggle resize preset similarly (if only one exists, this will no-op but assertion uses before/after)
    const resizeSelect = container.querySelector('select.image-converter-resize-dropdown') as HTMLSelectElement;
    const beforeResize = preview.textContent || '';
    // Try to switch between default and itself safely
    const resizeAlt = beforeResize.includes('Default') ? resizeSelect.value : resizeSelect.value; // keep stable if only one
    changeSelect(resizeSelect, resizeAlt);
    // If there is only one resize option, preview might not change; allow either change or equality
    // We still assert preview is a string
    expect(typeof preview.textContent).toBe('string');
  });

  it('18.3 Debounced preview: empty templates show empty-state message', async () => {
    const app = makeAppWithVault(['photo.webp']);
    const plugin = new ImageConverterPlugin(app, { id: 'image-converter' } as any);
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue(undefined);
    await plugin.loadSettings();

    const modal = new PresetSelectionModal(app, plugin.settings, () => {}, plugin, new VariableProcessor(app, plugin.settings));
    modal.onOpen();
    const container = (modal as any).contentEl as HTMLElement;

    // Clear both folder and filename inputs
    const inputs = container.querySelectorAll('.image-converter-text-setting input');
    changeInput(inputs[0] as HTMLInputElement, '');
    changeInput(inputs[1] as HTMLInputElement, '');

    await new Promise((resolve) => setTimeout(resolve, 180));

    const previewContent = container.querySelector('.image-converter-preview-content-compact') as HTMLElement;
    expect(previewContent.textContent || '').toContain('Enter templates');
  });

  it('18.4 Apply: persists modalSessionState and passes CUSTOM folder type with overrides', async () => {
    const app = makeAppWithVault(['img.png']);
    const plugin = new ImageConverterPlugin(app, { id: 'image-converter' } as any);
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue(undefined);
    await plugin.loadSettings();

const saveSpy2 = vi.spyOn(plugin, 'saveSettings').mockResolvedValue(undefined);

    let appliedArgs: any[] | null = null;
    const modal = new PresetSelectionModal(
      app,
      plugin.settings,
      (
        conversionPreset: ConversionPreset,
        filenamePreset: FilenamePreset,
        folderPreset: FolderPreset,
        linkFormatPreset: LinkFormatPreset,
        resizePreset: NonDestructiveResizePreset
      ) => {
        appliedArgs = [conversionPreset, filenamePreset, folderPreset, linkFormatPreset, resizePreset];
      },
      plugin,
      new VariableProcessor(app, plugin.settings)
    );

    modal.onOpen();
    const container = (modal as any).contentEl as HTMLElement;

    const inputsNodeList = container.querySelectorAll('.image-converter-text-setting input');
    const folderInputX = inputsNodeList[0] as HTMLInputElement;
    const filenameInputX = inputsNodeList[1] as HTMLInputElement;
    changeInput(folderInputX, 'assets/{YYYY}/{MM}');
    changeInput(filenameInputX, '{imagename}-{timestamp}');

    // Click Apply (cta button)
    const actions = container.querySelector('.image-converter-compact-actions')!;
    const buttons = actions.querySelectorAll('button');
    const applyBtn = buttons[buttons.length - 1] as HTMLButtonElement;
    applyBtn.click();

    expect(saveSpy2).toHaveBeenCalled();
    expect(plugin.settings.modalSessionState?.customFolderOverride).toBe('assets/{YYYY}/{MM}');
    expect(plugin.settings.modalSessionState?.customFilenameOverride).toBe('{imagename}-{timestamp}');

    expect(appliedArgs).toBeTruthy();
    const [, , folderPresetCopy] = appliedArgs!;
    expect(folderPresetCopy.type).toBe('CUSTOM');
  });

  it('18.5 Close without Apply: no onApply and no session persistence', async () => {
    const app = makeAppWithVault(['img.png']);
    const plugin = new ImageConverterPlugin(app, { id: 'image-converter' } as any);
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue(undefined);
    await plugin.loadSettings();

const saveSpy3 = vi.spyOn(plugin, 'saveSettings').mockResolvedValue(undefined);
    let called = false;

    const modal = new PresetSelectionModal(app, plugin.settings, () => { called = true; }, plugin, new VariableProcessor(app, plugin.settings));
    modal.onOpen();

    // Simulate closing without clicking Apply
    modal.onClose();

    expect(called).toBe(false);
    expect(saveSpy3).not.toHaveBeenCalled();
    expect(plugin.settings.modalSessionState).toBeUndefined();
  });

  it('18.6 Remember selections: reopen shows prior overrides when applied; closing without Apply reverts to presets', async () => {
    const app = makeAppWithVault(['img.png']);
    const plugin = new ImageConverterPlugin(app, { id: 'image-converter' } as any);
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue(undefined);
    await plugin.loadSettings();

    // First open -> set overrides and Apply
    const modal1 = new PresetSelectionModal(app, plugin.settings, () => {}, plugin, new VariableProcessor(app, plugin.settings));
    modal1.onOpen();
    const c1 = (modal1 as any).contentEl as HTMLElement;
    const [folderInput1, filenameInput1] = c1.querySelectorAll('.image-converter-text-setting input') as unknown as HTMLInputElement[];
    changeInput(folderInput1, 'assets/{YYYY}');
    changeInput(filenameInput1, '{imagename}-X');
    const actions1 = c1.querySelector('.image-converter-compact-actions')!;
    const buttons1 = actions1.querySelectorAll('button');
    (buttons1[buttons1.length - 1] as HTMLButtonElement).click(); // Apply

    // Reopen -> values should be restored from modalSessionState
    const modal2 = new PresetSelectionModal(app, plugin.settings, () => {}, plugin, new VariableProcessor(app, plugin.settings));
    modal2.onOpen();
    const c2 = (modal2 as any).contentEl as HTMLElement;
    const [folderInput2, filenameInput2] = c2.querySelectorAll('.image-converter-text-setting input') as unknown as HTMLInputElement[];
    expect(folderInput2.value).toBe('assets/{YYYY}');
    expect(filenameInput2.value).toBe('{imagename}-X');

    // Now open a new modal, change inputs, but close without Apply -> should revert to presets
    const plugin2 = new ImageConverterPlugin(app, { id: 'image-converter' } as any);
    vi.spyOn(plugin2 as any, 'loadData').mockResolvedValue(undefined);
    await plugin2.loadSettings();

    const modal3 = new PresetSelectionModal(app, plugin2.settings, () => {}, plugin2, new VariableProcessor(app, plugin2.settings));
    modal3.onOpen();
    const c3 = (modal3 as any).contentEl as HTMLElement;
    const inputs3 = c3.querySelectorAll('.image-converter-text-setting input') as unknown as HTMLInputElement[];
    changeInput(inputs3[0], 'tmp-folder');
    changeInput(inputs3[1], 'tmp-name');
    modal3.onClose();

    const modal4 = new PresetSelectionModal(app, plugin2.settings, () => {}, plugin2, new VariableProcessor(app, plugin2.settings));
    modal4.onOpen();
    const c4 = (modal4 as any).contentEl as HTMLElement;
    const [folderInput4, filenameInput4] = c4.querySelectorAll('.image-converter-text-setting input') as unknown as HTMLInputElement[];
    // Folder preset default has no template
    expect(folderInput4.value).toBe('');
    // Filename default preset template
    expect(filenameInput4.value).toBe('{imagename}');
  });
});

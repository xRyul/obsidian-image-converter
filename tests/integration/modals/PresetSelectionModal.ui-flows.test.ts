import { describe, it, expect, vi } from 'vitest';
import { PresetSelectionModal } from '../../../src/PresetSelectionModal';
import ImageConverterPlugin from '../../../src/main';
import { App } from 'obsidian';
import { VariableProcessor } from '../../../src/VariableProcessor';

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

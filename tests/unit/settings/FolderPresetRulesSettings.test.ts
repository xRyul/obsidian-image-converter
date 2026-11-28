import { describe, expect, it, vi } from 'vitest';
import { App, Modal, Setting, SettingGroup, type SettingDefinitionList } from 'obsidian';
import ImageConverterPlugin from '../../../src/main';
import { DEFAULT_SETTINGS } from '../../../src/ImageConverterSettings';
import { FolderPresetRuleModal, getFolderPresetRuleDefinitions, renderFolderPresetRules } from '../../../src/FolderPresetRulesSettings';
import { FolderSuggest } from '../../../src/FolderSuggest';
import { fakeApp, fakePluginManifest } from '../../factories/obsidian';

function createPlugin() {
    const plugin = new ImageConverterPlugin(fakeApp() as App, fakePluginManifest({ id: 'image-converter' }));
    plugin.settings = structuredClone(DEFAULT_SETTINGS);
    const save = vi.spyOn(plugin, 'saveSettings').mockResolvedValue();
    return { plugin, save };
}

function clickButton(container: HTMLElement, name: string) {
    const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent === name);
    expect(button).toBeTruthy();
    button!.click();
}

function changeControl(container: HTMLElement, label: string, value: string) {
    const input = container.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`)!;
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('folder rule settings controls', () => {
    it('renders the introduction as one setting with a line break in both settings implementations', () => {
        const { plugin } = createPlugin();
        const definitions = getFolderPresetRuleDefinitions(plugin, vi.fn());
        expect(definitions).toHaveLength(2);
        const intro = definitions[0];
        const nativeContainer = document.createElement('div');
        const setting = new Setting(nativeContainer);
        if ('render' in intro && intro.render) intro.render(setting, new SettingGroup(nativeContainer));
        expect(nativeContainer.querySelectorAll('.image-converter-folder-rules-intro')).toHaveLength(1);
        expect(setting.descEl.textContent).toContain('duplicate paths.\nUse /');

        const legacyContainer = document.createElement('div');
        renderFolderPresetRules(legacyContainer, plugin);
        const legacyIntro = legacyContainer.querySelector('.image-converter-folder-rules-intro .setting-item-description');
        expect(legacyContainer.querySelectorAll('.image-converter-folder-rules-intro')).toHaveLength(1);
        expect(legacyIntro?.textContent).toBe(setting.descEl.textContent);
    });

    it('adds a complete rule through a modal without persisting an incomplete draft', async () => {
        const { plugin, save } = createPlugin();
        const container = document.createElement('div');
        let modal: FolderPresetRuleModal | undefined;
        vi.spyOn(Modal.prototype, 'open').mockImplementation(function (this: FolderPresetRuleModal) {
            modal = this;
            this.onOpen();
        });
        renderFolderPresetRules(container, plugin);
        clickButton(container, 'Add rule');
        expect(modal).toBeTruthy();
        expect(plugin.settings.folderPresetRules).toEqual([]);
        expect(container.querySelector('[aria-label="Note folder"]')).toBeNull();

        changeControl(modal!.contentEl, 'Note folder', 'Projects\\Sub/');
        changeControl(modal!.contentEl, 'Global preset for folder', plugin.settings.globalPresets[0].name);
        expect(save).not.toHaveBeenCalled();
        clickButton(modal!.contentEl, 'Save');
        await vi.waitFor(() => expect(plugin.settings.folderPresetRules).toEqual([
            { folderPath: 'Projects/Sub', globalPreset: plugin.settings.globalPresets[0].name, enabled: true },
        ]));
        await vi.waitFor(() => expect(container.querySelector('[aria-label="Edit folder rule"]')).toBeTruthy());

        const enabled = container.querySelector<HTMLInputElement>('[aria-label="Enable folder rule"]')!;
        enabled.checked = false;
        enabled.dispatchEvent(new Event('change', { bubbles: true }));
        expect(plugin.settings.folderPresetRules![0].enabled).toBe(false);
        container.querySelector<HTMLButtonElement>('[aria-label="Remove folder rule"]')!.click();
        await vi.waitFor(() => expect(plugin.settings.folderPresetRules).toEqual([]));
        expect(save).toHaveBeenCalledTimes(3);
    });

    it('validates the path and preset before saving and keeps cancelled edits isolated', async () => {
        const { plugin } = createPlugin();
        const original = { folderPath: 'Projects', globalPreset: plugin.settings.globalPresets[0].name, enabled: true };
        const save = vi.fn().mockResolvedValue(undefined);
        const modal = new FolderPresetRuleModal(plugin.app, plugin, original, save);
        modal.onOpen();
        changeControl(modal.contentEl, 'Note folder', 'C:/Projects');
        clickButton(modal.contentEl, 'Save');
        expect(modal.contentEl.querySelector('[role="alert"]')?.textContent).toContain('vault-relative');
        expect(save).not.toHaveBeenCalled();
        changeControl(modal.contentEl, 'Note folder', 'file:');
        changeControl(modal.contentEl, 'Global preset for folder', '');
        clickButton(modal.contentEl, 'Save');
        expect(modal.contentEl.querySelector('[role="alert"]')?.textContent).toContain('existing global preset');
        clickButton(modal.contentEl, 'Cancel');
        expect(original.folderPath).toBe('Projects');
        expect(save).not.toHaveBeenCalled();
    });

    it('saves a selected external-files suggestion and closes its suggester on teardown', async () => {
        const { plugin } = createPlugin();
        const save = vi.fn().mockResolvedValue(undefined);
        const close = vi.spyOn(FolderSuggest.prototype, 'close');
        const modal = new FolderPresetRuleModal(plugin.app, plugin, undefined, save);
        modal.onOpen();
        const input = modal.contentEl.querySelector<HTMLInputElement>('[aria-label="Note folder"]')!;
        const suggest = new FolderSuggest(plugin.app, input, { includeExternalFiles: true });
        suggest.selectSuggestion(suggest.getSuggestions('')[0]);
        changeControl(modal.contentEl, 'Global preset for folder', plugin.settings.globalPresets[0].name);
        clickButton(modal.contentEl, 'Save');
        await vi.waitFor(() => expect(save).toHaveBeenCalledWith({ folderPath: 'file:', globalPreset: plugin.settings.globalPresets[0].name, enabled: true }));
        modal.onClose();
        expect(close).toHaveBeenCalled();
        expect(modal.contentEl.childElementCount).toBe(0);
    });

    it('defines a native mutable list with separate enable and edit controls', async () => {
        const { plugin, save } = createPlugin();
        plugin.settings.folderPresetRules = [
            { folderPath: '/', globalPreset: plugin.settings.globalPresets[0].name, enabled: true },
            { folderPath: 'file:', globalPreset: plugin.settings.globalPresets[0].name, enabled: true },
        ];
        const update = vi.fn();
        const definitions = getFolderPresetRuleDefinitions(plugin, update);
        const list = definitions.find(item => 'type' in item && item.type === 'list') as SettingDefinitionList;
        expect(list.items?.map(item => item.name)).toEqual(['Folder rule 1', 'Folder rule 2']);
        const container = document.createElement('div');
        const row = new Setting(container);
        const item = list.items![0];
        if ('render' in item && item.render) item.render(row, new SettingGroup(container));
        expect(row.nameEl.textContent).toBe('Vault root (/)');
        expect(row.controlEl.querySelectorAll('input')).toHaveLength(1);
        expect(row.controlEl.querySelector('[aria-label="Edit folder rule"]')).toBeTruthy();
        expect(row.controlEl.querySelector('select,input[type="text"]')).toBeNull();
        list.onReorder!(1, 0);
        await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
        expect(update).not.toHaveBeenCalled();
        expect(plugin.settings.folderPresetRules[0].folderPath).toBe('file:');
        list.onDelete!(1);
        await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
        expect(plugin.settings.folderPresetRules).toHaveLength(1);
        expect(save).toHaveBeenCalledTimes(2);
    });

    it('keeps native definition names unique when rule paths are duplicated', () => {
        const { plugin } = createPlugin();
        plugin.settings.folderPresetRules = [
            { folderPath: 'file:', globalPreset: plugin.settings.globalPresets[0].name, enabled: true },
            { folderPath: 'file:', globalPreset: plugin.settings.globalPresets[0].name, enabled: false },
        ];
        const list = getFolderPresetRuleDefinitions(plugin, vi.fn()).find(item => 'type' in item && item.type === 'list') as SettingDefinitionList;
        const names = list.items!.map(item => item.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it('rolls back a failed save so retrying does not create a duplicate rule', async () => {
        const { plugin, save } = createPlugin();
        save.mockRejectedValueOnce(new Error('Disk write failed'));
        let modal: FolderPresetRuleModal;
        vi.spyOn(Modal.prototype, 'open').mockImplementation(function (this: FolderPresetRuleModal) {
            modal = this;
            this.onOpen();
        });
        const container = document.createElement('div');
        renderFolderPresetRules(container, plugin);
        clickButton(container, 'Add rule');
        changeControl(modal!.contentEl, 'Note folder', 'file:');
        changeControl(modal!.contentEl, 'Global preset for folder', plugin.settings.globalPresets[0].name);
        clickButton(modal!.contentEl, 'Save');
        await vi.waitFor(() => expect(modal!.contentEl.querySelector('[role="alert"]')?.textContent).toContain('Could not save'));
        expect(plugin.settings.folderPresetRules).toEqual([]);
        clickButton(modal!.contentEl, 'Save');
        await vi.waitFor(() => expect(plugin.settings.folderPresetRules).toHaveLength(1));
        expect(save).toHaveBeenCalledTimes(2);
    });
});

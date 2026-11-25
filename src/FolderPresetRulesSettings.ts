import { App, Modal, Setting, requireApiVersion, type SettingDefinitionItem, type SettingDefinitionList } from 'obsidian';
import type ImageConverterPlugin from './main';
import { FolderSuggest } from './FolderSuggest';
import { EXTERNAL_FILES_PATH, normalizeRuleFolderPath, type FolderPresetRule } from './FolderPresetRules';
import { createSettingsGroup } from './utils/settingsGroup';

export const FOLDER_RULES_PAGE_NAME = 'Folder-based presets';
export const FOLDER_RULES_PAGE_DESCRIPTION = 'Choose image import presets by note folder or for external files.';
const FOLDER_RULES_INTRO = [
    'Rules apply to pasted and dropped images; the most specific folder wins, and the first enabled rule wins for duplicate paths.',
    'Use / for all vault notes, or file: for external notes.',
].join('\n');

function renderFolderRulesIntro(setting: Setting): void {
    setting.setClass('image-converter-folder-rules-intro').setName('').setDesc(FOLDER_RULES_INTRO);
}

function getRuleName(rule: FolderPresetRule): string {
    const path = normalizeRuleFolderPath(rule.folderPath);
    if (path === EXTERNAL_FILES_PATH) return 'External files (file:)';
    if (path === '') return 'Vault root (/)';
    return rule.folderPath || 'Incomplete rule';
}

function getRuleDescription(rule: FolderPresetRule, plugin: ImageConverterPlugin): string {
    if (normalizeRuleFolderPath(rule.folderPath) === null) return 'Edit this rule to select a valid note folder, /, or file:.';
    if (!plugin.settings.globalPresets.some(preset => preset.name === rule.globalPreset)) {
        return `Missing global preset: ${rule.globalPreset || 'none selected'}`;
    }
    return rule.globalPreset;
}

function openRuleEditor(plugin: ImageConverterPlugin, rule: FolderPresetRule | undefined, onChange: () => void): void {
    new FolderPresetRuleModal(plugin.app, plugin, rule, async updated => {
        const rules = plugin.settings.folderPresetRules ??= [];
        const index = rule ? rules.indexOf(rule) : rules.length;
        if (index < 0) throw new Error('This folder rule was removed while it was being edited.');
        rules.splice(index, rule ? 1 : 0, updated);
        try {
            await plugin.saveSettings();
        } catch (error) {
            if (rule) rules.splice(index, 1, rule);
            else rules.splice(index, 1);
            throw error;
        }
        onChange();
    }).open();
}

function renderRuleControls(setting: Setting, rule: FolderPresetRule, plugin: ImageConverterPlugin, onChange: () => void): void {
    setting.settingEl.addClass('image-converter-folder-rule-row');
    setting.addToggle(toggle => {
        toggle.toggleEl.setAttribute('aria-label', 'Enable folder rule');
        toggle.setValue(rule.enabled).onChange(async enabled => {
            rule.enabled = enabled;
            await plugin.saveSettings();
        });
    });
    setting.addExtraButton(button => {
        button.extraSettingsEl.setAttribute('aria-label', 'Edit folder rule');
        if (requireApiVersion('1.1.0')) button.setTooltip('Edit folder rule');
        button.setIcon('pencil').onClick(() => openRuleEditor(plugin, rule, onChange));
    });
}

export function getFolderPresetRuleDefinitions(plugin: ImageConverterPlugin, onChange: () => void): SettingDefinitionItem[] {
    const rules = plugin.settings.folderPresetRules ?? [];
    const removeRule = async (index: number) => {
        plugin.settings.folderPresetRules?.splice(index, 1);
        await plugin.saveSettings();
        onChange();
    };
    const reorderRules = async (oldIndex: number, newIndex: number) => {
        const [rule] = rules.splice(oldIndex, 1);
        rules.splice(newIndex, 0, rule);
        await plugin.saveSettings();
    };
    const list: SettingDefinitionList = {
        type: 'list',
        heading: 'Folder rules',
        cls: 'image-converter-folder-rules',
        emptyState: 'No folder rules. Notes use the current global preset.',
        addItem: {
            name: 'Add rule',
            action: () => openRuleEditor(plugin, undefined, onChange),
        },
        onDelete: index => { void removeRule(index); },
        onReorder: (oldIndex, newIndex) => { void reorderRules(oldIndex, newIndex); },
        items: rules.map((rule, index) => ({
            // Native settings key rows by name, but duplicate paths are valid rules.
            name: `Folder rule ${index + 1}`,
            desc: getRuleDescription(rule, plugin),
            searchable: false,
            render: setting => {
                setting.setName(getRuleName(rule));
                renderRuleControls(setting, rule, plugin, onChange);
            },
        })),
    };

    return [
        {
            name: '',
            desc: FOLDER_RULES_INTRO,
            searchable: false,
            render: renderFolderRulesIntro,
        },
        list,
    ];
}

export function renderFolderPresetRules(container: HTMLElement, plugin: ImageConverterPlugin): void {
    const section = container.createDiv('image-converter-folder-rules');
    renderFolderRulesIntro(new Setting(section));

    const rules = plugin.settings.folderPresetRules ??= [];
    const group = createSettingsGroup(section, 'Folder rules', 'image-converter-folder-rule-list');
    const rows = group.listEl;
    const renderRows = () => {
        rows.empty();
        if (!rules.length) new Setting(rows).setDesc('No folder rules. Notes use the current global preset.');
        rules.forEach(rule => {
            const row = new Setting(rows).setName(getRuleName(rule)).setDesc(getRuleDescription(rule, plugin));
            renderRuleControls(row, rule, plugin, renderRows);
            row.addExtraButton(button => {
                button.extraSettingsEl.setAttribute('aria-label', 'Remove folder rule');
                if (requireApiVersion('1.1.0')) button.setTooltip('Remove folder rule');
                button.setIcon('trash').onClick(async () => {
                    rules.splice(rules.indexOf(rule), 1);
                    await plugin.saveSettings();
                    renderRows();
                });
            });
        });
    };
    new Setting(section).setName('Add folder rule').addButton(button => button
        .setButtonText('Add rule')
        .onClick(() => openRuleEditor(plugin, undefined, renderRows)));
    renderRows();
}

export class FolderPresetRuleModal extends Modal {
    private draft: FolderPresetRule;
    private suggest?: FolderSuggest;

    constructor(app: App, private plugin: ImageConverterPlugin, private rule: FolderPresetRule | undefined, private onSave: (rule: FolderPresetRule) => Promise<void>) {
        super(app);
        this.draft = rule ? { ...rule } : { folderPath: '', globalPreset: '', enabled: true };
    }

    onOpen(): void {
        const { contentEl } = this;
        this.titleEl.setText(this.rule ? 'Edit folder rule' : 'Add folder rule');
        contentEl.addClass('image-converter-folder-rule-modal');
        let folderInput: HTMLInputElement;
        let presetInput: HTMLSelectElement;
        new Setting(contentEl)
            .setName('Note folder')
            .setDesc('Includes subfolders; / matches vault notes, and file: matches external notes.')
            .addText(text => {
                folderInput = text.inputEl;
                folderInput.setAttribute('aria-label', 'Note folder');
                text.setPlaceholder('Notes/projects, /, or file:').setValue(this.draft.folderPath);
                this.suggest = new FolderSuggest(this.app, folderInput, { includeExternalFiles: true });
                text.onChange(value => { this.draft.folderPath = value; });
            });
        new Setting(contentEl).setName('Global preset').addDropdown(dropdown => {
            presetInput = dropdown.selectEl;
            presetInput.setAttribute('aria-label', 'Global preset for folder');
            dropdown.addOption('', 'Select a global preset');
            for (const preset of this.plugin.settings.globalPresets) dropdown.addOption(preset.name, preset.name);
            if (this.draft.globalPreset && !this.plugin.settings.globalPresets.some(preset => preset.name === this.draft.globalPreset)) {
                dropdown.addOption(this.draft.globalPreset, `Missing: ${this.draft.globalPreset}`);
            }
            dropdown.setValue(this.draft.globalPreset).onChange(value => { this.draft.globalPreset = value; });
        });
        new Setting(contentEl).setName('Enabled').addToggle(toggle => {
            toggle.toggleEl.setAttribute('aria-label', 'Enable folder rule');
            toggle.setValue(this.draft.enabled).onChange(value => { this.draft.enabled = value; });
        });
        const errorEl = contentEl.createDiv('image-converter-folder-rule-error');
        errorEl.setAttribute('role', 'alert');
        let saving = false;
        new Setting(contentEl).setClass('image-converter-folder-rule-actions')
            .addButton(button => button.setButtonText('Cancel').onClick(() => this.close()))
            .addButton(button => button.setButtonText('Save').setCta().onClick(async () => {
                if (saving) return;
                errorEl.setText('');
                const path = normalizeRuleFolderPath(this.draft.folderPath);
                if (path === null) {
                    errorEl.setText('Enter a vault-relative folder, /, or file:.');
                    folderInput.focus();
                    return;
                }
                if (!this.plugin.settings.globalPresets.some(preset => preset.name === this.draft.globalPreset)) {
                    errorEl.setText('Select an existing global preset.');
                    presetInput.focus();
                    return;
                }
                saving = true;
                try {
                    await this.onSave({ ...this.draft, folderPath: path || '/' });
                    this.close();
                } catch (error) {
                    errorEl.setText('Could not save this rule. Try again.');
                    console.error('Could not save image import folder rule:', error);
                } finally {
                    saving = false;
                }
            }));
    }

    onClose(): void {
        this.suggest?.close();
        this.contentEl.empty();
    }
}

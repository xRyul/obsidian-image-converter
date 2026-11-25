import { Setting, SettingGroup, requireApiVersion, type SettingDefinitionBase, type SettingDefinitionControl } from 'obsidian';

export type SharedSettingDefinition = SettingDefinitionControl | (SettingDefinitionBase & {
    render: (setting: Setting) => void;
});

export interface SharedSettingGroupDefinition {
    type: 'group';
    heading: string;
    cls?: string;
    visible?: () => boolean;
    items: SharedSettingDefinition[];
}

export interface SharedSettingPageDefinition {
    type: 'page';
    name: string;
    desc: string;
    displayValue?: () => string;
    items: (SharedSettingDefinition | SharedSettingGroupDefinition)[];
}

export interface SettingsGroupContainer {
    listEl: HTMLElement;
    addSetting(callback: (setting: Setting) => void): void;
}

/** Keep the same grouping on older hosts without requiring the new settings API. */
export function createSettingsGroup(containerEl: HTMLElement, heading: string, cls: string): SettingsGroupContainer {
    if (requireApiVersion('1.11.0') && typeof SettingGroup === 'function') {
        const group = new SettingGroup(containerEl).addClass(cls);
        if (heading) group.setHeading(heading);
        return group;
    }

    const groupEl = containerEl.createDiv(cls);
    if (heading) groupEl.createDiv({ cls: 'image-converter-setting-group-heading', text: heading });
    const listEl = groupEl.createDiv('image-converter-setting-group-list');
    return {
        listEl,
        addSetting(callback) {
            callback(new Setting(listEl));
        },
    };
}

interface SettingsBinding {
    getControlValue(key: string): unknown;
    setControlValue(key: string, value: unknown): void | Promise<void>;
}

/** Render the simple shared definitions on hosts without declarative settings. */
export function renderLegacySettingDefinitions(group: SettingsGroupContainer, definitions: SharedSettingDefinition[], binding: SettingsBinding): void {
    definitions.forEach(definition => {
        if (definition.visible === false || typeof definition.visible === 'function' && !definition.visible()) return;
        group.addSetting(setting => {
            setting.setName(definition.name ?? '').setDesc(definition.desc ?? '');
            if ('render' in definition && definition.render) {
                definition.render(setting);
                return;
            }
            if (!('control' in definition) || !definition.control) return;
            const { control } = definition;
            const value = binding.getControlValue(control.key);
            if (control.type === 'toggle') {
                setting.addToggle(toggle => toggle
                    .setValue(Boolean(value))
                    .onChange(updated => { void binding.setControlValue(control.key, updated); }));
            } else if (control.type === 'dropdown') {
                setting.addDropdown(dropdown => dropdown
                    .addOptions(control.options)
                    .setValue(typeof value === 'string' ? value : '')
                    .onChange(updated => { void binding.setControlValue(control.key, updated); }));
            } else if (control.type === 'text') {
                setting.addText(text => text
                    .setValue(typeof value === 'string' ? value : '')
                    .setPlaceholder(control.placeholder ?? '')
                    .onChange(updated => { void binding.setControlValue(control.key, updated); }));
            } else if (control.type === 'slider') {
                setting.addSlider(slider => slider
                    .setLimits(control.min, control.max, control.step)
                    .setValue(typeof value === 'number' ? value : 0)
                    .onChange(updated => { void binding.setControlValue(control.key, updated); }));
            }
        });
    });
}

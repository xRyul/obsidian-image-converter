import { Notice } from 'obsidian';
import type ImageConverterPlugin from './main';
import { addInfoIcon } from './utils/settingInfo';
import type { SharedSettingDefinition } from './utils/settingsGroup';

/** Share the import controls between native definitions and the legacy settings page. */
export function getImageImportSettingDefinitions(plugin: ImageConverterPlugin): SharedSettingDefinition[] {
    return [
        {
            name: 'Show window',
            desc: 'Choose whether to show processing options on each image drop/paste.',
            control: {
                type: 'dropdown',
                key: 'modalBehavior',
                options: { always: 'Always show', never: 'Never show', ask: 'Ask each time' },
            },
        },
        {
            name: 'Cursor position after drop/paste',
            desc: 'Where to place the cursor after inserting an image link.',
            control: {
                type: 'dropdown',
                key: 'dropPasteCursorLocation',
                options: { front: 'At the front of the link', back: 'At the back of the link' },
            },
        },
        {
            name: 'Show notification for image size changes',
            desc: 'Show how much space was saved after processing an image.',
            control: { type: 'toggle', key: 'showSpaceSavedNotification' },
        },
        {
            name: 'Never process these filenames',
            desc: 'Comma-separated filenames or patterns to exclude from processing.',
            render: setting => {
                addInfoIcon(setting, 'Supports glob (*) and regex (enclosed in /, r/, or regex:), for example old.png, /^_/, or *.gif.');
                setting.addTextArea(text => {
                    text.setValue(plugin.settings.neverProcessFilenames).onChange(async value => {
                        plugin.settings.neverProcessFilenames = value;
                        await plugin.saveSettings();
                    });
                    text.inputEl.setAttribute('spellcheck', 'false');
                });
            },
        },
        {
            name: 'Image metadata',
            desc: 'Choose which EXIF metadata to keep when processing images. Files left unchanged keep their metadata.',
            control: {
                type: 'dropdown',
                key: 'metadataMode',
                options: Object.fromEntries([
                    ['keep-all', 'Keep all'],
                    ['strip-location', 'Keep all except location'],
                    ['strip-all', 'Remove all'],
                ]),
            },
        },
    ];
}

export function getImageInteractionSettingDefinitions(plugin: ImageConverterPlugin): SharedSettingDefinition[] {
    return [{
        name: 'Right-click menu',
        render: setting => {
            addInfoIcon(setting, 'Enable to show a right-click context menu.');
            setting.addToggle(toggle => toggle
                .setValue(plugin.settings.enableContextMenu)
                .onChange(async value => {
                    plugin.settings.enableContextMenu = value;
                    await plugin.saveSettings();
                    new Notice(`Context menu ${value ? 'enabled' : 'disabled'}. Reload Obsidian to see changes.`, 5000);
                }));
        },
    }];
}

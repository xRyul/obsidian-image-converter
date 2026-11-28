import { Notice, requireApiVersion } from 'obsidian';
import type ImageConverterPlugin from './main';
import type { SharedSettingPageDefinition } from './utils/settingsGroup';

export function getImageDisplaySettingPages(plugin: ImageConverterPlugin): SharedSettingPageDefinition[] {
    const { settings } = plugin;
    const alignmentEnabled = () => settings.isImageAlignmentEnabled;
    const resizingEnabled = () => settings.isImageResizeEnbaled;
    const captionsEnabled = () => settings.enableImageCaptions;
    const pages: SharedSettingPageDefinition[] = [
        {
            type: 'page',
            name: 'Image alignment',
            desc: 'Default alignment and the alignment cache.',
            items: [
                { name: 'Enable image alignment', control: { type: 'toggle', key: 'isImageAlignmentEnabled' } },
                {
                    type: 'group', heading: 'Default alignment', visible: alignmentEnabled,
                    items: [{
                        name: 'Default alignment for new images',
                        desc: 'Apply this alignment when inserting images; none keeps their original alignment.',
                        control: {
                            type: 'dropdown', key: 'imageAlignmentDefaultAlignment',
                            options: { none: 'None', left: 'Left', center: 'Center', right: 'Right' },
                        },
                    }],
                },
                {
                    type: 'group', heading: 'Cache', visible: alignmentEnabled,
                    items: [
                        {
                            name: 'Image alignment cache location',
                            desc: 'Use the same location on all devices when using Obsidian Sync.',
                            control: {
                                type: 'dropdown', key: 'imageAlignmentCacheLocation',
                                options: { config: 'Config folder (syncable)', plugin: 'Plugin folder (not syncable)' },
                            },
                        },
                        {
                            name: 'Image alignment cache cleanup interval',
                            desc: 'Minutes between cleanups; 0 disables cleanup.',
                            control: { type: 'slider', key: 'imageAlignmentCacheCleanupInterval', min: 0, max: 120, step: 5 },
                        },
                    ],
                },
            ],
        },
        {
            type: 'page',
            name: 'Drag & scroll resize',
            desc: 'Drag handles, scroll-wheel resizing, and image interaction.',
            items: [
                { name: 'Enable image resizing', control: { type: 'toggle', key: 'isImageResizeEnbaled' } },
                {
                    type: 'group', heading: 'Drag resizing', visible: resizingEnabled,
                    items: [
                        {
                            name: 'Enable drag resize', desc: 'Resize images by dragging their edges.',
                            control: { type: 'toggle', key: 'isDragResizeEnabled' },
                        },
                        {
                            name: 'Lock the aspect ratio when dragging',
                            desc: 'Keep image proportions when resizing.',
                            visible: () => settings.isDragResizeEnabled,
                            control: { type: 'toggle', key: 'isDragAspectRatioLocked' },
                        },
                    ],
                },
                {
                    type: 'group', heading: 'Scroll-wheel resizing', visible: resizingEnabled,
                    items: [
                        {
                            name: 'Enable scroll-wheel resize', desc: 'Resize images using the scroll wheel.',
                            control: { type: 'toggle', key: 'isScrollResizeEnabled' },
                        },
                        {
                            name: 'Scroll-wheel modifier key',
                            desc: 'Key to hold while using scroll-wheel resize.',
                            visible: () => settings.isScrollResizeEnabled,
                            control: {
                                type: 'dropdown', key: 'scrollwheelModifier',
                                options: { None: 'None', Shift: 'Shift', Control: 'Control', Alt: 'Alt', Meta: 'Meta' },
                            },
                        },
                        {
                            name: 'Scroll-wheel resize sensitivity',
                            visible: () => settings.isScrollResizeEnabled,
                            control: { type: 'slider', key: 'resizeSensitivity', min: 0.01, max: 1, step: 0.01 },
                        },
                    ],
                },
                {
                    type: 'group', heading: 'Image interaction', visible: resizingEnabled,
                    items: [
                        {
                            name: 'Disable Obsidian image selection on click',
                            desc: 'Reveal the Markdown link instead of native image selection in live preview.',
                            control: { type: 'toggle', key: 'disableObsidianImageSelectionOnClick' },
                        },
                        {
                            name: 'Cursor position during resize',
                            control: {
                                type: 'dropdown', key: 'resizeCursorLocation',
                                options: { front: 'At the front of the link', back: 'At the back of the link', below: 'One line below the image', none: 'Do not move cursor' },
                            },
                        },
                        {
                            name: 'Allow resizing in reading mode',
                            desc: 'Reading-mode resizing changes the display only, not the image file.',
                            control: { type: 'toggle', key: 'isResizeInReadingModeEnabled' },
                        },
                    ],
                },
            ],
        },
        {
            type: 'page',
            name: 'Captions',
            desc: 'Caption text, appearance, spacing, and excluded image types.',
            items: [
                { name: 'Enable image captions', control: { type: 'toggle', key: 'enableImageCaptions' } },
                {
                    type: 'group', heading: 'Caption text', visible: captionsEnabled,
                    items: [
                        {
                            name: 'Text alignment within caption',
                            control: { type: 'dropdown', key: 'captionAlignment', options: { left: 'Left', center: 'Center', right: 'Right' } },
                        },
                        {
                            name: 'Text transform',
                            control: { type: 'dropdown', key: 'captionTextTransform', options: { none: 'None', uppercase: 'Uppercase', lowercase: 'Lowercase', capitalize: 'Capitalize' } },
                        },
                        {
                            name: 'Font size', desc: 'CSS font size, such as 12px or 1.2em.',
                            control: { type: 'text', key: 'captionFontSize' },
                        },
                        {
                            name: 'Weight',
                            control: { type: 'dropdown', key: 'captionFontWeight', options: { normal: 'Normal', bold: 'Bold', ['300']: 'Light', ['400']: 'Regular', ['500']: 'Medium', ['600']: 'Semi-bold', ['700']: 'Bold' } },
                        },
                        {
                            name: 'Color', desc: 'CSS color or variable, such as var(--text-muted).',
                            control: { type: 'text', key: 'captionColor' },
                        },
                        {
                            name: 'Font style',
                            control: { type: 'dropdown', key: 'captionFontStyle', options: { italic: 'Italic', normal: 'Normal' } },
                        },
                    ],
                },
                {
                    type: 'group', heading: 'Appearance and spacing', visible: captionsEnabled,
                    items: [
                        {
                            name: 'Background color', desc: 'CSS color, such as transparent or var(--background-secondary).',
                            control: { type: 'text', key: 'captionBackgroundColor' },
                        },
                        {
                            name: 'Border', desc: 'CSS border, such as 1px solid gray.',
                            control: { type: 'text', key: 'captionBorder' },
                        },
                        {
                            name: 'Border corner radius', desc: 'CSS radius, such as 4px.',
                            control: { type: 'text', key: 'captionBorderRadius' },
                        },
                        {
                            name: 'Space at the top', desc: 'Space between the image and caption, such as 4px.',
                            control: { type: 'text', key: 'captionMarginTop' },
                        },
                        {
                            name: 'Padding', desc: 'CSS padding, such as 4px 8px.',
                            control: { type: 'text', key: 'captionPadding' },
                        },
                    ],
                },
                {
                    type: 'group', heading: 'Excluded images', visible: captionsEnabled,
                    items: [{
                        name: 'Skip caption extensions', desc: 'Comma-separated extensions, such as png, jpg.',
                        control: { type: 'text', key: 'skipCaptionExtensions' },
                    }],
                },
            ],
        },
    ];
    for (const page of pages) {
        for (const item of page.items) {
            if ('type' in item) item.cls = 'image-converter-display-subpage-group';
        }
    }
    if (requireApiVersion('1.13.1')) {
        const enabled = [alignmentEnabled, resizingEnabled, captionsEnabled];
        pages.forEach((page, index) => { page.displayValue = () => enabled[index]() ? 'Enabled' : 'Disabled'; });
    }
    return pages;
}

/** Preserve the existing runtime side effects after a declarative control saves. */
export async function applyImageDisplaySettingChange(plugin: ImageConverterPlugin, key: string, value: unknown): Promise<void> {
    const enableLabels: Record<string, string> = {
        isImageAlignmentEnabled: 'Image alignment',
        isImageResizeEnbaled: 'Image resizing',
        enableImageCaptions: 'Image captions',
    };
    if (enableLabels[key]) new Notice(`${enableLabels[key]} ${value ? 'enabled' : 'disabled'}. Reload Image Converter to apply changes.`, 5000);
    if (key === 'imageAlignmentCacheLocation') {
        plugin.ImageAlignmentManager?.updateCacheFilePath();
        await plugin.ImageAlignmentManager?.loadCache();
    }
    if (key === 'imageAlignmentCacheCleanupInterval') plugin.ImageAlignmentManager?.scheduleCacheCleanup();
    if (key.startsWith('caption')) plugin.captionManager?.applyCaptionStyles();
    if (key === 'disableObsidianImageSelectionOnClick') {
        new Notice(value
            ? 'Obsidian image selection disabled. Reload Obsidian to see changes.'
            : 'Obsidian image selection enabled. Reload Obsidian to see changes.', 5000);
    }
}

export function isImageDisplayVisibilityKey(key: string): boolean {
    return ['isImageAlignmentEnabled', 'isImageResizeEnbaled', 'enableImageCaptions', 'isDragResizeEnabled', 'isScrollResizeEnabled'].includes(key);
}

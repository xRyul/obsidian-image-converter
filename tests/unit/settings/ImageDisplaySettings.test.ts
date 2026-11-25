import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import * as ObsidianModule from 'obsidian';
import ImageConverterPlugin from '../../../src/main';
import { DEFAULT_SETTINGS, ImageConverterSettingTab } from '../../../src/ImageConverterSettings';
import { getImageDisplaySettingPages } from '../../../src/ImageDisplaySettings';
import { fakeApp, fakePluginManifest } from '../../factories/obsidian';

function setup() {
    const app = fakeApp() as App;
    const plugin = new ImageConverterPlugin(app, fakePluginManifest({ id: 'image-converter' }));
    plugin.settings = structuredClone(DEFAULT_SETTINGS);
    const save = vi.spyOn(plugin, 'saveSettings').mockResolvedValue();
    return { plugin, save, tab: new ImageConverterSettingTab(app, plugin) };
}

describe('image display subpage definitions', () => {
    it('places each enable toggle first and preserves every existing display setting', () => {
        const { plugin } = setup();
        const pages = getImageDisplaySettingPages(plugin);
        expect(pages.map(page => page.name)).toEqual(['Image alignment', 'Drag & scroll resize', 'Captions']);
        expect(pages.map(page => {
            const first = page.items[0];
            return 'control' in first ? first.control?.key : undefined;
        })).toEqual(['isImageAlignmentEnabled', 'isImageResizeEnbaled', 'enableImageCaptions']);
        const keys = pages.flatMap(page => page.items.flatMap(item => 'type' in item ? item.items : [item]))
            .flatMap(item => 'control' in item && item.control ? [item.control.key] : []);
        expect(keys).toHaveLength(26);
        expect(new Set(keys).size).toBe(keys.length);
        expect(keys).toContain('skipCaptionExtensions');
        expect(keys).toContain('imageAlignmentCacheCleanupInterval');
        expect(keys).toContain('disableObsidianImageSelectionOnClick');
        expect(pages.flatMap(page => page.items).filter(item => 'type' in item)
            .every(item => 'cls' in item && item.cls === 'image-converter-display-subpage-group')).toBe(true);
    });

    it('evaluates group visibility and the entry status from current values', () => {
        vi.spyOn(ObsidianModule, 'requireApiVersion').mockReturnValue(true);
        const { plugin } = setup();
        const page = getImageDisplaySettingPages(plugin)[0];
        const group = page.items.find(item => 'type' in item);
        expect(page.displayValue?.()).toBe('Enabled');
        expect(group && 'visible' in group && typeof group.visible === 'function' && group.visible()).toBe(true);
        plugin.settings.isImageAlignmentEnabled = false;
        expect(page.displayValue?.()).toBe('Disabled');
        expect(group && 'visible' in group && typeof group.visible === 'function' && group.visible()).toBe(false);
    });

    it('keeps cache cleanup milliseconds in storage and minutes in the UI', async () => {
        const { plugin, save, tab } = setup();
        expect(tab.getControlValue('imageAlignmentCacheCleanupInterval')).toBe(60);
        await tab.setControlValue('imageAlignmentCacheCleanupInterval', 15);
        expect(plugin.settings.imageAlignmentCacheCleanupInterval).toBe(900000);
        expect(tab.getControlValue('imageAlignmentCacheCleanupInterval')).toBe(15);
        expect(save).toHaveBeenCalledOnce();
    });

    it('keeps cache and caption runtime updates when controls are saved', async () => {
        const { plugin, tab } = setup();
        const updateCacheFilePath = vi.fn();
        const loadCache = vi.fn().mockResolvedValue(undefined);
        const scheduleCacheCleanup = vi.fn();
        const applyCaptionStyles = vi.fn();
        Object.assign(plugin, {
            ImageAlignmentManager: { updateCacheFilePath, loadCache, scheduleCacheCleanup },
            captionManager: { applyCaptionStyles },
        });
        await tab.setControlValue('imageAlignmentCacheLocation', 'plugin');
        expect(updateCacheFilePath).toHaveBeenCalledOnce();
        expect(loadCache).toHaveBeenCalledOnce();
        await tab.setControlValue('imageAlignmentCacheCleanupInterval', 30);
        expect(scheduleCacheCleanup).toHaveBeenCalledOnce();
        await tab.setControlValue('captionColor', 'var(--text-normal)');
        expect(applyCaptionStyles).toHaveBeenCalledOnce();
        expect(plugin.settings.captionColor).toBe('var(--text-normal)');
    });

    it('refreshes predicates without rebuilding native settings after enabling a feature', async () => {
        vi.spyOn(ObsidianModule, 'requireApiVersion').mockReturnValue(true);
        const { tab } = setup();
        const refresh = vi.spyOn(tab, 'refreshDomState');
        const update = vi.spyOn(tab, 'update');
        await tab.setControlValue('isImageAlignmentEnabled', false);
        expect(refresh).toHaveBeenCalledOnce();
        expect(update).not.toHaveBeenCalled();
    });

    it('keeps a legacy subpage open when its enable control changes', async () => {
        const { plugin, tab } = setup();
        tab.display();
        const entry = Array.from(tab.containerEl.querySelectorAll('.setting-item'))
            .find(item => item.querySelector('.setting-item-name')?.textContent === 'Image alignment')!;
        entry.querySelector<HTMLButtonElement>('button')!.click();
        expect(tab.containerEl.textContent).toContain('Enable image alignment');
        await tab.setControlValue('isImageAlignmentEnabled', false);
        expect(plugin.settings.isImageAlignmentEnabled).toBe(false);
        expect(tab.containerEl.textContent).toContain('Enable image alignment');
        expect(tab.containerEl.textContent).not.toContain('Image alignment cache location');
        await tab.setControlValue('isImageAlignmentEnabled', true);
        expect(tab.containerEl.textContent).toContain('Image alignment cache location');
        expect(tab.containerEl.querySelector('.image-converter-setting-tabs')).toBeNull();
    });
});

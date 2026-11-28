import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../src/ImageConverterSettings';
import { normalizeRuleFolderPath, resolveSettingsForNote } from '../../../src/FolderPresetRules';

function settingsWithRules() {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.folderPresets.push({ name: 'Project assets', type: 'CUSTOM', customTemplate: 'Projects/Assets' });
    settings.conversionPresets.push({ ...settings.conversionPresets[0], name: 'Project compression', outputFormat: 'WEBP', quality: 42 });
    settings.globalPresets.push({
        name: 'Project profile',
        folderPreset: 'Project assets',
        conversionPreset: 'Project compression',
        filenamePreset: settings.selectedFilenamePreset,
        linkFormatPreset: settings.linkFormatSettings.selectedLinkFormatPreset,
        resizePreset: settings.nonDestructiveResizeSettings.selectedResizePreset
    });
    settings.folderPresetRules = [{ folderPath: 'Projects', globalPreset: 'Project profile', enabled: true }];
    return settings;
}

describe('folder-based presets', () => {
    it('uses matching folders and descendants, without matching sibling prefixes', () => {
        const settings = settingsWithRules();
        for (const note of ['Projects/Note.md', 'Projects/Sub/Note.md']) {
            const resolved = resolveSettingsForNote(settings, note);
            expect(resolved.selectedFolderPreset).toBe('Project assets');
            expect(resolved.selectedConversionPreset).toBe('Project compression');
        }
        expect(resolveSettingsForNote(settings, 'ProjectsOther/Note.md')).toEqual(settings);
        expect(resolveSettingsForNote(settings, 'Note.md')).toEqual(settings);
    });

    it('selects the most specific valid rule and preserves first-rule precedence for ties', () => {
        const settings = settingsWithRules();
        settings.globalPresets.push({ ...settings.globalPresets.at(-1)!, name: 'Specific' });
        settings.folderPresetRules!.push(
            { folderPath: 'Projects/Sub', globalPreset: 'Specific', enabled: true },
            { folderPath: 'Projects/Sub', globalPreset: 'Project profile', enabled: true }
        );
        expect(resolveSettingsForNote(settings, 'Projects/Sub/Note.md').selectedGlobalPreset).toBe('Specific');
    });

    it('supports an explicit root rule and normalizes Windows/trailing separators', () => {
        const settings = settingsWithRules();
        settings.folderPresetRules![0].folderPath = '/';
        expect(resolveSettingsForNote(settings, 'Note.md').selectedGlobalPreset).toBe('Project profile');
        expect(resolveSettingsForNote(settings, 'Other/Note.md').selectedGlobalPreset).toBe('Project profile');
        settings.folderPresetRules![0].folderPath = ' Projects\\Sub/ ';
        expect(resolveSettingsForNote(settings, 'Projects/Sub/Note.md').selectedGlobalPreset).toBe('Project profile');
    });

    it.each([
        'file:D:/Apps/Su/读我.md',
        'file:D:\\Apps\\Su\\Readme.md',
        'file:///D:/Apps/Su/Readme.md',
        'file:/home/user/Readme.md',
    ])('matches external notes independently of vault rules: %s', notePath => {
        const settings = settingsWithRules();
        settings.globalPresets.push({ ...settings.globalPresets[0], name: 'Vault fallback' });
        settings.folderPresetRules = [
            { folderPath: '/', globalPreset: 'Vault fallback', enabled: true },
            { folderPath: 'file:', globalPreset: 'Project profile', enabled: true },
        ];
        expect(resolveSettingsForNote(settings, notePath).selectedGlobalPreset).toBe('Project profile');
        expect(resolveSettingsForNote(settings, 'Projects/Note.md').selectedGlobalPreset).toBe('Vault fallback');
        expect(resolveSettingsForNote(settings, 'Note.md').selectedGlobalPreset).toBe('Vault fallback');
    });

    it('does not apply a vault fallback when the external rule is disabled or missing', () => {
        const settings = settingsWithRules();
        settings.folderPresetRules = [
            { folderPath: '/', globalPreset: 'Project profile', enabled: true },
            { folderPath: 'file:', globalPreset: 'Project profile', enabled: false },
        ];
        expect(resolveSettingsForNote(settings, 'file:D:/Apps/Readme.md').selectedGlobalPreset).toBe(settings.selectedGlobalPreset);
        settings.folderPresetRules[1].enabled = true;
        settings.folderPresetRules[1].globalPreset = 'Missing';
        expect(resolveSettingsForNote(settings, 'file:D:/Apps/Readme.md').selectedGlobalPreset).toBe(settings.selectedGlobalPreset);
    });

    it('preserves the first enabled external rule when paths are duplicated', () => {
        const settings = settingsWithRules();
        settings.folderPresetRules = [
            { folderPath: 'file:', globalPreset: 'Project profile', enabled: true },
            { folderPath: 'file:', globalPreset: settings.globalPresets[0].name, enabled: true },
        ];
        expect(resolveSettingsForNote(settings, 'file:D:/Readme.md').selectedGlobalPreset).toBe('Project profile');
    });

    it.each(['', '  ', '../Projects', 'Projects/../Other', 'C:/Projects'])('ignores an invalid or incomplete folder: %s', folderPath => {
        const settings = settingsWithRules();
        settings.folderPresetRules![0].folderPath = folderPath;
        expect(resolveSettingsForNote(settings, 'Projects/Note.md')).toEqual(settings);
    });

    it('ignores disabled and missing global presets, allowing a valid parent to apply', () => {
        const settings = settingsWithRules();
        settings.folderPresetRules!.push({ folderPath: 'Projects/Sub', globalPreset: 'Deleted profile', enabled: true });
        expect(resolveSettingsForNote(settings, 'Projects/Sub/Note.md').selectedGlobalPreset).toBe('Project profile');
        settings.folderPresetRules![0].enabled = false;
        expect(resolveSettingsForNote(settings, 'Projects/Sub/Note.md')).toEqual(settings);
    });

    it('falls back per missing constituent preset, without changing other categories', () => {
        const settings = settingsWithRules();
        settings.globalPresets.at(-1)!.conversionPreset = 'Deleted conversion';
        const resolved = resolveSettingsForNote(settings, 'Projects/Note.md');
        expect(resolved.selectedConversionPreset).toBe(settings.selectedConversionPreset);
        expect(resolved.selectedFolderPreset).toBe('Project assets');
    });

    it('isolates selections, editable presets and modal template state between imports', () => {
        const settings = settingsWithRules();
        settings.modalSessionState = { customFolderOverride: 'Wrong/assets' };
        const before = structuredClone(settings);
        const first = resolveSettingsForNote(settings, 'Projects/Note.md');
        const second = resolveSettingsForNote(settings, 'Projects/Other.md');
        first.folderPresets.at(-1)!.customTemplate = 'Changed/assets';
        first.conversionPresets.at(-1)!.quality = 1;
        first.linkFormatSettings.linkFormatPresets[0].name = 'Changed';
        expect(first.modalSessionState).toBeUndefined();
        expect(settings).toEqual(before);
        expect(second.folderPresets.at(-1)!.customTemplate).toBe('Projects/Assets');
        expect(second.conversionPresets.at(-1)!.quality).toBe(42);
        const unmatched = resolveSettingsForNote(settings, 'Other/Note.md');
        unmatched.conversionPresets.at(-1)!.quality = 2;
        expect(unmatched.modalSessionState).toBeUndefined();
        expect(settings).toEqual(before);
    });

    it('preserves the original modal session behavior when no rules are configured', () => {
        const settings = settingsWithRules();
        settings.folderPresetRules = [];
        settings.modalSessionState = { customFolderOverride: 'Remembered/assets' };
        expect(resolveSettingsForNote(settings, 'Other/Note.md')).toBe(settings);
    });
});

describe('normalizeRuleFolderPath', () => {
    it('requires an explicit root and rejects traversal', () => {
        expect(normalizeRuleFolderPath('/')).toBe('');
        expect(normalizeRuleFolderPath('.')).toBe('');
        expect(normalizeRuleFolderPath('A//B/')).toBe('A/B');
        expect(normalizeRuleFolderPath('A/./B')).toBeNull();
    });

    it('accepts the external-files selector without accepting arbitrary colon paths', () => {
        expect(normalizeRuleFolderPath(' file: ')).toBe('file:');
        expect(normalizeRuleFolderPath('file:D:/Apps')).toBeNull();
        expect(normalizeRuleFolderPath('https:')).toBeNull();
        expect(normalizeRuleFolderPath('file:\0')).toBeNull();
    });
});

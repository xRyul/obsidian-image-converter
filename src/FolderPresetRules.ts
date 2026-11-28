import type { ImageConverterSettings } from './ImageConverterSettings';

export interface FolderPresetRule {
    folderPath: string;
    globalPreset: string;
    enabled: boolean;
}

export const EXTERNAL_FILES_PATH = 'file:';

/** Use / for vault notes and file: for external notes; a blank field is incomplete. */
export function normalizeRuleFolderPath(value: string): string | null {
    const path = value.trim().replace(/\\/g, '/');
    if (path === EXTERNAL_FILES_PATH) return EXTERNAL_FILES_PATH;
    if (!path || /[:\0]/.test(path)) return null;
    if (path === '/' || path === '.') return '';
    const parts = path.split('/').filter(Boolean);
    if (parts.some(part => part === '.' || part === '..')) return null;
    return parts.join('/');
}

/** Vault folder rules never apply to notes opened through the file: scheme. */
function matchesRuleFolder(path: string, folder: string, external: boolean): boolean {
    if (path === EXTERNAL_FILES_PATH) return external;
    if (external) return false;
    return !path || folder === path || folder.startsWith(`${path}/`);
}

/** Resolve a per-import snapshot without changing the global selection or presets. */
export function resolveSettingsForNote(
    settings: ImageConverterSettings,
    notePath: string
): ImageConverterSettings {
    if (!settings.folderPresetRules?.length) return settings;
    const external = notePath.startsWith(EXTERNAL_FILES_PATH);
    const folder = notePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
    let match: FolderPresetRule | undefined;
    let matchLength = -1;
    for (const rule of settings.folderPresetRules ?? []) {
        if (!rule?.enabled || typeof rule.folderPath !== 'string') continue;
        const path = normalizeRuleFolderPath(rule.folderPath);
        if (path === null || !matchesRuleFolder(path, folder, external)) continue;
        if (!settings.globalPresets.some(preset => preset.name === rule.globalPreset)) continue;
        if (path.length > matchLength) {
            match = rule;
            matchLength = path.length;
        }
    }
    const preset = settings.globalPresets.find(candidate => candidate.name === match?.globalPreset);

    // The selection modal can edit presets and custom templates. Keep those edits local
    // to this import, and do not reuse another folder's saved template overrides.
    const snapshot: ImageConverterSettings = {
        ...settings,
        globalPresets: settings.globalPresets.map(item => ({ ...item })),
        folderPresets: settings.folderPresets.map(item => ({ ...item })),
        filenamePresets: settings.filenamePresets.map(item => ({ ...item })),
        conversionPresets: settings.conversionPresets.map(item => ({ ...item })),
        linkFormatSettings: {
            ...settings.linkFormatSettings,
            linkFormatPresets: settings.linkFormatSettings.linkFormatPresets.map(item => ({ ...item }))
        },
        nonDestructiveResizeSettings: {
            ...settings.nonDestructiveResizeSettings,
            resizePresets: settings.nonDestructiveResizeSettings.resizePresets.map(item => ({ ...item }))
        },
        modalSessionState: undefined,
        selectedGlobalPreset: preset?.name ?? settings.selectedGlobalPreset
    };
    if (!preset) return snapshot;
    const available = (name: string, items: { name: string }[], fallback: string) =>
        items.some(item => item.name === name) ? name : fallback;
    snapshot.selectedFolderPreset = available(preset.folderPreset, snapshot.folderPresets, settings.selectedFolderPreset);
    snapshot.selectedFilenamePreset = available(preset.filenamePreset, snapshot.filenamePresets, settings.selectedFilenamePreset);
    snapshot.selectedConversionPreset = available(preset.conversionPreset, snapshot.conversionPresets, settings.selectedConversionPreset);
    snapshot.linkFormatSettings.selectedLinkFormatPreset = available(preset.linkFormatPreset, snapshot.linkFormatSettings.linkFormatPresets, settings.linkFormatSettings.selectedLinkFormatPreset);
    snapshot.nonDestructiveResizeSettings.selectedResizePreset = available(preset.resizePreset, snapshot.nonDestructiveResizeSettings.resizePresets, settings.nonDestructiveResizeSettings.selectedResizePreset);
    return snapshot;
}

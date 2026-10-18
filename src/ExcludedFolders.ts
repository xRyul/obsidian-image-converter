import type { ImageConverterSettings } from './ImageConverterSettings';

function normalizeVaultPath(value: string): string {
    const parts: string[] = [];
    for (const part of value.replace(/\\/g, '/').split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') parts.pop();
        else parts.push(part);
    }
    return parts.join('/');
}

/** Folder entries are vault-relative, case-sensitive, and always include subfolders. */
export function isPathExcluded(
    filePath: string | null | undefined,
    settings: Pick<ImageConverterSettings, 'excludedFolders'>
): boolean {
    if (!filePath) return false;
    const normalizedPath = normalizeVaultPath(filePath);
    return (settings.excludedFolders ?? '').split(/\r?\n/).some(entry => {
        if (!entry.trim()) return false;
        const folder = normalizeVaultPath(entry.trim());
        return folder === '' || normalizedPath === folder || normalizedPath.startsWith(`${folder}/`);
    });
}

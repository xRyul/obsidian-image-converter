import { describe, expect, it } from 'vitest';
import { isPathExcluded } from '../../../src/ExcludedFolders';

describe('Global excluded folders', () => {
    it('keeps existing behavior for empty and legacy settings', () => {
        expect(isPathExcluded('Research/image.png', { excludedFolders: '' })).toBe(false);
        expect(isPathExcluded('Research/image.png', {} as { excludedFolders: string })).toBe(false);
    });

    it('matches a folder and all descendants without matching sibling prefixes', () => {
        const settings = { excludedFolders: 'Research' };
        expect(isPathExcluded('Research', settings)).toBe(true);
        expect(isPathExcluded('Research/Project/image.png', settings)).toBe(true);
        expect(isPathExcluded('Research notes/image.png', settings)).toBe(false);
        expect(isPathExcluded('Other/Research/image.png', settings)).toBe(false);
        expect(isPathExcluded('research/image.png', settings)).toBe(false);
    });

    it('supports multiple folders, spaces, Unicode, CRLF and Windows separators', () => {
        const settings = { excludedFolders: '  Research Projects/  \r\n\r\n资料\\原始文件' };
        expect(isPathExcluded('./Research Projects/note.md', settings)).toBe(true);
        expect(isPathExcluded('资料/原始文件/image.png', settings)).toBe(true);
        expect(isPathExcluded('资料/原始文件副本/image.png', settings)).toBe(false);
    });

    it('normalizes path segments before checking exclusions', () => {
        expect(isPathExcluded('Other/../Research/./image.png', { excludedFolders: 'Research' })).toBe(true);
        expect(isPathExcluded('Research/../Other/image.png', { excludedFolders: 'Research' })).toBe(false);
    });

    it('can exclude the vault root explicitly and ignores missing paths', () => {
        expect(isPathExcluded('image.png', { excludedFolders: '/' })).toBe(true);
        expect(isPathExcluded(null, { excludedFolders: '/' })).toBe(false);
    });
});

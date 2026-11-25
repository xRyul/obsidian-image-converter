import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { FolderSuggest } from '../../../src/FolderSuggest';
import { fakeApp, fakeTFolder, fakeVault } from '../../factories/obsidian';

describe('folder rule path suggestions', () => {
    function makeSuggest(includeExternalFiles: boolean) {
        const folders = [fakeTFolder({ path: 'Projects' })];
        const app = fakeApp({ vault: fakeVault({ folders }) }) as App;
        return new FolderSuggest(app, document.createElement('input'), { includeExternalFiles });
    }

    it('places external files before a single vault root option', () => {
        const suggest = makeSuggest(true);
        const items = suggest.getSuggestions('');
        expect(items.map(item => item.path)).toEqual(['file:', '/', 'Projects']);
        const el = document.createElement('div');
        suggest.renderSuggestion(items[0], el);
        expect(el.textContent).toBe('External files (file:)');
    });

    it('searches special options by label and path', () => {
        const suggest = makeSuggest(true);
        expect(suggest.getSuggestions('external').map(item => item.path)).toEqual(['file:']);
        expect(suggest.getSuggestions('file:').map(item => item.path)).toEqual(['file:']);
        expect(suggest.getSuggestions('vault').map(item => item.path)).toEqual(['/']);
        expect(suggest.getSuggestions('proj').map(item => item.path)).toEqual(['Projects']);
    });

    it('keeps ordinary folder suggesters vault-only', () => {
        expect(makeSuggest(false).getSuggestions('').map(item => item.path)).toEqual(['Projects', '/']);
    });

    it('does not duplicate a root represented by an empty path', () => {
        const app = fakeApp({ vault: fakeVault({ folders: [fakeTFolder({ path: '' })] }) }) as App;
        const suggest = new FolderSuggest(app, document.createElement('input'), { includeExternalFiles: true });
        expect(suggest.getSuggestions('').map(item => item.path)).toEqual(['file:', '/']);
    });
});

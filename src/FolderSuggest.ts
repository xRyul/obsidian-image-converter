import { AbstractInputSuggest, App, TFolder } from 'obsidian';
import { EXTERNAL_FILES_PATH } from './FolderPresetRules';

export type FolderSuggestion = TFolder | { path: string; label: string };

interface FolderSuggestOptions {
    includeExternalFiles?: boolean;
}

type InputSuggestBaseInstance = {
    app: App;
    close(): void;
};

type InputSuggestBaseConstructor = new (
    app: App,
    inputEl: HTMLInputElement,
) => InputSuggestBaseInstance;

const folderSuggestBase = (AbstractInputSuggest ?? class {
    app: App;

    constructor(app: App, _inputEl: HTMLInputElement) {
        this.app = app;
    }

    close(): void {}
}) as unknown as InputSuggestBaseConstructor;

export class FolderSuggest extends folderSuggestBase {
    private inputEl: HTMLInputElement;

    constructor(app: App, inputEl: HTMLInputElement, private options: FolderSuggestOptions = {}) {
        super(app, inputEl);
        this.inputEl = inputEl;
    }

    getSuggestions(query: string): FolderSuggestion[] {
        const lowerQuery = query.toLowerCase();
        const folders = this.app.vault.getAllLoadedFiles().filter((file): file is TFolder => file instanceof TFolder);
        const suggestions: FolderSuggestion[] = folders;
        if (this.options.includeExternalFiles) {
            suggestions.unshift(
                { path: EXTERNAL_FILES_PATH, label: 'External files (file:)' },
                { path: '/', label: 'Vault root (/)' },
            );
        }

        return suggestions.filter(folder => {
            if (this.options.includeExternalFiles && folder instanceof TFolder && (!folder.path || folder.path === '/')) return false;
            const label = 'label' in folder ? folder.label : folder.path;
            return !lowerQuery || folder.path.toLowerCase().includes(lowerQuery) || label.toLowerCase().includes(lowerQuery);
        });
    }

    renderSuggestion(folder: FolderSuggestion, el: HTMLElement): void {
        el.setText('label' in folder ? folder.label : folder.path);
    }

    selectSuggestion(folder: FolderSuggestion): void {
        this.inputEl.value = folder.path;

        const triggerableInput = this.inputEl as HTMLInputElement & {
            trigger?: (eventName: string) => void;
        };

        if (typeof triggerableInput.trigger === 'function') {
            triggerableInput.trigger('input');
        } else {
            const eventConstructor = this.inputEl.ownerDocument.defaultView?.Event ?? Event;
            this.inputEl.dispatchEvent(new eventConstructor('input', { bubbles: true }));
            this.inputEl.dispatchEvent(new eventConstructor('change', { bubbles: true }));
        }

        this.close();
    }
}

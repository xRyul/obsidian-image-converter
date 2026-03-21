import { AbstractInputSuggest, App, TFolder } from 'obsidian';

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

    constructor(app: App, inputEl: HTMLInputElement) {
        super(app, inputEl);
        this.inputEl = inputEl;
    }

    getSuggestions(query: string): TFolder[] {
        const lowerQuery = query.toLowerCase();
        const folders = this.app.vault.getAllLoadedFiles().filter((file): file is TFolder => file instanceof TFolder);

        if (!lowerQuery) {
            return folders;
        }

        return folders.filter((folder) => folder.path.toLowerCase().includes(lowerQuery));
    }

    renderSuggestion(folder: TFolder, el: HTMLElement): void {
        el.setText(folder.path);
    }

    selectSuggestion(folder: TFolder): void {
        this.inputEl.value = folder.path;

        const triggerableInput = this.inputEl as HTMLInputElement & {
            trigger?: (eventName: string) => void;
        };

        if (typeof triggerableInput.trigger === 'function') {
            triggerableInput.trigger('input');
        } else {
            this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
            this.inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        }

        this.close();
    }
}

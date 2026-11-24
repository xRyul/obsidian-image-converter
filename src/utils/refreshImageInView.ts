// Shows the new content of an image file in the open note after a modal
// saves over it, without reloading the note.

import { MarkdownView, type App, type TFile } from "obsidian";

/**
 * Loads the image again in every `<img>` of the active note that shows the file.
 *
 * The browser keeps showing the old picture while an `<img>` keeps its address.
 * Obsidian's address for a vault file ends in `?<modified time>`, so this gives
 * each matching `<img>` the same address with a new time after the `?`. Only
 * those images load again. The note is not rebuilt, so it keeps its scroll
 * position.
 *
 * An `<img>` matches when its address without the `?` part is the file's
 * address without the `?` part. This finds names with spaces, `#` or other
 * characters that addresses encode, and skips other files whose path ends
 * with the same name.
 */
export function refreshImageInView(app: App, file: TFile): void {
    const view = app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;

    const fileAddress = withoutQuery(app.vault.getResourcePath(file));
    const newAddress = `${fileAddress}?${Date.now()}`;
    for (const img of Array.from(view.containerEl.querySelectorAll("img"))) {
        if (withoutQuery(img.src) === fileAddress) {
            img.src = newAddress;
        }
    }
}

function withoutQuery(address: string): string {
    const queryStart = address.indexOf("?");
    return queryStart === -1 ? address : address.slice(0, queryStart);
}

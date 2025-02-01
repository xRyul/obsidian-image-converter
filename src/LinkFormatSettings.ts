// LinkFormatSettings.ts

export type LinkFormat = "wikilink" | "markdown";
export type PathFormat = "shortest" | "relative" | "absolute";

export interface LinkFormatPreset {
    name: string;
    linkFormat: LinkFormat;
    pathFormat: PathFormat;
    prependCurrentDir: boolean;
    hideFolders: boolean;
}

export class LinkFormatSettings {
    linkFormatPresets: LinkFormatPreset[];
    selectedLinkFormatPreset: string;

    constructor() {
        this.linkFormatPresets = [
            {
                name: "Default (Wikilink, Shortest)",
                linkFormat: "wikilink",
                pathFormat: "shortest",
                prependCurrentDir: false,
                hideFolders: false,
            },
            {
                name: "Markdown, Relative",
                linkFormat: "markdown",
                pathFormat: "relative",
                prependCurrentDir: true,
                hideFolders: false,
            },
            // ... more presets can be added here
        ];
        this.selectedLinkFormatPreset = "Default (Wikilink, Shortest)";
    }

    // Add methods to manage presets (add, delete, update) if needed
}
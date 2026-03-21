import {
    App,
    Modal,
    Notice,
    PluginSettingTab,
    Setting,
    ButtonComponent,
    setIcon,
    TextComponent,
    TFile
} from "obsidian";
import ImageConverterPlugin from "./main";
import { VariableProcessor } from "./VariableProcessor";
import { LinkFormat, PathFormat, LinkFormatSettings, LinkFormatPreset } from "./LinkFormatSettings";
import { NonDestructiveResizeSettings, NonDestructiveResizePreset, ResizeDimension, ResizeScaleMode, ResizeUnits } from "./NonDestructiveResizeSettings";
import { ToolPreset } from "./ImageAnnotation";
import { SingleImageModalSettings } from './ProcessSingleImageModal';
import { findFfmpegExecutablePath, normalizeExecutablePath } from "./utils/ffmpegPath";

import Sortable from "sortablejs";

// --- Typedefs and Interfaces ---
export type ModalBehavior = "always" | "never" | "ask";

export type FolderPresetType =
    | "DEFAULT"
    | "ROOT"
    | "CURRENT"
    | "SUBFOLDER"
    | "CUSTOM";
export type FilenamePresetType =
    | "DEFAULT"
    | "ORIGINAL"
    | "NOTENAME_TIMESTAMP"
    | "CUSTOM";
export type OutputFormat = "WEBP" | "JPEG" | "PNG" | "ORIGINAL" | "NONE" | "PNGQUANT" | "AVIF";
export type ResizeMode =
    | "None"
    | "Fit"
    | "Fill"
    | "LongestEdge"
    | "ShortestEdge"
    | "Width"
    | "Height";
export type EnlargeReduce = "Auto" | "Reduce" | "Enlarge";

export type ActivePresetSetting =
    | "selectedFolderPreset"
    | "selectedFilenamePreset"
    | "selectedConversionPreset"
    | "selectedLinkFormatPreset"
    | "selectedResizePreset";

// Using interfaces is generally preferred for object shapes
export interface FolderPreset {
    type: FolderPresetType;
    customTemplate?: string; // Only used for CUSTOM type
    name: string;
}

export interface FilenamePreset {
    // type: FilenamePresetType;
    customTemplate?: string; // Only used for CUSTOM type
    name: string;
    skipRenamePatterns: string;
    conflictResolution: "reuse" | "increment";
}

// Interface for a Conversion Preset
export interface ConversionPreset {
    name: string;
    outputFormat: OutputFormat;
    quality: number;
    colorDepth: number;
    resizeMode: ResizeMode;
    desiredWidth: number;
    desiredHeight: number;
    desiredLongestEdge: number;
    enlargeOrReduce: EnlargeReduce;
    allowLargerFiles: boolean;
    revertToOriginalIfLarger?: boolean;
    minimumCompressionSavingsInKB?: number;
    skipConversionPatterns: string;
    pngquantExecutablePath?: string;
    pngquantQuality?: string;
    ffmpegExecutablePath?: string;
    ffmpegCrf?: number;
    ffmpegPreset?: string;
    detectedEncoder?: string;  // Cached detected encoder for AVIF
}

// Interface for UI state management (more structured)
interface PresetUIState {
    folder: PresetCategoryUIState<FolderPreset>;
    filename: PresetCategoryUIState<FilenamePreset>;
    conversion: PresetCategoryUIState<ConversionPreset>;
    linkformat: PresetCategoryUIState<LinkFormatPreset>
    globalPresetVisible: boolean; // Track visibility of preset categories
    resize: PresetCategoryUIState<NonDestructiveResizePreset>;
    imageAlignmentSectionCollapsed: boolean;
    imageDragResizeSectionCollapsed: boolean;
    imageCaptionSectionCollapsed: boolean; // ADDED: Track caption section collapse state
}

interface PresetCategoryUIState<T> {
    editingPreset: T | null;
    newPreset: T | null;
}

export interface GlobalPreset {
    name: string;
    folderPreset: string; // Name of the selected FolderPreset
    filenamePreset: string; // Name of the selected FilenamePreset
    conversionPreset: string; // Name of the selected ConversionPreset
    linkFormatPreset: string; // Name of the selected LinkFormatPreset
    resizePreset: string;
}

// Interface for settings
export interface ImageConverterSettings {
    folderPresets: FolderPreset[];
    selectedFolderPreset: string;
    filenamePresets: FilenamePreset[];
    selectedFilenamePreset: string;
    conversionPresets: ConversionPreset[];
    selectedConversionPreset: string;
    globalPresets: GlobalPreset[];
    selectedGlobalPreset: string; // Currently selected global preset (if any)
    modalSessionState?: {
        customFolderOverride?: string;
        customFilenameOverride?: string;
        lastUsedFolderPreset?: string;
        lastUsedFilenamePreset?: string;
    };
    outputFormat: OutputFormat;
    quality: number;
    colorDepth: number;

    pngquantQuality: string;

    ffmpegExecutablePath: string;  // For AVIF
    ffmpegCrf: number;             // For AVIF
    ffmpegPreset: string;          // For AVIF
    detectedEncoder?: string;      // Cached detected encoder for AVIF

    resizeMode: ResizeMode;
    desiredWidth: number;
    desiredHeight: number;
    desiredLongestEdge: number;
    enlargeOrReduce: EnlargeReduce;
    allowLargerFiles: boolean;
    showPresetModal: {
        folder: boolean;
        filename: boolean;
    };
    subfolderTemplate: string;
    linkFormatSettings: LinkFormatSettings;
    nonDestructiveResizeSettings: NonDestructiveResizeSettings;

    resizeCursorLocation: "front" | "back" | "below" |"none";
    dropPasteCursorLocation: "front" | "back";

    neverProcessFilenames: string;
    modalBehavior: ModalBehavior;

    singleImageModalSettings?: SingleImageModalSettings;

    ProcessCurrentNoteconvertTo: string;
    ProcessCurrentNotequality: number;
    ProcessCurrentNoteResizeModalresizeMode: string;
    ProcessCurrentNoteresizeModaldesiredWidth: number;
    ProcessCurrentNoteresizeModaldesiredHeight: number;
    ProcessCurrentNoteresizeModaldesiredLength: number;
    ProcessCurrentNoteskipImagesInTargetFormat: boolean;
    ProcessCurrentNoteEnlargeOrReduce: 'Always' | 'Reduce' | 'Enlarge';
    ProcessCurrentNoteSkipFormats: string;
    ProcessCurrentNoteIgnoreFolders: string;

    ProcessAllVaultconvertTo: string;
    ProcessAllVaultquality: number;
    ProcessAllVaultResizeModalresizeMode: string;
    ProcessAllVaultResizeModaldesiredWidth: number;
    ProcessAllVaultResizeModaldesiredHeight: number;
    ProcessAllVaultResizeModaldesiredLength: number;
    ProcessAllVaultEnlargeOrReduce: string;
    ProcessAllVaultSkipFormats: string;
    ProcessAllVaultskipImagesInTargetFormat: boolean;

    annotationPresets: {
        drawing: ToolPreset[];
        arrow: ToolPreset[];
        text: ToolPreset[];
    };

    isImageAlignmentEnabled: boolean;
    imageAlignmentDefaultAlignment: 'none' | 'left' | 'center' | 'right';
    imageAlignmentCacheCleanupInterval: number;
    imageAlignmentCacheLocation: "config" | "plugin";

    isDragResizeEnabled: boolean;
    isDragAspectRatioLocked: boolean;
    isScrollResizeEnabled: boolean;
    isResizeInReadingModeEnabled: boolean;

    resizeSensitivity: number;
    scrollwheelModifier: "None" | "Shift" | "Control" | "Alt" | "Meta";
    isImageResizeEnbaled: boolean;
    resizeState: { isResizing: boolean; };

    enableContextMenu: boolean;

    showSpaceSavedNotification: boolean;
    revertToOriginalIfLarger: boolean;
    minimumCompressionSavingsInKB: number;

    enableImageCaptions: boolean;
    skipCaptionExtensions: string;
    captionFontSize: string;
    captionColor: string;
    captionFontStyle: string;
    captionBackgroundColor: string;
    captionPadding: string;
    captionBorderRadius: string;
    captionOpacity: string;
    captionFontWeight: string;
    captionTextTransform: string;
    captionLetterSpacing: string;
    captionBorder: string;
    captionMarginTop: string;
    captionAlignment: string;
}

// --- Default Settings ---

export const DEFAULT_SETTINGS: ImageConverterSettings = {
    folderPresets: [
        { type: "DEFAULT", name: "Default (Obsidian setting)" },
        { type: "ROOT", name: "Root folder" },
        { type: "CURRENT", name: "Same folder as current note" },
        // { type: "SUBFOLDER", name: "In subfolder under current note" }, // Example for adding SUBFOLDER later
    ],
    selectedFolderPreset: "Default (Obsidian setting)",
    filenamePresets: [
        // { name: "Default (No Change)", customTemplate: "{imagename}", skipRenamePatterns: "", conflictResolution: "increment" }, // This must be disabled!!!
        { name: "Keep original name", customTemplate: "{imagename}", skipRenamePatterns: "", conflictResolution: "increment" },
        { name: "NoteName-Timestamp", customTemplate: "{notename}-{timestamp}", skipRenamePatterns: "", conflictResolution: "increment" },
    ],
    selectedFilenamePreset: "Keep original name",
    outputFormat: "NONE",
    quality: 100,
    colorDepth: 1,

    pngquantQuality: "65-80",

    ffmpegExecutablePath: "",  // Default for AVIF
    ffmpegCrf: 23,             // Default for AVIF
    ffmpegPreset: "medium",    // Default for AVIF
    detectedEncoder: undefined, // No cached encoder by default

    resizeMode: "None",
    desiredWidth: 800,
    desiredHeight: 600,
    desiredLongestEdge: 1000,
    enlargeOrReduce: "Auto",
    allowLargerFiles: false,
    showPresetModal: {
        folder: false,
        filename: false,
    },
    subfolderTemplate: "",
    conversionPresets: [
        {
            name: "None",
            outputFormat: "NONE",
            quality: 100,
            colorDepth: 1,
            resizeMode: "None",
            desiredWidth: 800,
            desiredHeight: 600,
            desiredLongestEdge: 1000,
            enlargeOrReduce: "Auto",
            allowLargerFiles: false,
            revertToOriginalIfLarger: false,
            minimumCompressionSavingsInKB: 30,
            skipConversionPatterns: "",
            pngquantExecutablePath: "",
            pngquantQuality: "65-80",
            ffmpegExecutablePath: "",
            ffmpegCrf: 23,
            ffmpegPreset: "medium",
        },
        {
            name: "WEBP (75, no resizing)",
            outputFormat: "WEBP",
            quality: 75,
            colorDepth: 1,
            resizeMode: "None",
            desiredWidth: 800,
            desiredHeight: 600,
            desiredLongestEdge: 1000,
            enlargeOrReduce: "Auto",
            allowLargerFiles: false,
            revertToOriginalIfLarger: false,
            minimumCompressionSavingsInKB: 30,
            skipConversionPatterns: "",
            pngquantExecutablePath: "",
            pngquantQuality: "65-80",
            ffmpegExecutablePath: "",
            ffmpegCrf: 23,
            ffmpegPreset: "medium",
        },
        {
            name: "PNGQUANT (65-80, no resizing)",
            outputFormat: "PNGQUANT",
            quality: 75, //Not really used, but can be used for unified settings,
            colorDepth: 1,
            resizeMode: "None",
            desiredWidth: 800,
            desiredHeight: 600,
            desiredLongestEdge: 1000,
            enlargeOrReduce: "Auto",
            allowLargerFiles: false,
            revertToOriginalIfLarger: false,
            minimumCompressionSavingsInKB: 30,
            skipConversionPatterns: "",
            pngquantExecutablePath: "",
            pngquantQuality: "65-80",
            ffmpegExecutablePath: "",
            ffmpegCrf: 23,
            ffmpegPreset: "medium",
        },
    ],
    selectedConversionPreset: "None",
    globalPresets: [
        {
            name: "WebP 75",
            folderPreset: "Default (Obsidian setting)",
            filenamePreset: "NoteName-Timestamp",
            conversionPreset: "WEBP (75, no resizing)",
            linkFormatPreset: "Default (Wikilink, Shortest)",
            resizePreset: "Default (No Resize)"
        }
    ],
    selectedGlobalPreset: "", // Base default remains none; fresh installs opt into "WebP 75" in loadSettings()
    linkFormatSettings: new LinkFormatSettings(),
    nonDestructiveResizeSettings: new NonDestructiveResizeSettings(),
    resizeCursorLocation: "none",
    dropPasteCursorLocation: "back",
    neverProcessFilenames: "",
    modalBehavior: "never",

    singleImageModalSettings: undefined,

    ProcessCurrentNoteconvertTo: 'webp',
    ProcessCurrentNotequality: 0.75,
    ProcessCurrentNoteResizeModalresizeMode: 'None',
    ProcessCurrentNoteresizeModaldesiredWidth: 600,
    ProcessCurrentNoteresizeModaldesiredHeight: 800,
    ProcessCurrentNoteresizeModaldesiredLength: 800,
    ProcessCurrentNoteskipImagesInTargetFormat: false,
    ProcessCurrentNoteEnlargeOrReduce: 'Always',
    ProcessCurrentNoteSkipFormats: 'tif,tiff,heic',
    ProcessCurrentNoteIgnoreFolders: '',

    ProcessAllVaultconvertTo: "disabled",
    ProcessAllVaultquality: 0.75,
    ProcessAllVaultResizeModalresizeMode: "None",
    ProcessAllVaultResizeModaldesiredWidth: 500,
    ProcessAllVaultResizeModaldesiredHeight: 500,
    ProcessAllVaultResizeModaldesiredLength: 500,
    ProcessAllVaultEnlargeOrReduce: "Always",
    ProcessAllVaultSkipFormats: "",
    ProcessAllVaultskipImagesInTargetFormat: false,

    annotationPresets: {
        drawing: [
            { color: '#000000', opacity: 1, blendMode: 'source-over', size: 2 },
            { color: '#000000', opacity: 1, blendMode: 'source-over', size: 2 },
            { color: '#000000', opacity: 1, blendMode: 'source-over', size: 2 }
        ] as ToolPreset[],
        arrow: [
            { color: '#000000', opacity: 1, blendMode: 'source-over', size: 8 },
            { color: '#000000', opacity: 1, blendMode: 'source-over', size: 8 },
            { color: '#000000', opacity: 1, blendMode: 'source-over', size: 8 }
        ] as ToolPreset[],
        text: [
            { color: '#000000', opacity: 1, blendMode: 'source-over', size: 24, backgroundColor: 'transparent', backgroundOpacity: 0.7 },
            { color: '#000000', opacity: 1, blendMode: 'source-over', size: 24, backgroundColor: 'transparent', backgroundOpacity: 0.7 },
            { color: '#000000', opacity: 1, blendMode: 'source-over', size: 24, backgroundColor: 'transparent', backgroundOpacity: 0.7 }
        ] as ToolPreset[]
    },

    isImageAlignmentEnabled: true,
    imageAlignmentDefaultAlignment: 'none',
    imageAlignmentCacheCleanupInterval: 3600000,
    imageAlignmentCacheLocation: "config",

    isDragResizeEnabled: true,
    isScrollResizeEnabled: true,
    isDragAspectRatioLocked: true,
    isResizeInReadingModeEnabled: false,

    resizeSensitivity: 0.1,
    scrollwheelModifier: "Shift",
    isImageResizeEnbaled: true,
    resizeState: { isResizing: false },

    enableContextMenu: true,

    showSpaceSavedNotification: true,
    revertToOriginalIfLarger: false,
    minimumCompressionSavingsInKB: 30,

    enableImageCaptions: false,
    skipCaptionExtensions: "icns",
    captionFontSize: "var(--font-smaller)",
    captionColor: "var(--text-gray)",
    captionFontStyle: "italic",
    captionBackgroundColor: 'transparent',
    captionPadding: '2px 4px',
    captionBorderRadius: '0',
    captionOpacity: '1',
    captionFontWeight: 'normal',
    captionTextTransform: 'none',
    captionLetterSpacing: 'normal',
    captionBorder: 'none',
    captionMarginTop: '4px',
    captionAlignment: 'center'
};

// --- Settings Tab Class ---

export class ImageConverterSettingTab extends PluginSettingTab {
    private cachedFirstMarkdownFile?: TFile;

    private getCachedFirstMarkdownFile(): TFile | undefined {
        if (!this.cachedFirstMarkdownFile) {
            [this.cachedFirstMarkdownFile] = this.app.vault.getMarkdownFiles(); // Cache for this settings-tab instance
        }
        return this.cachedFirstMarkdownFile;
    }

    /**
     * Creates preview context, using real vault files when available, or mock data as fallback.
     * This ensures previews always work even in empty vaults.
     */
    private getPreviewContext(): { file: TFile | File; activeFile: TFile } {
        const activeFile = this.app.workspace.getActiveFile();
        const firstImage = this.app.vault.getFiles().find(file => file.extension.match(/^(jpg|jpeg|png|gif|webp)$/i));
        const firstNote = (activeFile?.extension === 'md') ? activeFile : this.getCachedFirstMarkdownFile();

        // Use real image if available, otherwise create mock File
        const imageFile: TFile | File = (activeFile?.extension.match(/^(jpg|jpeg|png|gif|webp)$/i) ? activeFile : firstImage)
            ?? new File([new Uint8Array(256 * 1024)], 'example-image.png', { type: 'image/png' });

        // Use real note if available, otherwise create mock TFile-like object
        const noteFile: TFile = firstNote ?? ({
            basename: 'MyNote',
            name: 'MyNote.md',
            path: 'MyNote.md',
            extension: 'md',
            parent: this.app.vault.getRoot(),
            stat: { mtime: Date.now(), ctime: Date.now(), size: 1024 },
            vault: this.app.vault
        // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- Mock object for preview in empty vaults
        } as unknown as TFile);

        return { file: imageFile, activeFile: noteFile };
    }
    activeTab: "folder" | "filename" | "conversion" | "linkformat" | "resize" = "folder";
    presetUIState: PresetUIState;
    editingPresetKey: string | null = null;
    formContainer: HTMLElement;

    constructor(app: App, private plugin: ImageConverterPlugin) {
        super(app, plugin);
        // Initialize UI state with everything collapsed
        this.presetUIState = {
            folder: { editingPreset: null, newPreset: null },
            filename: { editingPreset: null, newPreset: null },
            conversion: { editingPreset: null, newPreset: null },
            linkformat: { editingPreset: null, newPreset: null },
            globalPresetVisible: true,
            resize: { editingPreset: null, newPreset: null },
            imageAlignmentSectionCollapsed: true,
            imageDragResizeSectionCollapsed: true,
            imageCaptionSectionCollapsed: true // ADDED: Initialize caption section collapse state
        };
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass("image-converter-settings-tab");

        // Add or remove the 'global-presets-visible' class based on visibility state
        if (this.presetUIState.globalPresetVisible) {
            containerEl.addClass("global-presets-visible");
        } else {
            containerEl.removeClass("global-presets-visible");
        }

        this.renderGlobalPresetSelector();

        // No need to check or update isFormExpanded here
        this.renderTabs();

        // Initialize the form container before rendering preset groups
        this.initializeFormContainer();

        // Only render preset groups if globalPresetVisible is true
        if (this.presetUIState.globalPresetVisible) {
            switch (this.activeTab) {
                case "folder":
                    this.renderPresetGroup(
                        "Folder presets",
                        this.plugin.settings.folderPresets,
                        "selectedFolderPreset",
                        this.presetUIState.folder
                    );
                    break;
                case "filename":
                    this.renderPresetGroup(
                        "Filename presets",
                        this.plugin.settings.filenamePresets,
                        "selectedFilenamePreset",
                        this.presetUIState.filename
                    );
                    break;
                case "conversion":
                    this.renderPresetGroup(
                        "Conversion presets",
                        this.plugin.settings.conversionPresets,
                        "selectedConversionPreset",
                        this.presetUIState.conversion
                    );
                    break;
                case "linkformat":
                    this.renderPresetGroup(
                        "Link format presets",
                        this.plugin.settings.linkFormatSettings.linkFormatPresets,
                        "selectedLinkFormatPreset",
                        this.presetUIState.linkformat
                    );
                    break;
                case "resize":
                    this.renderPresetGroup(
                        "Resize presets",
                        this.plugin.settings.nonDestructiveResizeSettings.resizePresets, // Correct type
                        "selectedResizePreset",
                        this.presetUIState.resize
                    );
                    break;
            }
        }

        // Set the form container to visible if editingPresetKey is not null
        if (this.editingPresetKey && this.formContainer) {
            this.formContainer.addClass("visible");
        }


        // --- Image Alignment Settings Section ---
        this.renderImageAlignmentSettingsSection(containerEl);


        // --- Image Drag and scroll resize Section--- 
        this.renderImageDragResizeSettingsSection(containerEl);

        // --- Image Captions Settings Section ---  // ADDED: Call renderImageCaptionSettingsSection here
        this.renderImageCaptionSettingsSection(containerEl);

        new Setting(containerEl)
            .setName("Right-click menu 🛈")
            .setTooltip("Enable to show a right-click context menu.")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.enableContextMenu)
                    .onChange(async (value) => {
                        this.plugin.settings.enableContextMenu = value;
                        await this.plugin.saveSettings();
                        if (!value) {
                            new Notice("Context menu disabled. Reload Obsidian to see changes.", 5000);
                        } else {
                            new Notice("Context menu enabled. Reload Obsidian to see changes.", 5000);
                        }
                    })
            );

        new Setting(containerEl)
            .setName("Cursor position after drop/paste 🛈")
            .setTooltip("Where to place the cursor after dropping or pasting the image")
            .addDropdown((dropdown) => {
                dropdown
                    .addOption("front", "At the front of the link")
                    .addOption("back", "At the back of the link")
                    .setValue(this.plugin.settings.dropPasteCursorLocation)
                    .onChange(async (value: "front" | "back") => {
                        this.plugin.settings.dropPasteCursorLocation = value;
                        await this.plugin.saveSettings();
                    });
            });


        new Setting(containerEl)
            .setName("Never process these filenames 🛈")
            .setTooltip(
                "A comma-separated list of file names or patterns that the plugin should never process. Supports glob (*) and regex (enclosed in `/` or `r/` or `regex:`). E.g., `old.png, /^_/, r/temp-.*\\.jpg$/` . Or simply skip all cat images e.g.: /cat/ or all gif images *.gif"
            )
            .addTextArea((text) => {
                text.setValue(this.plugin.settings.neverProcessFilenames)
                    .onChange(async (value) => {
                        this.plugin.settings.neverProcessFilenames = value;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.setAttr('spellcheck', 'false');
            });

        new Setting(containerEl)
            .setName('Show notification for image size changes 🛈')
            .setTooltip('Display a notification showing how much space was saved after processing an image.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showSpaceSavedNotification)
                .onChange(async (value) => {
                    this.plugin.settings.showSpaceSavedNotification = value;
                    await this.plugin.saveSettings();
                })
            );


        new Setting(containerEl)
            .setName("Show window")
            .setDesc("Choose whether to show processing options on each image drop/paste")
            .addDropdown((dropdown) => {
                dropdown
                    .addOption("always", "Always show")
                    .addOption("never", "Never show")
                    .addOption("ask", "Ask each time")
                    .setValue(this.plugin.settings.modalBehavior)
                    .onChange(async (value: ModalBehavior) => {
                        this.plugin.settings.modalBehavior = value;
                        await this.plugin.saveSettings();
                    });
            });
    }

    initializeFormContainer(): void {
        // Find the tab content wrapper
        const tabContentWrapper = this.containerEl.querySelector(".image-converter-tab-content-wrapper") as HTMLElement;

        // Check if the form container already exists to avoid duplicates
        this.formContainer = this.containerEl.querySelector(".image-converter-form-container") as HTMLElement;
        if (!this.formContainer) {
            this.formContainer = this.containerEl.createDiv("image-converter-form-container");
        }

        // Append the form container to the tab content wrapper if it's not already there
        if (tabContentWrapper && !tabContentWrapper.contains(this.formContainer)) {
            tabContentWrapper.appendChild(this.formContainer);
        }

    }


    renderGlobalPresetSelector(): void {
        const { containerEl } = this;

        const globalPresetContainer = containerEl.createDiv("image-converter-global-preset-container");

        // --- Click to Toggle Visibility ---
        // Create a clickable element for toggling visibility
        const toggleVisibilityEl = globalPresetContainer.createDiv("image-converter-global-preset-toggle");

        // Add a chevron icon
        const chevronIcon = toggleVisibilityEl.createEl("i");
        setIcon(chevronIcon, "chevron-down"); // Initial state (expanded)
        chevronIcon.addClass("image-converter-chevron-icon");

        // Add a label that changes based on visibility
        const toggleLabel = toggleVisibilityEl.createEl("span", { text: "Drop/paste presets", cls: "settings-section-title" });

        // Add click handler to toggle visibility specifically to the toggle element
        toggleVisibilityEl.onClickEvent((event: MouseEvent) => {
            // Prevent event propagation to avoid conflicts with other interactive elements
            event.stopPropagation();

            // Toggle the visibility state!
            this.presetUIState.globalPresetVisible = !this.presetUIState.globalPresetVisible;

            // Update icon and label based on new visibility state
            if (this.presetUIState.globalPresetVisible) {
                setIcon(chevronIcon, "chevron-down"); // Point down when expanded
                toggleLabel.textContent = "Drop/paste presets";
            } else {
                setIcon(chevronIcon, "chevron-right"); // Point right when collapsed
                toggleLabel.textContent = "Drop/paste presets";
            }

            this.display(); // Re-render the settings tab
        });

        // --- Dropdown ---
        new Setting(globalPresetContainer)
            // .setName("Drop/paste presets")
            .setDesc("Quickly apply a combination of presets")
            .addDropdown((dropdown) => {
                dropdown.addOption("", "None");
                this.plugin.settings.globalPresets.forEach((preset) => {
                    dropdown.addOption(preset.name, preset.name);
                });
                dropdown.setValue(this.plugin.settings.selectedGlobalPreset);
                dropdown.onChange(async (value) => {
                    this.plugin.settings.selectedGlobalPreset = value;
                    if (value) {
                        const selectedPreset = this.plugin.settings.globalPresets.find((presetItem) => presetItem.name === value);
                        if (selectedPreset) {
                            this.plugin.settings.selectedFolderPreset = selectedPreset.folderPreset;
                            this.plugin.settings.selectedFilenamePreset = selectedPreset.filenamePreset;
                            this.plugin.settings.selectedConversionPreset = selectedPreset.conversionPreset;
                            this.plugin.settings.linkFormatSettings.selectedLinkFormatPreset = selectedPreset.linkFormatPreset;
                            this.plugin.settings.nonDestructiveResizeSettings.selectedResizePreset = selectedPreset.resizePreset;
                        }
                    } else {
                        this.plugin.settings.selectedFolderPreset = DEFAULT_SETTINGS.selectedFolderPreset;
                        this.plugin.settings.selectedFilenamePreset = DEFAULT_SETTINGS.selectedFilenamePreset;
                        this.plugin.settings.selectedConversionPreset = DEFAULT_SETTINGS.selectedConversionPreset;
                        this.plugin.settings.linkFormatSettings.selectedLinkFormatPreset = DEFAULT_SETTINGS.linkFormatSettings.selectedLinkFormatPreset;
                        this.plugin.settings.nonDestructiveResizeSettings.selectedResizePreset = DEFAULT_SETTINGS.nonDestructiveResizeSettings.selectedResizePreset;
                    }
                    await this.plugin.saveSettings();
                    this.display();
                });
            });

        // "Save as New Preset" button
        new ButtonComponent(globalPresetContainer)
            .setIcon("plus")
    .setTooltip("Save current selection as a new global preset")
            .onClick((event: MouseEvent) => {
                // Prevent the click from affecting the global visibility toggle
                event.stopPropagation();
                // Open a modal to prompt for the preset name
                new SaveGlobalPresetModal(this.app, this.plugin, (presetName) => {
                    const newPreset: GlobalPreset = {
                        name: presetName,
                        folderPreset: this.plugin.settings.selectedFolderPreset,
                        filenamePreset: this.plugin.settings.selectedFilenamePreset,
                        conversionPreset: this.plugin.settings.selectedConversionPreset,
                        linkFormatPreset: this.plugin.settings.linkFormatSettings.selectedLinkFormatPreset,
                        resizePreset: this.plugin.settings.nonDestructiveResizeSettings.selectedResizePreset, // Add this line
                    };
                    this.plugin.settings.globalPresets.push(newPreset);
                    this.plugin.settings.selectedGlobalPreset = presetName;
                    void this.plugin.saveSettings().then(() => this.display());
                }).open();
            });

        // "Delete" button (only visible when a global preset is selected)
        if (this.plugin.settings.selectedGlobalPreset) {
            new ButtonComponent(globalPresetContainer)
                .setIcon("trash")
                .setClass("danger")
    .setTooltip("Delete selected global preset")
            .onClick((event: MouseEvent) => {
                    // Prevent the click from affecting the global visibility toggle
                    event.stopPropagation();
                    new ConfirmDialog(
                        this.app,
                        "Confirm Delete",
                        `Are you sure you want to delete the global preset "${this.plugin.settings.selectedGlobalPreset}"?`,
                        "Delete",
                                  () => {
                            this.plugin.settings.globalPresets = this.plugin.settings.globalPresets.filter(
                                (presetItem) => presetItem.name !== this.plugin.settings.selectedGlobalPreset
                            );
                            this.plugin.settings.selectedGlobalPreset = ""; // Reset selection
                            void this.plugin.saveSettings().then(() => this.display());
                        }
                    ).open();
                });
        }
    }

    renderImageAlignmentSettingsSection(containerEl: HTMLElement): void {
        // --- Image Alignment Settings Section ---
        const imageAlignmentSection = containerEl.createDiv("image-converter-settings-section");
        imageAlignmentSection.addClass("image-alignment-settings-section");

        // Conditionally add 'image-alignment-enabled' class
        if (this.plugin.settings.isImageAlignmentEnabled) {
            imageAlignmentSection.addClass("image-alignment-enabled");
        } else {
            imageAlignmentSection.removeClass("image-alignment-enabled");
        }

        // --- Clickable Header with Toggle ---
        const toggleAlignmentVisibilityEl = imageAlignmentSection.createDiv("settings-section-header");

        // Chevron Icon (for collapsing/expanding)
        const alignmentChevronIcon = toggleAlignmentVisibilityEl.createEl("i");
        setIcon(alignmentChevronIcon, "chevron-down");
        alignmentChevronIcon.addClass("settings-section-chevron-icon");

        // Section Title
        toggleAlignmentVisibilityEl.createEl("span", { text: "Image alignment", cls: "settings-section-title" });
        // // Clarification Text
        // toggleAlignmentVisibilityEl.createEl("span", {
        //     text: "For changes to take effect, please reload the app",
        //     cls: "settings-section-clarification-text"
        // });

        // Toggle Switch (integrated into header)
        const alignmentToggle = new Setting(toggleAlignmentVisibilityEl)
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.isImageAlignmentEnabled)
                    .onChange(async (value) => {
                        this.plugin.settings.isImageAlignmentEnabled = value;
                        await this.plugin.saveSettings();
                        if (!value) {
                            new Notice("Image alignment disabled. Reload Obsidian to see changes.", 5000);
                        } else {
                            new Notice("Image alignment enabled. Reload Obsidian to see changes.", 5000);
                        }
                        this.display(); // Refresh the settings UI
                    })
            );
        alignmentToggle.settingEl.addClass("settings-section-toggle-button");

        // --- APPLY COLLAPSED STATE FROM UI STATE ---
        if (this.presetUIState.imageAlignmentSectionCollapsed) { // CHECK UI STATE
            imageAlignmentSection.addClass("settings-section-collapsed");
            setIcon(alignmentChevronIcon, "chevron-right"); // Ensure chevron is correct on initial render
        }

        toggleAlignmentVisibilityEl.onClickEvent((event: MouseEvent) => {
            event.stopPropagation();
            // TOGGLE UI STATE AND CLASS INDEPENDENTLY
            this.presetUIState.imageAlignmentSectionCollapsed = !this.presetUIState.imageAlignmentSectionCollapsed; // UPDATE UI STATE
            imageAlignmentSection.toggleClass("settings-section-collapsed", this.presetUIState.imageAlignmentSectionCollapsed); // APPLY CLASS BASED ON UI STATE

            if (this.presetUIState.imageAlignmentSectionCollapsed) { // CHECK UI STATE
                setIcon(alignmentChevronIcon, "chevron-right");
            } else {
                setIcon(alignmentChevronIcon, "chevron-down");
            }
        });

        if (this.plugin.settings.isImageAlignmentEnabled) { // Conditionally render cleanup options
            new Setting(imageAlignmentSection)
                .setName("Default alignment for new images")
                .setDesc("Automatically apply this alignment when inserting new images. Set to 'none' to disable.")
                .addDropdown(dropdown => dropdown
                    .addOptions({
                        'none': 'None',
                        'left': 'Left',
                        'center': 'Center',
                        'right': 'Right'
                    })
                    .setValue(this.plugin.settings.imageAlignmentDefaultAlignment)
                    .onChange(async (value: 'none' | 'left' | 'center' | 'right') => {
                        this.plugin.settings.imageAlignmentDefaultAlignment = value;
                        await this.plugin.saveSettings();
                    })
                );

            // --- Cache Location Setting ---
            new Setting(imageAlignmentSection)
                .setName("Image alignment cache location 🛈")
                .setDesc(
                    "Choose where to store the cache file for image alignments. " +
                    "Note: App reload required."
                )
                .setTooltip(
                    "If you use Obsidian Sync, it is strongly recommended to use the SAME location on all your devices to ensure consistent behavior. " +
                    "Default: Obsidian's config folder (syncable)."
                )
                .addDropdown(dropdown => dropdown
                    .addOptions({
                        config: "Within config folder (syncable)",
                        plugin: "Within plugin folder (not syncable)",
                    })
                    .setValue(this.plugin.settings.imageAlignmentCacheLocation)
                    .onChange(async (value: "config" | "plugin") => {
                        this.plugin.settings.imageAlignmentCacheLocation = value;
                        await this.plugin.saveSettings();
                        this.plugin.ImageAlignmentManager?.updateCacheFilePath();
                        void this.plugin.ImageAlignmentManager?.loadCache();
                    })
                );

            new Setting(imageAlignmentSection) // Interval setting is now inside the collapsible section
                .setName("Image alignment cache cleanup interval")
                .setDesc(
                    "Interval (in minutes) to clean up redundant entries from image alignment cache. Default: 1 hour (0 to disable)"
                )
                .addSlider(slider => slider
                    .setLimits(0, 120, 5) // Min: 0, Max: 120, Step: 5 (minutes)
                    .setValue(this.plugin.settings.imageAlignmentCacheCleanupInterval / (60 * 1000))
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        const minutes = value;
                        this.plugin.settings.imageAlignmentCacheCleanupInterval = minutes * 60 * 1000;
                        await this.plugin.saveSettings();
                        this.plugin.ImageAlignmentManager?.scheduleCacheCleanup();
                    })
                );
        }
    }

    renderImageDragResizeSettingsSection(containerEl: HTMLElement): void {
        // --- Image Drag & Resize Settings Section ---
        const imageDragResizeSection = containerEl.createDiv("image-converter-settings-section");
        imageDragResizeSection.addClass("image-drag-resize-settings-section");

        // Conditionally add 'image-drag-resize-enabled' class
        if (this.plugin.settings.isImageResizeEnbaled) {
            imageDragResizeSection.addClass("image-drag-resize-enabled");
        } else {
            imageDragResizeSection.removeClass("image-drag-resize-enabled");
        }

        // --- Clickable Header with Toggle ---
        const toggleDragResizeVisibilityEl = imageDragResizeSection.createDiv("settings-section-header");

        // Chevron Icon (for collapsing/expanding)
        const dragResizeChevronIcon = toggleDragResizeVisibilityEl.createEl("i");
        setIcon(dragResizeChevronIcon, "chevron-down");
        dragResizeChevronIcon.addClass("settings-section-chevron-icon");

        // Section Title
        toggleDragResizeVisibilityEl.createEl("span", { text: "Drag & scroll resize", cls: "settings-section-title" });
        // // Clarification Text
        // toggleDragResizeVisibilityEl.createEl("span", {
        //     text: "For changes to take effect, please reload the app",
        //     cls: "settings-section-clarification-text"
        // });

        // Toggle Switch (integrated into header)
        const dragResizeToggle = new Setting(toggleDragResizeVisibilityEl)
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.isImageResizeEnbaled)
                    .onChange(async (value) => {
                        this.plugin.settings.isImageResizeEnbaled = value;
                        await this.plugin.saveSettings();
                        if (!value) {
                            new Notice("Image resizing disabled. Reload Obsidian to see changes.", 5000);
                        } else {
                            new Notice("Image resizing enabled. Reload Obsidian to see changes.", 5000);
                        }
                        this.display(); // Refresh the settings UI
                    })
            );
        dragResizeToggle.settingEl.addClass("settings-section-toggle-button");

        // --- APPLY COLLAPSED STATE FROM UI STATE ---
        if (this.presetUIState.imageDragResizeSectionCollapsed) { // CHECK UI STATE
            imageDragResizeSection.addClass("settings-section-collapsed");
            setIcon(dragResizeChevronIcon, "chevron-right"); // Ensure chevron is correct on initial render
        }

        toggleDragResizeVisibilityEl.onClickEvent((event: MouseEvent) => {
            event.stopPropagation();
            // TOGGLE UI STATE AND CLASS INDEPENDENTLY
            this.presetUIState.imageDragResizeSectionCollapsed = !this.presetUIState.imageDragResizeSectionCollapsed; // UPDATE UI STATE
            imageDragResizeSection.toggleClass("settings-section-collapsed", this.presetUIState.imageDragResizeSectionCollapsed); // APPLY CLASS BASED ON UI STATE

            if (this.presetUIState.imageDragResizeSectionCollapsed) { // CHECK UI STATE
                setIcon(dragResizeChevronIcon, "chevron-right");
            } else {
                setIcon(dragResizeChevronIcon, "chevron-down");
            }
        });

        if (this.plugin.settings.isImageResizeEnbaled) { // Conditionally render cleanup options
            // --- Checkboxes for Drag and Scroll Resize ---
            new Setting(imageDragResizeSection)
                .setName("Enable drag resize 🛈")
                .setDesc("Allow resizing images by dragging edges of the image.")
                .setTooltip("This creates a new <DIV> under the image to show resizing HANDLES. But this might cause some incompatibility with certain themes and cause images to jump around.")
                .addToggle((toggle) =>
                    toggle
                        .setValue(this.plugin.settings.isDragResizeEnabled)
                        .onChange(async (value) => {
                            this.plugin.settings.isDragResizeEnabled = value;
                            await this.plugin.saveSettings();
                            // Force refresh to update visible options
                            this.display();                            
                        })
                );

            // Drag-resize specific settings - only show when drag resize is enabled
            if (this.plugin.settings.isDragResizeEnabled) {
                const apectRatioSettingsContainer = imageDragResizeSection.createDiv('fix-aspect-ratio-settings');

                new Setting(apectRatioSettingsContainer)
                    .setName('Lock the aspect ratio when dragging')
                    .setDesc('Prevent accidental distortions of image aspect ratio when dragging to resize')
                    .addToggle(toggle => toggle
                        .setValue(this.plugin.settings.isDragAspectRatioLocked)
                        .onChange(async (value) => {
                            this.plugin.settings.isDragAspectRatioLocked = value;
                            await this.plugin.saveSettings();

                        }));
            }


            new Setting(imageDragResizeSection)
                .setName('Enable scroll-wheel resize')
                .setDesc('Allow resizing images using the scroll wheel')
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.isScrollResizeEnabled)
                    .onChange(async (value) => {
                        this.plugin.settings.isScrollResizeEnabled = value;
                        await this.plugin.saveSettings();
                        // Force refresh to update visible options
                        this.display();
                    }));


            // Scroll-wheel specific settings - only show when scroll-wheel resize is enabled
            if (this.plugin.settings.isScrollResizeEnabled) {
                const scrollSettingsContainer = imageDragResizeSection.createDiv('scroll-resize-settings');

                new Setting(scrollSettingsContainer)
                    .setName('Scroll-wheel modifier key')
                    .setDesc('Key that must be held while using scroll-wheel to resize')
                    .addDropdown(dropdown => dropdown
                        .addOptions({
                            'None': 'None',
                            'Shift': 'Shift',
                            'Control': 'Control',
                            'Alt': 'Alt',
                            'Meta': 'Meta'
                        })
                        .setValue(this.plugin.settings.scrollwheelModifier)
                        .onChange(async (value: "None" | "Shift" | "Control" | "Alt" | "Meta") => {
                            this.plugin.settings.scrollwheelModifier = value;
                            await this.plugin.saveSettings();
                        }));

                new Setting(scrollSettingsContainer)
                    .setName('Scroll-wheel resize sensitivity')
                    .setDesc('Adjust how sensitive the scroll-wheel resize is (0.01-1.0)')
                    .addSlider(slider => slider
                        .setLimits(0.01, 1, 0.01)
                        .setValue(this.plugin.settings.resizeSensitivity)
                        .setDynamicTooltip()
                        .onChange(async (value) => {
                            this.plugin.settings.resizeSensitivity = value;
                            await this.plugin.saveSettings();
                        }));
            }
            // New Setting: Resize Cursor Location
            new Setting(imageDragResizeSection)
                .setName("Cursor position during resize 🛈")
                // eslint-disable-next-line obsidianmd/ui/sentence-case -- Intentional messaging style
                .setTooltip("Where to place the cursor when resizing an image. Note: 'don't move cursor' - will try to keep your exisiting cursor in place but if you DRAG-RESIZE and cursor is still over the image when you finish resizing, it will get the text selected.")
                .addDropdown((dropdown) => {
                    dropdown
                        .addOption("front", "At the front of the link")
                        .addOption("back", "At the back of the link")
                        .addOption("below", "1 line below the image")
                        .addOption("none", "Don't move cursor")
                        .setValue(this.plugin.settings.resizeCursorLocation)
                        .onChange(async (value: "front" | "back" | "below" | "none") => {
                            this.plugin.settings.resizeCursorLocation = value;
                            await this.plugin.saveSettings();
                        });
                });

            new Setting(imageDragResizeSection)
                .setName("Allow resizing in reading mode")
                .setDesc("Non-destructive resizing in reading mode is only visual, thus if it is too distractive you can disable it.")
                .addToggle((toggle) =>
                    toggle
                        .setValue(this.plugin.settings.isResizeInReadingModeEnabled)
                        .onChange(async (value) => {
                            this.plugin.settings.isResizeInReadingModeEnabled = value;
                            await this.plugin.saveSettings();
                        })
                );

        }
    }

    renderImageCaptionSettingsSection(containerEl: HTMLElement): void {
        // --- Image Caption Settings Section ---
        const imageCaptionSection = containerEl.createDiv("image-converter-settings-section");
        imageCaptionSection.addClass("image-caption-settings-section");

        // Conditionally add 'image-caption-enabled' class
        if (this.plugin.settings.enableImageCaptions) {
            imageCaptionSection.addClass("image-caption-enabled");
        } else {
            imageCaptionSection.removeClass("image-caption-enabled");
        }

        // --- Clickable Header with Toggle ---
        const toggleCaptionVisibilityEl = imageCaptionSection.createDiv("settings-section-header");

        // Chevron Icon (for collapsing/expanding)
        const captionChevronIcon = toggleCaptionVisibilityEl.createEl("i");
        setIcon(captionChevronIcon, "chevron-down");
        captionChevronIcon.addClass("settings-section-chevron-icon");

        // Section Title
        toggleCaptionVisibilityEl.createEl("span", { text: "Captions", cls: "settings-section-title" });
        // // Clarification Text
        // toggleCaptionVisibilityEl.createEl("span", {
        //     text: "For changes to take effect, please reload the app",
        //     cls: "settings-section-clarification-text"
        // });

        // Toggle Switch (integrated into header)
        const imageCaptionToggle = new Setting(toggleCaptionVisibilityEl)
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.enableImageCaptions)
                    .onChange(async (value) => {
                        this.plugin.settings.enableImageCaptions = value;
                        await this.plugin.saveSettings();
                        if (!value) {
                            new Notice("Image captions disabled. Reload Obsidian to see changes.", 5000);
                        } else {
                            new Notice("Image captions enabled. Reload Obsidian to see changes.", 5000);
                        }
                        this.display();
                    })
            );
        imageCaptionToggle.settingEl.addClass("settings-section-toggle-button");

        // --- APPLY COLLAPSED STATE FROM UI STATE ---
        if (this.presetUIState.imageCaptionSectionCollapsed) {
            imageCaptionSection.addClass("settings-section-collapsed");
            setIcon(captionChevronIcon, "chevron-right");
        }

        toggleCaptionVisibilityEl.onClickEvent((event: MouseEvent) => {
            event.stopPropagation();
            // TOGGLE UI STATE AND CLASS INDEPENDENTLY
            this.presetUIState.imageCaptionSectionCollapsed = !this.presetUIState.imageCaptionSectionCollapsed;
            imageCaptionSection.toggleClass("settings-section-collapsed", this.presetUIState.imageCaptionSectionCollapsed);

            if (this.presetUIState.imageCaptionSectionCollapsed) {
                setIcon(captionChevronIcon, "chevron-right");
            } else {
                setIcon(captionChevronIcon, "chevron-down");
            }
        });

        // --- Image Captions Settings (Moved from display() function) ---
        if (this.plugin.settings.enableImageCaptions) {
            new Setting(imageCaptionSection)
                .setName("Text alignment within caption")
                .addDropdown(dropdown =>
                    dropdown.addOptions({
                        "left": "Left",
                        "center": "Center",
                        "right": "Right"
                    })
                        .setValue(this.plugin.settings.captionAlignment)
                        .onChange(async (value) => {
                            this.plugin.settings.captionAlignment = value;
                            await this.plugin.saveSettings();
                            this.plugin.captionManager?.applyCaptionStyles();
                        })
                );

            new Setting(imageCaptionSection)
                .setName("Text transform")
                .setDesc("Set text transformation")
                .addDropdown(dropdown =>
                    dropdown.addOptions({
                        "none": "None",
                        "uppercase": "UPPERCASE",
                        "lowercase": "lowercase",
                        "capitalize": "Capitalize"
                    })
                        .setValue(this.plugin.settings.captionTextTransform)
                        .onChange(async (value) => {
                            this.plugin.settings.captionTextTransform = value;
                            await this.plugin.saveSettings();
                            this.plugin.captionManager?.applyCaptionStyles();
                        })
                );

            new Setting(imageCaptionSection) // Font Size Setting is now FIRST setting in the section
                .setName("Font size")
                .setDesc("Set the font size for image captions (e.g., 12px, 1.2em).")
                .addText(text =>
                    text.setValue(this.plugin.settings.captionFontSize)
                        .onChange(async (value) => {
                            this.plugin.settings.captionFontSize = value;
                            await this.plugin.saveSettings();
                            this.plugin.captionManager?.applyCaptionStyles();
                        })
                );

            new Setting(imageCaptionSection)
                .setName("Weight")
                .setDesc("Set font weight (e.g., normal, bold, 600)")
                .addDropdown(dropdown =>
                    dropdown.addOptions({
                        "normal": "Normal",
                        "bold": "Bold",
                        ["300"]: "Light",
                        ["400"]: "Regular",
                        ["500"]: "Medium",
                        ["600"]: "Semi-bold",
                        ["700"]: "Bold"
                    })
                        .setValue(this.plugin.settings.captionFontWeight)
                        .onChange(async (value) => {
                            this.plugin.settings.captionFontWeight = value;
                            await this.plugin.saveSettings();
                            this.plugin.captionManager?.applyCaptionStyles();
                        })
                );

            new Setting(imageCaptionSection)
                .setName("Color")
                .setDesc("Choose a color for image captions e.g.: red, grey, white, black, hsl(50, 50%, 50%), rgb(50%, 75%, 100%) ")
                .addText(text =>
                    text.setValue(this.plugin.settings.captionColor)
                        .onChange(async (value) => {
                            this.plugin.settings.captionColor = value;
                            await this.plugin.saveSettings();
                            this.plugin.captionManager?.applyCaptionStyles();
                        })
                );

            new Setting(imageCaptionSection)
                .setName("Font style")
                .setDesc("Set the font style (e.g., italic, normal).")
                .addDropdown(dropdown =>
                    dropdown.addOptions({
                        "italic": "Italic", "normal": "Normal"
                    })
                        .setValue(this.plugin.settings.captionFontStyle)
                        .onChange(async (value) => {
                            this.plugin.settings.captionFontStyle = value;
                            await this.plugin.saveSettings();
                            this.plugin.captionManager?.applyCaptionStyles();
                        })
                );

            new Setting(imageCaptionSection)
                .setName("Background color")
                .setDesc("Choose a background color for image captions (e.g.: transparent, #f5f5f5, rgba(255,255,255,0.8))")
                .addText(text =>
                    text.setValue(this.plugin.settings.captionBackgroundColor)
                        .onChange(async (value) => {
                            this.plugin.settings.captionBackgroundColor = value;
                            await this.plugin.saveSettings();
                            this.plugin.captionManager?.applyCaptionStyles();
                        })
                );

            // In renderImageCaptionSettingsSection
            new Setting(imageCaptionSection)
                .setName("Border")
                .setDesc("Set border style (e.g., 1px solid gray)")
                .addText(text =>
                    text.setValue(this.plugin.settings.captionBorder)
                        .onChange(async (value) => {
                            this.plugin.settings.captionBorder = value;
                            await this.plugin.saveSettings();
                            this.plugin.captionManager?.applyCaptionStyles();
                        })
                );
            new Setting(imageCaptionSection)
                .setName("Border corner radius")
                .setDesc("Set border radius for caption (e.g., make it slightly rounded: 4px)")
                .addText(text =>
                    text.setValue(this.plugin.settings.captionBorderRadius)
                        .onChange(async (value) => {
                            this.plugin.settings.captionBorderRadius = value;
                            await this.plugin.saveSettings();
                            this.plugin.captionManager?.applyCaptionStyles();
                        })
                );

            new Setting(imageCaptionSection)
                .setName("Space at the top")
                .setDesc("Set space between image and caption (e.g., 4px, 8px)")
                .addText(text =>
                    text.setValue(this.plugin.settings.captionMarginTop)
                        .onChange(async (value) => {
                            this.plugin.settings.captionMarginTop = value;
                            await this.plugin.saveSettings();
                            this.plugin.captionManager?.applyCaptionStyles();
                        })
                );

            new Setting(imageCaptionSection)
                .setName("Padding")
                .setDesc("Set padding around caption (e.g., 4px 8px)")
                .addText(text =>
                    text.setValue(this.plugin.settings.captionPadding)
                        .onChange(async (value) => {
                            this.plugin.settings.captionPadding = value;
                            await this.plugin.saveSettings();
                            this.plugin.captionManager?.applyCaptionStyles();
                        })
                );

            // Skip Caption Extensions
            new Setting(imageCaptionSection)
                .setName("Skip caption extensions")
                .setDesc("Comma-separated list of image extensions to exclude from captions (e.g., PNG, JPG).")
                .addText((text) => {
                    text.setValue(this.plugin.settings.skipCaptionExtensions)
                        .onChange(async (value) => {
                            this.plugin.settings.skipCaptionExtensions = value;
                            await this.plugin.saveSettings();
                        });
                    text.inputEl.setAttr('spellcheck', 'false');
                });
        }
    }


    renderTabs(): void {
        const { containerEl } = this;
        // Check if tabs container already exists to avoid duplicates
        let tabContainer = containerEl.querySelector(".image-converter-setting-tabs") as HTMLElement;
        if (!tabContainer) {
            tabContainer = containerEl.createDiv("image-converter-setting-tabs");
        }
        // Only add tabs if they haven't been already
        if (tabContainer.children.length === 0) {
            // Correct the type of the first argument
            this.createTab("folder", "folder", "Folder");
            this.createTab("filename", "pencil", "Filename");
            this.createTab("conversion", "settings", "Conversion");
            this.createTab("linkformat", "link", "Link format");
            this.createTab("resize", "frame", "Resize");
        }

        // Highlight active tab 
        const tabs = tabContainer.querySelectorAll(".image-converter-tab");
        tabs.forEach((tab) => tab.removeClass("image-converter-tab-active"));

        const activeTab = tabContainer.querySelector(`.image-converter-tab-${this.activeTab}`);
        if (activeTab) {
            activeTab.addClass("image-converter-tab-active");
        }

    }

    createTab(tabId: "folder" | "filename" | "conversion" | "linkformat" | "resize", icon: string, label: string) {
        const { containerEl } = this;
        // Check if tabs container already exists to avoid duplicates
        let tabContainer = containerEl.querySelector(".image-converter-setting-tabs") as HTMLElement;
        if (!tabContainer) {
            tabContainer = containerEl.createDiv("image-converter-setting-tabs");
        }
        const tab = tabContainer.createDiv(`image-converter-tab image-converter-tab-${tabId}`);
        setIcon(tab, icon);
        tab.createSpan({ text: label, cls: "image-converter-tab-label" });
        tab.onclick = () => {
            // Close form before switching tabs
            if (this.formContainer) {
                this.formContainer.removeClass("visible");
                this.formContainer.empty();
            }
            this.editingPresetKey = null;

            // Reset relevant UI state
            this.presetUIState[tabId].editingPreset = null;
            this.presetUIState[tabId].newPreset = null;

            this.activeTab = tabId;
            this.display();
        };
    }

    renderPresetGroup<
        T extends FolderPreset | FilenamePreset | ConversionPreset | LinkFormatPreset | NonDestructiveResizePreset
    >(
        title: string,
        presets: T[],
        activePresetSetting: ActivePresetSetting,
        uiState: PresetCategoryUIState<T>
    ): void {
        const { containerEl } = this;

        // 1. Create a wrapper for each tab's content:
        const tabContentWrapper = containerEl.createDiv("image-converter-tab-content-wrapper");
        const groupContainer = tabContentWrapper.createDiv(
            "image-converter-preset-group"
        );

        const headerContainer = groupContainer.createDiv(
            "image-converter-preset-group-header" // Add a wrapper for header and description
        );

        // eslint-disable-next-line obsidianmd/settings-tab/no-manual-html-headings -- setHeading() not available in test mocks
        headerContainer.createEl("h3", { text: title, cls: "settings-group-heading" });

        // --- Add explanation here ---
        const description = this.getPresetGroupDescription(activePresetSetting);
        if (description) {
            headerContainer.createEl("p", {
                text: description,
                cls: "image-converter-preset-group-description",
            });
        }

        const cardsContainer = groupContainer.createDiv(
            "image-converter-preset-cards"
        );

        // Initialize SortableJS for drag and drop
        new Sortable(cardsContainer, {
            animation: 150, // Add a smooth animation
            handle: ".image-converter-preset-card-header", // Make the card header the drag handle
            draggable: ".image-converter-preset-card", // Only allow preset cards to be dragged
            ghostClass: 'image-converter-sortable-ghost',
            onEnd: (evt) => {
                if (evt.oldIndex !== undefined && evt.newIndex !== undefined) {
                    if (activePresetSetting === "selectedFolderPreset") {
                        const reorderedPresets = this.arrayMove(
                            this.plugin.settings.folderPresets,
                            evt.oldIndex,
                            evt.newIndex
                        );
                        this.plugin.settings.folderPresets = reorderedPresets;
                        void this.plugin.saveSettings().then(() => this.display());
                    } else if (activePresetSetting === "selectedFilenamePreset") {
                        // Duplicate the logic for filename presets
                        const reorderedPresets = this.arrayMove(
                            this.plugin.settings.filenamePresets,
                            evt.oldIndex,
                            evt.newIndex
                        );
                        this.plugin.settings.filenamePresets = reorderedPresets;
                        void this.plugin.saveSettings().then(() => this.display());
                    } else if (activePresetSetting === "selectedConversionPreset") {
                        // Duplicate the logic for conversion presets
                        const reorderedPresets = this.arrayMove(
                            this.plugin.settings.conversionPresets,
                            evt.oldIndex,
                            evt.newIndex
                        );
                        this.plugin.settings.conversionPresets = reorderedPresets;
                        void this.plugin.saveSettings().then(() => this.display());
                    } else if (activePresetSetting === "selectedLinkFormatPreset") {
                        const reorderedPresets = this.arrayMove(
                            this.plugin.settings.linkFormatSettings.linkFormatPresets,
                            evt.oldIndex,
                            evt.newIndex
                        );
                        this.plugin.settings.linkFormatSettings.linkFormatPresets = reorderedPresets;
                        void this.plugin.saveSettings().then(() => this.display());
                    } else if (activePresetSetting === "selectedResizePreset") {
                        const reorderedPresets = this.arrayMove(
                            this.plugin.settings.nonDestructiveResizeSettings.resizePresets,
                            evt.oldIndex,
                            evt.newIndex
                        );
                        this.plugin.settings.nonDestructiveResizeSettings.resizePresets = reorderedPresets;
                        void this.plugin.saveSettings().then(() => this.display());
                    }
                }
            },
        });

        // Add all default cards
        for (const preset of presets) {
            const isEditing = uiState.editingPreset === preset;
            const isActive = preset.name === this.getSelectedPresetName(activePresetSetting); // Use helper function here
            this.renderPresetCard(
                cardsContainer,
                preset,
                activePresetSetting,
                isEditing,
                isActive,
                uiState
            );
        }

        // Append the form container after the cards if it's a valid Node
        if (this.formContainer instanceof Node) {
            tabContentWrapper.appendChild(this.formContainer);
        }

        // "Add New" card and Form Rendering
        if (!uiState.newPreset) {
            this.addAddNewPresetCard(
                cardsContainer,
                activePresetSetting,
                uiState
            );
        } else {
            // Check if form should be expanded
            // const isNewExpanded = this.isFormExpanded && this.editingPresetKey === "new";
            this.renderPresetForm(
                this.formContainer,
                uiState.newPreset,
                true,
                activePresetSetting,
                uiState
            );
        }
    }

    // Helper method to get descriptions
    getPresetGroupDescription(activePresetSetting: ActivePresetSetting): string {
        switch (activePresetSetting) {
            case "selectedFolderPreset":
                return "Define where converted images will be stored. Choose from predefined locations or create custom paths using variables.";
            case "selectedFilenamePreset":
                return "Control how converted images are named. Use variables like {notename}, {timestamp}, {uuid}, or {MD5:filename} to create unique filenames.";
            case "selectedConversionPreset":
                return "Control the output format, quality, and resizing options for converted images. This allows to significantly reduce file size and keep vault size small.";
            case "selectedLinkFormatPreset":
                return "Determine how image links are inserted into notes. Choose between Wikilinks and Markdown links, and specify how the file path should be formatted. This allows to use a different link style for images than your vault's default, offering better cross-compatibility with other applications.";
            case "selectedResizePreset":
                return "Configure non-destructive resizing options for images directly within the editor. This allows to adjust the display size without altering the original file.";
            default:
                return "";
        }
    }

    // Helper to get a unique key for a preset
    getPresetKey<
        T extends FolderPreset | FilenamePreset | ConversionPreset | LinkFormatPreset | NonDestructiveResizePreset
    >(preset: T): string {
        if ('type' in preset) { // Check if the property exists to narrow down the type
            return `${preset.name}-${preset.type}`;
        }
        if ('linkFormat' in preset) {
            return `${preset.name}-${preset.linkFormat}`;
        }
        return `${preset.name}`;
    }

    getTabContentWrapper(): HTMLElement {
        const { containerEl } = this;
        const tabContentWrapper = containerEl.querySelector(".image-converter-tab-content-wrapper") as HTMLElement;
        return tabContentWrapper;
    }

    private arrayMove<T>(array: T[], fromIndex: number, toIndex: number): T[] {
        const newArray = array.slice();
        const [movedItem] = newArray.splice(fromIndex, 1);
        newArray.splice(toIndex, 0, movedItem);
        return newArray;
    }

    renderPresetCard<
        T extends
        | FolderPreset
        | FilenamePreset
        | ConversionPreset
        | LinkFormatPreset
        | NonDestructiveResizePreset
    >(
        containerEl: HTMLElement,
        preset: T,
        activePresetSetting: ActivePresetSetting,
        isEditing: boolean,
        isActive: boolean,
        uiState: PresetCategoryUIState<T>
    ): void {

        const card = containerEl.createDiv({
            cls: `image-converter-preset-card ${this.isDefaultPreset(preset, activePresetSetting)
                ? "image-converter-default-preset"
                : ""
                } ${isActive ? "image-converter-active-preset" : ""}`,
        });

        const presetKey = this.getPresetKey(preset);
        const isEditingExpanded = this.editingPresetKey === presetKey;

        if (isEditing || isEditingExpanded) {
            // Render the form in the form container
            this.renderPresetForm(
                this.formContainer, // Render in the dedicated form container
                preset,
                false,
                activePresetSetting,
                uiState
            );
            return; // Skip rendering the regular card content
        }

        // Preset Name and Summary
        const cardHeader = card.createDiv("image-converter-preset-card-header");
        cardHeader.createEl("span", {
            text: preset.name,
            cls: "image-converter-preset-card-title",
            title: preset.name, // Add the full name as a tooltip
        });

        if (!this.isDefaultPreset(preset, activePresetSetting)) {
            const actionsContainer = cardHeader.createDiv("image-converter-preset-card-actions");

            // Edit Button
            new ButtonComponent(actionsContainer)
                .setIcon("pencil")
                .setTooltip("Edit")
                .onClick(() => {
                    let correctActivePresetSetting = activePresetSetting;
                    if (preset.hasOwnProperty('linkFormat')) { // Check if it's a Link Format preset
                        correctActivePresetSetting = "selectedLinkFormatPreset";
                    }

                    uiState.editingPreset = preset;
                    this.showPresetForm(preset, false, correctActivePresetSetting, uiState);
                });

            // Delete Button
            new ButtonComponent(actionsContainer)
                .setIcon("trash")
                .setClass("danger")
                .setTooltip("Delete")
                .onClick(() => {
                    new ConfirmDialog(
                        this.app,
                        "Confirm Delete",
                        `Are you sure you want to delete the preset "${preset.name}"?`,
                        "Delete",
                        () => {
                            if (activePresetSetting === "selectedFolderPreset") {
                                this.plugin.settings.folderPresets = this.plugin.settings.folderPresets.filter(
                                    (presetItem) => presetItem.name !== preset.name
                                );
                                this.plugin.settings.selectedFolderPreset = DEFAULT_SETTINGS.selectedFolderPreset;
                            } else if (activePresetSetting === "selectedFilenamePreset") {
                                this.plugin.settings.filenamePresets = this.plugin.settings.filenamePresets.filter(
                                    (presetItem) => presetItem.name !== preset.name
                                );
                                this.plugin.settings.selectedFilenamePreset = DEFAULT_SETTINGS.selectedFilenamePreset;
                            } else if (activePresetSetting === "selectedConversionPreset") {
                                this.plugin.settings.conversionPresets = this.plugin.settings.conversionPresets.filter(
                                    (presetItem) => presetItem.name !== preset.name
                                );
                                this.plugin.settings.selectedConversionPreset = DEFAULT_SETTINGS.selectedConversionPreset;
                            } else if (activePresetSetting === "selectedLinkFormatPreset") {
                                    this.plugin.settings.linkFormatSettings.linkFormatPresets =
                                        this.plugin.settings.linkFormatSettings.linkFormatPresets.filter(
                                            (presetItem) => presetItem.name !== preset.name
                                        );
                                if (this.plugin.settings.linkFormatSettings.selectedLinkFormatPreset === preset.name) {
                                    this.plugin.settings.linkFormatSettings.selectedLinkFormatPreset =
                                        DEFAULT_SETTINGS.linkFormatSettings.selectedLinkFormatPreset;
                                }
                            } else if (activePresetSetting === "selectedResizePreset") { // Add this case
                                this.plugin.settings.nonDestructiveResizeSettings.resizePresets =
                                    this.plugin.settings.nonDestructiveResizeSettings.resizePresets.filter(
                                        (presetItem) => presetItem.name !== preset.name
                                    );
                                // Reset to default if the deleted preset was the active one
                                if (this.plugin.settings.nonDestructiveResizeSettings.selectedResizePreset === preset.name) {
                                    this.plugin.settings.nonDestructiveResizeSettings.selectedResizePreset =
                                        DEFAULT_SETTINGS.nonDestructiveResizeSettings.selectedResizePreset;
                                }
                            }

                            void this.plugin.saveSettings().then(() => this.display());
                        }
                    ).open();
                });
        }

        // Card Body (Summary)
        const cardBody = card.createDiv("image-converter-preset-card-body");
        if (activePresetSetting === "selectedFolderPreset") {
            void this.generateFolderPresetSummary(cardBody, preset as FolderPreset);
        } else if (activePresetSetting === "selectedFilenamePreset") {
            void this.generateFilenamePresetSummary(cardBody, preset as FilenamePreset);
        } else if (activePresetSetting === "selectedLinkFormatPreset") {
            cardBody.createEl("p", {
                text: this.getLinkFormatPresetSummary(preset as LinkFormatPreset),
            });
        } else if (activePresetSetting === "selectedResizePreset") {
            cardBody.appendChild(this.getResizePresetSummary(preset as NonDestructiveResizePreset));
        } else {
            cardBody.appendChild(
                this.getConversionPresetSummary(preset as ConversionPreset)
            );
        }

        // Activate Preset on Click
        card.onClickEvent(async () => {
            if (!isActive) {
                switch (activePresetSetting) {
                    case "selectedFolderPreset":
                        this.plugin.settings.selectedFolderPreset = preset.name;
                        break;
                    case "selectedFilenamePreset":
                        this.plugin.settings.selectedFilenamePreset = preset.name;
                        break;
                    case "selectedConversionPreset":
                        this.plugin.settings.selectedConversionPreset = preset.name;
                        break;
                    case "selectedLinkFormatPreset":
                        this.plugin.settings.linkFormatSettings.selectedLinkFormatPreset = preset.name;
                        break;
                    case "selectedResizePreset":
                        this.plugin.settings.nonDestructiveResizeSettings.selectedResizePreset = preset.name;
                        break;
                }
                await this.plugin.saveSettings();
                this.display();
            }
        });
    }

    showAvailableVariables() {
        new AvailableVariablesModal(this.app, this.plugin.variableProcessor).open();
    }

    showPresetForm<T extends FolderPreset | FilenamePreset | ConversionPreset | LinkFormatPreset | NonDestructiveResizePreset>(
        preset: T,
        isNew: boolean,
        activePresetSetting: ActivePresetSetting,
        uiState: PresetCategoryUIState<T>
    ) {
        // Ensure form container is initialized
        if (!this.formContainer) {
            this.initializeFormContainer();
        }

        // Add the 'visible' class to show the form
        this.formContainer.addClass("visible");

        // No need to set isFormExpanded here
        this.editingPresetKey = isNew ? "new" : this.getPresetKey(preset);

        // Clear and render the form
        this.formContainer.empty();
        this.renderPresetForm(this.formContainer, preset, isNew, activePresetSetting, uiState);

        // Scroll the form into view
        this.formContainer.scrollIntoView({ behavior: "smooth", block: "start" });
    }



    // This renders the form to create OR edit preset
    renderPresetForm<
        T extends
        | FolderPreset
        | FilenamePreset
        | ConversionPreset
        | LinkFormatPreset
        | NonDestructiveResizePreset
    >(
        containerEl: HTMLElement,
        preset: T,
        isNew: boolean,
        activePresetSetting: ActivePresetSetting,
        uiState: PresetCategoryUIState<T>
    ): void {

        containerEl.empty(); // Clear the form container before rendering

        const isDefault = isNew ? false : this.isDefaultPreset(preset, activePresetSetting);

        // Render form directly into the container
        const formContainer = containerEl.createDiv("image-converter-preset-form");


        // Name Input
        new Setting(formContainer)
            .setName("Preset name")
            .addText((text) => {
                text.setValue(preset.name).onChange((value) => {
                    preset.name = value;
                });
                text.inputEl.setAttr('spellcheck', 'false'); // Disable spellcheck
                // Disable name input only when editing a default preset
                if (!isNew && isDefault) text.setDisabled(true);
            });

        // Render form fields based on preset type
        if (activePresetSetting === "selectedFolderPreset") {
            this.renderFolderPresetFormFields(
                formContainer,
                preset as FolderPreset,
                isDefault,
                () => this.showAvailableVariables()
            );
        } else if (activePresetSetting === "selectedFilenamePreset") {
            // Directly add Custom Template Setting
            this.addCustomTemplateSetting(
                formContainer,
                preset as FilenamePreset,
                () => this.showAvailableVariables()
            );

            // Add Skip Rename Patterns Setting for Filename Preset
            this.addSkipPatternsSetting(formContainer, preset as FilenamePreset, 'skipRenamePatterns', 'Skip rename patterns');
        } else if (activePresetSetting === "selectedLinkFormatPreset") {
            this.renderLinkFormatFormFields(formContainer, preset as LinkFormatPreset);
        } else if (activePresetSetting === "selectedResizePreset") {
            this.renderResizePresetFormFields(formContainer, preset as NonDestructiveResizePreset);
        } else {
            this.renderConversionPresetFormFields(
                formContainer,
                preset as ConversionPreset
            );
            // Add Skip Patterns Setting for Conversion Preset
            this.addSkipPatternsSetting(formContainer, preset as ConversionPreset, 'skipConversionPatterns', 'Skip conversion patterns');

        }

        // Save/Cancel Buttons
        const buttonContainer = formContainer.createDiv("image-converter-form-buttons");
        this.addSaveButton(buttonContainer, preset, isNew, activePresetSetting, uiState);
        this.addCancelButton(buttonContainer, uiState, isNew);
    }

    addCustomTemplateSetting(
        containerEl: HTMLElement,
        preset: FilenamePreset,
        showVariablesCallback: () => void
    ): void {
        const formButtons = containerEl.querySelector(
            ".image-converter-form-buttons"
        );

        const settingWrapper = containerEl.createDiv("image-converter-custom-template-setting-wrapper");

        const customTemplateSetting = new Setting(settingWrapper)
            .setName("Custom imagename")
            .setClass("image-converter-custom-template-setting");

        const inputContainer = customTemplateSetting.controlEl.createDiv("image-converter-input-button-container");

        // Add text input
        let customTemplateText: TextComponent | undefined;
        customTemplateSetting.addText((text) => {
            customTemplateText = text;
            text.setPlaceholder("e.g., {notename}-{timestamp}")
                .setValue(preset.customTemplate || "")
                .onChange((value) => {
            preset.customTemplate = value;
                    void updatePreview();
                });
            text.inputEl.setAttr('spellcheck', 'false');
            return text;
        });

        new ButtonComponent(inputContainer)
            .setIcon("help-circle")
            .setTooltip("Show available variables")
            .onClick(showVariablesCallback);

        // Add preview area
        const previewContainer = settingWrapper.createDiv("image-converter-preview-container");
        previewContainer.createEl('div', { text: 'Preview:', cls: 'image-converter-preview-label' }); // Use previewLabel here
        const previewEl = previewContainer.createDiv('image-converter-preview-path');

        const updatePreview = async () => {
            if (!customTemplateText) return;

            const templateValue = customTemplateText.getValue();
            if (!templateValue) {
                previewEl.empty();
                return;
            }

            try {
                const ctx = this.getPreviewContext();
                const processedPath = await this.plugin.variableProcessor.processTemplate(templateValue, ctx);
                previewEl.setText(processedPath);
            } catch (error) {
                console.error('Preview generation error:', error);
                previewEl.setText('Error generating preview');
            }
        };

        // Initial preview update
        void updatePreview();

        new Setting(settingWrapper)
            .setName("If an output file already exists")
            .setDesc("Choose how to handle filename conflicts")
            .addDropdown((dropdown) => {
                dropdown
                    .addOptions({
                        reuse: "Reuse existing file in vault (if any)",
                        increment: "Add number suffix (-1, -2, etc.)",
                    })
                    .setValue(preset.conflictResolution || "reuse")
                    .onChange((value: "reuse" | "increment") => {
                        preset.conflictResolution = value;
                    });
            });

        if (formButtons) {
            containerEl.insertBefore(settingWrapper, formButtons);
        } else {
            containerEl.appendChild(settingWrapper);
        }
    }



    renderFolderPresetFormFields(
        formContainer: HTMLElement,
        preset: FolderPreset,
        isDefault: boolean,
        showVariablesCallback: () => void
    ): void {
        // Options for the dropdown when creating a new preset
        const newPresetOptions = {
            SUBFOLDER: "In subfolder under current note",
            CUSTOM: "Custom",
        };

        // Options for the dropdown when editing an existing preset (includes all options)
        const existingPresetOptions = {
            DEFAULT: "Default (Obsidian setting)",
            ROOT: "Root folder",
            CURRENT: "Same folder as current note",
            ...newPresetOptions, // Include the options for new presets
        };

        new Setting(formContainer)
            .setName("Location")
            .addDropdown((dropdown) => {
                dropdown
                    .addOptions(
                        isDefault || !this.presetUIState.folder.newPreset
                            ? existingPresetOptions
                            : newPresetOptions
                    )
                    .setValue(preset.type || "DEFAULT") // Default to "DEFAULT" for existing, "SUBFOLDER" for new
                    .onChange((value: FolderPresetType) => {
                        preset.type = value;
                        this.updateFolderPresetFormFields(
                            formContainer,
                            preset,
                            isDefault,
                            showVariablesCallback
                        );
                    });
                if (isDefault) dropdown.setDisabled(true);
            });

        this.updateFolderPresetFormFields(formContainer, preset, isDefault, showVariablesCallback);
    }

    updateFolderPresetFormFields(
        containerEl: HTMLElement,
        preset: FolderPreset,
        isDefault: boolean,
        showVariablesCallback: () => void
    ): void {
        const subfolderSetting = containerEl.querySelector(
            ".image-converter-subfolder-name-setting-wrapper" // Changed selector to target the wrapper
        );
        const customTemplateSetting = containerEl.querySelector(
            ".image-converter-custom-path-setting-wrapper" // Changed selector to target the wrapper
        );
        const formButtons = containerEl.querySelector(
            ".image-converter-form-buttons"
        );

        // Remove both subfolder and custom path settings (including previews)
        subfolderSetting?.remove();
        customTemplateSetting?.remove();

        if (preset.type === "SUBFOLDER") {
            const wrapper = containerEl.createDiv("image-converter-subfolder-name-setting-wrapper");

            const subfolderNameSetting = new Setting(wrapper)
                .setName("Subfolder name")
                .setDesc("Enter a custom subfolder name or path.")
                .setClass("image-converter-subfolder-name-setting");

            const inputContainer = subfolderNameSetting.controlEl.createDiv("image-converter-input-button-container");

            let subfolderTemplateText: TextComponent | undefined;
            subfolderNameSetting.addText((text) => {
                subfolderTemplateText = text;
                text.setPlaceholder("e.g., {YYYY}/{MM}/{imagename}")
                    .setValue(this.plugin.settings.subfolderTemplate)
                    .onChange(async (value) => {
                        this.plugin.settings.subfolderTemplate = value;
                        void updatePreview();
                    });
                text.inputEl.setAttr('spellcheck', 'false');
                if (isDefault) text.setDisabled(true);
            });

            new ButtonComponent(inputContainer)
                .setIcon("help-circle")
                .setTooltip("Show available variables")
                .onClick(showVariablesCallback);

            const previewContainer = wrapper.createDiv("image-converter-preview-container");
            previewContainer.createEl('div', { text: 'Preview:', cls: 'image-converter-preview-label' });
            const previewEl = previewContainer.createDiv('image-converter-preview-path');

            const updatePreview = async () => {
                if (!subfolderTemplateText) return;

                const templateValue = subfolderTemplateText.getValue();
                if (!templateValue) {
                    previewEl.empty();
                    return;
                }

                try {
                    const ctx = this.getPreviewContext();
                    const processedPath = await this.plugin.variableProcessor.processTemplate(templateValue, ctx);
                    previewEl.setText(processedPath);
                } catch (error) {
                    console.error('Preview generation error:', error);
                    previewEl.setText('Error generating preview');
                }
            };

            void updatePreview();

            if (formButtons) {
                containerEl.insertBefore(wrapper, formButtons);
            } else {
                containerEl.appendChild(wrapper);
            }
        } else if (preset.type === "CUSTOM") {
            const wrapper = containerEl.createDiv("image-converter-custom-path-setting-wrapper");

            const customPathSetting = new Setting(wrapper)
                .setName("Custom path")
                .setDesc("Enter a custom path.")
                .setClass("image-converter-custom-template-setting");

            const inputContainer = customPathSetting.controlEl.createDiv("image-converter-input-button-container");

            let customTemplateText: TextComponent | undefined;
            customPathSetting.addText((text) => {
                customTemplateText = text;
                text.setPlaceholder("e.g., {YYYY}/{MM}/{imagename}")
                    .setValue(preset.customTemplate || "")
                    .onChange((value) => {
                            preset.customTemplate = value;
                        void updatePreview();
                    });
                text.inputEl.setAttr('spellcheck', 'false');
                if (isDefault) text.setDisabled(true);
            });

            new ButtonComponent(inputContainer)
                .setIcon("help-circle")
                .setTooltip("Show available variables")
                .onClick(showVariablesCallback);

            const previewContainer = wrapper.createDiv("image-converter-preview-container");
            previewContainer.createEl('div', { text: 'Preview:', cls: 'image-converter-preview-label' });
            const previewEl = previewContainer.createDiv('image-converter-preview-path');

            const updatePreview = async () => {
                if (!customTemplateText) return;

                const templateValue = customTemplateText.getValue();
                if (!templateValue) {
                    previewEl.empty();
                    return;
                }

                try {
                    const ctx = this.getPreviewContext();
                    const processedPath = await this.plugin.variableProcessor.processTemplate(templateValue, ctx);
                    previewEl.setText(processedPath);
                } catch (error) {
                    console.error('Preview generation error:', error);
                    previewEl.setText('Error generating preview');
                }
            };

            void updatePreview();

            if (formButtons) {
                containerEl.insertBefore(wrapper, formButtons);
            } else {
                containerEl.appendChild(wrapper);
            }
        }
    }

    renderConversionPresetFormFields(
        formContainer: HTMLElement,
        preset: ConversionPreset
    ): void {
        const outputFormatSetting = new Setting(formContainer)
            .setName("Output format")
            .addDropdown((dropdown) => {
                dropdown
                    .addOptions({
                        WEBP: "WEBP",
                        JPEG: "JPEG",
                        PNG: "PNG",
                        ORIGINAL: "Original (Compress)",
                        NONE: "None (No Conversion/Compression)",
                        PNGQUANT: "pngquant (Compression for PNG only))",
                        AVIF: "AVIF (via ffmpeg)",
                    })
                    .setValue(preset.outputFormat)
                    .onChange((value: OutputFormat) => {
                        preset.outputFormat = value;
                        this.updateConversionPresetFormFields(
                            formContainer,
                            preset,
                            outputFormatSetting
                        );
                    });
            });

        this.updateConversionPresetFormFields(
            formContainer,
            preset,
            outputFormatSetting
        );
    }

    updateConversionPresetFormFields(
        containerEl: HTMLElement,
        preset: ConversionPreset,
        outputFormatSetting: Setting
    ): void {
        const qualitySetting = containerEl.querySelector(
            ".image-converter-quality-setting"
        );
        const colorDepthSetting = containerEl.querySelector(
            ".image-converter-color-depth-setting"
        );
        const resizeModeSetting = containerEl.querySelector(
            ".image-converter-resize-mode-setting"
        );
        const desiredWidthSetting = containerEl.querySelector(
            ".image-converter-desired-width-setting"
        );
        const desiredHeightSetting = containerEl.querySelector(
            ".image-converter-desired-height-setting"
        );
        const desiredLongestEdgeSetting = containerEl.querySelector(
            ".image-converter-desired-longest-edge-setting"
        );
        const enlargeOrReduceSetting = containerEl.querySelector(
            ".image-converter-enlarge-or-reduce-setting"
        );
        const revertToOriginalSetting = containerEl.querySelector(
            ".image-converter-revert-to-original"
        );
        const minSavingsSettingEl = containerEl.querySelector(
            ".image-converter-min-savings-setting"
        );
        const pngquantExecutablePathSetting = containerEl.querySelector(".image-converter-pngquant-executable-path");
        const pngquantQualitySetting = containerEl.querySelector(".image-converter-pngquant-quality");

        // AVIF settings
        const ffmpegExecutablePathSetting = containerEl.querySelector(".image-converter-ffmpeg-executable-path");
        const ffmpegCrfSetting = containerEl.querySelector(".image-converter-ffmpeg-crf");
        const ffmpegPresetSetting = containerEl.querySelector(".image-converter-ffmpeg-preset");
        const encoderDetectionSetting = containerEl.querySelector(".image-converter-encoder-detection");


        qualitySetting?.remove();
        colorDepthSetting?.remove();
        resizeModeSetting?.remove();
        desiredWidthSetting?.remove();
        desiredHeightSetting?.remove();
        desiredLongestEdgeSetting?.remove();
        enlargeOrReduceSetting?.remove();
        revertToOriginalSetting?.remove();
        minSavingsSettingEl?.remove();
        pngquantExecutablePathSetting?.remove();
        pngquantQualitySetting?.remove();

        //Remove AVIF settings
        ffmpegExecutablePathSetting?.remove();
        ffmpegCrfSetting?.remove();
        ffmpegPresetSetting?.remove();
        encoderDetectionSetting?.remove();

        // Insert Quality setting after Output Format
        if (["WEBP", "JPEG", "ORIGINAL"].includes(preset.outputFormat)) {
            const newSetting = new Setting(containerEl)
                .setName("Quality")
                .setClass("image-converter-quality-setting")
                .addSlider((slider) => {
                    slider
                        .setLimits(0, 100, 1)
                        .setValue(preset.quality)
                        .setDynamicTooltip()
                        .onChange(async (value) => {
                            preset.quality = value;
                        });
                });
            outputFormatSetting.settingEl.insertAdjacentElement(
                "afterend",
                newSetting.settingEl
            );
        }

        // Insert Color Depth setting after Quality (if applicable) or Output Format
        if (preset.outputFormat === "PNG") {
            const newSetting = new Setting(containerEl)
                .setName("Color depth")
                .setClass("image-converter-color-depth-setting")
                .addSlider((slider) => {
                    slider
                        .setLimits(0, 1, 0.1)
                        .setValue(preset.colorDepth)
                        .setDynamicTooltip()
                        .onChange(async (value) => {
                            preset.colorDepth = value;
                        });
                });

            const qualitySettingEl = containerEl.querySelector(
                ".image-converter-quality-setting"
            );
            if (qualitySettingEl) {
                qualitySettingEl.insertAdjacentElement(
                    "afterend",
                    newSetting.settingEl
                );
            } else {
                outputFormatSetting.settingEl.insertAdjacentElement(
                    "afterend",
                    newSetting.settingEl
                );
            }
        }

        // Insert PNGQUANT settings after Output Format
        if (preset.outputFormat === "PNGQUANT") {
            const executablePathSetting = new Setting(containerEl)
                .setName("Executable path for pngquant 🛈")
                .setTooltip("Provide full-path to the binary file. It can be inside vault or anywhere in your file system.")
                .setClass("image-converter-pngquant-executable-path") // Add class for easy selection
                .addText((text) => {
                    text.setValue(preset.pngquantExecutablePath || "")
                        .onChange((value) => {
                            preset.pngquantExecutablePath = value;
                            void this.plugin.saveSettings();
                        });
                    text.inputEl.setAttr('spellcheck', 'false'); // Disable spellcheck
                });
            outputFormatSetting.settingEl.insertAdjacentElement(
                "afterend",
                executablePathSetting.settingEl
            );

            const qualitySetting = new Setting(containerEl)
                .setName("Quality range for pngquant")
                .setDesc("Quality setting for pngquant (e.g., 65-80). Both min-max values must be provided.")
                .setClass("image-converter-pngquant-quality") // Add class for easy selection
                .addText((text) => {
                    text.setValue(preset.pngquantQuality || "")
                        .onChange((value) => {
                            preset.pngquantQuality = value;
                            void this.plugin.saveSettings();
                        });
                    text.inputEl.setAttr('spellcheck', 'false'); // Disable spellcheck
                });
            executablePathSetting.settingEl.insertAdjacentElement( // Insert after executable path
                "afterend",
                qualitySetting.settingEl
            );
        }

        // Insert AVIF settings after Output Format
        if (preset.outputFormat === "AVIF") {
            let textComponent: TextComponent | undefined;

            const buildEncoderDesc = (prefix: string, encoderLabel: string, suffix: string): DocumentFragment => {
                const fragment = document.createDocumentFragment();
                const prefixSpan = document.createElement("span");
                prefixSpan.textContent = prefix;
                const encoderSpan = document.createElement("span");
                encoderSpan.textContent = encoderLabel;
                encoderSpan.className = "image-converter-encoder-highlight";
                const suffixSpan = document.createElement("span");
                suffixSpan.textContent = suffix;
                fragment.append(prefixSpan, encoderSpan, suffixSpan);
                return fragment;
            };

            let encoderDetectionButton: ButtonComponent | undefined;

            const defaultEncoderDesc = "Detect and validate working AV1 encoder by running a test encode. This ensures hardware encoders are actually available on your system.";
            const defaultCrfDesc = "Constant rate factor for AVIF (0-63, lower is better quality). Range varies by encoder - click 'Detect encoder' to see the specific range.";

            const resetEncoderUi = (encoderDetectionSetting: Setting, crfSetting: Setting, presetSetting: Setting) => {
                encoderDetectionSetting.setDesc(defaultEncoderDesc);
                encoderDetectionSetting.settingEl.removeClass("image-converter-encoder-detected");
                encoderDetectionButton?.buttonEl?.removeClass("image-converter-encoder-detected");

                crfSetting.setDesc(defaultCrfDesc);
                crfSetting.settingEl.removeClass("image-converter-encoder-detected");

                presetSetting.settingEl.show();
                // eslint-disable-next-line obsidianmd/ui/sentence-case -- Technical description
                presetSetting.setDesc("Encoding preset (speed vs. compression).");

                const dropdown = presetSetting.controlEl.querySelector('select');
                if (dropdown) {
                    dropdown.innerHTML = '';
                    const defaultPresets = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow', 'placebo'];
                    defaultPresets.forEach(presetName => {
                        const option = document.createElement('option');
                        option.value = presetName;
                        option.text = presetName;
                        dropdown.appendChild(option);
                    });
                    dropdown.value = preset.ffmpegPreset || 'medium';
                }
            };

            const executablePathSetting = new Setting(containerEl)
                // eslint-disable-next-line obsidianmd/ui/sentence-case -- Product name
                .setName("FFmpeg executable path 🛈")
                .setTooltip("Provide full-path to the binary file. It can be inside vault or anywhere in your file system.")
                .setClass("image-converter-ffmpeg-executable-path")
                .addButton(button => {
                    button
                        .setIcon("search")
                        // eslint-disable-next-line obsidianmd/ui/sentence-case -- FFmpeg is the official brand name
                        .setTooltip("Auto-detect FFmpeg")
                        .setClass("image-converter-icon-button")
                        .onClick(async () => {
                            button.setDisabled(true);
                            try {
                                const detectedPath = await findFfmpegExecutablePath(this.app);
                                if (!detectedPath) {
                                    // eslint-disable-next-line obsidianmd/ui/sentence-case
                                    new Notice("FFmpeg not found. Try installing via: Homebrew (macOS), Chocolatey (Windows), or apt/snap (Linux). Then set the path manually.", 8000);
                                    return;
                                }

                                const normalizedPath = normalizeExecutablePath(detectedPath);
                                const previousPath = preset.ffmpegExecutablePath || "";
                                preset.ffmpegExecutablePath = normalizedPath;
                                this.plugin.settings.ffmpegExecutablePath = normalizedPath;
                                if (this.plugin.settings.singleImageModalSettings) {
                                    this.plugin.settings.singleImageModalSettings.ffmpegExecutablePath = normalizedPath;
                                }
                                if (normalizedPath !== previousPath) {
                                    preset.detectedEncoder = undefined;
                                    this.plugin.settings.detectedEncoder = undefined;
                                    if (this.plugin.settings.singleImageModalSettings) {
                                        this.plugin.settings.singleImageModalSettings.detectedEncoder = undefined;
                                    }
                                    resetEncoderUi(encoderDetectionSetting, crfSetting, presetSetting);
                                }
                                void this.plugin.saveSettings();

                                textComponent?.setValue(normalizedPath);
                                // eslint-disable-next-line obsidianmd/ui/sentence-case
                                new Notice("FFmpeg path detected and saved.", 4000);
                            } catch (error) {
                                const message = error instanceof Error ? error.message : String(error);
                                console.error("FFmpeg auto-detection failed:", message);
                                new Notice(`FFmpeg auto-detection failed: ${message}`);
                            } finally {
                                button.setDisabled(false);
                            }
                        });
                })
                .addText(text => {
                    textComponent = text;
                    text.setValue(preset.ffmpegExecutablePath || "")
                        .onChange(value => {
                            const normalizedPath = normalizeExecutablePath(value);
                            const previousPath = preset.ffmpegExecutablePath || "";
                            preset.ffmpegExecutablePath = normalizedPath;
                            this.plugin.settings.ffmpegExecutablePath = normalizedPath;
                            if (this.plugin.settings.singleImageModalSettings) {
                                this.plugin.settings.singleImageModalSettings.ffmpegExecutablePath = normalizedPath;
                            }
                            if (normalizedPath !== previousPath) {
                                preset.detectedEncoder = undefined;
                                this.plugin.settings.detectedEncoder = undefined;
                                if (this.plugin.settings.singleImageModalSettings) {
                                    this.plugin.settings.singleImageModalSettings.detectedEncoder = undefined;
                                }
                                resetEncoderUi(encoderDetectionSetting, crfSetting, presetSetting);
                            }
                            if (normalizedPath !== value) {
                                text.setValue(normalizedPath);
                            }
                            void this.plugin.saveSettings();
                        });
                    text.inputEl.setAttr('spellcheck', 'false');
                });
            outputFormatSetting.settingEl.insertAdjacentElement("afterend", executablePathSetting.settingEl);

            // Add encoder detection button
            const encoderDetectionSetting = new Setting(containerEl)
                .setName("Encoder detection")
                .setDesc(defaultEncoderDesc)
                .setClass("image-converter-encoder-detection")
                .addButton(button => {
                    encoderDetectionButton = button;
                    button
                        .setButtonText("Detect encoder")
                        .setCta()
                        .onClick(async () => {
                            if (!preset.ffmpegExecutablePath) {
                                // eslint-disable-next-line obsidianmd/ui/sentence-case -- FFmpeg is the official brand name
                                new Notice("Please specify FFmpeg executable path first");
                                return;
                            }
                            
                            button.setButtonText("Validating...");
                            button.setDisabled(true);
                            
                            try {
                                // Import ImageProcessor to use detection method
                                // eslint-disable-next-line @typescript-eslint/naming-convention -- Import matches class name
                                const { ImageProcessor, ENCODER_CONFIGS } = await import('./ImageProcessor');
                                type AvifEncoder = keyof typeof ENCODER_CONFIGS;
                                const processor = new ImageProcessor(this.plugin.supportedImageFormats);
                                
                                const encoder = await processor.detectAvifEncoder(preset.ffmpegExecutablePath, preset.detectedEncoder);
                                
                                if (encoder) {
                                    const encoderInfo = ENCODER_CONFIGS[encoder];
                                    const platformHint = encoderInfo ? ` (${encoderInfo.platformHint})` : '';
                                    new Notice(`✓ Working encoder: ${encoder}${platformHint}`, 5000);
                                    
                                    // Save detected encoder to preset (persists in data.json)
                                    preset.detectedEncoder = encoder;
                                    void this.plugin.saveSettings();
                                    
                                    encoderDetectionDesc(`${encoder}${platformHint}`, encoderInfo?.crfMin, encoderInfo?.crfMax);
                                    encoderDetectionSetting.settingEl.addClass("image-converter-encoder-detected");
                                    encoderDetectionButton?.buttonEl?.addClass("image-converter-encoder-detected");
                                    
                                    // Update CRF description with the detected encoder's range
                                    crfDesc(encoder, encoderInfo?.crfMin, encoderInfo?.crfMax);
                                    crfSetting.settingEl.addClass("image-converter-encoder-detected");
                                    
                                    // Show/hide preset setting based on encoder support
                                    if (encoderInfo?.supportsPreset && encoderInfo.presetNames) {
                                        presetSetting.settingEl.show();
                                        presetSetting.setDesc(`Encoding preset for ${encoder} (speed vs. compression).`);
                                        
                                        // Update dropdown options with encoder-specific presets
                                        const dropdown = presetSetting.controlEl.querySelector('select');
                                        if (dropdown) {
                                            // Clear existing options
                                            dropdown.innerHTML = '';
                                            
                                            // Add encoder-specific presets
                                            encoderInfo.presetNames.forEach(presetName => {
                                                const option = document.createElement('option');
                                                option.value = presetName;
                                                option.text = presetName;
                                                dropdown.appendChild(option);
                                            });
                                            
                                            // Set current value or default to middle option
                                            const currentPreset = preset.ffmpegPreset || encoderInfo.presetNames[Math.floor(encoderInfo.presetNames.length / 2)];
                                            dropdown.value = encoderInfo.presetNames.includes(currentPreset) ? currentPreset : encoderInfo.presetNames[Math.floor(encoderInfo.presetNames.length / 2)];
                                            preset.ffmpegPreset = dropdown.value;
                                            void this.plugin.saveSettings();
                                        }
                                    } else {
                                        presetSetting.settingEl.hide();
                                    }
                                } else {
                                    const cachedEncoder = preset.detectedEncoder as AvifEncoder | undefined;
                                    const cachedInfo = cachedEncoder ? ENCODER_CONFIGS[cachedEncoder] : undefined;
                                    if (cachedInfo) {
                                        if (!cachedEncoder) {
                                            return;
                                        }
                                        const platformHint = cachedInfo ? ` (${cachedInfo.platformHint})` : '';
                                        new Notice(`Encoder detection failed. Using cached encoder: ${cachedEncoder}${platformHint}`, 5000);
                                        encoderDetectionDesc(`${cachedEncoder}${platformHint}`, cachedInfo.crfMin, cachedInfo.crfMax);
                                        encoderDetectionSetting.settingEl.addClass("image-converter-encoder-detected");
                                        encoderDetectionButton?.buttonEl?.addClass("image-converter-encoder-detected");
                                        crfDesc(cachedEncoder, cachedInfo.crfMin, cachedInfo.crfMax);
                                        crfSetting.settingEl.addClass("image-converter-encoder-detected");

                                        if (cachedInfo.supportsPreset && cachedInfo.presetNames) {
                                            presetSetting.settingEl.show();
                                            presetSetting.setDesc(`Encoding preset for ${cachedEncoder} (speed vs. compression).`);

                                            const dropdown = presetSetting.controlEl.querySelector('select');
                                            if (dropdown) {
                                                dropdown.innerHTML = '';
                                                cachedInfo.presetNames.forEach(presetName => {
                                                    const option = document.createElement('option');
                                                    option.value = presetName;
                                                    option.text = presetName;
                                                    dropdown.appendChild(option);
                                                });

                                                const currentPreset = preset.ffmpegPreset || cachedInfo.presetNames[Math.floor(cachedInfo.presetNames.length / 2)];
                                                dropdown.value = cachedInfo.presetNames.includes(currentPreset) ? currentPreset : cachedInfo.presetNames[Math.floor(cachedInfo.presetNames.length / 2)];
                                                preset.ffmpegPreset = dropdown.value;
                                                void this.plugin.saveSettings();
                                            }
                                        } else {
                                            presetSetting.settingEl.hide();
                                        }
                                        return;
                                    }

                                    // eslint-disable-next-line obsidianmd/ui/sentence-case -- Technical terms: AV1, FFmpeg
                                    new Notice("No working AV1 encoder found. Install FFmpeg with AV1 support.", 5000);
                                    // eslint-disable-next-line obsidianmd/ui/sentence-case
                                    encoderDetectionSetting.setDesc("No working encoder found. Install FFmpeg with libaom-av1, libsvtav1, or ensure hardware drivers are installed.");
                                    resetEncoderUi(encoderDetectionSetting, crfSetting, presetSetting);
                                }
                            } catch (error) {
                                console.error("Encoder detection error:", error);
                                new Notice(`Error detecting encoder: ${error instanceof Error ? error.message : String(error)}`);
                            } finally {
                                button.setButtonText("Detect encoder");
                                button.setDisabled(false);
                            }
                        });
                });
            executablePathSetting.settingEl.insertAdjacentElement("afterend", encoderDetectionSetting.settingEl);

            const crfSetting = new Setting(containerEl)
                // eslint-disable-next-line obsidianmd/ui/sentence-case -- Product name and acronym
                .setName("FFmpeg CRF")
                .setDesc(defaultCrfDesc)
                .setClass("image-converter-ffmpeg-crf")
                .addText((text) => { // Keep as TextComponent for numeric input
                    text.setValue(preset.ffmpegCrf?.toString() || "")
                        .onChange(value => {
                            const parsedValue = parseInt(value, 10);
                            preset.ffmpegCrf = isNaN(parsedValue) ? undefined : parsedValue;
                            void this.plugin.saveSettings();
                        });
                    text.inputEl.setAttr('spellcheck', 'false');
                });
            const encoderDetectionDesc = (encoderLabel: string, crfMin?: number, crfMax?: number) => {
                encoderDetectionSetting.setDesc(
                    buildEncoderDesc(
                        "Working encoder: ",
                        encoderLabel,
                        `. CRF range: ${crfMin ?? "?"}-${crfMax ?? "?"}`
                    )
                );
            };

            const crfDesc = (encoderLabel: string, crfMin?: number, crfMax?: number) => {
                crfSetting.setDesc(
                    buildEncoderDesc(
                        "Constant rate factor for ",
                        encoderLabel,
                        ` (${crfMin ?? "?"}-${crfMax ?? "?"}, lower is better quality).`
                    )
                );
            };
            encoderDetectionSetting.settingEl.insertAdjacentElement("afterend", crfSetting.settingEl);


            const presetSetting = new Setting(containerEl)
                // eslint-disable-next-line obsidianmd/ui/sentence-case -- Product name
                .setName("FFmpeg preset")
                // eslint-disable-next-line obsidianmd/ui/sentence-case -- Technical description
                .setDesc("Encoding preset (speed vs. compression).")
                .setClass("image-converter-ffmpeg-preset")
                // Change this to a dropdown:
                .addDropdown(dropdown => {
                    dropdown
                        .addOptions({
                            ultrafast: "ultrafast",
                            superfast: "superfast",
                            veryfast: "veryfast",
                            faster: "faster",
                            fast: "fast",
                            medium: "medium",
                            slow: "slow",
                            slower: "slower",
                            veryslow: "veryslow",
                            placebo: "placebo",
                        })
                        .setValue(preset.ffmpegPreset || "medium") // default
                        .onChange(value => {
                            preset.ffmpegPreset = value;
                            void this.plugin.saveSettings();
                        });
                });
            crfSetting.settingEl.insertAdjacentElement("afterend", presetSetting.settingEl);

            // Rehydrate encoder UI from cached preset value (if present)
            void (async () => {
                if (!preset.detectedEncoder) {
                    return;
                }

                try {
                    const { ENCODER_CONFIGS } = await import('./ImageProcessor');
                    type AvifEncoder = keyof typeof ENCODER_CONFIGS;
                    const encoder = preset.detectedEncoder as AvifEncoder;
                    const encoderInfo = ENCODER_CONFIGS[encoder];
                    if (!encoderInfo) {
                        return;
                    }

                    const platformHint = encoderInfo ? ` (${encoderInfo.platformHint})` : '';
                    encoderDetectionDesc(`${encoder}${platformHint}`, encoderInfo.crfMin, encoderInfo.crfMax);
                    encoderDetectionSetting.settingEl.addClass("image-converter-encoder-detected");
                    encoderDetectionButton?.buttonEl?.addClass("image-converter-encoder-detected");
                    crfDesc(encoder, encoderInfo.crfMin, encoderInfo.crfMax);
                    crfSetting.settingEl.addClass("image-converter-encoder-detected");

                    if (encoderInfo.supportsPreset && encoderInfo.presetNames) {
                        presetSetting.settingEl.show();
                        presetSetting.setDesc(`Encoding preset for ${encoder} (speed vs. compression).`);

                        const dropdown = presetSetting.controlEl.querySelector('select');
                        if (dropdown) {
                            dropdown.innerHTML = '';
                            encoderInfo.presetNames.forEach(presetName => {
                                const option = document.createElement('option');
                                option.value = presetName;
                                option.text = presetName;
                                dropdown.appendChild(option);
                            });

                            const currentPreset = preset.ffmpegPreset || encoderInfo.presetNames[Math.floor(encoderInfo.presetNames.length / 2)];
                            dropdown.value = encoderInfo.presetNames.includes(currentPreset) ? currentPreset : encoderInfo.presetNames[Math.floor(encoderInfo.presetNames.length / 2)];
                            preset.ffmpegPreset = dropdown.value;
                            void this.plugin.saveSettings();
                        }
                    } else {
                        presetSetting.settingEl.hide();
                    }
                } catch (error) {
                    console.error("Encoder rehydration error:", error);
                }
            })();
        }

        // Find the last setting added so far
        let lastAddedSetting: HTMLElement | null =
            containerEl.querySelector(
                ".image-converter-color-depth-setting"
            ) || containerEl.querySelector(".image-converter-quality-setting");
        if (!lastAddedSetting) {
            lastAddedSetting = outputFormatSetting.settingEl;
        }

        // Insert Resize Mode setting after the last added setting
        const resizeSetting = new Setting(containerEl)
            .setName("Resize mode")
            .setClass("image-converter-resize-mode-setting")
            .addDropdown((dropdown) => {
                dropdown
                    .addOptions({
                        None: "None",
                        Fit: "Fit",
                        Fill: "Fill",
                        LongestEdge: "Longest Edge",
                        ShortestEdge: "Shortest Edge",
                        Width: "Width",
                        Height: "Height",
                    })
                    .setValue(preset.resizeMode)
                    .onChange((value: ResizeMode) => {
                        preset.resizeMode = value;
                        this.updateConversionPresetFormFields(
                            containerEl,
                            preset,
                            outputFormatSetting
                        );
                    });
            });
        if (lastAddedSetting) {
            lastAddedSetting.insertAdjacentElement(
                "afterend",
                resizeSetting.settingEl
            );
        }

        // Update lastAddedSetting to be the Resize Mode setting
        lastAddedSetting = resizeSetting.settingEl;

        if (["Fit", "Fill", "Width"].includes(preset.resizeMode)) {
            const newSetting = new Setting(containerEl)
                .setName("Desired width")
                .setClass("image-converter-desired-width-setting")
                .addText((text) => {
                    text.setValue(preset.desiredWidth.toString()).onChange(
                        (value) => {
                            preset.desiredWidth = parseInt(value, 10);
                        }
                    );
                    text.inputEl.setAttr('spellcheck', 'false'); // Disable spellcheck
                });
            lastAddedSetting.insertAdjacentElement(
                "afterend",
                newSetting.settingEl
            );
            lastAddedSetting = newSetting.settingEl;
        }

        if (["Fit", "Fill", "Height"].includes(preset.resizeMode)) {
            const newSetting = new Setting(containerEl)
                .setName("Desired height")
                .setClass("image-converter-desired-height-setting")
                .addText((text) => {
                    text.setValue(preset.desiredHeight.toString()).onChange(
                        (value) => {
                            preset.desiredHeight = parseInt(value, 10);
                        }
                    );
                    text.inputEl.setAttr('spellcheck', 'false'); // Disable spellcheck
                });
            lastAddedSetting.insertAdjacentElement(
                "afterend",
                newSetting.settingEl
            );
            lastAddedSetting = newSetting.settingEl;
        }

        if (["LongestEdge", "ShortestEdge"].includes(preset.resizeMode)) {
            // Remove existing longest/shortest edge setting
            const existingEdgeSetting = containerEl.querySelector(
                ".image-converter-desired-longest-edge-setting, .image-converter-desired-shortest-edge-setting"
            );
            existingEdgeSetting?.remove();

            const newSetting = new Setting(containerEl)
                .setName(preset.resizeMode === "LongestEdge" ? "Desired longest edge" : "Desired shortest edge") // Dynamically set the name
                .setClass(preset.resizeMode === "LongestEdge" ? "image-converter-desired-longest-edge-setting" : "image-converter-desired-shortest-edge-setting") // Dynamically set the class
                .addText((text) => {
                    text.setValue(
                        preset.desiredLongestEdge.toString() // Still use desiredLongestEdge to store the value for both cases
                    ).onChange((value) => {
                        preset.desiredLongestEdge = parseInt(value, 10); // Still use desiredLongestEdge to store the value for both cases
                    });
                    text.inputEl.setAttr('spellcheck', 'false');
                });
            lastAddedSetting.insertAdjacentElement(
                "afterend",
                newSetting.settingEl
            );
            lastAddedSetting = newSetting.settingEl;
        }

        if (preset.resizeMode !== "None") {
            const newSetting = new Setting(containerEl)
                .setName("Scale mode")
                .setClass("image-converter-enlarge-or-reduce-setting")
                .addDropdown((dropdown) => {
                    dropdown
                        .addOptions({
                            Auto: "Auto",
                            Reduce: "Only Reduce",
                            Enlarge: "Only Enlarge",
                        })
                        .setValue(preset.enlargeOrReduce)
                        .onChange((value: EnlargeReduce) => {
                            preset.enlargeOrReduce = value;
                        });
                });
            lastAddedSetting.insertAdjacentElement(
                "afterend",
                newSetting.settingEl
            );
            lastAddedSetting = newSetting.settingEl;
        }

        const newSetting = new Setting(containerEl)
            .setName("Revert to original if larger")
            .setClass("image-converter-revert-to-original")
            .setDesc("If the processed image filesize is larger than the original, use the original image instead. Sometimes compression can increase file size, especially with certain formats or settings, but if you would prefer to always get smaller file sizes, enable this option.")
            .addToggle((toggle) =>
                toggle
                    .setValue(preset.revertToOriginalIfLarger ?? this.plugin.settings.revertToOriginalIfLarger)
                    .onChange(async (value) => {
                        preset.revertToOriginalIfLarger = value;
                        await this.plugin.saveSettings();
                        updateMinSavingsVisibility();
                    })
            );
        lastAddedSetting.insertAdjacentElement(
            "afterend",
            newSetting.settingEl
        );
        lastAddedSetting = newSetting.settingEl;

        const minSavingsSetting = new Setting(containerEl)
            // eslint-disable-next-line obsidianmd/ui/sentence-case
            .setName("Minimum compression savings (KB)")
            .setClass("image-converter-min-savings-setting")
            // eslint-disable-next-line obsidianmd/ui/sentence-case
            .setDesc("This option allows you to further specify, how much the file size must be reduced before compressing the image. Sometimes an image's size might shrink by only 3 KB, but the visible degradation in quality is significant. This option helps catch those cases and avoids compressing such images. Default is 30kb, which means if after compressing the image file size would reduce only by 30kb or less, then the original image bytes will be used instead. Set to 0 to always allow compression when the output is smaller.")
            .addText((text) =>
                text
                    .setPlaceholder("30")
                    .setValue(String(preset.minimumCompressionSavingsInKB ?? this.plugin.settings.minimumCompressionSavingsInKB))
                    .onChange(async (value) => {
                        const numValue = Number(value);
                        if (!isNaN(numValue) && numValue >= 0) {
                            preset.minimumCompressionSavingsInKB = numValue;
                            await this.plugin.saveSettings();
                        }
                    })
            );
        lastAddedSetting.insertAdjacentElement(
            "afterend",
            minSavingsSetting.settingEl
        );
        lastAddedSetting = minSavingsSetting.settingEl;

        const updateMinSavingsVisibility = () => {
            if (preset.revertToOriginalIfLarger ?? this.plugin.settings.revertToOriginalIfLarger) {
                minSavingsSetting.settingEl.show();
            } else {
                minSavingsSetting.settingEl.hide();
            }
        };

        updateMinSavingsVisibility();
    }


    renderLinkFormatSettings(): void {
        const { containerEl } = this;
        containerEl.createDiv("image-converter-tab-content-wrapper");

        // 1. Preset Management:
        this.renderPresetGroup(
            "Link format presets",
            this.plugin.settings.linkFormatSettings.linkFormatPresets,
            "selectedLinkFormatPreset",
            this.presetUIState.linkformat
        );
    }

    // New method to render form fields specifically for LinkFormatPreset
    renderLinkFormatFormFields(
        formContainer: HTMLElement,
        preset: LinkFormatPreset
    ): void {
        // Link Format (Dropdown)
        new Setting(formContainer)
            .setName("Link format")
            .setDesc("Choose between wikilink and Markdown format")
            .addDropdown((dropdown) => {
                dropdown
                    .addOptions({
                        wikilink: "Wikilink",
                        markdown: "Markdown",
                    })
                    .setValue(preset.linkFormat)
                    .onChange((value: LinkFormat) => {
                        preset.linkFormat = value;
                        this.updateExamples(formContainer, preset); // Update examples on change
                    });
            });

        // Path Format (Dropdown)
        new Setting(formContainer)
            .setName("Path format")
            .setDesc("Choose how paths should be formatted")
            .addDropdown((dropdown) => {
                dropdown
                    .addOptions({
                        shortest: "Shortest",
                        relative: "Relative",
                        absolute: "Absolute",
                    })
                    .setValue(preset.pathFormat)
                    .onChange((value: PathFormat) => {
                        preset.pathFormat = value;
                        this.updateExamples(formContainer, preset); // Update examples on change
                    });
            });

        // Collapsible Examples Section
        const examplesSection = formContainer.createEl("details", {
            cls: "image-converter-format-examples-section"
        });
        examplesSection.createEl("summary", { text: "Examples" }); // Use summary for details

        examplesSection.createEl("div", {
            cls: "image-converter-format-examples-content"
        });

        // Examples table (Initially populated)
        this.updateExamples(formContainer, preset);
    }

    // Helper method to update examples content
    updateExamples(formContainer: HTMLElement, preset: LinkFormatPreset): void {
        const examplesSection = formContainer.querySelector(".image-converter-format-examples-section");
        if (!examplesSection) return;

        const content = examplesSection.querySelector(".image-converter-format-examples-content") as HTMLElement;
        content.empty();

        const table = content.createEl("table", { cls: "image-converter-format-examples-table" });

        const buildExample = (format: PathFormat) => {
            const { linkFormat } = preset;
            switch (format) {
                case "shortest":
                    return linkFormat === "wikilink" ? "![[image.jpg]]" : "![](image.jpg)";
                case "relative":
                    return linkFormat === "wikilink" ? "![[./subfolder/image.jpg]]" : "![](./subfolder/image.jpg)";
                case "absolute":
                    return linkFormat === "wikilink" ? "![[/subfolder/image.jpg]]" : "![](/subfolder/image.jpg)";
                default:
                    return "";
            }
        };

        const formats = [
            ["Shortest",
                `Uses just the file name without any path:
             <ul>
                 <li><b>Wikilink</b>: ![[image.jpg]]</li>
                 <li><b>Markdown</b>: ![](image.jpg)</li>
             </ul>`,
                buildExample("shortest")],

            ["Relative",
                `Uses the path relative to the current note:
             <ul>
                 <li>Same folder: starts with <code>./</code> (e.g., <code>./image.jpg</code>)</li>
                 <li>Parent folder: starts with <code>../</code> (e.g., <code>../image.jpg</code>)</li>
                 <li>Subfolder: includes folder path (e.g., <code>./subfolder/image.jpg</code>)</li>
             </ul>`,
                buildExample("relative")],

            ["Absolute",
                `Uses the complete path from your vault root, always starting with <code>/</code>. 
             This ensures the link works from any note in your vault, regardless of its location.`,
                buildExample("absolute")]
        ];

        formats.forEach(([format, description, example]) => {
            const row = table.createEl("tr");
            row.createEl("td", { cls: "image-converter-format-label", text: format });
        // eslint-disable-next-line @microsoft/sdl/no-inner-html -- Safe: developer-controlled static HTML content
            row.createEl("td", { cls: "image-converter-format-description" }).innerHTML = description;
            row.createEl("td", { cls: "image-converter-format-example", text: example });
        });

        // Practical example
        const scenario = content.createEl("div", { cls: "image-converter-format-scenario" });
        const paths = scenario.createEl("div", { cls: "image-converter-format-paths" });
        // eslint-disable-next-line obsidianmd/ui/sentence-case -- Example label with emoji
        paths.createEl("div", { cls: "image-converter-path-label" }).setText("📄 Note location:");
        paths.createEl("div", { cls: "image-converter-path-value" }).setText("/Folder/Subfolder1/note.md");
        // eslint-disable-next-line obsidianmd/ui/sentence-case -- Example label with emoji
        paths.createEl("div", { cls: "image-converter-path-label" }).setText("🖼️ Image location:");
        paths.createEl("div", { cls: "image-converter-path-value" }).setText("/Folder/Subfolder2/image.jpg");

        const result = scenario.createEl("div", { cls: "image-converter-format-result" });
        // eslint-disable-next-line obsidianmd/ui/sentence-case -- Example label with arrow
        result.createEl("div", { cls: "image-converter-result-label" }).setText("→ Path becomes:");
        const resultValue = result.createEl("div", { cls: "image-converter-result-value" });

        const updateResult = () => {
            const { linkFormat } = preset;

            // Clear previous content first
            resultValue.empty();

            // Create a new table
            const resultTable = resultValue.createEl("table");

            const addRow = (format: string, path: string) => {
                const row = resultTable.createEl("tr");
                row.createEl("td", { text: format, cls: "format-label" });
                row.createEl("td", { text: path, cls: "format-value" });
            };

            if (linkFormat === "wikilink") {
                addRow("Shortest:", "![[Bäume.jpg]]");
                addRow("Relative:", "![[../Subfolder2/Bäume.jpg]]");
                addRow("Absolute:", "![[/Folder/Subfolder2/Bäume.jpg]]");
            } else {
                addRow("Shortest:", "![](Bäume.jpg)");
                addRow("Relative:", "![](../Subfolder2/Bäume.jpg)");
                addRow("Absolute:", "![](/Folder/Subfolder2/Bäume.jpg)");
            }
        };

        updateResult();
    }

    isDefaultPreset<
        T extends
        | FolderPreset
        | FilenamePreset
        | ConversionPreset
        | LinkFormatPreset
        | NonDestructiveResizePreset
    >(preset: T, activePresetSetting: ActivePresetSetting): boolean {
        const defaultPresetNames: Record<ActivePresetSetting, string[]> = {
            selectedFolderPreset: [
                "Default (Obsidian setting)",
                "Root folder",
                "Same folder as current note",
            ],
            selectedFilenamePreset: ["Keep original name", "NoteName-Timestamp"],
            selectedConversionPreset: ["None", "WEBP (75, no resizing)"],
            selectedLinkFormatPreset: [
                "Default (Wikilink, Shortest)",
                "Markdown, Relative",
            ],
            selectedResizePreset: ["Default (No Resize)"], // Add this line
        };

        return defaultPresetNames[activePresetSetting]?.includes(preset.name);
    }

    // this renders the + Add New preset card
    addAddNewPresetCard<T extends FolderPreset | FilenamePreset | ConversionPreset | LinkFormatPreset | NonDestructiveResizePreset>(
        containerEl: HTMLElement,
        activePresetSetting: ActivePresetSetting,
        uiState: PresetCategoryUIState<T>
    ): void {
        const card = containerEl.createDiv({
            cls: "image-converter-preset-card image-converter-add-new-preset",
        });
        card.createEl("div", {
            // eslint-disable-next-line obsidianmd/ui/sentence-case -- Action button text
            text: "+ Add new",
            cls: "image-converter-add-new-preset-text",
        });

        card.onClickEvent(() => {
            if (activePresetSetting === "selectedFolderPreset") {
                uiState.newPreset = { name: "", type: "SUBFOLDER" } as T;
            } else if (activePresetSetting === "selectedFilenamePreset") {
                uiState.newPreset = {
                    name: "",
                    customTemplate: "",
                    skipRenamePatterns: "",
                } as T;
            } else if (activePresetSetting === "selectedLinkFormatPreset") {
                uiState.newPreset = {
                    name: "",
                    linkFormat: "wikilink",
                    pathFormat: "shortest",
                } as T;
            } else if (activePresetSetting === "selectedConversionPreset") {
                uiState.newPreset = {
                    name: "",
                    outputFormat: "NONE",
                    quality: 100,
                    colorDepth: 1,
                    resizeMode: "None",
                    desiredWidth: 800,
                    desiredHeight: 600,
                    desiredLongestEdge: 1000,
                    enlargeOrReduce: "Auto",
                    allowLargerFiles: false,
                    revertToOriginalIfLarger: false,
                    minimumCompressionSavingsInKB: 30,
                    skipConversionPatterns: "",
                    ffmpegExecutablePath: this.plugin.settings.ffmpegExecutablePath || "",
                    ffmpegCrf: 23,
                    ffmpegPreset: "medium",
                } as T;
            } else if (activePresetSetting === "selectedResizePreset") {
                // Add this case
                uiState.newPreset = {
                    name: "",
                    resizeDimension: "none",
                } as T;
            }

            // Check if uiState.newPreset is not null before passing it to showPresetForm
            if (uiState.newPreset !== null) {
                // Ensure formContainer is initialized before showing the form
                if (!this.formContainer) {
                    this.initializeFormContainer();
                }

                this.showPresetForm(uiState.newPreset, true, activePresetSetting, uiState);
            } else {
                // Handle the case where newPreset is null, e.g., show an error message
                console.error("Error: newPreset is null.");
            }
        });
    }

    async generateFolderPresetSummary(containerEl: HTMLElement, preset: FolderPreset): Promise<void> {
        containerEl.empty(); // Clear existing content
        this.cachedFirstMarkdownFile = undefined;

        const fragment = document.createDocumentFragment();

        const addLine = (text: string) => {
            fragment.createEl("p", { text });
        };

        const addExample = async (template: string) => {
            const exampleEl = fragment.createEl("p", { cls: "image-converter-summary-example" });
            exampleEl.textContent = "Example: loading..."; // Placeholder

            try {
                const ctx = this.getPreviewContext();
                const processedPath = await this.plugin.variableProcessor.processTemplate(template, ctx);
                exampleEl.textContent = `Example: ${processedPath}`;
            } catch (error) {
                console.error('Preview generation error:', error);
            exampleEl.textContent = 'Example: error generating preview';
            }
        };

        switch (preset.type) {
            case "DEFAULT":
                addLine("Default (Using Obsidian's configured setting for attachments)");
                void addExample("Assets/{notename}/{imagename}");
                break;
            case "ROOT":
                addLine("Root folder of the vault (Top-level folder).");
                void addExample("{imagename}");
                break;
            case "CURRENT":
                addLine("Same folder as the note you're currently editing.");
                void addExample("{notepath}/{imagename}");
                break;
            case "SUBFOLDER":
                addLine(`In subfolder: ${this.plugin.settings.subfolderTemplate}`);
                void addExample(this.plugin.settings.subfolderTemplate);
                break;
            case "CUSTOM":
                addLine(`Custom location: ${preset.customTemplate}`);
                void addExample(preset.customTemplate || "");
                break;
            default:
                addLine("Unknown location");
                break;
        }

        containerEl.appendChild(fragment);
    }

    async generateFilenamePresetSummary(containerEl: HTMLElement, preset: FilenamePreset): Promise<void> {
        containerEl.empty(); // Clear existing content
        this.cachedFirstMarkdownFile = undefined;

        const fragment = document.createDocumentFragment();

        const addLine = (text: string) => {
            fragment.createEl("p", { text });
        };

        const addExample = async (template: string) => {
            const exampleEl = fragment.createEl("p", { cls: "image-converter-summary-example" });
            exampleEl.textContent = "Example: loading..."; // Placeholder

            try {
                const ctx = this.getPreviewContext();
                const processedPath = await this.plugin.variableProcessor.processTemplate(template, ctx);
                exampleEl.textContent = `Example: ${processedPath}`;
            } catch (error) {
                console.error('Preview generation error:', error);
                exampleEl.textContent = 'Example: error generating preview';
            }
        };

        addLine(`Template: ${preset.customTemplate || "{imagename}"}`);
        void addExample(preset.customTemplate || "{imagename}");

        if (preset.skipRenamePatterns) {
            addLine(`Skip rename patterns: ${preset.skipRenamePatterns}`);
        }
        if (preset.conflictResolution) {
            addLine(`If an output file already exists: ${preset.conflictResolution}`);
        }

        containerEl.appendChild(fragment);
    }



    getLinkFormatPresetSummary(preset: LinkFormatPreset): string {
        return `Link Type: ${preset.linkFormat}, Path Type: ${preset.pathFormat}`;
    }

    getConversionPresetSummary(preset: ConversionPreset): DocumentFragment {
        const fragment = document.createDocumentFragment();

        const addLine = (text: string) => {
            fragment.createEl("p", { text });
        };

        addLine(`Format: ${preset.outputFormat}`);

        if (preset.outputFormat !== "NONE") {
            // Only show quality for formats that use it (not AVIF - it uses CRF instead)
            if (preset.outputFormat !== "AVIF") {
                addLine(`Quality: ${preset.quality}`);
            }
            if (preset.outputFormat === "PNG") {
                addLine(`Color Depth: ${preset.colorDepth}`);
            }
            if (preset.outputFormat === "AVIF") {
                addLine(`FFmpeg CRF: ${preset.ffmpegCrf}`);
                addLine(`FFmpeg Preset: ${preset.ffmpegPreset}`);
            }

            addLine(`Resize: ${preset.resizeMode}`);

            switch (preset.resizeMode) {
                case "Fit":
                case "Fill":
                    addLine(`(${preset.desiredWidth}x${preset.desiredHeight})`);
                    break;
                case "Width":
                    addLine(`(Width: ${preset.desiredWidth})`);
                    break;
                case "Height":
                    addLine(`(Height: ${preset.desiredHeight})`);
                    break;
                case "LongestEdge":
                    addLine(`(Longest Edge: ${preset.desiredLongestEdge})`);
                    break;
                case "ShortestEdge":
                    addLine(`(Shortest Edge: ${preset.desiredLongestEdge})`);
                    break;
                default: // "None"
                    break;
            }

            if (preset.resizeMode !== "None") {
                addLine(`Enlarge/Reduce: ${preset.enlargeOrReduce}`);
            }

            addLine(`Allow Larger Files: ${preset.allowLargerFiles ? "Yes" : "No"}`);
        }

        if (preset.skipConversionPatterns) {
            addLine(`Skip Patterns: ${preset.skipConversionPatterns}`);
        }
        if (preset.revertToOriginalIfLarger) {
            addLine("Revert to original if larger: Yes");
            if (preset.minimumCompressionSavingsInKB !== undefined) {
                addLine(`Minimum compression savings (KB): ${preset.minimumCompressionSavingsInKB}`);
            }
        }

        return fragment;
    }

    addSkipPatternsSetting(
        containerEl: HTMLElement,
        preset: ConversionPreset | FilenamePreset,
        property: 'skipConversionPatterns' | 'skipRenamePatterns',
        title: string
    ): void {
        new Setting(containerEl)
            .setName(title)
            .setDesc(
                "Comma-separated list of patterns to skip (glob or regex). Regex patterns must be enclosed in `/` or `r/` or `regex:` E.g. do not process images which include word CAT in them /CAT/"
            )
            .setTooltip(
                "Supports multiple pattern types:\n\n" +
                "1. Glob patterns:\n" +
                "   *.png, draft-*, test-?.jpg\n" +
                "   * = any characters\n" +
                "   ? = single character\n\n" +
                "2. Regular expressions:\n" +
                "   /pattern/ or r/pattern/ or regex:pattern\n\n" +
                "Examples:\n" +
                " *.png (all PNG files)\n" +
                " draft-* (files starting with draft-)\n" +
                " /^IMG_\\d{4}\\./ (IMG_ followed by 4 digits)\n" +
                " r/\\.(jpe?g|png)$/ (files ending in .jpg/.jpeg/.png)\n" +
                " regex:^(draft|temp)- (files starting with draft- or temp-)"
            )
            .addTextArea((text) => {
                const value = property === 'skipConversionPatterns'
                    ? (preset as ConversionPreset).skipConversionPatterns
                    : (preset as FilenamePreset).skipRenamePatterns;
                text
                    .setPlaceholder("e.g., *.png, draft-*, /^IMG_\\d{4}\\./)")
                    .setValue(value)
                    .onChange(async (newValue) => {
                        const trimmedValue = newValue.trim() ? newValue : "";
                        if (property === 'skipConversionPatterns') {
                            (preset as ConversionPreset).skipConversionPatterns = trimmedValue;
                        } else {
                            (preset as FilenamePreset).skipRenamePatterns = trimmedValue;
                        }
                    });
                text.inputEl.setAttr('spellcheck', 'false');
            });
    }

    getResizePresetSummary(preset: NonDestructiveResizePreset): DocumentFragment {
        const fragment = document.createDocumentFragment();

        const addLine = (text: string) => {
            const paragraphEl = document.createElement("p");
            paragraphEl.textContent = text;
            fragment.appendChild(paragraphEl);
        };

        // Store values in variables before the switch statement
        const widthValue = `${preset.width}${preset.resizeUnits === "percentage" ? "%" : "px"}`;
        const heightValue = `${preset.height}${preset.resizeUnits === "percentage" ? "%" : "px"}`;
        const { customValue } = preset;
        const longestEdgeValue = `${preset.longestEdge}${preset.resizeUnits === "percentage" ? "%" : "px"}`;
        const shortestEdgeValue = `${preset.shortestEdge}${preset.resizeUnits === "percentage" ? "%" : "px"}`;
        const editorMaxWidthValue = `${preset.editorMaxWidthValue}${preset.resizeUnits === "percentage" ? "%" : "px"}`;
        const scaleModeValue = preset.resizeScaleMode;
        const respectEditorMaxWidthValue = preset.respectEditorMaxWidth ? "Yes" : "No";
        const maintainAspectRatioValue = preset.maintainAspectRatio ? "Yes" : "No";

        switch (preset.resizeDimension) {
            case "none":
                addLine("No resizing");
                break;
            case "width":
                addLine(`Width: ${widthValue}`);
                addLine(`Scale Mode: ${scaleModeValue}`);
                addLine(`Respect Editor Max Width: ${respectEditorMaxWidthValue}`);
                addLine(`Maintain Aspect Ratio: ${maintainAspectRatioValue}`);
                break;
            case "height":
                addLine(`Height: ${heightValue}`);
                addLine(`Scale Mode: ${scaleModeValue}`);
                addLine(`Respect Editor Max Width: ${respectEditorMaxWidthValue}`);
                addLine(`Maintain Aspect Ratio: ${maintainAspectRatioValue}`);
                break;
            case "both":
                addLine(`Custom: ${customValue}`);
                addLine(`Scale Mode: ${scaleModeValue}`);
                addLine(`Respect Editor Max Width: ${respectEditorMaxWidthValue}`);
                addLine(`Maintain Aspect Ratio: ${maintainAspectRatioValue}`);
                break;
            case "longest-edge":
                addLine(`Longest Edge: ${longestEdgeValue}`);
                addLine(`Scale Mode: ${scaleModeValue}`);
                addLine(`Respect Editor Max Width: ${respectEditorMaxWidthValue}`);
                addLine(`Maintain Aspect Ratio: ${maintainAspectRatioValue}`);
                break;
            case "shortest-edge":
                addLine(`Shortest Edge: ${shortestEdgeValue}`);
                addLine(`Scale Mode: ${scaleModeValue}`);
                addLine(`Respect Editor Max Width: ${respectEditorMaxWidthValue}`);
                addLine(`Maintain Aspect Ratio: ${maintainAspectRatioValue}`);
                break;
            case "original-width":
                addLine("Original Width");
                addLine(`Scale Mode: ${scaleModeValue}`);
                addLine(`Respect Editor Max Width: ${respectEditorMaxWidthValue}`);
                break;
            case "original-height":
                addLine("Original Height");
                addLine(`Scale Mode: ${scaleModeValue}`);
                addLine(`Respect Editor Max Width: ${respectEditorMaxWidthValue}`);
                break;
            case "editor-max-width":
                addLine(`Editor Max Width: ${editorMaxWidthValue}`);
                addLine(`Scale Mode: ${scaleModeValue}`);
                addLine(`Respect Editor Max Width: ${respectEditorMaxWidthValue}`);
                break;
        }

        return fragment;
    }

    renderResizePresetFormFields(formContainer: HTMLElement, preset: NonDestructiveResizePreset): void {
        // Resize Dimension (Dropdown)
        new Setting(formContainer)
            .setName("Resize dimension")
            .setDesc("Choose how to resize the image")
            .addDropdown((dropdown) => {
                dropdown
                    .addOptions({
                        "none": "None",
                        "width": "Width",
                        "height": "Height",
                        "both": "WidthxHeight (Custom)",
                        ["longest-edge"]: "Longest edge",
                        ["shortest-edge"]: "Shortest edge",
                        ["original-width"]: "Apply original image width",
                        ["original-height"]: "Apply original image height",
                        ["editor-max-width"]: "Fit editor max-width"
                    })
                    .setValue(preset.resizeDimension)
                    .onChange((value: ResizeDimension) => {
                        preset.resizeDimension = value;
                        this.updateResizePresetFormFields(formContainer, preset);
                    });
            });

        this.updateResizePresetFormFields(formContainer, preset);
    }

    updateResizePresetFormFields(
        formContainer: HTMLElement,
        preset: NonDestructiveResizePreset
    ): void {
        // Remove existing settings (except Resize Dimension)
        formContainer
            .querySelectorAll(
                ".image-converter-resize-width-setting, .image-converter-resize-height-setting, .image-converter-resize-custom-setting, .image-converter-resize-scale-mode-setting, .image-converter-resize-respect-width-setting, .image-converter-resize-units-setting, .image-converter-maintain-aspect-ratio-setting, .image-converter-resize-longest-edge-setting, .image-converter-resize-shortest-edge-setting, .image-converter-resize-editor-max-width-value-setting"
            )
            .forEach((el) => el.remove());

        // Find the Save/Cancel buttons
        const buttonContainer = formContainer.querySelector(
            ".image-converter-form-buttons"
        );

        // Helper function to add input settings
        const addInputSetting = (
            name: string,
            classname: string,
            value: number | undefined,
            onChange: (value: string) => void,
            addUnits = false
        ) => {
            const newSetting = new Setting(formContainer)
                .setName(name)
                .setClass(classname)
                .addText((text) => {
                    text.setValue(value?.toString() || "")
                        .onChange(onChange);

                    // Set placeholder using text component
                    text.setPlaceholder(
                        preset.resizeUnits === "percentage"
                            ? `${name} (%)`
                            : `${name} (px)`
                    );
                });

            // Add units dropdown next to input field if required
            if (addUnits) {
                newSetting.addDropdown((dropdown) => {
                    dropdown
                        .addOptions({
                            pixels: "px",
                            percentage: "%",
                        })
                        .setValue(preset.resizeUnits)
                        .onChange((value: ResizeUnits) => {
                            preset.resizeUnits = value;
                            // Update placeholder
                            const textComponent = newSetting.components[0] as TextComponent;
                            textComponent.setPlaceholder(
                                value === "percentage" ? `${name} (%)` : `${name} (px)`
                            );
                        });
                    dropdown.selectEl.addClass("image-converter-resize-units-dropdown");
                });
            }

            if (buttonContainer) {
                formContainer.insertBefore(
                    newSetting.settingEl,
                    buttonContainer
                );
            }
            return newSetting;
        };

        // Add settings based on selection
        let customValueSetting: Setting | undefined;
        let editorMaxWidthValueSetting: Setting | undefined;

        switch (preset.resizeDimension) {
            case "width":
                addInputSetting(
                    "Width",
                    "image-converter-resize-width-setting",
                    preset.width,
                    (value) => {
                        const parsedValue = parseFloat(value);
                        preset.width = isNaN(parsedValue)
                            ? undefined
                            : parsedValue;
                    },
                    true // Add units dropdown
                )
                    .setDesc("Set new custom width"); // Add description here
                break;
            case "height":
                addInputSetting(
                    "Height",
                    "image-converter-resize-height-setting",
                    preset.height,
                    (value) => {
                        const parsedValue = parseFloat(value);
                        preset.height = isNaN(parsedValue)
                            ? undefined
                            : parsedValue;
                    },
                    true // Add units dropdown
                )
                    .setDesc("Set new custom height"); // Add description here
                break;
            case "longest-edge":
                addInputSetting(
                    "Longest edge",
                    "image-converter-resize-longest-edge-setting",
                    preset.longestEdge,
                    (value) => {
                        const parsedValue = parseFloat(value);
                        preset.longestEdge = isNaN(parsedValue)
                            ? undefined
                            : parsedValue;
                    },
                    true // Add units dropdown
                )
                    .setDesc("Plugin automatically reads the original image dimensions and applies the provided value to the longer of the width or height. The other dimension is then calculated automatically if 'maintain aspect ratio' is enabled."); // Add description here
                break;
            case "shortest-edge":
                addInputSetting(
                    "Shortest edge",
                    "image-converter-resize-shortest-edge-setting",
                    preset.shortestEdge,
                    (value) => {
                        const parsedValue = parseFloat(value);
                        preset.shortestEdge = isNaN(parsedValue)
                            ? undefined
                            : parsedValue;
                    },
                    true // Add units dropdown
                )
                    .setDesc("Plugin automatically reads the original image dimensions and applies the provided value to the shorter of the width or height. The other dimension is then calculated automatically if 'maintain aspect ratio' is enabled."); // Add description here
                break;
            case "both":
                customValueSetting = new Setting(formContainer)
                    .setName("Custom value")
                    .setClass("image-converter-resize-custom-setting")
                    .addText((text) => {
                        text.setValue(preset.customValue || "")
                            .onChange((value) => {
                                // Basic validation for custom value format
                                if (
                                    /^\|?\d*(?:\.\d+)?(?:x\d*(?:\.\d+)?)?%?$/.test(
                                        value
                                    ) ||
                                    (preset.resizeUnits === "percentage" &&
                                        /^\d*(?:\.\d+)?x\d*(?:\.\d+)?%$/.test(
                                            value
                                        ))
                                ) {
                                    preset.customValue = value;
                                } else {
                                    new Notice(
                                        "Invalid custom value format. Use |widthxheight or percentage format (e.g., 50x75%)."
                                    );
                                }
                            });
                        // Set placeholder for customValueSetting correctly
                        text.setPlaceholder(
                            preset.resizeUnits === "percentage"
                                ? "e.g. 50x75"
                                : "widthxheight"
                        );
                    })
                    .setDesc("Set both width and height using the format |widthxheight (e.g., 300x200) or percentage format (e.g., 50x75). This does not preserve aspect ratio.");
                if (buttonContainer) {
                    formContainer.insertBefore(
                        customValueSetting.settingEl,
                        buttonContainer
                    );
                }
                break;
            case "editor-max-width":
                editorMaxWidthValueSetting = new Setting(formContainer)
                    .setName("Max width value")
                    .setClass(
                        "image-converter-resize-editor-max-width-value-setting"
                    )
                    .addText((text) => {
                        text.setValue(
                            preset.editorMaxWidthValue?.toString() || ""
                        )
                            .onChange((value) => {
                                const parsedValue = parseFloat(value);
                                preset.editorMaxWidthValue = isNaN(parsedValue)
                                    ? undefined
                                    : parsedValue;
                            });
                        // Set placeholder based on selected units
                        text.setPlaceholder(
                            preset.resizeUnits === "percentage"
                                ? "e.g. 50%"
                                : "e.g. 200px"
                        );
                    })
                    .addDropdown((dropdown) => {
                        dropdown
                            .addOptions({
                                pixels: "px",
                                percentage: "%",
                            })
                            .setValue(preset.resizeUnits)
                            .onChange((value: ResizeUnits) => {
                                preset.resizeUnits = value;
                                // Update placeholder (using optional chaining)
                                (editorMaxWidthValueSetting?.components[0] as TextComponent)?.setPlaceholder(
                                    value === "percentage"
                                        ? "e.g. 50%"
                                        : "e.g. 200px"
                                );
                            });
                        dropdown.selectEl.addClass(
                            "image-converter-resize-units-dropdown"
                        );
                    })
                    .setDesc("Set the maximum width of the image to fit within the editor's width. You can specify a percentage or a fixed pixel value.");
                if (buttonContainer) {
                    formContainer.insertBefore(
                        editorMaxWidthValueSetting.settingEl,
                        buttonContainer
                    );
                }
                break;
        }

        // Add Maintain Aspect Ratio toggle (only when resizeDimension is not "none" or "both")
        let aspectToggle: Setting | undefined = undefined;
        if (
            preset.resizeDimension !== "none" &&
            preset.resizeDimension !== "both"
        ) {
            aspectToggle = new Setting(formContainer)
                .setName("Maintain aspect ratio")
                .setClass("image-converter-maintain-aspect-ratio-setting")
                .setDesc(
                    "Preserve the image's original proportions when resizing."
                )
                .addToggle((toggle) => {
                    toggle
                        .setValue(preset.maintainAspectRatio)
                        .onChange((value) => {
                            preset.maintainAspectRatio = value;
                        });
                });

            if (buttonContainer) {
                formContainer.insertBefore(
                    aspectToggle.settingEl,
                    buttonContainer
                );
            }
        }

        // Hide aspect ratio toggle for specific resize dimensions
        if (
            preset.resizeDimension === "original-width" ||
            preset.resizeDimension === "original-height" ||
            preset.resizeDimension === "editor-max-width"
        ) {
            aspectToggle?.settingEl.hide();
        } else {
            aspectToggle?.settingEl.show(); // Make sure to show it otherwise
        }

        // Hide settings if not selected
        if (preset.resizeDimension !== "editor-max-width") {
            editorMaxWidthValueSetting?.settingEl.hide();
        }

        // Scale Mode Setting (only when resizeDimension is not "none", "original-width", "original-height", or "editor-max-width")
        if (
            preset.resizeDimension !== "none" &&
            preset.resizeDimension !== "original-width" &&
            preset.resizeDimension !== "original-height" &&
            preset.resizeDimension !== "editor-max-width"
        ) {
            const scaleModeSetting = new Setting(formContainer)
                .setName("Scale mode")
                .setClass("image-converter-resize-scale-mode-setting")
                .setDesc(
                    // eslint-disable-next-line obsidianmd/ui/sentence-case -- Technical description with list
                    "Controls how images are adjusted relative to target size:\n- Auto: adjusts image to fit specified dimensions\n- Reduce only: only shrinks images larger than target\n- Enlarge only: only enlarges images smaller than target"
                )
                .addDropdown((dropdown) => {
                    dropdown
                        .addOptions({
                            auto: "Auto",
                            reduce: "Reduce Only",
                            enlarge: "Enlarge Only",
                        })
                        .setValue(preset.resizeScaleMode)
                        .onChange((value: ResizeScaleMode) => {
                            preset.resizeScaleMode = value;
                        });
                });

            if (buttonContainer) {
                formContainer.insertBefore(
                    scaleModeSetting.settingEl,
                    buttonContainer
                );
            }
        }

        // Respect Editor Max Width Toggle (not applicable for "editor-max-width")
        if (preset.resizeDimension !== "editor-max-width" && preset.resizeDimension !== "none") {
            const respectWidthToggle = new Setting(formContainer)
                .setName("Respect editor max width")
                .setClass("image-converter-resize-respect-width-setting")
                .setDesc(
                    "When calculating dimensions, prevent the image from exceeding the editor's width."
                )
                .addToggle((toggle) => {
                    toggle
                        .setValue(preset.respectEditorMaxWidth)
                        .onChange((value) => {
                            preset.respectEditorMaxWidth = value;
                        });
                });

            if (buttonContainer) {
                formContainer.insertBefore(
                    respectWidthToggle.settingEl,
                    buttonContainer
                );
            }
        }
    }

    private getSelectedPresetName(activePresetSetting: ActivePresetSetting): string | undefined {
        switch (activePresetSetting) {
            case "selectedFolderPreset":
                return this.plugin.settings.selectedFolderPreset;
            case "selectedFilenamePreset":
                return this.plugin.settings.selectedFilenamePreset;
            case "selectedConversionPreset":
                return this.plugin.settings.selectedConversionPreset;
            case "selectedLinkFormatPreset":
                return this.plugin.settings.linkFormatSettings.selectedLinkFormatPreset;
            case "selectedResizePreset":
                return this.plugin.settings.nonDestructiveResizeSettings.selectedResizePreset;
            default:
                return undefined;
        }
    }

    private addSaveButton<
        T extends
        | FolderPreset
        | FilenamePreset
        | ConversionPreset
        | LinkFormatPreset
        | NonDestructiveResizePreset
    >(
        buttonContainer: HTMLElement,
        preset: T,
        isNew: boolean,
        activePresetSetting: ActivePresetSetting,
        uiState: PresetCategoryUIState<T>
    ): void {
        new ButtonComponent(buttonContainer)
            .setButtonText(isNew ? "Add" : "Save")
            .setCta()
            .onClick(async () => {
                if (!preset.name) {
                    new Notice("Preset name cannot be empty.");
                    return;
                }

                // Check for duplicate names
                if (
                    !this.isDefaultPreset(preset, activePresetSetting) &&
                    (
                        (activePresetSetting === "selectedFolderPreset" &&
                            this.plugin.settings.folderPresets.some(
                                (presetItem) => presetItem.name === preset.name && presetItem !== preset
                            )) ||
                        (activePresetSetting === "selectedFilenamePreset" &&
                            this.plugin.settings.filenamePresets.some(
                                (presetItem) => presetItem.name === preset.name && presetItem !== preset
                            )) ||
                        (activePresetSetting === "selectedConversionPreset" &&
                            this.plugin.settings.conversionPresets.some(
                                (presetItem) => presetItem.name === preset.name && presetItem !== preset
                            )) ||
                        (activePresetSetting === "selectedLinkFormatPreset" &&
                            this.plugin.settings.linkFormatSettings.linkFormatPresets.some(
                                (presetItem) => presetItem.name === preset.name && presetItem !== preset
                            )) ||
                        (activePresetSetting === "selectedResizePreset" && // Add this check
                            this.plugin.settings.nonDestructiveResizeSettings.resizePresets.some(
                                (presetItem) => presetItem.name === preset.name && presetItem !== preset
                            ))
                    )
                ) {
                    new Notice("A preset with this name already exists.");
                    return;
                }

                if (isNew) {
                    if (activePresetSetting === "selectedFolderPreset") {
                        this.plugin.settings.folderPresets.push(preset as FolderPreset);
                    } else if (activePresetSetting === "selectedFilenamePreset") {
                        this.plugin.settings.filenamePresets.push(preset as FilenamePreset);
                    } else if (activePresetSetting === "selectedConversionPreset") {
                        this.plugin.settings.conversionPresets.push(preset as ConversionPreset);
                    } else if (activePresetSetting === "selectedLinkFormatPreset") {
                        this.plugin.settings.linkFormatSettings.linkFormatPresets.push(preset as LinkFormatPreset);
                    } else if (activePresetSetting === "selectedResizePreset") { // Add this case
                        this.plugin.settings.nonDestructiveResizeSettings.resizePresets.push(preset as NonDestructiveResizePreset);
                    }
                } else {
                    // Update existing preset (handled by reference)
                }

                await this.plugin.saveSettings();

                // Reset UI state
                uiState.editingPreset = null;
                uiState.newPreset = null;
                this.editingPresetKey = null;

                this.display();
            });
    }

    private addCancelButton<T extends FolderPreset | FilenamePreset | ConversionPreset | LinkFormatPreset | NonDestructiveResizePreset>(
        buttonContainer: HTMLElement,
        uiState: PresetCategoryUIState<T>,
        isNew: boolean
    ): void {
        new ButtonComponent(buttonContainer)
            .setButtonText("Cancel")
            .onClick(() => {
                uiState.editingPreset = null;
                uiState.newPreset = null;

                // Reset the expanded state
                this.editingPresetKey = null;

                // Hide the form container by removing the 'visible' class - visbility and opacity
                this.formContainer.removeClass("visible");

                this.display();
            });
    }


    onClose() {
        // Reset the form state when settings are closed
        if (this.formContainer) {
            this.formContainer.removeClass("visible"); // Hide the form
            this.formContainer.empty(); // Clear any form content
        }

        // Reset UI state
        this.editingPresetKey = null;
        this.presetUIState = {
            folder: { editingPreset: null, newPreset: null },
            filename: { editingPreset: null, newPreset: null },
            conversion: { editingPreset: null, newPreset: null },
            linkformat: { editingPreset: null, newPreset: null },
            resize: { editingPreset: null, newPreset: null },
            globalPresetVisible: true,
            imageAlignmentSectionCollapsed: false,
            imageDragResizeSectionCollapsed: false,
            imageCaptionSectionCollapsed: false // ADDED: Reset caption section collapse state
        };
    }
}



export class ConfirmDialog extends Modal {
    message: string | DocumentFragment;
    confirmText: string;
    callback: () => void;

    constructor(
        app: App,
        title: string,
        message: string | DocumentFragment,
        confirmText: string,
        callback: () => void
    ) {
        super(app);
        this.titleEl.setText(title); // Set the title text
        this.message = message;
        this.confirmText = confirmText;
        this.callback = callback;
    }

    onOpen() {
        const { contentEl } = this;

        // Check if the message is a string or a DocumentFragment
        if (typeof this.message === 'string') {
            contentEl.setText(this.message);
        } else {
            contentEl.empty();
            contentEl.appendChild(this.message);
        }

        // Create a container for buttons
        const buttonContainer = contentEl.createDiv(
            "image-converter-confirm-modal-buttons"
        );

        // Add a Cancel button
        new ButtonComponent(buttonContainer)
            .setButtonText("Cancel")
            .onClick(() => this.close());

        // Add a Confirm button with danger styling
        new ButtonComponent(buttonContainer)
            .setButtonText(this.confirmText)
            .setCta()
            .onClick(() => {
                this.close();
                this.callback();
            });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

export class SaveGlobalPresetModal extends Modal {
    plugin: ImageConverterPlugin;
    callback: (presetName: string) => void;
    presetName = "";

    constructor(app: App, plugin: ImageConverterPlugin, callback: (presetName: string) => void) {
        super(app);
        this.plugin = plugin;
        this.callback = callback;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "Save global preset" });

        // Preset Name Input
        new Setting(contentEl)
            .setName("Preset name")
            .addText((text) => {
                text.setPlaceholder("Enter preset name")
                    .setValue(this.presetName)
                    .onChange((value) => {
                        this.presetName = value;
                    });
            });

        // Preset Summary
        const summaryEl = contentEl.createEl("div", { cls: "image-converter-preset-summary" });
        this.updateSummary(summaryEl);

        // --- Buttons ---
        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText("Save")
                    .setCta()
                    .onClick(() => {
                        if (this.presetName) {
                            this.callback(this.presetName);
                            this.close();
                        } else {
                            new Notice("Please enter a preset name.");
                        }
                    })
            )
            .addButton((btn) =>
                btn
                    .setButtonText("Cancel")
                    .onClick(() => {
                        this.close();
                    })
            );

    }

    updateSummary(summaryEl: HTMLElement) {
        summaryEl.empty();
        summaryEl.createEl("h4", { text: "Summary" });

        const folderPreset = this.plugin.settings.folderPresets.find(
            (presetItem) => presetItem.name === this.plugin.settings.selectedFolderPreset
        );
        const filenamePreset = this.plugin.settings.filenamePresets.find(
            (presetItem) => presetItem.name === this.plugin.settings.selectedFilenamePreset
        );
        const conversionPreset = this.plugin.settings.conversionPresets.find(
            (presetItem) => presetItem.name === this.plugin.settings.selectedConversionPreset
        );
        const linkFormatPreset = this.plugin.settings.linkFormatSettings.linkFormatPresets.find(
            (presetItem) => presetItem.name === this.plugin.settings.linkFormatSettings.selectedLinkFormatPreset
        );
        const resizePreset = this.plugin.settings.nonDestructiveResizeSettings.resizePresets.find(
            (presetItem) => presetItem.name === this.plugin.settings.nonDestructiveResizeSettings.selectedResizePreset
        );

        // Use DocumentFragment for efficient DOM updates
        const fragment = document.createDocumentFragment();

        // Helper function to create a section title
        const createSectionTitle = (title: string) => {
            const titleEl = document.createElement("div");
            titleEl.classList.add("summary-section-title");
            titleEl.textContent = title;
            return titleEl;
        };

        // Helper function to create a summary item
        const createSummaryItem = (label: string, value: string | undefined | number | boolean, boldValue = false) => {
            const itemEl = document.createElement("div");
            itemEl.classList.add("summary-item");
            itemEl.createEl("span", { text: `${label}: `, cls: "summary-label" });
            itemEl.createEl("span", {
                text: value !== undefined && value !== null ? value.toString() : "None",
                cls: boldValue ? "summary-value-bold" : "summary-value",
            });
            return itemEl;
        };

        // Function to add a preset summary section
        const addPresetSummary = (presetType: string, preset: FolderPreset | FilenamePreset | ConversionPreset | LinkFormatPreset | NonDestructiveResizePreset | undefined) => {
            if (preset) {
                const sectionEl = document.createElement("div");
                sectionEl.classList.add("summary-section");
                sectionEl.appendChild(createSectionTitle(`${presetType} Preset: ${preset.name}`));

                switch (presetType) {
                    case "Folder": {
                        const folderP = preset as FolderPreset;
                        sectionEl.appendChild(createSummaryItem("Type", folderP.type));
                        if (folderP.type === "SUBFOLDER") {
                            sectionEl.appendChild(createSummaryItem("Subfolder template", this.plugin.settings.subfolderTemplate));
                        } else if (folderP.type === "CUSTOM") {
                            sectionEl.appendChild(createSummaryItem("Custom template", folderP.customTemplate));
                        }
                        break;
                    }
                    case "Filename": {
                        const filenameP = preset as FilenamePreset;
                        sectionEl.appendChild(createSummaryItem("Template", filenameP.customTemplate));
                        break;
                    }
                    case "Conversion": {
                        const conversionP = preset as ConversionPreset;
                        sectionEl.appendChild(createSummaryItem("Output format", conversionP.outputFormat));
                        if (conversionP.outputFormat !== "NONE") {
                            sectionEl.appendChild(createSummaryItem("Quality", conversionP.quality));
                            if (conversionP.outputFormat === "PNG") {
                                sectionEl.appendChild(createSummaryItem("Color depth", conversionP.colorDepth));
                            }
                            sectionEl.appendChild(createSummaryItem("Resize mode", conversionP.resizeMode));
                            switch (conversionP.resizeMode) {
                                case "Fit":
                                case "Fill":
                                    sectionEl.appendChild(createSummaryItem("Dimensions", `${conversionP.desiredWidth}x${conversionP.desiredHeight}`));
                                    break;
                                case "Width":
                                    sectionEl.appendChild(createSummaryItem("Width", conversionP.desiredWidth));
                                    break;
                                case "Height":
                                    sectionEl.appendChild(createSummaryItem("Height", conversionP.desiredHeight));
                                    break;
                                case "LongestEdge":
                                case "ShortestEdge":
                                    sectionEl.appendChild(createSummaryItem("Edge", conversionP.desiredLongestEdge));
                                    break;
                            }
                            if (conversionP.resizeMode !== "None") {
                                sectionEl.appendChild(createSummaryItem("Scale", conversionP.enlargeOrReduce));
                            }
                            sectionEl.appendChild(createSummaryItem("Allow larger files", conversionP.allowLargerFiles ? "Yes" : "No"));
                            if (conversionP.revertToOriginalIfLarger) {
                                sectionEl.appendChild(createSummaryItem("Revert to original if larger", "Yes"));
                                sectionEl.appendChild(createSummaryItem("Minimum compression savings (KB)", conversionP.minimumCompressionSavingsInKB));
                            }
                            sectionEl.appendChild(createSummaryItem("Skip patterns", conversionP.skipConversionPatterns));
                        }
                        break;
                    }
                    case "Link format": {
                        const linkP = preset as LinkFormatPreset;
                        sectionEl.appendChild(createSummaryItem("Link type", linkP.linkFormat));
                        sectionEl.appendChild(createSummaryItem("Path format", linkP.pathFormat));
                        break;
                    }
                    case "Resize":
                        if (resizePreset) { // Add this check here
                            let resizeDimensionSummary = "";
                            switch (resizePreset.resizeDimension) {
                                case "width":
                                    resizeDimensionSummary = `Width: ${resizePreset.width}${resizePreset.resizeUnits === "percentage" ? "%" : "px"}`;
                                    break;
                                case "height":
                                    resizeDimensionSummary = `Height: ${resizePreset.height}${resizePreset.resizeUnits === "percentage" ? "%" : "px"}`;
                                    break;
                                case "both":
                                    resizeDimensionSummary = `Custom: ${resizePreset.customValue}`;
                                    break;
                                case "longest-edge":
                                    resizeDimensionSummary = `Longest edge: ${resizePreset.longestEdge}${resizePreset.resizeUnits === "percentage" ? "%" : "px"}`;
                                    break;
                                case "shortest-edge":
                                    resizeDimensionSummary = `Shortest edge: ${resizePreset.shortestEdge}${resizePreset.resizeUnits === "percentage" ? "%" : "px"}`;
                                    break;
                                case "original-width":
                                    resizeDimensionSummary = "Original width";
                                    break;
                                case "original-height":
                                    resizeDimensionSummary = "Original height";
                                    break;
                                case "editor-max-width":
                                    resizeDimensionSummary = `Editor max width: ${resizePreset.editorMaxWidthValue}${resizePreset.resizeUnits === "percentage" ? "%" : "px"}`;
                                    break;
                                case "none":
                                    resizeDimensionSummary = "No resizing";
                                    break;
                            }
                            sectionEl.appendChild(createSummaryItem("Dimension", resizeDimensionSummary));

                            // Add scale mode, respect editor max width, and maintain aspect ratio
                            if (resizePreset.resizeDimension !== "none") {
                                sectionEl.appendChild(createSummaryItem("Scale mode", resizePreset.resizeScaleMode));
                                sectionEl.appendChild(createSummaryItem("Respect editor max width", resizePreset.respectEditorMaxWidth ? "Yes" : "No"));
                                if (resizePreset.resizeDimension !== "original-width" && resizePreset.resizeDimension !== "original-height" && resizePreset.resizeDimension !== "editor-max-width") {
                                    sectionEl.appendChild(createSummaryItem("Maintain aspect ratio", resizePreset.maintainAspectRatio ? "Yes" : "No"));
                                }
                            }
                        } // end of if (resizePreset) check
                        break;
                }

                fragment.appendChild(sectionEl);
            }
        };

        addPresetSummary("Folder", folderPreset);
        addPresetSummary("Filename", filenamePreset);
        addPresetSummary("Conversion", conversionPreset);
        addPresetSummary("Link format", linkFormatPreset);
        addPresetSummary("Resize", resizePreset);

        // Append the fragment to the summary container
        summaryEl.appendChild(fragment);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

export class AvailableVariablesModal extends Modal {
    private variableProcessor: VariableProcessor;
    private modalClass = "image-converter-available-variables-modal";
    private searchInput: HTMLInputElement;
    private categorizedVariables: Record<string, { name: string; description: string; example: string }[]>;
    private contentContainer: HTMLElement;

    constructor(app: App, variableProcessor: VariableProcessor) {
        super(app);
        this.variableProcessor = variableProcessor;
    }

    onOpen() {
        this.modalEl.addClass(this.modalClass); // Add class to modal container
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "Available variables" });

        // Create search container
        const searchContainer = contentEl.createEl("div", { cls: "variable-search-container" });
        
        // Create search input
        this.searchInput = searchContainer.createEl("input", {
            type: "text",
            placeholder: "Search variables...",
            cls: "variable-search-input"
        });

        // Add search icon (optional visual enhancement)
        searchContainer.createEl("span", { 
            text: "🔍", 
            cls: "variable-search-icon" 
        });

        // Create content container for the variables
        this.contentContainer = contentEl.createEl("div", { cls: "variable-content-container" });

        // Get categorized variables once
        this.categorizedVariables = this.variableProcessor.getCategorizedVariables();

        // Initial render
        this.renderVariables();

        // Add search functionality
        this.searchInput.addEventListener("input", () => {
            this.handleSearch();
        });

        // Focus on search input
        this.searchInput.focus();
    }

    private renderVariables(searchTerm = "") {
        this.contentContainer.empty();

        for (const [category, variables] of Object.entries(this.categorizedVariables)) {
            // Filter variables based on search term
            const filteredVariables = variables.filter(variable => {
                if (!searchTerm) return true;
                
                const searchLower = searchTerm.toLowerCase();
                return (
                    variable.name.toLowerCase().includes(searchLower) ||
                    variable.description.toLowerCase().includes(searchLower) ||
                    variable.example.toLowerCase().includes(searchLower)
                );
            });

            // Only show category if it has matching variables
            if (filteredVariables.length > 0) {
                const categoryEl = this.contentContainer.createEl("div", { cls: "variable-category" });
                categoryEl.createEl("h4", { text: category, cls: "variable-category-title" });
                
                const table = categoryEl.createEl("table", { cls: "variable-table" });
                
                // Add table header
                const thead = table.createEl("thead");
                const headerRow = thead.createEl("tr");
                headerRow.createEl("th", { text: "Variable" });
                headerRow.createEl("th", { text: "Description" });
                headerRow.createEl("th", { text: "Example" });
                
                const tbody = table.createTBody();
                
                for (const variable of filteredVariables) {
                    const row = tbody.createEl("tr", { cls: "variable-row" });
                    
                    // Highlight search term in the content
                    const nameCell = row.createEl("td", { cls: "variable-name" });
                    // eslint-disable-next-line @microsoft/sdl/no-inner-html -- Safe: content from variableProcessor with escaped search term
                    nameCell.innerHTML = this.highlightSearchTerm(variable.name, searchTerm);
                    
                    const descCell = row.createEl("td", { cls: "variable-description" });
                    // eslint-disable-next-line @microsoft/sdl/no-inner-html -- Safe: content from variableProcessor with escaped search term
                    descCell.innerHTML = this.highlightSearchTerm(variable.description, searchTerm);
                    const exampleCell = row.createEl("td", { cls: "variable-example" });
                    // eslint-disable-next-line @microsoft/sdl/no-inner-html -- Safe: content from variableProcessor with escaped search term
                    exampleCell.innerHTML = this.highlightSearchTerm(variable.example, searchTerm);
                    // Add click handler to copy variable name
                    nameCell.addEventListener("click", () => {
                        void (async () => {
                            try {
                                await navigator.clipboard.writeText(variable.name);
                                
                                // Visual feedback - add CSS class for copy success
                                nameCell.classList.add("variable-name-copied");
                                
                                // Show "Copied!" text temporarily
                                const originalText = nameCell.textContent;
                                nameCell.textContent = "Copied!";
                                
                                setTimeout(() => {
                                    nameCell.classList.remove("variable-name-copied");
                                    nameCell.textContent = originalText;
                                }, 800);
                            } catch (err) {
                                console.error("Failed to copy to clipboard:", err);
                                // Fallback visual indication for copy failure
                                nameCell.classList.add("variable-name-copy-error");
                                setTimeout(() => {
                                    nameCell.classList.remove("variable-name-copy-error");
                                }, 500);
                            }
                        })();
                    });
                    nameCell.title = "Click to copy variable name";
                }
            }
        }

        // Show "no results" message if no variables match
        if (searchTerm && this.contentContainer.children.length === 0) {
            this.contentContainer.createEl("div", { 
                cls: "variable-no-results",
                text: `No variables found matching "${searchTerm}"`
            });
        }
    }

    private highlightSearchTerm(text: string, searchTerm: string): string {
        if (!searchTerm) return text;
        
        const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        return text.replace(regex, '<mark>$1</mark>');
    }

    private handleSearch() {
        const searchTerm = this.searchInput.value.trim();
        this.renderVariables(searchTerm);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.removeClass(this.modalClass); // Remove class on close
    }
}

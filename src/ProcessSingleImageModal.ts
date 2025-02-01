import {
    App,
    Modal,
    Notice,
    Setting,
    ButtonComponent,
    TFile,
} from "obsidian";
import {
    ResizeMode,
    EnlargeReduce,
} from './ImageProcessor';
import ImageConverterPlugin from "./main";

export class ProcessSingleImageModal extends Modal {
    plugin: ImageConverterPlugin;
    imageFile: TFile;

    // --- Settings UI Elements ---
    qualitySetting: Setting | null = null;
    convertToSetting: Setting | null = null;
    resizeModeSetting: Setting | null = null;
    resizeInputSettings: Setting | null = null;
    enlargeReduceSettings: Setting | null = null;
    resizeInputsDiv: HTMLDivElement | null = null;
    enlargeReduceDiv: HTMLDivElement | null = null;

    constructor(app: App, plugin: ImageConverterPlugin, imageFile: TFile) {
        super(app);
        this.plugin = plugin;
        this.imageFile = imageFile;
        this.modalEl.addClass("image-convert-modal");
    }


    onOpen() {
        const { contentEl } = this;
        this.createUI(contentEl);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }

    // --- UI Creation Methods ---

    private createUI(contentEl: HTMLElement) {
        this.createHeader(contentEl);
        this.createWarningMessage(contentEl);

        // Create settings sections (no longer collapsible)
        const settingsContainer = contentEl.createDiv({
            cls: "settings-container",
        });

        // Format and Quality Container
        const formatQualityContainer = settingsContainer.createDiv({
            cls: "format-quality-container",
        });
        this.createGeneralSettings(formatQualityContainer);

        // Resize Container
        const resizeContainer = settingsContainer.createDiv({
            cls: "resize-container",
        });
        this.createResizeSettings(resizeContainer);

        this.createProcessButton(settingsContainer);
    }

    private createHeader(contentEl: HTMLElement) {
        const headerContainer = contentEl.createDiv({ cls: "modal-header" });

        // Main title
        headerContainer.createEl("h2", {
            text: "Convert, compress and resize",
        });

        // Subtitle
        headerContainer.createEl("h6", {
            text: this.imageFile.name,
            cls: "modal-subtitle",
        });
    }

    private createWarningMessage(contentEl: HTMLElement) {
        contentEl.createEl("p", {
            cls: "modal-warning",
            text: "⚠️ This will modify the selected image. Please ensure you have backups.",
        });
    }

    private createGeneralSettings(contentEl: HTMLElement) {
        // contentEl.createEl("h4", { text: "General" });

        // --- Convert To Setting ---
        this.convertToSetting = new Setting(contentEl)
            .setName("Convert to ⓘ")
            .setDesc(
                "Choose output format. 'Same as original' applies compression/resizing to current format."
            )
            .setTooltip(
                "Same as original: preserves current format while applying compression/resizing"
            )
            .addDropdown((dropdown) => {
                dropdown
                    .addOption("disabled", "Same as original")
                    .addOptions({
                        webp: "WebP",
                        jpg: "JPG",
                        png: "PNG",
                    })
                    .setValue(this.plugin.settings.ProcessCurrentNoteconvertTo)
                    .onChange(async (value) => {
                        this.plugin.settings.ProcessCurrentNoteconvertTo = value;
                        await this.plugin.saveSettings();
                    });
            });

        // --- Quality Setting ---
        this.qualitySetting = new Setting(contentEl)
            .setName("Quality ⓘ")
            .setDesc("Compression level (0-100)")
            .setTooltip(
                "100: No compression (original quality)\n75: Recommended (good balance)\n0-50: High compression (lower quality)"
            )
            .addText((text) => {
                text
                    .setPlaceholder("Enter quality (0-100)")
                    .setValue(
                        (
                            this.plugin.settings.ProcessCurrentNotequality * 100
                        ).toString()
                    )
                    .onChange(async (value) => {
                        const quality = parseInt(value, 10);
                        if (
                            !isNaN(quality) &&
                            quality >= 0 &&
                            quality <= 100
                        ) {
                            this.plugin.settings.ProcessCurrentNotequality =
                                quality / 100;
                            await this.plugin.saveSettings();
                        }
                    });
            });
    }

    private createResizeSettings(contentEl: HTMLElement) {
        // contentEl.createEl("h4", { text: "Resize" });

        // --- Resize Mode Setting ---
        this.resizeModeSetting = new Setting(contentEl)
            .setName("Resize mode ⓘ")
            .setDesc(
                "Choose how the image should be resized. Note: Results are permanent."
            )
            .setTooltip(
                "Fit: Maintains aspect ratio within dimensions\nFill: Exactly matches dimensions\nLongest Edge: Limits the longest side\nShortest Edge: Limits the shortest side\nWidth/Height: Constrains single dimension"
            )
            .addDropdown((dropdown) => {
                dropdown
                    .addOptions({
                        None: "None",
                        Fit: "Fit (maintain aspect ratio within dimensions)",
                        Fill: "Fill (exactly match dimensions)",
                        LongestEdge: "Longest edge",
                        ShortestEdge: "Shortest edge",
                        Width: "Width",
                        Height: "Height",
                    })
                    .setValue(
                        this.plugin.settings
                            .ProcessCurrentNoteResizeModalresizeMode
                    )
                    .onChange(async (value) => {
                        this.plugin.settings.ProcessCurrentNoteResizeModalresizeMode =
                            value;
                        await this.plugin.saveSettings();
                        this.updateResizeInputVisibility(value);
                    });
            });

        // --- Enlarge/Reduce Setting ---
        this.createEnlargeReduceInputs(contentEl);

        // --- Resize Inputs (Conditional) ---
        this.resizeInputsDiv = contentEl.createDiv({ cls: "resize-inputs" });
        this.updateResizeInputVisibility(
            this.plugin.settings.ProcessCurrentNoteResizeModalresizeMode
        );
    }

    private createEnlargeReduceInputs(contentEl: HTMLElement) {
        this.enlargeReduceDiv = contentEl.createDiv({
            cls: "enlarge-reduce-settings",
        });
        this.createEnlargeReduceSettings();
    }


    createProcessButton(contentEl: HTMLElement) {
        const buttonContainer = contentEl.createDiv({ cls: "button-container" });
        new ButtonComponent(buttonContainer)
            .setButtonText("Process")
            .setCta()
            .onClick(async () => {
                this.close();
                const {
                    ProcessCurrentNoteconvertTo: convertTo,
                    ProcessCurrentNotequality: quality,
                    ProcessCurrentNoteResizeModalresizeMode: resizeMode,
                    ProcessCurrentNoteresizeModaldesiredWidth: desiredWidth,
                    ProcessCurrentNoteresizeModaldesiredHeight: desiredHeight,
                    ProcessCurrentNoteresizeModaldesiredLength: desiredLength,
                    ProcessCurrentNoteEnlargeOrReduce: enlargeOrReduce,
                    allowLargerFiles,
                } = this.plugin.settings;
    
                const outputFormat = convertTo === 'disabled' ? 'ORIGINAL' : convertTo.toUpperCase() as 'WEBP' | 'JPEG' | 'PNG' | 'ORIGINAL';
                const colorDepth = 1;
    
                const imageData = await this.app.vault.readBinary(this.imageFile);
                const imageBlob = new Blob([imageData], { type: `image/${this.imageFile.extension}` });
    
                const processedImageData = await this.plugin.imageProcessor.processImage(
                    imageBlob,
                    outputFormat,
                    quality,
                    colorDepth,
                    resizeMode as ResizeMode,
                    desiredWidth,
                    desiredHeight,
                    desiredLength,
                    enlargeOrReduce as EnlargeReduce,
                    allowLargerFiles
                );
    
                // Handle file renaming or overwriting for single image processing
                if (this.imageFile.extension !== outputFormat.toLowerCase() && outputFormat !== "ORIGINAL") {
                    // Rename the file if the extension is different
                    const newFileName = this.imageFile.basename + '.' + outputFormat.toLowerCase();
                    const newFilePath = this.imageFile.path.replace(this.imageFile.name, newFileName);
    
                    // Check if a file with the new name already exists
                    if (this.app.vault.getAbstractFileByPath(newFilePath)) {
                        new Notice(`Error: A file with the name ${newFileName} already exists.`);
                        return; // Abort the process if the file already exists and extension is different
                    }

                    // Rename the file
                    await this.app.fileManager.renameFile(this.imageFile, newFilePath);
    
                    // Get the renamed file using the new path
                    const renamedFile = this.app.vault.getAbstractFileByPath(newFilePath) as TFile;
                    if (!renamedFile) {
                        console.error('Failed to find renamed file:', newFilePath);
                        return;
                    }
    
                    // Modify the file content with processed image data
                    await this.app.vault.modifyBinary(renamedFile, processedImageData);
    
                    // Update links in the active note
                    const activeFile = this.app.workspace.getActiveFile();
                    if (activeFile) {
                        await this.updateLinks(activeFile, this.imageFile, outputFormat.toLowerCase());
                    }
    
                    // Update the imageFile property to reflect the renamed file
                    this.imageFile = renamedFile;
                } else {
                    // Overwrite the existing file if the extension is the same or format is ORIGINAL
                    await this.app.vault.modifyBinary(this.imageFile, processedImageData);
                    await this.refreshActiveNote(); // Refresh the file in the UI
                }
    
                // Refresh the note to display the updated image
                await this.refreshActiveNote();
    
                new Notice(`Processed image: ${this.imageFile.name}`);
            });
    }
    
    /**
     * Updates links in the note to reflect the renamed image file.
     */
    async updateLinks(noteFile: TFile, oldFile: TFile, newExtension: string) {
        try {
            const content = await this.app.vault.read(noteFile);
            const oldFileName = oldFile.name;
            const newFileName = oldFile.basename + '.' + newExtension;
    
            // Replace all occurrences of the old file name with the new file name
            const updatedContent = content.replace(
                new RegExp(`!\\[\\[${oldFileName}\\]\\]`, 'g'),
                `![[${newFileName}]]`
            );
    
            // Write the updated content back to the note
            await this.app.vault.modify(noteFile, updatedContent);
        } catch (error) {
            console.error('Error updating links:', error);
            new Notice(`Error updating links: ${error.message}`);
        }
    }
    
    /**
     * Refreshes the active note to ensure the updated image is displayed.
     */
    async refreshActiveNote() {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
            const activeLeaf = this.app.workspace.getLeaf();
            if (activeLeaf) {
                // Get the current leaf using getMostRecentLeaf (or getLeaf for specific cases)
                const leaf = this.app.workspace.getMostRecentLeaf();
                if (leaf) {
                    // Store current state
                    const currentState = leaf.getViewState();
                    
                    // Switch to a different view type temporarily
                    await leaf.setViewState({
                        type: 'empty',
                        state: {}
                    });

                    // Switch back to the original view
                    await leaf.setViewState(currentState);

                }
                // Reopen the file to refresh its content
                await activeLeaf.openFile(activeFile, { active: true });
            }
        }
    }


    // --- Helper Methods for Settings ---

    private updateResizeInputVisibility(resizeMode: string): void {
        if (resizeMode === "None") {
            this.resizeInputsDiv?.empty();
            this.enlargeReduceDiv?.hide();
            this.resizeInputSettings = null;
            this.enlargeReduceSettings = null;
        } else {
            if (!this.resizeInputSettings) {
                this.createResizeInputSettings(resizeMode);
            } else {
                this.updateResizeInputSettings(resizeMode);
            }

            if (!this.enlargeReduceSettings) {
                this.createEnlargeReduceSettings();
            }
            this.enlargeReduceDiv?.show();
        }
    }

    private createEnlargeReduceSettings(): void {
        if (!this.enlargeReduceDiv) return;

        this.enlargeReduceDiv.empty();

        this.enlargeReduceSettings = new Setting(this.enlargeReduceDiv)
            .setClass("enlarge-reduce-setting")
            .setName("Enlarge or Reduce ⓘ")
            .setDesc(
                "Reduce and Enlarge: Adjusts all images. Reduce only: Shrinks larger images. Enlarge only: Enlarges smaller images."
            )
            .setTooltip(
                "• Reduce and Enlarge: Adjusts all images to fit specified dimensions\n• Reduce only: Only shrinks images larger than target\n• Enlarge only: Only enlarges images smaller than target"
            )
            .addDropdown((dropdown) => {
                dropdown
                    .addOptions({
                        Always: "Reduce and Enlarge",
                        Reduce: "Reduce only",
                        Enlarge: "Enlarge only",
                    })
                    .setValue(
                        this.plugin.settings.ProcessCurrentNoteEnlargeOrReduce
                    )
                    .onChange(
                        async (value: "Always" | "Reduce" | "Enlarge") => {
                            this.plugin.settings.ProcessCurrentNoteEnlargeOrReduce =
                                value;
                            await this.plugin.saveSettings();
                        }
                    );
            });
    }

    private createResizeInputSettings(resizeMode: string): void {
        if (!this.resizeInputsDiv) return;

        this.resizeInputsDiv.empty();

        this.resizeInputSettings = new Setting(this.resizeInputsDiv).setClass(
            "resize-input-setting"
        );

        this.updateResizeInputSettings(resizeMode);
    }

    private updateResizeInputSettings(resizeMode: string): void {
        if (!this.resizeInputSettings) return;

        this.resizeInputSettings.clear();

        let name = "";
        let desc = "";

        if (["Fit", "Fill"].includes(resizeMode)) {
            name = "Resize dimensions";
            desc = "Enter the desired width and height in pixels";
            this.resizeInputSettings
                .setName(name)
                .setDesc(desc)
                .addText((text) =>
                    text
                        .setPlaceholder("Width")
                        .setValue(
                            this.plugin.settings
                                .ProcessCurrentNoteresizeModaldesiredWidth
                                .toString()
                        )
                        .onChange(async (value: string) => {
                            const width = parseInt(value);
                            if (/^\d+$/.test(value) && width > 0) {
                                this.plugin.settings.ProcessCurrentNoteresizeModaldesiredWidth =
                                    width;
                                await this.plugin.saveSettings();
                            }
                        })
                )
                .addText((text) =>
                    text
                        .setPlaceholder("Height")
                        .setValue(
                            this.plugin.settings
                                .ProcessCurrentNoteresizeModaldesiredHeight
                                .toString()
                        )
                        .onChange(async (value: string) => {
                            const height = parseInt(value);
                            if (/^\d+$/.test(value) && height > 0) {
                                this.plugin.settings.ProcessCurrentNoteresizeModaldesiredHeight =
                                    height;
                                await this.plugin.saveSettings();
                            }
                        })
                );
        } else {
            switch (resizeMode) {
                case "LongestEdge":
                case "ShortestEdge":
                    name = `${resizeMode}`;
                    desc = "Enter the desired length in pixels";
                    break;
                case "Width":
                    name = "Width";
                    desc = "Enter the desired width in pixels";
                    break;
                case "Height":
                    name = "Height";
                    desc = "Enter the desired height in pixels";
                    break;
            }

            this.resizeInputSettings
                .setName(name)
                .setDesc(desc)
                .addText((text) =>
                    text
                        .setPlaceholder("")
                        .setValue(this.getInitialValue(resizeMode).toString())
                        .onChange(async (value: string) => {
                            const length = parseInt(value);
                            if (/^\d+$/.test(value) && length > 0) {
                                await this.updateSettingValue(
                                    resizeMode,
                                    length
                                );
                            }
                        })
                );
        }
    }

    private getInitialValue(resizeMode: string): number {
        switch (resizeMode) {
            case "LongestEdge":
            case "ShortestEdge":
                return this.plugin.settings
                    .ProcessCurrentNoteresizeModaldesiredLength;
            case "Width":
                return this.plugin.settings
                    .ProcessCurrentNoteresizeModaldesiredWidth;
            case "Height":
                return this.plugin.settings
                    .ProcessCurrentNoteresizeModaldesiredHeight;
            default:
                return 0;
        }
    }

    private async updateSettingValue(
        resizeMode: string,
        value: number
    ): Promise<void> {
        switch (resizeMode) {
            case "LongestEdge":
            case "ShortestEdge":
                this.plugin.settings.ProcessCurrentNoteresizeModaldesiredLength =
                    value;
                break;
            case "Width":
                this.plugin.settings.ProcessCurrentNoteresizeModaldesiredWidth =
                    value;
                break;
            case "Height":
                this.plugin.settings.ProcessCurrentNoteresizeModaldesiredHeight =
                    value;
                break;
        }
        await this.plugin.saveSettings();
    }
}
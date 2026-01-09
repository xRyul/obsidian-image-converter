// ProcessSingleImageModal.ts
import { App, Modal, Notice, TFile, Setting, MarkdownView } from "obsidian";
import ImageConverterPlugin from "./main";
import { OutputFormat, ResizeMode, EnlargeReduce } from "./ImageConverterSettings";

export interface SingleImageModalSettings {
    conversionPresetName: string;
    outputFormat: OutputFormat;
    quality: number;
    colorDepth: number;
    resizeMode: ResizeMode;
    desiredWidth: number;
    desiredHeight: number;
    desiredLongestEdge: number;
    enlargeOrReduce: EnlargeReduce;
    allowLargerFiles: boolean;
    pngquantExecutablePath: string;
    pngquantQuality: string;
    ffmpegExecutablePath: string;
    ffmpegCrf: number;
    ffmpegPreset: string;
}

export class ProcessSingleImageModal extends Modal {
    private imageFile: TFile;
    private modalSettings: SingleImageModalSettings;
    private previewImageUrl: string | null = null;
    private previewContainer: HTMLDivElement;

    // --- Dedicated containers for each section ---
    private conversionSettingsContainer: HTMLDivElement;
    private resizeSettingsContainer: HTMLDivElement;
    private buttonContainer: HTMLDivElement;

    constructor(app: App, private plugin: ImageConverterPlugin, file: TFile) {
        super(app);
        this.imageFile = file;
        this.loadModalSettings();
        this.titleEl.setText(`Process Image: ${file.name}`);
    }

    private loadModalSettings() {
        const savedSettings = this.plugin.settings.singleImageModalSettings;

        if (savedSettings) {
            this.modalSettings = { ...savedSettings };
        } else {
            const avifPreset = this.plugin.settings.conversionPresets.find(preset => preset.outputFormat === "AVIF");
            const pngQuantPreset = this.plugin.settings.conversionPresets.find(preset => preset.outputFormat === "PNGQUANT");

            this.modalSettings = {
                conversionPresetName: this.plugin.settings.selectedConversionPreset,
                outputFormat: this.plugin.settings.outputFormat,
                quality: this.plugin.settings.quality,
                colorDepth: this.plugin.settings.colorDepth,
                resizeMode: this.plugin.settings.resizeMode,
                desiredWidth: this.plugin.settings.desiredWidth,
                desiredHeight: this.plugin.settings.desiredHeight,
                desiredLongestEdge: this.plugin.settings.desiredLongestEdge,
                enlargeOrReduce: this.plugin.settings.enlargeOrReduce,
                allowLargerFiles: this.plugin.settings.allowLargerFiles,
                pngquantExecutablePath: pngQuantPreset?.pngquantExecutablePath || "",
                pngquantQuality: pngQuantPreset?.pngquantQuality || "",
                ffmpegExecutablePath: avifPreset?.ffmpegExecutablePath || "",
                ffmpegCrf: avifPreset?.ffmpegCrf !== undefined ? avifPreset.ffmpegCrf : (this.plugin.settings.ffmpegCrf !== undefined ? this.plugin.settings.ffmpegCrf : 23),
                ffmpegPreset: avifPreset?.ffmpegPreset || this.plugin.settings.ffmpegPreset || "medium",
            };
        }
    }

    private saveModalSettings() {
        this.plugin.settings.singleImageModalSettings = { ...this.modalSettings };
        this.plugin.saveSettings().catch((error: unknown) => {
            console.error("Failed to save single image modal settings:", error);
        });
    }

    private getErrorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    // Obsidian calls Modal.onOpen as a lifecycle hook and intentionally ignores the returned Promise.
    // We keep this method async to allow await inside, so we disable the no-misused-promises rule here.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    async onOpen(): Promise<void> {
        this.contentEl.empty();
        this.contentEl.addClass("process-single-image-modal");

        this.previewContainer = this.contentEl.createDiv("preview-image-container");
        this.previewContainer.setCssStyles({
            border: "1px solid #ccc",
            padding: "10px",
            margin: "1em 0",
            textAlign: "center",
            maxHeight: "400px",
            overflowY: "auto",
            overflowX: "hidden",
        });
        this.conversionSettingsContainer = this.contentEl.createDiv("conversion-settings-container");
        this.resizeSettingsContainer = this.contentEl.createDiv("resize-settings-container");
        this.buttonContainer = this.contentEl.createDiv("process-single-image-modal-buttons");

        const windowWidth = window.innerWidth;
        const maxWidth = 800;
        const modalWidth = Math.min(windowWidth * 0.9, maxWidth);
        this.modalEl.setCssStyles({ width: `${modalWidth}px` });

        this.renderSettings();
        await this.generatePreview();  // Initial preview, may be skipped.
        this.renderActionButtons();
    }

    private renderSettings() {
        this.renderConversionSettings();
        this.renderResizeSettings();
    }

    private renderConversionSettings() {
        this.conversionSettingsContainer.empty();

        const currentPreset = this.plugin.getPresetByName(
            this.modalSettings.conversionPresetName,
            this.plugin.settings.conversionPresets,
            "Conversion"
        );

        new Setting(this.conversionSettingsContainer)
            // eslint-disable-next-line obsidianmd/ui/sentence-case
            .setName("Output Format")
            .addDropdown(dropdown => {
                const options: Record<OutputFormat, string> = {
                    "WEBP": "WEBP",
                    "JPEG": "JPEG",
                    "PNG": "PNG",
                    "ORIGINAL": "Original (Compress)",
                    "NONE": "None (No Conversion)",
                    "PNGQUANT": "pngquant (PNG Only)",
                    "AVIF": "AVIF (via ffmpeg)"
                };
                Object.entries(options).forEach(([key, value]) => {
                    dropdown.addOption(key, value);
                });
                dropdown.setValue(this.modalSettings.outputFormat);
                dropdown.onChange(async (value: OutputFormat) => {
                    const currentPngquantPath = this.modalSettings.pngquantExecutablePath;
                    const currentFfmpegPath = this.modalSettings.ffmpegExecutablePath;

                    this.modalSettings.outputFormat = value;
                    this.modalSettings.pngquantExecutablePath = currentPngquantPath;
                    this.modalSettings.ffmpegExecutablePath = currentFfmpegPath;

                    this.renderConversionSettings();
                    await this.generatePreview(); // Regenerate preview (conditional)
                });
            });

        if (["WEBP", "JPEG", "ORIGINAL"].includes(this.modalSettings.outputFormat)) {
            new Setting(this.conversionSettingsContainer)
                .setName("Quality")
                .addSlider(slider => {
                    slider.setLimits(1, 100, 1)
                        .setValue(this.modalSettings.quality)
                        .setDynamicTooltip()
                        .onChange(async (value) => {
                            this.modalSettings.quality = value;
                            await this.generatePreview(); // Regenerate preview (conditional)
                        });
                });
        }

        if (this.modalSettings.outputFormat === "PNG") {
            new Setting(this.conversionSettingsContainer)
                .setName("Color depth")
                .addSlider(slider => {
                    slider.setLimits(0, 1, 0.1)
                        .setValue(this.modalSettings.colorDepth)
                        .setDynamicTooltip()
                        .onChange(async (value) => {
                            this.modalSettings.colorDepth = value;
                            await this.generatePreview(); // Regenerate preview (conditional)
                        });
                });
        }

        if (this.modalSettings.outputFormat === "PNGQUANT") {
            new Setting(this.conversionSettingsContainer)
                // eslint-disable-next-line obsidianmd/ui/sentence-case
                .setName("pngquant executable path 🛈")
                .setTooltip("Provide full-path to the binary file. It can be inside vault or anywhere in your file system.")
                .addText(text => {
                    text.setValue(this.modalSettings.pngquantExecutablePath)
                        .onChange(async value => {
                            if (currentPreset) {
                                currentPreset.pngquantExecutablePath = value;
                            }
                            this.modalSettings.pngquantExecutablePath = value;
                            // NO PREVIEW for pngquant
                        });
                    text.inputEl.setAttr('spellcheck', 'false');
                });

            new Setting(this.conversionSettingsContainer)
                .setName("Quality min-max range 🛈")
                .setTooltip(
                    // eslint-disable-next-line obsidianmd/ui/sentence-case
                    "Instructs pngquant to use the least amount of colors required to meet or exceed the max quality. min and max are numbers in range 0 (worst) to 100 (perfect)."
                )
                .addText(text => {
                    text.setValue(this.modalSettings.pngquantQuality)
                        .onChange(async value => {
                            this.modalSettings.pngquantQuality = value;
                            // NO PREVIEW for pngquant
                        });
                    text.inputEl.setAttr('spellcheck', 'false');
                });
        }

        if (this.modalSettings.outputFormat === "AVIF") {
            new Setting(this.conversionSettingsContainer)
                // eslint-disable-next-line obsidianmd/ui/sentence-case
                .setName("FFmpeg executable path 🛈")
                .setTooltip("Provide full-path to the binary file. It can be inside vault or anywhere in your file system.")
                .addText(text => {
                    text.setValue(this.modalSettings.ffmpegExecutablePath)
                        .onChange(async value => {
                            if (currentPreset) {
                                currentPreset.ffmpegExecutablePath = value;
                            }
                            this.modalSettings.ffmpegExecutablePath = value;
                            // NO PREVIEW for AVIF
                        });
                    text.inputEl.setAttr('spellcheck', 'false');
                });

            new Setting(this.conversionSettingsContainer)
                // eslint-disable-next-line obsidianmd/ui/sentence-case
                .setName("FFmpeg CRF")
                .setDesc("Lower values mean better quality (larger file size). 0 is lossless.")
                .addSlider(slider => {
                    slider.setLimits(0, 63, 1)
                        .setValue(this.modalSettings.ffmpegCrf)
                        .setDynamicTooltip()
                        .onChange(async (value) => {
                            this.modalSettings.ffmpegCrf = value;
                            // NO PREVIEW for AVIF
                        });
                });

            new Setting(this.conversionSettingsContainer)
                // eslint-disable-next-line obsidianmd/ui/sentence-case
                .setName("FFmpeg Preset")
                .addDropdown(dropdown => {
                    dropdown.addOptions({
                        "ultrafast": "ultrafast",
                        "superfast": "superfast",
                        "veryfast": "veryfast",
                        "faster": "faster",
                        "fast": "fast",
                        "medium": "medium",
                        "slow": "slow",
                        "slower": "slower",
                        "veryslow": "veryslow",
                        "placebo": "placebo",
                    });
                    dropdown.setValue(this.modalSettings.ffmpegPreset);
                    dropdown.onChange(async (value) => {
                        this.modalSettings.ffmpegPreset = value;
                        // NO PREVIEW for AVIF
                    });
                });
        }
    }

    private renderResizeSettings() {
        this.resizeSettingsContainer.empty();

        new Setting(this.resizeSettingsContainer)
            // eslint-disable-next-line obsidianmd/ui/sentence-case
            .setName("Resize Mode")
            .addDropdown(dropdown => {
                const resizeOptions: Record<ResizeMode, string> = {
                    "None": "None",
                    "Fit": "Fit",
                    "Fill": "Fill",
                    "LongestEdge": "Longest Edge",
                    "ShortestEdge": "Shortest Edge",
                    "Width": "Width",
                    "Height": "Height",
                };
                Object.entries(resizeOptions).forEach(([key, value]) => {
                    dropdown.addOption(key, value);
                });
                dropdown.setValue(this.modalSettings.resizeMode)
                    .onChange(async (value: ResizeMode) => {
                        this.modalSettings.resizeMode = value;
                        this.renderResizeSettings();
                        await this.generatePreview(); // Regenerate preview (conditional)
                    });
            });

        if (["Fit", "Fill", "Width", "Height", "LongestEdge", "ShortestEdge"].includes(this.modalSettings.resizeMode)) {
             //Consolidate all text inputs that effect the generate preview function
              if (["Fit", "Fill", "Width"].includes(this.modalSettings.resizeMode)){
                new Setting(this.resizeSettingsContainer)
                // eslint-disable-next-line obsidianmd/ui/sentence-case
                .setName("Desired Width")
                .addText(text => {
                    text.setValue(this.modalSettings.desiredWidth.toString())
                        .onChange(async (value) => {
                            this.modalSettings.desiredWidth = parseInt(value, 10) || 0;
                            if(!(["PNGQUANT", "AVIF"].includes(this.modalSettings.outputFormat))){
                                await this.generatePreview();
                            }
                        });
                    text.inputEl.setAttr('spellcheck', 'false');
                });
              }
            if (["Fit", "Fill", "Height"].includes(this.modalSettings.resizeMode)) {
                new Setting(this.resizeSettingsContainer)
                    // eslint-disable-next-line obsidianmd/ui/sentence-case
                    .setName("Desired Height")
                    .addText(text => {
                        text.setValue(this.modalSettings.desiredHeight.toString())
                            .onChange(async (value) => {
                                this.modalSettings.desiredHeight = parseInt(value, 10) || 0;
                                if(!(["PNGQUANT", "AVIF"].includes(this.modalSettings.outputFormat))){
                                    await this.generatePreview();
                                }
                            });
                        text.inputEl.setAttr('spellcheck', 'false');
                    });
            }

            if (["LongestEdge", "ShortestEdge"].includes(this.modalSettings.resizeMode)) {
                new Setting(this.resizeSettingsContainer)
                    .setName(this.modalSettings.resizeMode === "LongestEdge" ? "Desired Longest Edge" : "Desired Shortest Edge")
                    .addText(text => {
                        text.setValue(this.modalSettings.desiredLongestEdge.toString())
                            .onChange(async (value) => {
                                this.modalSettings.desiredLongestEdge = parseInt(value, 10) || 0;
                                if(!(["PNGQUANT", "AVIF"].includes(this.modalSettings.outputFormat))){
                                    await this.generatePreview();
                                }
                            });
                        text.inputEl.setAttr('spellcheck', 'false');
                    });
            }

            new Setting(this.resizeSettingsContainer)
                // eslint-disable-next-line obsidianmd/ui/sentence-case
                .setName("Enlarge/Reduce")
                .addDropdown(dropdown => {
                    const enlargeReduceOptions: Record<EnlargeReduce, string> = {
                        "Auto": "Auto",
                        "Reduce": "Only Reduce",
                        "Enlarge": "Only Enlarge",
                    };
                    Object.entries(enlargeReduceOptions).forEach(([key, value]) => {
                        dropdown.addOption(key, value);
                    });
                    dropdown.setValue(this.modalSettings.enlargeOrReduce)
                        .onChange(async (value: EnlargeReduce) => {
                            this.modalSettings.enlargeOrReduce = value;
                            if(!(["PNGQUANT", "AVIF"].includes(this.modalSettings.outputFormat))){
                                await this.generatePreview();
                            }
                        });
                });
        }
    }

    private renderActionButtons() {
        this.buttonContainer.empty();
        new Setting(this.buttonContainer)
            .addButton(button => {
                button.setButtonText("Process")
                    .setCta()
                    .onClick(() => this.processImage());
            })
            .addButton(button => {
                button.setButtonText("Cancel")
                    .onClick(() => this.close());
            });
    }



    private async generatePreview() {
        //  Skip preview for PNGQUANT and AVIF
        if (this.modalSettings.outputFormat === "PNGQUANT" || this.modalSettings.outputFormat === "AVIF") {
            this.previewContainer.empty();
            this.previewContainer.createEl("p", { text: "Preview not available for this format." });
            return;
        }

        this.previewContainer.empty();
        const loadingEl = this.previewContainer.createEl("p", { text: "Generating preview..." });

        try {
            const fileBuffer = await this.app.vault.readBinary(this.imageFile);
            const imageBlob = new Blob([fileBuffer], { type: this.imageFile.extension ? `image/${this.imageFile.extension}` : 'application/octet-stream' });

            // No need to get conversionPreset here; preview uses modalSettings

            const processedImageBuffer = await this.plugin.imageProcessor.processImage(
                imageBlob,
                this.modalSettings.outputFormat,
                this.modalSettings.quality / 100,
                this.modalSettings.colorDepth,
                this.modalSettings.resizeMode,
                this.modalSettings.desiredWidth,
                this.modalSettings.desiredHeight,
                this.modalSettings.desiredLongestEdge,
                this.modalSettings.enlargeOrReduce,
                this.modalSettings.allowLargerFiles,
                undefined, // No special preset for preview
                this.plugin.settings
            );

            const blob = new Blob([processedImageBuffer], { type: `image/${this.modalSettings.outputFormat.toLowerCase()}` });
            this.previewImageUrl = URL.createObjectURL(blob);

            const img = this.previewContainer.createEl("img", {
                attr: {
                    src: this.previewImageUrl,
                },
                cls: "preview-image",
            });
            img.setCssStyles({
                maxWidth: "100%",
                maxHeight: "350px",
                height: "auto",
                display: "block",
                margin: "0 auto",
            });

            loadingEl.remove();

        } catch (error) {
            loadingEl.setText(`Preview failed: ${this.getErrorMessage(error)}`);
            console.error("Preview generation failed:", error);
        }
    }
    private async processImage() {
        //No Changes needed
        try {
            const fileBuffer = await this.app.vault.readBinary(this.imageFile);
            const imageFile = new File([fileBuffer], this.imageFile.name, { type: this.imageFile.extension ? `image/${this.imageFile.extension}` : 'application/octet-stream' });

            const destinationPath: string = this.imageFile.parent?.path || "";
            let newFilename: string = (this.modalSettings.outputFormat === "NONE" || this.modalSettings.outputFormat === "ORIGINAL")
                ? this.imageFile.name
                : `${this.imageFile.name.substring(0, this.imageFile.name.lastIndexOf("."))}.${this.modalSettings.outputFormat.toLowerCase()}`;

            //  Handle PNGQuant extension
            if (this.modalSettings.outputFormat === "PNGQUANT") {
                newFilename = `${this.imageFile.name.substring(0, this.imageFile.name.lastIndexOf("."))}.png`; // Force .png
            }

            const fullPath: string = this.plugin.folderAndFilenameManagement.combinePath(destinationPath, newFilename);

            // Get Conversion Preset
            const conversionPreset = this.plugin.getPresetByName(
                this.modalSettings.conversionPresetName,
                this.plugin.settings.conversionPresets,
                "Conversion"
            );

            // Skip if the conversion is not needed
            if (this.modalSettings.outputFormat === "NONE" && this.modalSettings.resizeMode === "None") {
                new Notice(`No processing needed for "${this.imageFile.name}".`, 1000);
                this.close();
                return;
            }

            if (conversionPreset && this.plugin.folderAndFilenameManagement.shouldSkipConversion(this.imageFile.name, conversionPreset)) {
                new Notice(`Skipped conversion of image "${this.imageFile.name}" due to skip pattern match in the conversion preset.`, 2000);
                this.close();
                return;
            }

            const originalSize = this.imageFile.stat.size;
            let processedImageBuffer: ArrayBuffer | undefined;

            // --- Handle NONE and ORIGINAL formats, and resizing ---
            if (this.modalSettings.outputFormat === "NONE" && this.modalSettings.resizeMode !== "None") {
                // No conversion, BUT resizing is needed.
                processedImageBuffer = await this.plugin.imageProcessor.resizeImage(
                    imageFile,
                    this.modalSettings.resizeMode,
                    this.modalSettings.desiredWidth,
                    this.modalSettings.desiredHeight,
                    this.modalSettings.desiredLongestEdge,
                    this.modalSettings.enlargeOrReduce
                );
            } else if (this.modalSettings.outputFormat === "ORIGINAL") {
                // Compress using the original format.
                processedImageBuffer = await this.plugin.imageProcessor.compressOriginalImage(
                    imageFile,
                    this.modalSettings.quality / 100,
                    this.modalSettings.resizeMode,
                    this.modalSettings.desiredWidth,
                    this.modalSettings.desiredHeight,
                    this.modalSettings.desiredLongestEdge,
                    this.modalSettings.enlargeOrReduce
                );

            } else {
                // All other conversion cases (WEBP, JPEG, PNG, etc.)
                // Pass pngquant settings if applicable
                const avifPreset = this.plugin.settings.conversionPresets.find(
                    preset => preset.outputFormat === "AVIF"
                );
                processedImageBuffer = await this.plugin.imageProcessor.processImage(
                    imageFile,
                    this.modalSettings.outputFormat,
                    this.modalSettings.outputFormat === "AVIF" ? 100 : this.modalSettings.quality / 100, // Pass 100 for quality, it is ignored,
                    this.modalSettings.colorDepth,
                    this.modalSettings.resizeMode,
                    this.modalSettings.desiredWidth,
                    this.modalSettings.desiredHeight,
                    this.modalSettings.desiredLongestEdge,
                    this.modalSettings.enlargeOrReduce,
                    this.modalSettings.allowLargerFiles,
                    this.modalSettings.outputFormat === "PNGQUANT" ? { // Pass a dummy preset with pngquant settings
                        name: "temp",
                        outputFormat: "PNGQUANT",
                        quality: 100,
                        colorDepth: 1,
                        resizeMode: "None",
                        desiredWidth: 0,
                        desiredHeight: 0,
                        desiredLongestEdge: 0,
                        enlargeOrReduce: "Auto",
                        allowLargerFiles: false,
                        skipConversionPatterns: "",
                        pngquantExecutablePath: this.modalSettings.pngquantExecutablePath,
                        pngquantQuality: this.modalSettings.pngquantQuality,
                    } : this.modalSettings.outputFormat === "AVIF" ? {
                        name: "temp", // Dummy name
                        outputFormat: "AVIF",
                        quality: 100,
                        colorDepth: 1,
                        resizeMode: "None",
                        desiredWidth: 0,
                        desiredHeight: 0,
                        desiredLongestEdge: 0,
                        enlargeOrReduce: "Auto",
                        allowLargerFiles: false,
                        skipConversionPatterns: "",
                        ffmpegExecutablePath: avifPreset?.ffmpegExecutablePath || "",
                        ffmpegCrf: this.modalSettings.ffmpegCrf,
                        ffmpegPreset: this.modalSettings.ffmpegPreset,
                    } : undefined,
                    this.plugin.settings
                );
            }


            // --- File Creation/Replacement ---
            if (processedImageBuffer && this.plugin.settings.revertToOriginalIfLarger && processedImageBuffer.byteLength > originalSize) {
                this.plugin.showSizeComparisonNotification(originalSize, processedImageBuffer.byteLength);
                new Notice(`Using original image for "${this.imageFile.name}" as processed image is larger.`, 1000);
                // We don't create/modify a file, but the link *might* need updating (if format changed).
            } else if (processedImageBuffer) {
                this.plugin.showSizeComparisonNotification(originalSize, processedImageBuffer.byteLength);

                // Check if the file needs renaming *before* modifying it
                if (this.imageFile.path !== fullPath) {
                    // File needs to be renamed. Use renameFile for atomic operation.
                    await this.app.fileManager.renameFile(this.imageFile, fullPath);
                    // Get a reference to the *renamed* file.
                    const renamedFile = this.app.vault.getAbstractFileByPath(fullPath);
                    if (renamedFile instanceof TFile) {
                        // Now modify the *renamed* file.
                        await this.app.vault.modifyBinary(renamedFile, processedImageBuffer);
                    } else {
                        new Notice(`Error: Could not find renamed file at ${fullPath}`);
                        return; // Exit if rename failed
                    }
                } else {
                    // No rename needed, just modify the existing file in place.
                    await this.app.vault.modifyBinary(this.imageFile, processedImageBuffer); // Modify in place
                }

            } // If there is no `processedImageBuffer` then only rename happened, so do nothing.


            // --- Update Link in Active Note ---
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (activeView) {
                const { editor } = activeView;
                const fileContent = editor.getValue();

                const escapedOriginalName = this.imageFile.name.replace(/[[\]]/g, '\\$&');
                const linkRegex = new RegExp(`!\\[\\[${escapedOriginalName}(?:\\|[^\\]]+)?\\]\\[\\]|!\\[.*?\\]\\((${escapedOriginalName})(?:\\?[^)]*)?\\)`, 'g');

                // Use the new filename for the link
                const newLinkText = `![[${newFilename}]]`;

                const newContent = fileContent.replace(linkRegex, newLinkText);
                if (newContent !== fileContent) {
                    editor.setValue(newContent);
                    new Notice(`Link updated in "${activeView.file?.name}"`, 1000);
                }
            }

            try {
                await this.refreshActiveNote();
            } catch (error) {
                // Non-critical: image was processed successfully, but view refresh failed
                console.error("Error refreshing active note after image processing:", error);
                new Notice("Image processed, but failed to refresh view. You may need to reload the note.");
            }
            new Notice(`Image "${this.imageFile.name}" processed`, 1000);
            this.close();

        } catch (error) {
            console.error("Error processing image:", error);
            new Notice(`Failed to process image: ${this.getErrorMessage(error)}`, 2000);
        } finally {
            if (this.previewImageUrl) {
                URL.revokeObjectURL(this.previewImageUrl);
                this.previewImageUrl = null;
            }
        }
    }

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
    onClose() {
		// No Changes
        this.saveModalSettings();
        if (this.previewImageUrl) {
            URL.revokeObjectURL(this.previewImageUrl);
            this.previewImageUrl = null;
        }
        this.contentEl.empty();
    }
}
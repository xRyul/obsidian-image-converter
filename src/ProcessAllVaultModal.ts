// ProcessAllVaultModal.ts
import {
    App,
    Modal,
    Setting,
    ButtonComponent,
} from "obsidian";
import ImageConverterPlugin from "./main";
import { BatchImageProcessor } from "./BatchImageProcessor";

export class ProcessAllVaultModal extends Modal {
    private enlargeReduceSettings: Setting | null = null;
    private resizeInputSettings: Setting | null = null;
    // private submitButton: ButtonComponent | null = null;
    private resizeInputsDiv: HTMLDivElement | null = null;
    private enlargeReduceDiv: HTMLDivElement | null = null;

    constructor(
        app: App,
        private plugin: ImageConverterPlugin,
        private batchImageProcessor: BatchImageProcessor
    ) {
        super(app);
        this.modalEl.addClass("image-convert-modal");
    }

    onOpen() {
        const { contentEl } = this;
        this.createUI(contentEl);
    }

    onClose() {
        // Clear nullable UI elements
        this.enlargeReduceSettings = null;
        this.resizeInputSettings = null;
        this.resizeInputsDiv = null;
        this.enlargeReduceDiv = null;
    
        const { contentEl } = this;
        contentEl.empty();
    }

    // --- UI Creation Methods ---

    private createUI(contentEl: HTMLElement) {
        this.createHeader(contentEl);
        this.createWarningMessage(contentEl);

        const settingsContainer = contentEl.createDiv({
            cls: "settings-container",
        });

        const formatQualityContainer = settingsContainer.createDiv({
            cls: "format-quality-container",
        });
        this.createGeneralSettings(formatQualityContainer);

        const resizeContainer = settingsContainer.createDiv({
            cls: "resize-container",
        });
        this.createResizeSettings(resizeContainer);

        const skipContainer = settingsContainer.createDiv({
            cls: "skip-container",
        });
        this.createSkipSettings(skipContainer);

        this.createProcessButton(settingsContainer);
    }

    private createHeader(contentEl: HTMLElement) {
        const headerContainer = contentEl.createDiv({ cls: "modal-header" });
        headerContainer.createEl("h2", {
            text: "Convert, compress and resize all images",
        });
        headerContainer.createEl("h6", {
            text: "In the vault",
            cls: "modal-subtitle",
        });
    }

    private createWarningMessage(contentEl: HTMLElement) {
        contentEl.createEl("p", {
            cls: "modal-warning",
            // eslint-disable-next-line obsidianmd/ui/sentence-case -- Warning icon improves visibility
            text: "⚠️ This will modify all images in the vault. Please ensure you have backups.",
        });
    }

    private createGeneralSettings(contentEl: HTMLElement) {
        new Setting(contentEl)
            .setName("Convert to ⓘ")
            .setDesc(
                "Choose output format. Same as original applies compression/resizing to current format"
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
                    .setValue(this.plugin.settings.ProcessAllVaultconvertTo)
                    .onChange(async (value) => {
                        this.plugin.settings.ProcessAllVaultconvertTo = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(contentEl)
            .setName("Quality ⓘ")
            .setDesc("Compression level (0-100)")
            .setTooltip(
                "100: no compression (original quality)\n75: recommended (good balance)\n0-50: high compression (lower quality)"
            )
            .addText((text) => {
                text
                    .setPlaceholder("Enter quality (0-100)")
                    .setValue(
                        (
                            this.plugin.settings.ProcessAllVaultquality * 100
                        ).toString()
                    )
                    .onChange(async (value) => {
                        const quality = parseInt(value, 10);
                        if (
                            !isNaN(quality) &&
                            quality >= 0 &&
                            quality <= 100
                        ) {
                            this.plugin.settings.ProcessAllVaultquality =
                                quality / 100;
                            await this.plugin.saveSettings();
                        }
                    });
            });
    }

    private createResizeSettings(contentEl: HTMLElement) {
        new Setting(contentEl)
            .setName("Resize mode ⓘ")
            .setDesc(
                "Choose how images should be resized. Note: results are permanent"
            )
            .setTooltip(
                // eslint-disable-next-line obsidianmd/ui/sentence-case -- Structured tooltip format
                "Fit: Maintains aspect ratio within dimensions\nFill: Exactly matches dimensions\nLongest edge: Limits the longest side\nShortest edge: Limits the shortest side\nWidth/Height: Constrains single dimension"
            )
            .addDropdown((dropdown) => {
                dropdown
                    .addOptions({
                        None: "None",
                        Fit: "Fit",
                        Fill: "Fill",
                        LongestEdge: "Longest edge",
                        ShortestEdge: "Shortest edge",
                        Width: "Width",
                        Height: "Height",
                    })
                    .setValue(
                        this.plugin.settings
                            .ProcessAllVaultResizeModalresizeMode
                    )
                    .onChange(async (value) => {
                        this.plugin.settings.ProcessAllVaultResizeModalresizeMode =
                            value;
                        await this.plugin.saveSettings();
                        this.updateResizeInputVisibility(value);
                    });
            });

        this.resizeInputsDiv = contentEl.createDiv({ cls: "resize-inputs" });
        this.enlargeReduceDiv = contentEl.createDiv({
            cls: "enlarge-reduce-settings",
        });

        this.updateResizeInputVisibility(
            this.plugin.settings.ProcessAllVaultResizeModalresizeMode
        );
    }

    private createSkipSettings(contentEl: HTMLElement) {
        new Setting(contentEl)
            .setName("Skip formats ⓘ")
            .setDesc(
                // eslint-disable-next-line obsidianmd/ui/sentence-case -- Example format aids clarity
                "Comma-separated list (no dots or spaces). Example: png,gif"
            )
            .setTooltip(
                "Comma-separated list of file formats to skip (e.g., tif,tiff,heic). Leave empty to process all formats."
            )
            .addText((text) => {
                text.setPlaceholder(
                    // eslint-disable-next-line obsidianmd/ui/sentence-case -- Example format
                    "Example: png,gif"
                )
                    .setValue(this.plugin.settings.ProcessAllVaultSkipFormats)
                    .onChange(async (value) => {
                        this.plugin.settings.ProcessAllVaultSkipFormats = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(contentEl)
            .setName("Skip images in target format ⓘ")
            .setDesc(
                "Skip compression/resizing if image is already in target format."
            )
            .setTooltip(
                "If image is already in target format, this allows you to skip its compression, conversion and resizing. Processing of all other formats will be still performed."
            )
            .addToggle((toggle) => {
                toggle
                    .setValue(
                        this.plugin.settings.ProcessAllVaultskipImagesInTargetFormat
                    )
                    .onChange(async (value) => {
                        this.plugin.settings.ProcessAllVaultskipImagesInTargetFormat =
                            value;
                        await this.plugin.saveSettings();
                    });
            });
    }

    private createProcessButton(contentEl: HTMLElement) {
        const buttonContainer = contentEl.createDiv({
            cls: "button-container",
        });
        new ButtonComponent(buttonContainer)
            .setButtonText("Process all images")
            .setCta()
            .onClick(async () => {
                this.close();
                await this.batchImageProcessor.processAllVaultImages();
            });
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
            .setName("Enlarge or reduce ⓘ")
            .setDesc(
                "Reduce and enlarge: adjusts all images. Reduce only: shrinks larger images. Enlarge only: enlarges smaller images"
            )
            .setTooltip(
                // eslint-disable-next-line obsidianmd/ui/sentence-case -- Bullet list format
                "• Reduce and enlarge: Adjusts all images to fit specified dimensions\n• Reduce only: Only shrinks images larger than target\n• Enlarge only: Only enlarges images smaller than target"
            )
            .addDropdown((dropdown) => {
                dropdown
                    .addOptions({
                        Always: "Reduce and enlarge",
                        Reduce: "Reduce only",
                        Enlarge: "Enlarge only",
                    })
                    .setValue(
                        this.plugin.settings.ProcessAllVaultEnlargeOrReduce
                    )
                    .onChange(
                        async (value: "Always" | "Reduce" | "Enlarge") => {
                            this.plugin.settings.ProcessAllVaultEnlargeOrReduce =
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
                                .ProcessAllVaultResizeModaldesiredWidth
                                .toString()
                        )
                        .onChange(async (value: string) => {
                            const width = parseInt(value);
                            if (/^\d+$/.test(value) && width > 0) {
                                this.plugin.settings.ProcessAllVaultResizeModaldesiredWidth =
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
                                .ProcessAllVaultResizeModaldesiredHeight
                                .toString()
                        )
                        .onChange(async (value: string) => {
                            const height = parseInt(value);
                            if (/^\d+$/.test(value) && height > 0) {
                                this.plugin.settings.ProcessAllVaultResizeModaldesiredHeight =
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
                    .ProcessAllVaultResizeModaldesiredLength;
            case "Width":
                return this.plugin.settings
                    .ProcessAllVaultResizeModaldesiredWidth;
            case "Height":
                return this.plugin.settings
                    .ProcessAllVaultResizeModaldesiredHeight;
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
                this.plugin.settings.ProcessAllVaultResizeModaldesiredLength =
                    value;
                break;
            case "Width":
                this.plugin.settings.ProcessAllVaultResizeModaldesiredWidth =
                    value;
                break;
            case "Height":
                this.plugin.settings.ProcessAllVaultResizeModaldesiredHeight =
                    value;
                break;
        }
        await this.plugin.saveSettings();
    }
}
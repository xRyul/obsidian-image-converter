// ProcessSingleImageModal.ts
import { App, Modal, Notice, TFile, Setting, MarkdownView } from "obsidian";
import ImageConverterPlugin from "./main";
import { OutputFormat, ResizeMode, EnlargeReduce } from "./ImageConverterSettings";
import { ENCODER_CONFIGS, ImageProcessor } from "./ImageProcessor";
import { findFfmpegExecutablePath, normalizeExecutablePath } from "./utils/ffmpegPath";
import { addInfoIcon } from "./utils/settingInfo";

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
    detectedEncoder?: string;
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
                ffmpegExecutablePath: avifPreset?.ffmpegExecutablePath || this.plugin.settings.ffmpegExecutablePath || "",
                ffmpegCrf: avifPreset?.ffmpegCrf !== undefined ? avifPreset.ffmpegCrf : (this.plugin.settings.ffmpegCrf !== undefined ? this.plugin.settings.ffmpegCrf : 23),
                ffmpegPreset: avifPreset?.ffmpegPreset || this.plugin.settings.ffmpegPreset || "medium",
                detectedEncoder: avifPreset?.detectedEncoder || this.plugin.settings.detectedEncoder,
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
                    const currentFFmpegPath = this.modalSettings.ffmpegExecutablePath;

                    this.modalSettings.outputFormat = value;
                    this.modalSettings.pngquantExecutablePath = currentPngquantPath;
                    this.modalSettings.ffmpegExecutablePath = currentFFmpegPath;

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
                .setName("Executable path for pngquant")
                .then((setting) => addInfoIcon(setting, "Provide full-path to the binary file. It can be inside vault or anywhere in your file system."))
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
                .setName("Quality min-max range")
                .then((setting) => addInfoIcon(setting, "Instructs pngquant to use the least amount of colors required to meet or exceed the max quality. min and max are numbers in range 0 (worst) to 100 (perfect)."))
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
            let ffmpegPathInput: HTMLInputElement | undefined;
            let encoderDetectionButtonEl: HTMLButtonElement | undefined;
            let crfTextInput: HTMLInputElement | undefined;
            let presetSelectEl: HTMLSelectElement | undefined;

            type AvifEncoder = keyof typeof ENCODER_CONFIGS;

            const defaultPresetNames = [
                "ultrafast",
                "superfast",
                "veryfast",
                "faster",
                "fast",
                "medium",
                "slow",
                "slower",
                "veryslow",
                "placebo"
            ];

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

            const updateEncoderConfig = (encoder: AvifEncoder | undefined) => {
                if (!encoder) {
                    return;
                }

                const encoderInfo = ENCODER_CONFIGS[encoder];
                if (!encoderInfo) {
                    return;
                }

                const platformHint = encoderInfo ? ` (${encoderInfo.platformHint})` : "";
                encoderDetectionSetting.setDesc(
                    buildEncoderDesc(
                        "Working encoder: ",
                        `${encoder}${platformHint}`,
                        `. CRF range: ${encoderInfo.crfMin}-${encoderInfo.crfMax}`
                    )
                );
                encoderDetectionSetting.settingEl.addClass("image-converter-encoder-detected");
                encoderDetectionButtonEl?.classList.add("image-converter-encoder-detected");

                crfSetting.setDesc(
                    buildEncoderDesc(
                        "Constant rate factor for ",
                        `${encoder}${platformHint}`,
                        ` (${encoderInfo.crfMin}-${encoderInfo.crfMax}, lower is better quality).`
                    )
                );
                crfSetting.settingEl.addClass("image-converter-encoder-detected");

                if (encoderInfo.supportsPreset && encoderInfo.presetNames && presetSelectEl) {
                    presetSetting.settingEl.show();
                    presetSetting.setDesc(`Encoding preset for ${encoder} (speed vs. compression).`);
                    presetSelectEl.innerHTML = "";
                    encoderInfo.presetNames.forEach(presetName => {
                        const option = document.createElement("option");
                        option.value = presetName;
                        option.text = presetName;
                        presetSelectEl?.appendChild(option);
                    });
                    const currentPreset = this.modalSettings.ffmpegPreset || encoderInfo.presetNames[Math.floor(encoderInfo.presetNames.length / 2)];
                    presetSelectEl.value = encoderInfo.presetNames.includes(currentPreset) ? currentPreset : encoderInfo.presetNames[Math.floor(encoderInfo.presetNames.length / 2)];
                    this.modalSettings.ffmpegPreset = presetSelectEl.value;
                } else if (presetSelectEl) {
                    presetSetting.settingEl.hide();
                }

                if (crfTextInput) {
                    const currentCrf = this.modalSettings.ffmpegCrf;
                    const clampedCrf = Math.max(encoderInfo.crfMin, Math.min(encoderInfo.crfMax, currentCrf));
                    if (clampedCrf !== currentCrf) {
                        this.modalSettings.ffmpegCrf = clampedCrf;
                        crfTextInput.value = clampedCrf.toString();
                    }
                }
            };

            const resetEncoderUi = () => {
                // eslint-disable-next-line obsidianmd/ui/sentence-case
                encoderDetectionSetting.setDesc("Detect and validate working AV1 encoder by running a test encode. This ensures hardware encoders are actually available on your system.");
                encoderDetectionSetting.settingEl.removeClass("image-converter-encoder-detected");
                encoderDetectionButtonEl?.classList.remove("image-converter-encoder-detected");
                crfSetting.settingEl.removeClass("image-converter-encoder-detected");
                // eslint-disable-next-line obsidianmd/ui/sentence-case
                crfSetting.setDesc("Constant rate factor for AVIF (0-63, lower is better quality). Range varies by encoder - click 'Detect encoder' to see the specific range.");
                if (presetSelectEl) {
                    presetSetting.settingEl.show();
                    // eslint-disable-next-line obsidianmd/ui/sentence-case
                    presetSetting.setDesc("Encoding preset (speed vs. compression).");
                    presetSelectEl.innerHTML = "";
                    defaultPresetNames.forEach(presetName => {
                        const option = document.createElement("option");
                        option.value = presetName;
                        option.text = presetName;
                        presetSelectEl?.appendChild(option);
                    });
                    presetSelectEl.value = this.modalSettings.ffmpegPreset || "medium";
                }
            };

            const updateFfmpegPath = (value: string) => {
                const normalizedPath = normalizeExecutablePath(value);
                if (currentPreset) {
                    currentPreset.ffmpegExecutablePath = normalizedPath;
                }
                this.modalSettings.ffmpegExecutablePath = normalizedPath;
                this.plugin.settings.ffmpegExecutablePath = normalizedPath;
                if (ffmpegPathInput && ffmpegPathInput.value !== normalizedPath) {
                    ffmpegPathInput.value = normalizedPath;
                }
            };

            new Setting(this.conversionSettingsContainer)
                // eslint-disable-next-line obsidianmd/ui/sentence-case
                .setName("FFmpeg executable path")
                .then((setting) => addInfoIcon(setting, "Provide full-path to the binary file. It can be inside vault or anywhere in your file system."))
                .addButton(button => {
                    button
                        .setIcon("search")
                        // eslint-disable-next-line obsidianmd/ui/sentence-case
                        .setTooltip("Auto-detect FFmpeg")
                        .onClick(async () => {
                            button.setDisabled(true);
                            try {
                                const detectedPath = await findFfmpegExecutablePath(this.app);
                                if (!detectedPath) {
                                    // eslint-disable-next-line obsidianmd/ui/sentence-case
                                    new Notice("FFmpeg not found. Try installing via: Homebrew (macOS), Chocolatey (Windows), or apt/snap (Linux). Then set the path manually.", 8000);
                                    return;
                                }
                                updateFfmpegPath(detectedPath);
                                void this.plugin.saveSettings();
                                // eslint-disable-next-line obsidianmd/ui/sentence-case
                                new Notice("FFmpeg path detected and saved.", 4000);
                            } catch (error) {
                                const message = this.getErrorMessage(error);
                                console.error("FFmpeg auto-detection failed:", message);
                                new Notice(`FFmpeg auto-detection failed: ${message}`);
                            } finally {
                                button.setDisabled(false);
                            }
                        });
                })
                .addText(text => {
                    ffmpegPathInput = text.inputEl;
                    text.setValue(this.modalSettings.ffmpegExecutablePath)
                        .onChange(async value => {
                            updateFfmpegPath(value);
                            void this.plugin.saveSettings();
                            // NO PREVIEW for AVIF
                        });
                    text.inputEl.setAttr('spellcheck', 'false');
                });

            const encoderDetectionSetting = new Setting(this.conversionSettingsContainer)
                .setName("Encoder detection")
                // eslint-disable-next-line obsidianmd/ui/sentence-case
                .setDesc("Detect and validate working AV1 encoder by running a test encode. This ensures hardware encoders are actually available on your system.")
                .addButton(button => {
                    encoderDetectionButtonEl = button.buttonEl;
                    button
                        .setButtonText("Detect encoder")
                        .setCta()
                        .onClick(async () => {
                            if (!this.modalSettings.ffmpegExecutablePath) {
                                // eslint-disable-next-line obsidianmd/ui/sentence-case
                                new Notice("Please specify FFmpeg executable path first");
                                return;
                            }

                            button.setButtonText("Validating...");
                            button.setDisabled(true);

                            try {
                                const processor = new ImageProcessor(this.plugin.supportedImageFormats);
                                const encoder = await processor.detectAvifEncoder(this.modalSettings.ffmpegExecutablePath, this.modalSettings.detectedEncoder);

                                if (encoder) {
                                    const encoderInfo = ENCODER_CONFIGS[encoder];
                                    const platformHint = encoderInfo ? ` (${encoderInfo.platformHint})` : "";
                                    new Notice(`✓ Working encoder: ${encoder}${platformHint}`, 5000);

                                    this.modalSettings.detectedEncoder = encoder;
                                    if (currentPreset) {
                                        currentPreset.detectedEncoder = encoder;
                                    }
                                    this.plugin.settings.detectedEncoder = encoder;
                                    void this.plugin.saveSettings();

                                    updateEncoderConfig(encoder);
                                } else {
                                    const cachedEncoder = this.modalSettings.detectedEncoder as AvifEncoder | undefined;
                                    const cachedInfo = cachedEncoder ? ENCODER_CONFIGS[cachedEncoder] : undefined;
                                    if (cachedEncoder && cachedInfo) {
                                        const platformHint = cachedInfo ? ` (${cachedInfo.platformHint})` : "";
                                        new Notice(`Encoder detection failed. Using cached encoder: ${cachedEncoder}${platformHint}`, 5000);
                                        updateEncoderConfig(cachedEncoder);
                                        return;
                                    }

                                    // eslint-disable-next-line obsidianmd/ui/sentence-case
                                    new Notice("No working AV1 encoder found. Install FFmpeg with AV1 support.", 5000);
                                    resetEncoderUi();
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

            const crfSetting = new Setting(this.conversionSettingsContainer)
                // eslint-disable-next-line obsidianmd/ui/sentence-case
                .setName("FFmpeg CRF")
                // eslint-disable-next-line obsidianmd/ui/sentence-case
                .setDesc("Constant rate factor for AVIF (0-63, lower is better quality). Range varies by encoder - click 'Detect encoder' to see the specific range.")
                .addText((text) => {
                    text.setValue(this.modalSettings.ffmpegCrf?.toString() || "")
                        .onChange(value => {
                            const parsedValue = parseInt(value, 10);
                            if (Number.isNaN(parsedValue)) {
                                return;
                            }
                            const encoder = this.modalSettings.detectedEncoder as AvifEncoder | undefined;
                            const encoderInfo = encoder ? ENCODER_CONFIGS[encoder] : undefined;
                            const clampedCrf = encoderInfo ? Math.max(encoderInfo.crfMin, Math.min(encoderInfo.crfMax, parsedValue)) : parsedValue;
                            this.modalSettings.ffmpegCrf = clampedCrf;
                            if (currentPreset) {
                                currentPreset.ffmpegCrf = clampedCrf;
                            }
                            this.plugin.settings.ffmpegCrf = clampedCrf;
                            if (clampedCrf !== parsedValue) {
                                text.setValue(clampedCrf.toString());
                            }
                            void this.plugin.saveSettings();
                        });
                    text.inputEl.setAttr('spellcheck', 'false');
                    crfTextInput = text.inputEl;
                });

            const presetSetting = new Setting(this.conversionSettingsContainer)
                // eslint-disable-next-line obsidianmd/ui/sentence-case
                .setName("FFmpeg preset")
                // eslint-disable-next-line obsidianmd/ui/sentence-case
                .setDesc("Encoding preset (speed vs. compression).")
                .addDropdown(dropdown => {
                    dropdown.addOptions(
                        defaultPresetNames.reduce((options, presetName) => ({
                            ...options,
                            [presetName]: presetName
                        }), {} as Record<string, string>)
                    );
                    dropdown.setValue(this.modalSettings.ffmpegPreset || "medium");
                    dropdown.onChange(value => {
                        this.modalSettings.ffmpegPreset = value;
                        if (currentPreset) {
                            currentPreset.ffmpegPreset = value;
                        }
                        this.plugin.settings.ffmpegPreset = value;
                        void this.plugin.saveSettings();
                    });
                    presetSelectEl = dropdown.selectEl;
                });

            const cachedEncoder = this.modalSettings.detectedEncoder as AvifEncoder | undefined;
            if (cachedEncoder) {
                updateEncoderConfig(cachedEncoder);
            } else {
                resetEncoderUi();
            }

            if (currentPreset) {
                currentPreset.ffmpegExecutablePath = this.modalSettings.ffmpegExecutablePath;
                currentPreset.ffmpegCrf = this.modalSettings.ffmpegCrf;
                currentPreset.ffmpegPreset = this.modalSettings.ffmpegPreset;
                if (this.modalSettings.detectedEncoder) {
                    currentPreset.detectedEncoder = this.modalSettings.detectedEncoder;
                }
            }
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
                        ffmpegExecutablePath: this.modalSettings.ffmpegExecutablePath,
                        ffmpegCrf: this.modalSettings.ffmpegCrf,
                        ffmpegPreset: this.modalSettings.ffmpegPreset,
                        detectedEncoder: this.modalSettings.detectedEncoder,
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
            new Notice(
                `Failed to process image "${this.imageFile.name}" (target: ${this.modalSettings.outputFormat}): ${this.getErrorMessage(error)}`,
                2000
            );
        }
    }

    async refreshActiveNote() {
        // Instead of a destructive view reload (empty → restore → openFile),
        // only update the <img> tag for the processed file via cache-busting.
        // This preserves the user's scroll position completely.
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) return;

        const container = activeView.containerEl;
        const imgs = container.querySelectorAll<HTMLImageElement>('img');
        const filePath = this.imageFile.path;
        for (const img of imgs) {
            try {
                const src = img.src;
                if (!src.includes(encodeURI(filePath)) && !src.includes(filePath)) continue;

                const url = new URL(src);
                url.searchParams.set('_t', Date.now().toString());
                img.src = url.toString();
            } catch {
                continue;
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
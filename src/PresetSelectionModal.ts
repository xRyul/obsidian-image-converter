import { Modal, Notice, App, Setting, ButtonComponent, DropdownComponent, TextComponent } from "obsidian";
import {
    ImageConverterSettings,
    ConversionPreset,
    FilenamePreset,
    FolderPreset,
    GlobalPreset,
    AvailableVariablesModal
} from "./ImageConverterSettings";
import { LinkFormatPreset } from "./LinkFormatSettings";
import { NonDestructiveResizePreset } from "./NonDestructiveResizeSettings";
import { VariableProcessor } from "./VariableProcessor";
import ImageConverterPlugin from "./main";

export class PresetSelectionModal extends Modal {
    private variableProcessor: VariableProcessor;

    private selectedConversionPreset: ConversionPreset;
    private selectedFilenamePreset: FilenamePreset;
    private selectedFolderPreset: FolderPreset;
    private selectedLinkFormatPreset: LinkFormatPreset;
    private selectedResizePreset: NonDestructiveResizePreset;

    private conversionQualitySetting: Setting | null = null;
    private conversionColorDepthSetting: Setting | null = null;

    private selectedGlobalPreset: GlobalPreset | null = null;

    private folderPresetDropdown: Setting;
    private filenamePresetDropdown: Setting;
    private conversionPresetDropdown: Setting;
    private linkFormatPresetDropdown: Setting;
    private resizePresetDropdown: Setting;

    private customFilenameSetting: Setting | null = null;
    private customFilenameText: TextComponent | null = null;
    private customFolderSetting: Setting | null = null;
    private customFolderText: TextComponent | null = null;

    private previewContainer: HTMLDivElement | null = null;
    private updateTimeout: number | null = null;

    // Processing card toggle state
    private isProcessingCardExpanded = false;
    private processingCardContent: HTMLElement | null = null;
    private processingCardPreview: HTMLElement | null = null;
    private processingCardChevron: HTMLElement | null = null;

    constructor(
        app: App,
        private settings: ImageConverterSettings,
        private onApply: (
            conversionPreset: ConversionPreset,
            filenamePreset: FilenamePreset,
            folderPreset: FolderPreset,
            linkFormatPreset: LinkFormatPreset,
            resizePreset: NonDestructiveResizePreset
        ) => void,
        private plugin: ImageConverterPlugin,
        variableProcessor: VariableProcessor
    ) {
        super(app);
        this.variableProcessor = variableProcessor;

        // Initialize selected presets with current settings or defaults
        this.selectedConversionPreset = this.plugin.getPresetByName(
            this.settings.selectedConversionPreset,
            this.settings.conversionPresets,
            'Conversion'
        );

        this.selectedFilenamePreset = this.plugin.getPresetByName(
            this.settings.selectedFilenamePreset,
            this.settings.filenamePresets,
            'Filename'
        );

        this.selectedFolderPreset = this.plugin.getPresetByName(
            this.settings.selectedFolderPreset,
            this.settings.folderPresets,
            'Folder'
        );

        this.selectedLinkFormatPreset = this.plugin.getPresetByName(
            this.settings.linkFormatSettings.selectedLinkFormatPreset,
            this.settings.linkFormatSettings.linkFormatPresets,
            'LinkFormat'
        );

        this.selectedResizePreset = this.plugin.getPresetByName(
            this.settings.nonDestructiveResizeSettings.selectedResizePreset,
            this.settings.nonDestructiveResizeSettings.resizePresets,
            'Resize'
        );
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("image-converter-preset-selection-modal");

        // Compact single-column layout
        const mainContainer = contentEl.createDiv("image-converter-compact-container");
        
        // Compact header with title and mini global preset
        this.createCompactHeader(mainContainer);
        
        // Input section with inline presets
        this.createCompactInputSection(mainContainer);
        
        // Processing options in compact grid
        this.createCompactProcessingSection(mainContainer);
        
        // Compact preview
        this.createCompactPreview(mainContainer);
        
        // Action buttons
        this.createActionButtons(mainContainer);

        // Initialize preview
        this.updatePreviews();
    }

    private createCompactHeader(container: HTMLElement) {
        const header = container.createDiv("image-converter-compact-header");
        
        // Title on the left
        header.createEl("h2", { 
            text: "Image Converter",
            cls: "image-converter-compact-title"
        });
        
        // Variables button in the middle
        const variablesButton = header.createDiv("image-converter-variables-header");
        new Setting(variablesButton)
            .addButton((button) => {
                button
                    .setButtonText("{Variables}")
                    .setTooltip("Show available variables")
                    .onClick(() => this.showAvailableVariables());
                button.buttonEl.addClass("image-converter-variables-header-btn");
            });
        
        // Global preset dropdown on the right
        const globalMini = header.createDiv("image-converter-global-mini");
        this.createGlobalPresetDropdown(globalMini);
    }

    private createCompactInputSection(container: HTMLElement) {
        const inputSection = container.createDiv("image-converter-compact-inputs");
        
        // Folder input with inline preset
        this.createCompactInputWithPreset(
            inputSection,
            "📂 Folder",
            "e.g., assets/{YYYY}/{MM}",
            "Where to save the image",
            this.selectedFolderPreset,
            this.settings.folderPresets,
            (text) => { this.customFolderText = text; },
            (value) => {
                this.selectedFolderPreset = this.settings.folderPresets.find(p => p.name === value) || this.settings.folderPresets[0];
                if (this.customFolderText && this.selectedFolderPreset.customTemplate) {
                    this.customFolderText.setValue(this.selectedFolderPreset.customTemplate);
                }
                this.updatePreviews();
            },
            (setting) => { this.folderPresetDropdown = setting; }
        );

        // Filename input with inline preset
        this.createCompactInputWithPreset(
            inputSection,
            "📄 Filename", 
            "e.g., {imagename}-{timestamp}",
            "What to name the file",
            this.selectedFilenamePreset,
            this.settings.filenamePresets,
            (text) => { this.customFilenameText = text; },
            (value) => {
                this.selectedFilenamePreset = this.settings.filenamePresets.find(p => p.name === value) || this.settings.filenamePresets[0];
                if (this.customFilenameText && this.selectedFilenamePreset.customTemplate) {
                    this.customFilenameText.setValue(this.selectedFilenamePreset.customTemplate);
                }
                this.updatePreviews();
            },
            (setting) => { this.filenamePresetDropdown = setting; }
        );

    }

    private createCompactInputWithPreset<T extends { name: string, customTemplate?: string }>(
        container: HTMLElement,
        label: string,
        placeholder: string,
        description: string,
        selectedPreset: T,
        presets: T[],
        onTextCreated: (text: TextComponent) => void,
        onPresetChange: (value: string) => void,
        onSettingCreated: (setting: Setting) => void
    ) {
        const group = container.createDiv("image-converter-compact-input-group");
        
        // Row 1: Label and Dropdown
        const labelRow = group.createDiv("image-converter-label-dropdown-row");
        
        // Label on the left
        labelRow.createEl("div", {
            text: label,
            cls: "image-converter-group-label"
        });
          // Preset dropdown on the right
        const presetContainer = labelRow.createDiv("image-converter-preset-dropdown-container");
        const setting = new Setting(presetContainer)
            .setClass("image-converter-preset-dropdown-setting")
            .addDropdown((dropdown) => {
                presets.forEach((preset) => {
                    dropdown.addOption(preset.name, preset.name);
                });                dropdown.setValue(selectedPreset.name);
                dropdown.onChange(onPresetChange);
                
                // Apply compact styling to the dropdown using CSS classes
                dropdown.selectEl.addClass("image-converter-compact-dropdown");
                
                // Extract the preset type from the label for data attribute
                const presetType = label.replace("📂 ", "").replace("📄 ", "");
                dropdown.selectEl.setAttribute('data-preset-type', presetType.toLowerCase());
            });
        
        // Remove default setting styling
        setting.settingEl.addClass("image-converter-preset-dropdown-setting-item");
        setting.settingEl.addClass("image-converter-hide-name-desc");
        
        // Row 2: Full-width input field
        const inputRow = group.createDiv("image-converter-input-row");
        const textSetting = new Setting(inputRow)
            .setClass("image-converter-text-setting")
            .addText((text) => {
                onTextCreated(text);
                text.setPlaceholder(placeholder)
                    .setValue(selectedPreset.customTemplate || "")
                    .onChange(() => this.updatePreviews());
                text.inputEl.setAttr("spellcheck", "false");
                text.inputEl.addClass("image-converter-full-width-input");
                return text;
            });
        
        // Remove default setting styling
        textSetting.settingEl.addClass("image-converter-text-setting-item");
        textSetting.settingEl.addClass("image-converter-hide-name-desc");
        
        onSettingCreated(setting);
    }

    private createCompactProcessingSection(container: HTMLElement) {
        // Bordered card container
        const card = container.createDiv("image-converter-processing-card");
        
        // Persistent clickable header (always visible)
        const cardHeader = card.createDiv("image-converter-processing-card-header");
        cardHeader.addClass("image-converter-processing-card-header-clickable");
        
        // Header content container
        const headerContent = cardHeader.createDiv("image-converter-processing-card-header-content");
        
        // Preview text (will be updated by updateProcessingPreview)
        this.processingCardPreview = headerContent.createDiv("image-converter-processing-preview-text");
        
        // Chevron icon (moved to the right)
        this.processingCardChevron = headerContent.createEl("span", {
            text: "▶",
            cls: "image-converter-processing-card-chevron"
        });
        
        // Initialize preview content
        this.updateProcessingPreview();

        // Full content (shown when expanded)
        this.processingCardContent = card.createDiv("image-converter-processing-card-content");
        this.processingCardContent.addClass("image-converter-collapsed"); // Start collapsed
        
        // Column Header Row 1: Format and Link
        const headerRow1 = this.processingCardContent.createDiv("image-converter-grid-header-row");
        headerRow1.createEl("div", { text: "Format", cls: "image-converter-grid-header" });
        headerRow1.createEl("div", { text: "Link", cls: "image-converter-grid-header" });
        
        // Component Row 1: Format dropdown and Link dropdown
        const componentRow1 = this.processingCardContent.createDiv("image-converter-grid-component-row");

        // Format dropdown
        const formatDiv = componentRow1.createDiv("image-converter-grid-component");
        this.conversionPresetDropdown = new Setting(formatDiv)
            .addDropdown((dropdown) => {
                this.settings.conversionPresets.forEach((preset) => {
                    dropdown.addOption(preset.name, preset.name);
                });
                dropdown.setValue(this.selectedConversionPreset.name);
                dropdown.onChange((value) => {
                    this.selectedConversionPreset = this.settings.conversionPresets.find(p => p.name === value) || this.settings.conversionPresets[0];
                    this.updateConversionSettings(card);
                    this.updateProcessingPreview();
                });
                // Pre-fill with "jpeg 1000 ▼" appearance
                dropdown.selectEl.addClass("image-converter-format-dropdown");
            });
        // Remove default setting styling
        this.conversionPresetDropdown.settingEl.addClass("image-converter-grid-dropdown-setting");

        // Link dropdown
        const linkDiv = componentRow1.createDiv("image-converter-grid-component");
        this.linkFormatPresetDropdown = new Setting(linkDiv)
            .addDropdown((dropdown) => {
                this.settings.linkFormatSettings.linkFormatPresets.forEach((preset) => {
                    dropdown.addOption(preset.name, preset.name);
                });
                dropdown.setValue(this.selectedLinkFormatPreset.name);
                dropdown.onChange((value) => {
                    this.selectedLinkFormatPreset = this.settings.linkFormatSettings.linkFormatPresets.find(p => p.name === value) || this.settings.linkFormatSettings.linkFormatPresets[0];
                    this.updateProcessingPreview();
                });
                // Pre-fill with "Wiki/Md ▼" appearance
                dropdown.selectEl.addClass("image-converter-link-dropdown");
            });
        // Remove default setting styling
        this.linkFormatPresetDropdown.settingEl.addClass("image-converter-grid-dropdown-setting");

        // Column Header Row 2: Resize and Quality
        const headerRow2 = this.processingCardContent.createDiv("image-converter-grid-header-row");
        headerRow2.createEl("div", { text: "Resize", cls: "image-converter-grid-header" });
        const qualityHeader = headerRow2.createEl("div", { 
            text: `Quality ${this.selectedConversionPreset.quality}%`, 
            cls: "image-converter-grid-header image-converter-quality-header" 
        });
        
        // Component Row 2: Resize dropdown and Quality slider
        const componentRow2 = this.processingCardContent.createDiv("image-converter-grid-component-row");
        
        // Resize dropdown
        const resizeDiv = componentRow2.createDiv("image-converter-grid-component");
        this.resizePresetDropdown = new Setting(resizeDiv)
            .addDropdown((dropdown) => {
                this.settings.nonDestructiveResizeSettings.resizePresets.forEach((preset) => {
                    dropdown.addOption(preset.name, preset.name);
                });
                dropdown.setValue(this.selectedResizePreset.name);
                dropdown.onChange((value) => {
                    this.selectedResizePreset = this.settings.nonDestructiveResizeSettings.resizePresets.find(p => p.name === value) || this.settings.nonDestructiveResizeSettings.resizePresets[0];
                    this.updateProcessingPreview();
                });
                // Pre-fill with "Default ▼" appearance
                dropdown.selectEl.addClass("image-converter-resize-dropdown");
            });
        // Remove default setting styling
        this.resizePresetDropdown.settingEl.addClass("image-converter-grid-dropdown-setting");

        // Quality slider
        const qualityDiv = componentRow2.createDiv("image-converter-grid-component");
        this.conversionQualitySetting = new Setting(qualityDiv)
            .addSlider((slider) => {
                slider
                    .setLimits(0, 100, 1)
                    .setValue(this.selectedConversionPreset.quality)
                    .setDynamicTooltip()
                    .onChange((value) => {
                        this.selectedConversionPreset.quality = value;
                        // Update the quality header text
                        qualityHeader.textContent = `Quality ${value}%`;
                        this.updateProcessingPreview();
                    });
                slider.sliderEl.addClass("image-converter-quality-slider");
            });
        // Remove default setting styling
        this.conversionQualitySetting.settingEl.addClass("image-converter-grid-slider-setting");

        // Add click handler to toggle using DOM onclick (Obsidian-safe pattern)
        cardHeader.onclick = () => {
            this.toggleProcessingCard();
        };
    }

    private createCompactPreview(container: HTMLElement) {
        const previewSection = container.createDiv("image-converter-compact-preview");
        
        const previewHeader = previewSection.createDiv("image-converter-preview-header-compact");
        previewHeader.createEl("span", { text: "Preview", cls: "image-converter-preview-title-compact" });
        
        this.previewContainer = previewSection.createDiv("image-converter-preview-content-compact");
    }

    private updateConversionSettings(container: HTMLElement): void {
        // This method is now simplified since we don't need to recreate the quality slider
        // The quality slider is already properly positioned in the 2x2 grid
        
        // Only handle color depth for PNG if needed in future updates
        // For now, we keep the 2x2 grid layout clean and simple
    }

    private createActionButtons(container: HTMLElement) {
        const actionSection = container.createDiv("image-converter-compact-actions");

        new Setting(actionSection)
            .addButton((button: ButtonComponent) => {
                button
                    .setButtonText("Edit presets")
                    .onClick(() => {
                        this.close();
                        const appWithSettings = this.app as { setting?: { open(): void; openTabById(id: string): void } };
                        if (appWithSettings.setting) {
                            appWithSettings.setting.open();
                            appWithSettings.setting.openTabById(this.plugin.manifest.id);
                        } else {
                            new Notice("Unable to open settings.");
                        }
                    });
            })
            .addButton((button) => {
                button
                    .setButtonText("Apply")
                    .setCta()
                    .onClick(() => {
                        this.onApply(
                            this.selectedConversionPreset,
                            this.selectedFilenamePreset,
                            this.selectedFolderPreset,
                            this.selectedLinkFormatPreset,
                            this.selectedResizePreset
                        );
                        this.close();
                    });
            });
    }

    private createGlobalPresetDropdown(contentEl: HTMLElement): void {
        // Global preset dropdown only (Variables button is now in the header)
        const miniSetting = new Setting(contentEl)
            .addDropdown((dropdown: DropdownComponent) => {
                dropdown.addOption("none", "None");
                this.settings.globalPresets.forEach((preset) => {
                    dropdown.addOption(preset.name, preset.name);
                });
                dropdown.setValue(
                    this.selectedGlobalPreset
                        ? this.selectedGlobalPreset.name
                        : "none"
                );
                dropdown.onChange((value) => {
                    if (value === "none") {
                        this.selectedGlobalPreset = null;
                        // Reset to current settings
                        this.selectedConversionPreset =
                            this.settings.conversionPresets.find(
                                (p) => p.name === this.settings.selectedConversionPreset
                            ) || this.settings.conversionPresets[0];
                        this.selectedFilenamePreset =
                            this.settings.filenamePresets.find(
                                (p) => p.name === this.settings.selectedFilenamePreset
                            ) || this.settings.filenamePresets[0];
                        this.selectedFolderPreset =
                            this.settings.folderPresets.find(
                                (p) => p.name === this.settings.selectedFolderPreset
                            ) || this.settings.folderPresets[0];
                        this.selectedLinkFormatPreset =
                            this.settings.linkFormatSettings.linkFormatPresets.find(
                                (p) => p.name === this.settings.linkFormatSettings.selectedLinkFormatPreset
                            ) || this.settings.linkFormatSettings.linkFormatPresets[0];
                        this.selectedResizePreset =
                            this.settings.nonDestructiveResizeSettings.resizePresets.find(
                                (p) => p.name === this.settings.nonDestructiveResizeSettings.selectedResizePreset
                            ) || this.settings.nonDestructiveResizeSettings.resizePresets[0];
                    } else {
                        this.selectedGlobalPreset =
                            this.settings.globalPresets.find((p) => p.name === value) || null;
                        if (this.selectedGlobalPreset) {
                            // Apply global preset
                            this.selectedConversionPreset =
                                this.settings.conversionPresets.find(
                                    (p) => p.name === (this.selectedGlobalPreset?.conversionPreset || '')
                                ) || this.settings.conversionPresets[0];
                            this.selectedFilenamePreset =
                                this.settings.filenamePresets.find(
                                    (p) => p.name === (this.selectedGlobalPreset?.filenamePreset || '')
                                ) || this.settings.filenamePresets[0];
                            this.selectedFolderPreset =
                                this.settings.folderPresets.find(
                                    (p) => p.name === (this.selectedGlobalPreset?.folderPreset || '')
                                ) || this.settings.folderPresets[0];
                            this.selectedLinkFormatPreset =
                                this.settings.linkFormatSettings.linkFormatPresets.find(
                                    (p) => p.name === (this.selectedGlobalPreset?.linkFormatPreset || '')
                                ) || this.settings.linkFormatSettings.linkFormatPresets[0];
                            this.selectedResizePreset =
                                this.settings.nonDestructiveResizeSettings.resizePresets.find(
                                    (p) => p.name === (this.selectedGlobalPreset?.resizePreset || '')
                                ) || this.settings.nonDestructiveResizeSettings.resizePresets[0];
                        }
                    }

                    // Update all dropdowns
                    (this.folderPresetDropdown.components[0] as DropdownComponent).setValue(this.selectedFolderPreset.name);
                    (this.filenamePresetDropdown.components[0] as DropdownComponent).setValue(this.selectedFilenamePreset.name);
                    (this.conversionPresetDropdown.components[0] as DropdownComponent).setValue(this.selectedConversionPreset.name);
                    (this.linkFormatPresetDropdown.components[0] as DropdownComponent).setValue(this.selectedLinkFormatPreset.name);
                    (this.resizePresetDropdown.components[0] as DropdownComponent).setValue(this.selectedResizePreset.name);

                    // Update input fields
                    if (this.customFolderText && this.selectedFolderPreset.customTemplate) {
                        this.customFolderText.setValue(this.selectedFolderPreset.customTemplate);
                    }
                    if (this.customFilenameText && this.selectedFilenamePreset.customTemplate) {
                        this.customFilenameText.setValue(this.selectedFilenamePreset.customTemplate);
                    }

                    // Update conversion settings
                    const processingSections = contentEl.closest('.image-converter-compact-container')?.querySelectorAll('.image-converter-compact-processing');
                    if (processingSections && processingSections.length > 0) {
                        this.updateConversionSettings(processingSections[0] as HTMLElement);
                    }

                    this.updatePreviews();
                });
            });

        miniSetting.settingEl.addClass("image-converter-global-mini-setting");
    }

    private updatePreviews = async () => {
        if (!this.previewContainer || !this.customFolderText || !this.customFilenameText) return;

        if (this.updateTimeout) {
            window.clearTimeout(this.updateTimeout);
        }

        this.updateTimeout = window.setTimeout(async () => {
            if (!this.previewContainer) return;

            try {
                const activeFile = this.app.workspace.getActiveFile();
                const firstImage = this.app.vault
                    .getFiles()
                    .find((file) => file.extension.match(/^(jpg|jpeg|png|gif|webp)$/i));

                const fileToUse = activeFile?.extension.match(/^(jpg|jpeg|png|gif|webp)$/i) ? activeFile : firstImage;

                const folderTemplate = this.customFolderText?.getValue() || "";
                const filenameTemplate = this.customFilenameText?.getValue() || "";

                const newContent = createEl('div');

                if (folderTemplate || filenameTemplate) {
                    const folderPath = folderTemplate
                        ? await this.variableProcessor.processTemplate(
                            folderTemplate,
                            { file: fileToUse || this.app.vault.getFiles()[0], activeFile: activeFile || this.app.vault.getFiles()[0] }
                        )
                        : "";

                    const filename = filenameTemplate
                        ? await this.variableProcessor.processTemplate(
                            filenameTemplate,
                            { file: fileToUse || this.app.vault.getFiles()[0], activeFile: activeFile || this.app.vault.getFiles()[0] }
                        )
                        : "";

                    const fullPath = [folderPath, filename].filter(Boolean).join("/");

                    newContent.createEl("div", {
                        text: fullPath || "No path specified",
                        cls: "image-converter-preview-path-compact"
                    });
                } else {
                    newContent.createEl("div", {
                        text: "Enter templates to see preview",
                        cls: "image-converter-preview-empty-compact"
                    });
                }

                if (this.previewContainer) {
                    this.previewContainer.empty();
                    this.previewContainer.append(newContent);
                }

            } catch (error) {
                console.error("Preview generation error:", error);
                if (this.previewContainer) {
                    this.previewContainer.empty();
                    this.previewContainer.createEl("div", {
                        text: "Error generating preview",
                        cls: "image-converter-preview-error-compact"
                    });
                }
            }
        }, 150);
    }

    private showAvailableVariables() {
        new AvailableVariablesModal(this.app, this.variableProcessor).open();
    }

    private updateProcessingPreview() {
        if (!this.processingCardPreview) return;

        // Generate preview text with current settings
        const formatText = this.selectedConversionPreset.name;
        const qualityText = `${this.selectedConversionPreset.quality}%`;
        const linkText = this.selectedLinkFormatPreset.name;
        const resizeText = this.selectedResizePreset.name;

        // Create compact preview display
        const previewText = `${formatText} ${qualityText} • ${linkText} • ${resizeText}`;
        
        // Update the text content of the preview div
        this.processingCardPreview.textContent = previewText;
    }

    private toggleProcessingCard() {
        this.isProcessingCardExpanded = !this.isProcessingCardExpanded;

        if (!this.processingCardContent || !this.processingCardChevron) {
            return;
        }

        if (this.isProcessingCardExpanded) {
            // Show full content
            this.processingCardContent.removeClass("image-converter-collapsed");
            this.processingCardChevron.textContent = "▼";
        } else {
            // Hide full content
            this.processingCardContent.addClass("image-converter-collapsed");
            this.processingCardChevron.textContent = "▶";
        }
    }

    onClose() {
        if (this.updateTimeout) {
            window.clearTimeout(this.updateTimeout);
            this.updateTimeout = null;
        }

        this.conversionQualitySetting = null;
        this.conversionColorDepthSetting = null;
        this.customFilenameSetting = null;
        this.customFilenameText = null;
        this.customFolderSetting = null;
        this.customFolderText = null;
        this.previewContainer = null;

        const { contentEl } = this;
        contentEl.empty();
    }
}

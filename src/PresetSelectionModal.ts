import { Modal, Notice, App, Setting, ButtonComponent, DropdownComponent, TextComponent } from "obsidian";
import {
    ImageConverterSettings,
    ConversionPreset,
    FilenamePreset,
    FolderPreset,
    GlobalPreset,
    AvailableVariablesModal
} from "./ImageConverterSettings";
import { LinkFormatPreset } from "./LinkFormatSettings"
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
    private customFolderSetting: Setting | null = null; // Add custom folder setting
    private customFolderText: TextComponent | null = null; // Add custom folder text component

    private previewContainer: HTMLDivElement | null = null;
    private updateTimeout: number | null = null;

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

        // Create main layout container
        const mainContainer = contentEl.createDiv("image-converter-main-container");

        // Create two columns
        const settingsColumn = mainContainer.createDiv("image-converter-settings-column");

        // SETTINGS COLUMN
        // Main heading
        settingsColumn.createEl("h2", {
            text: "Image Processing",
        });

        // 1. Global Preset Section
        const globalSection = settingsColumn.createDiv("image-converter-preset-section");
        globalSection.createEl("h3", { text: "" });
        this.createGlobalPresetDropdown(globalSection);

        // 2. File Organization Section with integrated help button
        const fileSection = settingsColumn.createDiv("image-converter-preset-section");

        // Header with title and variables help
        const fileSectionHeader = fileSection.createDiv("image-converter-section-header");
        const titleGroup = fileSectionHeader.createDiv("image-converter-title-group");
        titleGroup.createEl("h3", { text: "File organization" });
        new ButtonComponent(titleGroup)
            .setIcon("help-circle")
            .setTooltip("Show available variables")
            .setClass("image-converter-help-button")
            .onClick(() => this.showAvailableVariables());

        // Add description
        fileSection.createEl("p", {
            cls: "image-converter-section-description",
            text: "Some default presets are already pre-defined. You can create more presets in the main plugin settings window. After selecting custom made preset a new input field will show pre-filled with template from the preset which you can always manually overwrite."
        });

        // Inputs container
        const inputsContainer = fileSection.createDiv("image-converter-inputs-container");

        // Folder Organization
        const folderGroup = inputsContainer.createDiv("image-converter-input-group");
        this.folderPresetDropdown = this.createPresetDropdown(
            folderGroup,
            "Folder",
            this.settings.folderPresets,
            this.selectedFolderPreset,
            (value) => {
                this.selectedFolderPreset = this.settings.folderPresets.find(
                    (p) => p.name === value
                ) || this.settings.folderPresets[0];
                this.updatePreviews();
                this.updateFolderInputFieldVisibility(); // Add this line
            }
        );

        this.customFolderSetting = new Setting(folderGroup)
            .addText((text) => {
                this.customFolderText = text;
                text.setPlaceholder("e.g., {YYYY}/{MM}/{notename}")
                    .setValue(this.selectedFolderPreset.customTemplate || "")
                    .onChange(() => this.updatePreviews());
                text.inputEl.setAttr("spellcheck", "false");
                return text;
            });
        this.updateFolderInputFieldVisibility(); // Initial visibility check

        // Filename Organization
        const filenameGroup = inputsContainer.createDiv("image-converter-input-group");
        this.filenamePresetDropdown = this.createPresetDropdown(
            filenameGroup,
            "Filename",
            this.settings.filenamePresets,
            this.selectedFilenamePreset,
            (value) => {
                this.selectedFilenamePreset = this.settings.filenamePresets.find(
                    (p) => p.name === value
                ) || this.settings.filenamePresets[0];
                if (this.customFilenameText) {
                    this.customFilenameText.setValue(
                        this.selectedFilenamePreset.customTemplate || ""
                    );
                }
                this.updatePreviews();
                this.updateFilenameInputFieldVisibility(); // Add this line
            }
        );

        this.customFilenameSetting = new Setting(filenameGroup)
            .addText((text) => {
                this.customFilenameText = text;
                text.setPlaceholder("e.g., {imagename}-{timestamp}")
                    .setValue(this.selectedFilenamePreset.customTemplate || "")
                    .onChange(() => this.updatePreviews());
                text.inputEl.setAttr("spellcheck", "false");
                return text;
            });
        this.updateFilenameInputFieldVisibility(); // Initial visibility check

        // Preview section
        const previewSection = fileSection.createDiv("image-converter-preview-section");
        const previewHeader = previewSection.createDiv("image-converter-preview-header");
        previewHeader.createEl("span", {
            cls: "image-converter-preview-icon",
            text: "" // Or use any other icon system you prefer
        });
        previewHeader.createEl("span", {
            text: "Path preview",
            cls: "image-converter-preview-title"
        });
        this.previewContainer = previewSection.createDiv("image-converter-modal-preview-container");


        // 3. Conversion Section
        const conversionSection = settingsColumn.createDiv("image-converter-preset-section");
        conversionSection.createEl("h3", { text: "Image conversion" });

        const conversionContainer = conversionSection.createDiv("image-converter-conversion-container");

        this.conversionPresetDropdown = this.createPresetDropdown(
            conversionContainer,
            "Format",
            this.settings.conversionPresets,
            this.selectedConversionPreset,
            (value) => {
                this.selectedConversionPreset = this.settings.conversionPresets.find(
                    (p) => p.name === value
                ) || this.settings.conversionPresets[0];
                this.updateConversionSettings(conversionContainer);
            }
        );
        this.updateConversionSettings(conversionContainer);

        // 4. Additional Settings Section
        const additionalSection = settingsColumn.createDiv("image-converter-preset-section");
        additionalSection.createEl("h3", { text: "Additional settings" });

        this.linkFormatPresetDropdown = this.createPresetDropdown(
            additionalSection,
            "Link format",
            this.settings.linkFormatSettings.linkFormatPresets,
            this.selectedLinkFormatPreset,
            (value) => {
                this.selectedLinkFormatPreset = this.settings.linkFormatSettings.linkFormatPresets.find(
                    (p) => p.name === value
                ) || this.settings.linkFormatSettings.linkFormatPresets[0];
            }
        );

        this.resizePresetDropdown = this.createPresetDropdown(
            additionalSection,
            "Resize (non-destructive)",
            this.settings.nonDestructiveResizeSettings.resizePresets,
            this.selectedResizePreset,
            (value) => {
                this.selectedResizePreset = this.settings.nonDestructiveResizeSettings.resizePresets.find(
                    (p) => p.name === value
                ) || this.settings.nonDestructiveResizeSettings.resizePresets[0];
            }
        );

        // 5. Action Buttons Section (at the bottom of settings column)
        const actionSection = settingsColumn.createDiv("image-converter-action-section");

        new Setting(actionSection)
            .addButton((button: ButtonComponent) => {
                button
                    .setButtonText("Edit presets")
                    .onClick(() => {
                        this.close();
                        const settingsTab = (this.app as any).setting;
                        if (settingsTab) {
                            settingsTab.open();
                            settingsTab.openTabById(this.plugin.manifest.id);
                        } else {
                            new Notice("Unable to open settings.");
                        }
                    });
            });

        new Setting(actionSection)
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


    private createPresetDropdown<T extends { name: string }>(
        contentEl: HTMLElement,
        name: string,
        presets: T[],
        selectedPreset: T,
        onChange: (value: string) => void
    ): Setting {
        const dropdownSetting = new Setting(contentEl)
            .setName(name)
            .addDropdown((dropdown) => {
                presets.forEach((preset) => {
                    dropdown.addOption(preset.name, preset.name);
                });
                dropdown.setValue(selectedPreset.name);
                dropdown.onChange(onChange);
            });

        return dropdownSetting;
    }

    private updateConversionSettings(container: HTMLElement): void {
        // First remove any existing quality container
        const existingContainer = document.querySelector('.image-converter-conversion-quality-container');
        if (existingContainer) {
            existingContainer.remove();
        }

        // Remove existing settings if they exist
        if (this.conversionQualitySetting) {
            this.conversionQualitySetting.settingEl.remove();
            this.conversionQualitySetting = null;
        }
        if (this.conversionColorDepthSetting) {
            this.conversionColorDepthSetting.settingEl.remove();
            this.conversionColorDepthSetting = null;
        }

        // Create new quality container
        const qualityContainer = container.createDiv("image-converter-conversion-quality-container");

        // Add quality slider
        this.conversionQualitySetting = new Setting(qualityContainer)
            .setName("Quality")
            .setDesc(`Current: ${this.selectedConversionPreset.quality}%`)
            .addSlider((slider) => {
                slider
                    .setLimits(0, 100, 1)
                    .setValue(this.selectedConversionPreset.quality)
                    .setDynamicTooltip()
                    .onChange((value) => {
                        this.selectedConversionPreset.quality = value;
                        this.conversionQualitySetting?.setDesc(`Current: ${value}%`);
                    });
            });

        // Add color depth slider for PNG
        if (this.selectedConversionPreset.outputFormat === "PNG") {
            this.conversionColorDepthSetting = new Setting(qualityContainer)
                .setName("Color depth")
                .setDesc(`Current: ${this.selectedConversionPreset.colorDepth * 100}%`)
                .addSlider((slider) => {
                    slider
                        .setLimits(0, 1, 0.1)
                        .setValue(this.selectedConversionPreset.colorDepth)
                        .setDynamicTooltip()
                        .onChange((value) => {
                            this.selectedConversionPreset.colorDepth = value;
                            this.conversionColorDepthSetting?.setDesc(`Current: ${value * 100}%`);
                        });
                });
        }
    }

    // New method to create the global preset dropdown
    private createGlobalPresetDropdown(contentEl: HTMLElement): void {
        new Setting(contentEl)
            .setName("Global preset")
            .setDesc(
                "Select a global preset to apply multiple settings at once"
            )
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
                        // Reset individual selections to current settings or defaults
                        this.selectedConversionPreset =
                            this.settings.conversionPresets.find(
                                (p) =>
                                    p.name ===
                                    this.settings.selectedConversionPreset
                            ) || this.settings.conversionPresets[0];
                        this.selectedFilenamePreset =
                            this.settings.filenamePresets.find(
                                (p) =>
                                    p.name ===
                                    this.settings.selectedFilenamePreset
                            ) || this.settings.filenamePresets[0];
                        this.selectedFolderPreset =
                            this.settings.folderPresets.find(
                                (p) =>
                                    p.name === this.settings.selectedFolderPreset
                            ) || this.settings.folderPresets[0];
                        this.selectedLinkFormatPreset =
                            this.settings.linkFormatSettings.linkFormatPresets.find(
                                (p) =>
                                    p.name ===
                                    this.settings.linkFormatSettings
                                        .selectedLinkFormatPreset
                            ) ||
                            this.settings.linkFormatSettings
                                .linkFormatPresets[0];
                        this.selectedResizePreset =
                            this.settings.nonDestructiveResizeSettings.resizePresets.find(
                                (p) =>
                                    p.name ===
                                    this.settings.nonDestructiveResizeSettings
                                        .selectedResizePreset
                            ) ||
                            this.settings.nonDestructiveResizeSettings
                                .resizePresets[0];
                    } else {
                        this.selectedGlobalPreset =
                            this.settings.globalPresets.find(
                                (p) => p.name === value
                            ) || null;
                        if (this.selectedGlobalPreset) {
                            // Apply settings from the selected global preset
                            this.selectedConversionPreset =
                                this.settings.conversionPresets.find(
                                    (p) =>
                                        p.name ===
                                        this.selectedGlobalPreset!
                                            .conversionPreset
                                ) || this.settings.conversionPresets[0];
                            this.selectedFilenamePreset =
                                this.settings.filenamePresets.find(
                                    (p) =>
                                        p.name ===
                                        this.selectedGlobalPreset!.filenamePreset
                                ) || this.settings.filenamePresets[0];
                            this.selectedFolderPreset =
                                this.settings.folderPresets.find(
                                    (p) =>
                                        p.name ===
                                        this.selectedGlobalPreset!.folderPreset
                                ) || this.settings.folderPresets[0];
                            this.selectedLinkFormatPreset =
                                this.settings.linkFormatSettings.linkFormatPresets.find(
                                    (p) =>
                                        p.name ===
                                        this.selectedGlobalPreset!
                                            .linkFormatPreset
                                ) ||
                                this.settings.linkFormatSettings
                                    .linkFormatPresets[0];
                            this.selectedResizePreset =
                                this.settings.nonDestructiveResizeSettings.resizePresets.find(
                                    (p) =>
                                        p.name ===
                                        this.selectedGlobalPreset!.resizePreset
                                ) ||
                                this.settings.nonDestructiveResizeSettings
                                    .resizePresets[0];
                        }
                    }

                    // Update all dropdowns to reflect the selected preset
                    (
                        this.folderPresetDropdown.components[0] as DropdownComponent
                    ).setValue(this.selectedFolderPreset.name);
                    (
                        this.filenamePresetDropdown
                            .components[0] as DropdownComponent
                    ).setValue(this.selectedFilenamePreset.name);
                    (
                        this.conversionPresetDropdown
                            .components[0] as DropdownComponent
                    ).setValue(this.selectedConversionPreset.name);
                    (
                        this.linkFormatPresetDropdown
                            .components[0] as DropdownComponent
                    ).setValue(this.selectedLinkFormatPreset.name);
                    (
                        this.resizePresetDropdown
                            .components[0] as DropdownComponent
                    ).setValue(this.selectedResizePreset.name);

                    // Find the quality container and update it
                    const qualityContainer = this.conversionPresetDropdown.settingEl.parentElement?.querySelector('.image-converter-conversion-quality-container');
                    if (qualityContainer) {
                        this.updateConversionSettings(qualityContainer as HTMLElement);
                    }

                    this.updateFilenameSettings(contentEl);
                    this.updateFolderPreview();
                    this.updateFolderInputFieldVisibility();    // Add this
                    this.updateFilenameInputFieldVisibility();  // Add this
                });
            });
    }



    private updateFilenameSettings(contentEl: HTMLElement): void {
        // Update the custom filename text component's value if user is changing global preset
        if (this.customFilenameText) {
            this.customFilenameText.setValue(
                this.selectedFilenamePreset.customTemplate || ""
            );
        }
    }

    private updatePreviews = async () => {
        if (!this.previewContainer || !this.customFolderText || !this.customFilenameText) return;

        // Debounce the update to prevent flashing
        if (this.updateTimeout) {
            window.clearTimeout(this.updateTimeout);
        }

        this.updateTimeout = window.setTimeout(async () => {
            if (!this.previewContainer) return; // Additional null check after timeout

            try {
                const activeFile = this.app.workspace.getActiveFile();
                const firstImage = this.app.vault
                    .getFiles()
                    .find((file) => file.extension.match(/^(jpg|jpeg|png|gif|webp)$/i));

                const fileToUse = activeFile?.extension.match(/^(jpg|jpeg|png|gif|webp)$/i)
                    ? activeFile
                    : firstImage;

                const folderTemplate = this.customFolderText?.getValue() || "";
                const filenameTemplate = this.customFilenameText?.getValue() || "";

                // Prepare new content before updating DOM
                const newContent = createEl('div');

                if (folderTemplate || filenameTemplate) {
                    const folderPath = folderTemplate
                        ? await this.variableProcessor.processTemplate(
                            folderTemplate,
                            { file: fileToUse!, activeFile: activeFile! }
                        )
                        : "";

                    const filename = filenameTemplate
                        ? await this.variableProcessor.processTemplate(
                            filenameTemplate,
                            { file: fileToUse!, activeFile: activeFile! }
                        )
                        : "";

                    const previewPath = newContent.createDiv("image-converter-preview-path");
                    const fullPath = [folderPath, filename].filter(Boolean).join("/");

                    previewPath.createEl("div", {
                        text: "Full path: ",
                        cls: "image-converter-preview-label"
                    });

                    previewPath.createEl("div", {
                        text: fullPath || "No path specified",
                        cls: "image-converter-preview-value"
                    });

                    if (folderTemplate && filenameTemplate) {
                        const folderPreview = previewPath.createEl("div", {
                            cls: "image-converter-preview-component"
                        });
                        folderPreview.createEl("span", {
                            text: "Folder: ",
                            cls: "image-converter-preview-label"
                        });
                        folderPreview.createEl("span", {
                            text: folderPath,
                            cls: "image-converter-preview-value"
                        });

                        const filenamePreview = previewPath.createEl("div", {
                            cls: "image-converter-preview-component"
                        });
                        filenamePreview.createEl("span", {
                            text: "Filename: ",
                            cls: "image-converter-preview-label"
                        });
                        filenamePreview.createEl("span", {
                            text: filename,
                            cls: "image-converter-preview-value"
                        });
                    }
                } else {
                    newContent.createEl("div", {
                        text: "Enter a template to see preview",
                        cls: "image-converter-preview-empty"
                    });
                }

                // Additional null check before DOM updates
                if (this.previewContainer) {
                    this.previewContainer.empty();
                    this.previewContainer.append(newContent);
                }

            } catch (error) {
                console.error("Preview generation error:", error);
                // Additional null check before error handling
                if (this.previewContainer) {
                    this.previewContainer.empty();
                    this.previewContainer.createEl("div", {
                        text: "Error generating preview",
                        cls: "image-converter-preview-error"
                    });
                }
            }
        }, 150); // Small delay to prevent rapid updates
    }

    private updateFolderPreview = async () => {
        if (!this.customFolderText) return;

        const templateValue = this.customFolderText.getValue();
        const previewEl = this.customFolderSetting?.controlEl.querySelector(
            ".image-converter-image-converter-preview-path"
        ) as HTMLElement;

        if (!templateValue) {
            previewEl.empty();
            return;
        }

        try {
            const activeFile = this.app.workspace.getActiveFile();
            const firstImage = this.app.vault
                .getFiles()
                .find((file) =>
                    file.extension.match(/^(jpg|jpeg|png|gif|webp)$/i)
                );

            const fileToUse =
                activeFile &&
                    activeFile.extension.match(/^(jpg|jpeg|png|gif|webp)$/i)
                    ? activeFile
                    : firstImage;

            const processedPath = await this.variableProcessor.processTemplate(
                templateValue,
                { file: fileToUse!, activeFile: activeFile! }
            );
            previewEl.setText(processedPath);
        } catch (error) {
            console.error("Preview generation error:", error);
            previewEl.setText("Error generating preview");
        }
    };

    private showAvailableVariables() {
        new AvailableVariablesModal(this.app, this.variableProcessor).open();
    }


    // NEW method
    private updateFolderInputFieldVisibility() {
        if (this.customFolderSetting) {
            // Assuming 'DEFAULT' is a type where you want to hide the input
            if (this.selectedFolderPreset.type === 'DEFAULT'
                || this.selectedFolderPreset.type === 'ROOT'
                || this.selectedFolderPreset.type === 'CURRENT'
                || this.selectedFolderPreset.type === 'SUBFOLDER') {
                this.customFolderSetting.settingEl.hide();
            } else {
                this.customFolderSetting.settingEl.show();
            }
        }
    }

    // NEW method
    private updateFilenameInputFieldVisibility() {
        if (this.customFilenameSetting) {
            // Check if a default preset (besides 'Default (No change)') is selected
            const isDefaultPreset = this.selectedFilenamePreset.name === "Keep original name" ||
                this.selectedFilenamePreset.name === "NoteName-Timestamp";

            if (isDefaultPreset) {
                this.customFilenameSetting.settingEl.hide();
            } else {
                this.customFilenameSetting.settingEl.show();
            }
        }
    }

    onClose() {
        // Clear any pending update timeout
        if (this.updateTimeout) {
            window.clearTimeout(this.updateTimeout);
            this.updateTimeout = null;
        }

        // Clear nullable settings and components
        this.conversionQualitySetting = null;
        this.conversionColorDepthSetting = null;
        this.customFilenameSetting = null;
        this.customFilenameText = null;
        this.customFolderSetting = null;
        this.customFolderText = null;
        this.previewContainer = null;

        // Empty the modal content
        const { contentEl } = this;
        contentEl.empty();
    }
}
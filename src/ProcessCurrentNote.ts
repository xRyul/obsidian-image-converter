/* eslint-disable obsidianmd/ui/sentence-case */
// ProcessCurrentNote.ts
import {
    App,
    Modal,
    Notice,
    Setting,
    ButtonComponent,
    TFile,
    TextComponent
} from "obsidian";
import { FolderSuggest } from "./FolderSuggest";
import ImageConverterPlugin from './main';

// import {
//     ResizeMode,
//     EnlargeReduce,
// } from './ImageProcessor';

import { BatchImageProcessor } from './BatchImageProcessor';
import { CanvasData, CanvasNode } from './canvas-types';

export class ProcessCurrentNote extends Modal {
    private imageCount = 0;
    private processedCount = 0;
    private skippedCount = 0;
    private imageCountDisplay: HTMLSpanElement;
    private processedCountDisplay: HTMLSpanElement;
    private skippedCountDisplay: HTMLSpanElement;

    private enlargeReduceSettings: Setting | null = null;
    private resizeInputSettings: Setting | null = null;
    submitButton: ButtonComponent | null = null;
    private resizeInputsDiv: HTMLDivElement | null = null;
    private enlargeReduceDiv: HTMLDivElement | null = null;
    convertToSetting: Setting;
    skipFormatsSetting: Setting;
    resizeModeSetting: Setting;
    skipTargetFormatSetting: Setting;

    constructor(
        app: App,
        private plugin: ImageConverterPlugin,
        private activeFile: TFile,
        private batchImageProcessor: BatchImageProcessor  // Inject instead of creating new
    ) {
        super(app);
    }

    // Obsidian calls Modal.onOpen as a lifecycle hook and intentionally ignores the returned Promise.
    // We keep this method async to allow await inside, so we disable the no-misused-promises rule here.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    async onOpen(): Promise<void> {
		const { contentEl } = this;

		// Create main container
		const mainContainer = contentEl.createDiv({
			cls: "image-convert-modal",
		});

		// Header section
		const headerContainer = mainContainer.createDiv({
			cls: "modal-header",
		});
		headerContainer.createEl("h2", {
			text: "Convert, compress and resize",
		});

		headerContainer.createEl("h6", {
			text: `all images in: ${this.activeFile.basename}.${this.activeFile.extension}`,
			cls: "modal-subtitle",
		});

		// Initial image counts (fetch these before creating settings)
		await this.updateImageCounts();

		// --- Image Counts Display ---
		const countsDisplay = contentEl.createDiv({
			cls: "image-counts-display",
		});

		countsDisplay.createEl("span", { text: "Total images found: " });
		this.imageCountDisplay = countsDisplay.createEl("span");

		countsDisplay.createEl("br");

		countsDisplay.createEl("span", { text: "To be processed: " });
		this.processedCountDisplay = countsDisplay.createEl("span");

		countsDisplay.createEl("br");

		countsDisplay.createEl("span", { text: "Skipped: " });
		this.skippedCountDisplay = countsDisplay.createEl("span");

		// Warning message
		headerContainer.createEl("p", {
			cls: "modal-warning",
			 
			text: "⚠️ This will modify all images in the current note — please ensure you have backups.",
		});

		// --- Settings Container ---
		const settingsContainer = mainContainer.createDiv({
			cls: "settings-container",
		});

		// Format and Quality Container
		const formatQualityContainer = settingsContainer.createDiv({
			cls: "format-quality-container",
		});

		// Convert To setting
		this.convertToSetting = new Setting(formatQualityContainer)
			.setName("Convert to ⓘ ")
			.setDesc("Choose output format for your images")
			.setTooltip(
				"Same as original: preserves current format while applying compression/resizing",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						disabled: "Same as original",
						webp: "WebP",
						jpg: "JPG",
						png: "PNG",
					})
					.setValue(this.plugin.settings.ProcessCurrentNoteconvertTo)
					.onChange(async (value) => {
						this.plugin.settings.ProcessCurrentNoteconvertTo =
							value;
						await this.plugin.saveSettings();
						await this.updateImageCountsAndDisplay(); // Update counts after changing this setting
					}),
			);

		// Quality setting
		new Setting(formatQualityContainer)
			.setName("Quality ⓘ")
			.setDesc("Compression level (0-100)")
			.setTooltip(
				"100: no compression (original quality)\n75: recommended (good balance)\n0-50: high compression (lower quality)",
			)
			.addText((text) =>
				text
					.setPlaceholder("Enter quality (0-100)")
					.setValue(
						(
							this.plugin.settings.ProcessCurrentNotequality * 100
						).toString(),
					)
					.onChange(async (value) => {
						const quality = parseInt(value);
						if (
							/^\d+$/.test(value) &&
							quality >= 0 &&
							quality <= 100
						) {
							this.plugin.settings.ProcessCurrentNotequality =
								quality / 100;
							await this.plugin.saveSettings();
						}
					}),
			);

		// Resize Container (separate from format/quality)
		const resizeContainer = settingsContainer.createDiv({
			cls: "resize-container",
		});

		// Resize Mode setting
		this.resizeModeSetting = new Setting(resizeContainer)
			.setName("Resize mode ⓘ")
			.setDesc(
				"Choose how images should be resized - results are permanent.",
			)
			 
			.setTooltip(
				"Fit: maintains aspect ratio within dimensions\nFill: exactly matches dimensions\nLongest edge: limits the longest side\nShortest edge: limits the shortest side\nWidth/height: constrains single dimension",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						None: "None",
						LongestEdge: "Longest edge",
						ShortestEdge: "Shortest edge",
						Width: "Width",
						Height: "Height",
						Fit: "Fit",
						Fill: "Fill",
					})
					.setValue(
						this.plugin.settings
							.ProcessCurrentNoteResizeModalresizeMode,
					)
					.onChange(async (value) => {
						this.plugin.settings.ProcessCurrentNoteResizeModalresizeMode =
							value;
						await this.plugin.saveSettings();
						this.updateResizeInputVisibility(value);
						await this.updateImageCountsAndDisplay(); // Update counts after changing this setting
					}),
			);

		// Create resize inputs
		this.resizeInputsDiv = resizeContainer.createDiv({
			cls: "resize-inputs",
		});
		this.enlargeReduceDiv = resizeContainer.createDiv({
			cls: "enlarge-reduce-settings",
		});

		// Skip formats Container
		const skipContainer = settingsContainer.createDiv({
			cls: "skip-container",
		});

		// Skip formats setting
		this.skipFormatsSetting = new Setting(skipContainer)
			.setName("Skip file formats ⓘ")
			.setTooltip(
				"Comma-separated list of file formats to skip (e.g., tif,tiff,heic). Leave empty to process all formats.",
			)
			.addText((text) =>
				text
					 
					.setPlaceholder("e.g., tif, tiff, heic")
					.setValue(
						this.plugin.settings.ProcessCurrentNoteSkipFormats,
					)
					.onChange(async (value) => {
						this.plugin.settings.ProcessCurrentNoteSkipFormats =
							value;
						await this.plugin.saveSettings();
						await this.updateImageCountsAndDisplay(); // Update counts after changing this setting
					}),
			);

		// Ignore folders setting
		new Setting(skipContainer)
			.setClass("image-converter-ignore-folders-setting")
			.setName("Skip folders ⓘ")
			.setTooltip(
				"Comma-separated folder patterns to exclude images from processing.",
			)
			.addText((text) => {
				text.setPlaceholder("e.g., _attachments, images/**")
					.setValue(
						this.plugin.settings.ProcessCurrentNoteIgnoreFolders,
					)
					.onChange(async (value) => {
						this.plugin.settings.ProcessCurrentNoteIgnoreFolders =
							value;
						await this.plugin.saveSettings();
						await this.updateImageCountsAndDisplay();
					});

				text.inputEl.setAttr("spellcheck", "false");
				new FolderSuggest(this.app, text.inputEl);
			});

		// Add collapsible help section below the setting row so the input stays visually anchored.
		const helpDetails = skipContainer.createEl("details", {
			cls: "image-converter-ignore-folders-help",
		});
		helpDetails.createEl("summary", {
			text: "Show examples and how matching works",
			cls: "image-converter-ignore-folders-help-summary",
		});

		const helpContent = helpDetails.createDiv({
			cls: "image-converter-ignore-folders-help-content",
		});

		helpContent.createDiv({
			text: "How matching works:",
			attr: { style: "font-weight: bold; margin: 8px 0 4px 0;" },
		});
		const behaviorList = helpContent.createEl("ul", {
			attr: { style: "margin: 4px 0; padding-left: 20px;" },
		});
		behaviorList.createEl("li", {
			text: "Folder paths without wildcards skip that folder and all subfolders",
		});
		behaviorList.createEl("li", {
			text: "Leading / is optional",
		});
		behaviorList.createEl("li", {
			text: "Use * to match only direct children",
		});
		behaviorList.createEl("li", {
			text: "Use ** to include subfolders too",
		});
		behaviorList.createEl("li", {
			text: "Regex is supported for advanced patterns",
		});

		helpContent.createDiv({
			text: "Examples:",
			attr: { style: "font-weight: bold; margin-bottom: 4px;" },
		});

		const examplesList = helpContent.createEl("ul", {
			attr: { style: "margin: 4px 0 8px 0; padding-left: 20px;" },
		});
		examplesList.createEl("li", {
			text: "_attachments → Skips that folder and everything inside it",
		});
		examplesList.createEl("li", {
			text: "/_attachments → Same as above",
		});
		examplesList.createEl("li", {
			text: "_attachments/* → Skips only direct children in that folder",
		});
		examplesList.createEl("li", {
			text: "_attachments/** → Skips that folder and all nested subfolders",
		});
		examplesList.createEl("li", {
			text: "images/**, assets/** → Skips multiple folder trees",
		});
		examplesList.createEl("li", {
			text: "archive/2025/** → Skips a specific folder tree",
		});

		helpContent.createDiv({
			text: "Advanced (regex):",
			attr: { style: "font-weight: bold; margin-bottom: 4px;" },
		});

		const advancedExamplesList = helpContent.createEl("ul", {
			attr: { style: "margin: 4px 0 8px 0; padding-left: 20px;" },
		});
		advancedExamplesList.createEl("li", {
			text: "/^_attachments\\// → Skips paths starting with _attachments/",
		});
		advancedExamplesList.createEl("li", {
			text: "regex:^media/(raw|temp)/ → Skips media/raw and media/temp",
		});
		advancedExamplesList.createEl("li", {
			text: "r/^(drafts|scratch)\\// → Skips drafts/ and scratch/",
		});

		// Skip target format setting
		this.skipTargetFormatSetting = new Setting(skipContainer)
			.setName("Skip images in target format ⓘ")
			.setTooltip(
				"If image is already in target format, this allows you to skip its compression, conversion and resizing. Processing of all other formats will be still performed.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(
						this.plugin.settings
							.ProcessCurrentNoteskipImagesInTargetFormat,
					)
					.onChange(async (value) => {
						this.plugin.settings.ProcessCurrentNoteskipImagesInTargetFormat =
							value;
						await this.plugin.saveSettings();
						await this.updateImageCountsAndDisplay(); // Update counts after changing this setting
					}),
			);

		// Initialize resize inputs
		this.updateResizeInputVisibility(
			this.plugin.settings.ProcessCurrentNoteResizeModalresizeMode,
		);

		// --- Update Counts After Settings Change ---
		await this.updateImageCountsAndDisplay();

		// Submit button
		const buttonContainer = settingsContainer.createDiv({
			cls: "button-container",
		});
		this.submitButton = new ButtonComponent(buttonContainer)
			.setButtonText("Submit")
			.onClick(async () => {
				// Use async here
				this.close();
				if (
					this.activeFile.extension === "md" ||
					this.activeFile.extension === "canvas"
				) {
					await this.batchImageProcessor.processImagesInNote(
						this.activeFile,
					);
					await this.refreshActiveNote();
				} else {
					 
					new Notice(
						"Error: active file must be a markdown or canvas file.",
					);
				}
			});
	}
    
    private updateResizeInputVisibility(resizeMode: string): void {
        if (resizeMode === "None") {
            this.resizeInputsDiv?.empty();
            this.enlargeReduceDiv?.hide(); // Explicitly hide it
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
            this.enlargeReduceDiv?.show(); // Show only when not None
        }
    }

    private createEnlargeReduceSettings(): void {
        if (!this.enlargeReduceDiv) return;

        // Clear existing content using Obsidian's method
        this.enlargeReduceDiv.empty();

        this.enlargeReduceSettings = new Setting(this.enlargeReduceDiv)
            .setClass('enlarge-reduce-setting')
            .setName('Enlarge or reduce ⓘ')
            .setDesc('Controls how images are adjusted relative to target size:')
             
            .setTooltip('• Reduce and enlarge: adjusts all images to fit specified dimensions\n• Reduce only: only shrinks images larger than target\n• Enlarge only: only enlarges images smaller than target')
            .addDropdown((dropdown) => {
                dropdown
                    .addOptions({
                        Always: 'Reduce and enlarge',
                        Reduce: 'Reduce only',
                        Enlarge: 'Enlarge only',
                    })
                    .setValue(this.plugin.settings.ProcessCurrentNoteEnlargeOrReduce)
                    .onChange(async (value: 'Always' | 'Reduce' | 'Enlarge') => {
                        this.plugin.settings.ProcessCurrentNoteEnlargeOrReduce = value;
                        await this.plugin.saveSettings();
                    });
            });
    }

    private createResizeInputSettings(resizeMode: string): void {
        if (!this.resizeInputsDiv) return;

        // Clear existing content using Obsidian's method
        this.resizeInputsDiv.empty();

        // Create new setting
        this.resizeInputSettings = new Setting(this.resizeInputsDiv)
            .setClass('resize-input-setting'); // Add a class for styling if needed

        this.updateResizeInputSettings(resizeMode);
    }

    private updateResizeInputSettings(resizeMode: string): void {
        if (!this.resizeInputSettings) return;

        this.resizeInputSettings.clear();

        let name = '';
        let desc = '';

        if (['Fit', 'Fill'].includes(resizeMode)) {
            name = 'Resize dimensions';
            desc = 'Enter the desired width and height in pixels';
            this.resizeInputSettings
                .setName(name)
                .setDesc(desc)
                .addText((text: TextComponent) => text
                    .setPlaceholder('Width')
                    .setValue(this.plugin.settings.ProcessCurrentNoteresizeModaldesiredWidth.toString())
                    .onChange(async (value: string) => {
                        const width = parseInt(value);
                        if (/^\d+$/.test(value) && width > 0) {
                            this.plugin.settings.ProcessCurrentNoteresizeModaldesiredWidth = width;
                            await this.plugin.saveSettings();
                        }
                    }))
                .addText((text: TextComponent) => text
                    .setPlaceholder('Height')
                    .setValue(this.plugin.settings.ProcessCurrentNoteresizeModaldesiredHeight.toString())
                    .onChange(async (value: string) => {
                        const height = parseInt(value);
                        if (/^\d+$/.test(value) && height > 0) {
                            this.plugin.settings.ProcessCurrentNoteresizeModaldesiredHeight = height;
                            await this.plugin.saveSettings();
                        }
                    }));
        } else {
            switch (resizeMode) {
                case 'LongestEdge':
                case 'ShortestEdge':
                    name = `${resizeMode}`;
                    desc = 'Enter the desired length in pixels';
                    break;
                case 'Width':
                    name = 'Width';
                    desc = 'Enter the desired width in pixels';
                    break;
                case 'Height':
                    name = 'Height';
                    desc = 'Enter the desired height in pixels';
                    break;
            }

            this.resizeInputSettings
                .setName(name)
                .setDesc(desc)
                .addText((text: TextComponent) => text
                    .setPlaceholder('')
                    .setValue(this.getInitialValue(resizeMode).toString())
                    .onChange(async (value: string) => {
                        const length = parseInt(value);
                        if (/^\d+$/.test(value) && length > 0) {
                            await this.updateSettingValue(resizeMode, length);
                        }
                    }));
        }

        // Update the enlarge/reduce settings in place instead of recreating
        if (!this.enlargeReduceSettings) {
            this.createEnlargeReduceSettings();
        }
    }

    private getInitialValue(resizeMode: string): number {
        switch (resizeMode) {
            case 'LongestEdge':
            case 'ShortestEdge':
                return this.plugin.settings.ProcessCurrentNoteresizeModaldesiredLength;
            case 'Width':
                return this.plugin.settings.ProcessCurrentNoteresizeModaldesiredWidth;
            case 'Height':
                return this.plugin.settings.ProcessCurrentNoteresizeModaldesiredHeight;
            default:
                return 0;
        }
    }

    private async updateSettingValue(resizeMode: string, value: number): Promise<void> {
        switch (resizeMode) {
            case 'LongestEdge':
            case 'ShortestEdge':
                this.plugin.settings.ProcessCurrentNoteresizeModaldesiredLength = value;
                break;
            case 'Width':
                this.plugin.settings.ProcessCurrentNoteresizeModaldesiredWidth = value;
                break;
            case 'Height':
                this.plugin.settings.ProcessCurrentNoteresizeModaldesiredHeight = value;
                break;
        }
        await this.plugin.saveSettings();
    }



    private async updateImageCountsAndDisplay() {
        await this.updateImageCounts();
        this.updateCountDisplays();
    }

    private async updateImageCounts() {
        if (!this.activeFile) return;

        const skipFormats = this.plugin.settings.ProcessCurrentNoteSkipFormats
            .toLowerCase()
            .split(',')
            .map(format => format.trim())
            .filter(format => format.length > 0);

        const targetFormat = this.plugin.settings.ProcessCurrentNoteconvertTo.toLowerCase();
        const skipTargetFormat = this.plugin.settings.ProcessCurrentNoteskipImagesInTargetFormat;
        const ignoreFolders = this.plugin.settings.ProcessCurrentNoteIgnoreFolders ?? '';
        const matchesIgnoreFolders = (filePath: string) =>
            this.plugin.folderAndFilenameManagement.matchesPathPatterns(filePath, ignoreFolders);

        if (this.activeFile.extension === 'canvas') {
            const canvasData = JSON.parse(await this.app.vault.read(this.activeFile)) as CanvasData;
            const images = this.getImagePathsFromCanvas(canvasData);
            this.imageCount = images.length;
            this.processedCount = images.filter(imagePath => {
                if (matchesIgnoreFolders(imagePath)) {
                    return false;
                }
                const imageFile = this.app.vault.getAbstractFileByPath(imagePath);
                if (!(imageFile instanceof TFile) || skipFormats.includes(imageFile.extension.toLowerCase())) {
                    return false; // Skip if not a TFile or in skipFormats
                }
                if (skipTargetFormat && imageFile.extension.toLowerCase() === targetFormat) {
                    return false; // Skip if skipTargetFormat is true and the image is already in the target format
                }
                return true;
            }).length;
            this.skippedCount = this.imageCount - this.processedCount;
        } else {
            // Handle markdown files (similar logic to your processCurrentNoteImages)
            const linkedFiles = this.getLinkedImageFiles(this.activeFile);
            this.imageCount = linkedFiles.length;

            this.processedCount = linkedFiles.filter(file => {
                if (matchesIgnoreFolders(file.path)) {
                    return false;
                }
                if (skipFormats.includes(file.extension.toLowerCase())) {
                    return false;
                }
                if (skipTargetFormat && file.extension.toLowerCase() === targetFormat) {
                    return false;
                }
                return true;
            }).length;
            this.skippedCount = this.imageCount - this.processedCount;
        }
    }

    private hasNodes(data: CanvasData | CanvasNode): data is CanvasData {
        return 'nodes' in data && Array.isArray(data.nodes);
    }

    private getImagePathsFromCanvas(canvasData: CanvasData | CanvasNode): string[] {
        // Type guard ensures proper narrowing: CanvasData has 'nodes', CanvasNode has 'children'
        const nodes: CanvasNode[] = this.hasNodes(canvasData)
            ? canvasData.nodes ?? []
            : canvasData.children ?? [];

        const imagePaths: string[] = [];
        for (const node of nodes) {
            if (node.type === 'file' && node.file) {
                imagePaths.push(node.file);
            }
            if (Array.isArray(node.children) && node.children.length > 0) {
                imagePaths.push(...this.getImagePathsFromCanvas(node));
            }
        }
        return imagePaths;
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

    private getLinkedImageFiles(file: TFile): TFile[] {
        const { resolvedLinks } = this.app.metadataCache;
        const linksInCurrentNote = resolvedLinks[file.path];
        return Object.keys(linksInCurrentNote)
            .map(link => this.app.vault.getAbstractFileByPath(link))
            .filter((file): file is TFile => file instanceof TFile && this.plugin.supportedImageFormats.isSupported(undefined, file.name));
    }

    private updateCountDisplays() {
        this.imageCountDisplay.setText(this.imageCount.toString());
        this.processedCountDisplay.setText(this.processedCount.toString());
        this.skippedCountDisplay.setText(this.skippedCount.toString());
    }


    onClose() {
        // Clear nullable UI elements
        this.enlargeReduceSettings = null;
        this.resizeInputSettings = null;
        this.submitButton = null;
        this.resizeInputsDiv = null;
        this.enlargeReduceDiv = null;
        
        const { contentEl } = this;
        contentEl.empty();
    }
}


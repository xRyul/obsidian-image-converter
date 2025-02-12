import {
    Plugin,
    Editor,
    Platform,
    Notice,
    TFile,
    TFolder,
    EditorPosition,
    MarkdownView
} from "obsidian";
import { SupportedImageFormats } from "./SupportedImageFormats";
import { FolderAndFilenameManagement } from "./FolderAndFilenameManagement";
import { ImageProcessor } from "./ImageProcessor";
import { VariableProcessor } from "./VariableProcessor";
import { LinkFormatPreset } from "./LinkFormatSettings";
import { LinkFormatter } from "./LinkFormatter";
import { NonDestructiveResizePreset } from "./NonDestructiveResizeSettings";
import { ContextMenu } from "./ContextMenu";
// import { ImageAlignment } from './ImageAlignment';
import { ImageAlignmentManager } from './ImageAlignmentManager';
import { ImageResizer } from "./ImageResizer";
import { BatchImageProcessor } from "./BatchImageProcessor";
import { ProcessSingleImageModal } from "./ProcessSingleImageModal";
import { ProcessFolderModal } from "./ProcessFolderModal";
import { ProcessCurrentNote } from "./ProcessCurrentNote";
import { ProcessAllVaultModal } from "./ProcessAllVaultModal"

// Settings tab and all DEFAULTS
import {
    ImageConverterSettings,
    DEFAULT_SETTINGS,
    ImageConverterSettingTab,
    ConversionPreset,
    FilenamePreset,
    FolderPreset,
    ConfirmDialog
} from "./ImageConverterSettings";

import { PresetSelectionModal } from "./PresetSelectionModal";

export default class ImageConverterPlugin extends Plugin {
    settings: ImageConverterSettings;

    // Check supported image formats
    supportedImageFormats: SupportedImageFormats;
    // Handle image management
    folderAndFilenameManagement: FolderAndFilenameManagement;
    // Handle image processing
    imageProcessor: ImageProcessor;
    // Handle variable processing
    variableProcessor: VariableProcessor;
    // linkFormatSettings: LinkFormatSettings;     // Link format - it is initialised via ImageConverterSettings
    // Link formatter
    linkFormatter: LinkFormatter;
    // Context menu
    contextMenu: ContextMenu;
    // Alignment
    // imageAlignment: ImageAlignment | null = null;
    ImageAlignmentManager: ImageAlignmentManager | null = null;
    // drag-resize
    imageResizer: ImageResizer | null = null;
    // batch processing
    batchImageProcessor: BatchImageProcessor;
    // Single Image Modal
    processSingleImageModal: ProcessSingleImageModal;
    // Process whole fodler
    processFolderModal: ProcessFolderModal;
    // Processcurrent note/canvas
    processCurrentNote: ProcessCurrentNote;
    // ProcessAllVault
    processAllVaultModal: ProcessAllVaultModal

    private processedImage: ArrayBuffer | null = null;
    private temporaryBuffers: (ArrayBuffer | Blob | null)[] = [];

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new ImageConverterSettingTab(this.app, this));

        // Initialize core components immediately
        this.supportedImageFormats = new SupportedImageFormats(this.app);

        // Initialize ImageAlignment early since it's time-sensitive
        if (this.settings.isImageAlignmentEnabled) {
            this.ImageAlignmentManager = new ImageAlignmentManager(
                this.app,
                this,
                this.supportedImageFormats,
            );
            await this.ImageAlignmentManager.initialize();
            
            // This helps when opening into note with alignments set and fires less often than e.g. active-leaf-change
            this.registerEvent(
                this.app.workspace.on('file-open', (file) => {
                    if (file) {
                        this.ImageAlignmentManager?.applyAlignmentsToNote(file.path);
                    }
                })
            );
        }

        // // REDUNDANT - Below already initializes on layout change and for applying alignemnt "file-open" is much better option as it fires much less often
        // // NOTE: For alignment to be set this must be outside `this.app.workspace.onLayoutReady(() => {`
        // // Initialize DRAG/SCROLL rESIZING and apply alignments- when opening into the note or swithing notes 
        // this.registerEvent(
        //     this.app.workspace.on('active-leaf-change', (leaf) => {
        //         console.count("active-leaf-change triggered")
        //         // const markdownView = leaf?.view instanceof MarkdownView ? leaf.view : null;
        //         // if (markdownView && this.imageResizer && this.settings.isImageResizeEnbaled) {
        //         //     this.imageResizer.onload(markdownView);
        //         // }
        //         // // Delay the execution slightly to ensure the new window's DOM is ready
        //         // setTimeout(() => {
        //         //     this.ImageAlignmentManager!.setupImageObserver();
        //         // }, 500);
        //         const currentFile = this.app.workspace.getActiveFile();
        //         if (currentFile) {
        //             // console.log("current file path:", currentFile.path)
        //             void this.ImageAlignmentManager!.applyAlignmentsToNote(currentFile.path);
        //         }
        //     })
        // );


        // Wait for layout to be ready before initializing view-dependent components
        this.app.workspace.onLayoutReady(() => {
            this.initializeComponents();
        
            // Apply Image Alignment and Resizing when switching Live to Reading mode etc.
            if (this.settings.isImageAlignmentEnabled || this.settings.isImageResizeEnbaled) {
                this.registerEvent(
                    this.app.workspace.on('layout-change', () => {
                        if (this.settings.isImageAlignmentEnabled) {
                            const currentFile = this.app.workspace.getActiveFile();
                            if (currentFile) {
                                void this.ImageAlignmentManager?.applyAlignmentsToNote(currentFile.path);
                            }
                        }
                        
                        if (this.settings.isImageResizeEnbaled) {
                            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                            if (activeView) {
                                this.imageResizer?.onLayoutChange(activeView);
                            }
                        }
                    })
                );
            }
        });
    }

    async initializeComponents() {

        // Initialize base components first
        this.variableProcessor = new VariableProcessor(this.app, this.settings);
        this.linkFormatter = new LinkFormatter(this.app);
        this.imageProcessor = new ImageProcessor(this.supportedImageFormats);

        if (this.settings.isImageResizeEnbaled) {
            this.imageResizer = new ImageResizer(this);
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (activeView) {
                this.imageResizer.onload(activeView);
            }
        }

        // Initialize components that depend on others
        this.folderAndFilenameManagement = new FolderAndFilenameManagement(
            this.app,
            this.settings,
            this.supportedImageFormats,
            this.variableProcessor
        );

        this.batchImageProcessor = new BatchImageProcessor(
            this.app,
            this,
            this.imageProcessor,
            this.folderAndFilenameManagement
        );

        // Initialize context menu if enabled
        if (this.settings.enableContextMenu) {
            this.contextMenu = new ContextMenu(
                this.app,
                this,
                this.folderAndFilenameManagement,
                this.variableProcessor
            );
        }

        // REDUNDANT as it is already initialized inside ImageConverterSettings %%Initialize NonDestructiveResizeSettings if needed%%
        // if (!this.settings.nonDestructiveResizeSettings) {
        //     this.settings.nonDestructiveResizeSettings = new NonDestructiveResizeSettings();
        // }

        // Register PASTE/DROP events
        this.dropPaste_registerEvents();

        // Register file menu events
        this.registerEvent(
            this.app.workspace.on("file-menu", (menu, file) => {
                if (file instanceof TFile && this.supportedImageFormats.isSupported(undefined, file.name)) {
                    menu.addItem((item) => {
                        item.setTitle("Process image")
                            .setIcon("cog")
                            .onClick(() => {
                                new ProcessSingleImageModal(this.app, this, file).open();
                            });
                    });
                } else if (file instanceof TFolder) {
                    menu.addItem((item) => {
                        item.setTitle("Process all images in Folder")
                            .setIcon("cog")
                            .onClick(() => {
                                new ProcessFolderModal(this.app, this, file.path, this.batchImageProcessor).open();
                            });
                    });
                } else if (file instanceof TFile && (file.extension === 'md' || file.extension === 'canvas')) {
                    menu.addItem((item) => {
                        item.setTitle(`Process all images in ${file.extension === 'md' ? 'Note' : 'Canvas'}`)
                            .setIcon("cog")
                            .onClick(() => {
                                new ProcessCurrentNote(this.app, this, file, this.batchImageProcessor).open();
                            });
                    });
                }
            })
        );

        // Register commands
        this.addCommand({
            id: 'process-all-vault-images',
            name: 'Process all vault images',
            callback: () => {
                new ProcessAllVaultModal(this.app, this, this.batchImageProcessor).open();
            }
        });

        this.addCommand({
            id: 'process-all-images-current-note',
            name: 'Process all images in current note',
            callback: () => {
                const activeFile = this.app.workspace.getActiveFile();
                if (activeFile) {
                    new ProcessCurrentNote(this.app, this, activeFile, this.batchImageProcessor).open();
                } else {
                    new Notice('Error: No active file found.');
                }
            }
        });

        this.addCommand({
            id: 'open-image-converter-settings',
            name: 'Open Image Converter Settings',
            callback: () => this.command_openSettingsTab()
        });

        this.addReloadCommand();
    }

    async onunload() {
        // Clean up alignment related components first
        if (this.ImageAlignmentManager) {
            this.ImageAlignmentManager.onunload();
            this.ImageAlignmentManager = null;
        }

        // Clean up resizer next since other components might depend on it
        if (this.imageResizer) {
            this.imageResizer.onunload();
            this.imageResizer = null;
        }

        // Clean up UI components
        if (this.contextMenu) {
            this.contextMenu.onunload();
        }

        // Clean up modals
        [
            this.processSingleImageModal,
            this.processFolderModal,
            this.processCurrentNote,
            this.processAllVaultModal
        ].forEach(modal => {
            if (modal?.close) modal.close();
        });

        // Clean up any open modals
        [
            this.processSingleImageModal,
            this.processFolderModal,
            this.processCurrentNote,
            this.processAllVaultModal
        ].forEach(modal => {
            if (modal?.close) modal.close();
        });

    }


    // Load settings method
    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    // Save settings method
    async saveSettings() {
        await this.saveData(this.settings);
    }

    // Command to open settings tab
    async command_openSettingsTab() {
        const setting = (this.app as any).setting;
        if (setting) {
            await setting.open();
            setting.openTabById(this.manifest.id);
        } else {
            new Notice('Unable to open settings. Please check if the settings plugin is enabled.');
        }
    }

    addReloadCommand() {
        this.addCommand({
            id: 'reload-plugin',
            name: 'Reload plugin',
            callback: async () => {
                new Notice('Reloading Image Converter plugin...');

                try {
                    // Use the workaround to access the internal plugins API
                    const plugins = (this.app as any).plugins;

                    // 1. Disable the plugin
                    if (plugins && plugins.disablePlugin) {
                        await plugins.disablePlugin(this.manifest.id);
                    } else {
                        console.error("Plugins API is not accessible.");
                        new Notice('Failed to reload plugin: Plugins API unavailable.');
                        return;
                    }

                    // add some delay as disabling takes some time.
                    await new Promise(resolve => setTimeout(resolve, 500)); // even 100ms would be enough.

                    // 2. Re-enable the plugin
                    if (plugins && plugins.enablePlugin) {
                        await plugins.enablePlugin(this.manifest.id);
                    } else {
                        console.error("Plugins API is not accessible.");
                        new Notice('Failed to reload plugin: Plugins API unavailable.');
                        return;
                    }


                    new Notice('Image Converter plugin reloaded!');
                } catch (error) {
                    console.error("Error reloading plugin:", error);
                    new Notice('Failed to reload plugin. See console for details.');
                }
            },
        });
    }

    private dropPaste_registerEvents() {
        // On mobile DROP events are not supported, but lets still check as a precaution
        if (Platform.isMobile) return;

        // Drop event (Obsidian editor - primary handlers)
        this.registerEvent(
            this.app.workspace.on("editor-drop", async (evt: DragEvent, editor: Editor) => {
                if (!evt.dataTransfer) {
                    console.warn("DataTransfer object is null initially. Cannot process drop event.");
                    return;
                }

                // Get the actual drop position from the mouse event
                const pos = editor.posAtMouse(evt);
                if (!pos) {
                    console.warn("Could not determine drop position");
                    return;
                }

                const fileData: { name: string, type: string, file: File }[] = [];
                for (let i = 0; i < evt.dataTransfer.files.length; i++) {
                    const file = evt.dataTransfer.files[i];
                    fileData.push({ name: file.name, type: file.type, file: file });
                }

                // Check if we should process these files
                const hasSupportedFiles = fileData.some(data =>
                    this.supportedImageFormats.isSupported(data.type, data.name) &&
                    !this.folderAndFilenameManagement.matches_patterns(data.name, this.settings.neverProcessFilenames)
                );

                if (hasSupportedFiles) {
                    evt.preventDefault(); // Prevent default behavior

                    // We don't need setTimeout anymore since we're using the drop position
                    await this.handleDrop(fileData, editor, evt, pos);
                }
            })
        );

        // --- Paste event handler ---
        this.registerEvent(
            this.app.workspace.on("editor-paste", async (evt: ClipboardEvent, editor: Editor) => {
                if (!evt.clipboardData) {
                    console.warn("ClipboardData object is null. Cannot process paste event.");
                    return;
                }

                const cursor = editor.getCursor();

                // Extract Clipboard Item Information
                const itemData: { kind: string, type: string, file: File | null }[] = [];
                for (let i = 0; i < evt.clipboardData.items.length; i++) {
                    const item = evt.clipboardData.items[i];
                    const file = item.kind === "file" ? item.getAsFile() : null;
                    itemData.push({ kind: item.kind, type: item.type, file: file });
                }

                // Check if we should process these items
                const hasSupportedItems = itemData.some(data =>
                    data.kind === "file" &&
                    data.file &&
                    this.supportedImageFormats.isSupported(data.type, data.file.name) &&
                    !this.folderAndFilenameManagement.matches_patterns(data.file.name, this.settings.neverProcessFilenames)
                );

                if (hasSupportedItems) {
                    evt.preventDefault();
                    await this.handlePaste(itemData, editor, cursor);
                }
            })
        );
    }

    private async handleDrop(fileData: { name: string; type: string; file: File }[], editor: Editor, evt: DragEvent, cursor: EditorPosition) {

        // Step 1: Filter Supported Files
        // - Filter the incoming `fileData` to keep only the files that are supported by the plugin (using `isSupported`).
        const supportedFiles = fileData
            .filter(data => {
                // console.log(`Dropped file: ${data.name}, file.type: ${data.type}`);
                return this.supportedImageFormats.isSupported(data.type, data.name)
            })
            .map(data => data.file);

        // Step 2: Check for Active File
        // - Return early if no supported files are found or if there's no active file in the Obsidian workspace.
        if (supportedFiles.length === 0) return;

        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('No active file detected.');
            return;
        }

        // Step 3: Map Files to Processing Promises
        // - Create an array of promises, each responsible for processing one file.
        // - This allows for sequential processing, avoiding concurrency issues.
        const filePromises = supportedFiles.map(async (file) => {
            try {
                // Check modal behavior setting
                const modalBehavior = this.settings.modalBehavior;
                let showModal = modalBehavior === "always";

                if (modalBehavior === "ask") {
                    showModal = await new Promise<boolean>((resolve) => {
                        new ConfirmDialog(
                            this.app,
                            "Show Preset Selection Modal?",
                            "Do you want to select presets for this image?",
                            "Yes",
                            () => resolve(true)
                        ).open();
                    });
                }

                let selectedConversionPreset: ConversionPreset;
                let selectedFilenamePreset: FilenamePreset;
                let selectedFolderPreset: FolderPreset;
                let selectedLinkFormatPreset: LinkFormatPreset;
                let selectedResizePreset: NonDestructiveResizePreset;

                if (showModal) {
                    // Show the modal and wait for user selection
                    ({
                        selectedConversionPreset,
                        selectedFilenamePreset,
                        selectedFolderPreset,
                        selectedLinkFormatPreset,
                        selectedResizePreset
                    } = await new Promise<{
                        selectedConversionPreset: ConversionPreset;
                        selectedFilenamePreset: FilenamePreset;
                        selectedFolderPreset: FolderPreset;
                        selectedLinkFormatPreset: LinkFormatPreset;
                        selectedResizePreset: NonDestructiveResizePreset;
                    }>((resolve) => {
                        new PresetSelectionModal(
                            this.app,
                            this.settings,
                            (conversionPreset, filenamePreset, folderPreset, linkFormatPreset, resizePreset) => {
                                resolve({
                                    selectedConversionPreset: conversionPreset,
                                    selectedFilenamePreset: filenamePreset,
                                    selectedFolderPreset: folderPreset,
                                    selectedLinkFormatPreset: linkFormatPreset,
                                    selectedResizePreset: resizePreset,
                                });
                            },
                            this,
                            this.variableProcessor
                        ).open();
                    }));
                } else {
                    // Use default presets from settings using the generic getter
                    selectedConversionPreset = this.getPresetByName(
                        this.settings.selectedConversionPreset,
                        this.settings.conversionPresets,
                        'Conversion'
                    );

                    selectedFilenamePreset = this.getPresetByName(
                        this.settings.selectedFilenamePreset,
                        this.settings.filenamePresets,
                        'Filename'
                    );

                    selectedFolderPreset = this.getPresetByName(
                        this.settings.selectedFolderPreset,
                        this.settings.folderPresets,
                        'Folder'
                    );

                    selectedLinkFormatPreset = this.getPresetByName(
                        this.settings.linkFormatSettings.selectedLinkFormatPreset,
                        this.settings.linkFormatSettings.linkFormatPresets,
                        'Link Format'
                    );

                    selectedResizePreset = this.getPresetByName(
                        this.settings.nonDestructiveResizeSettings.selectedResizePreset,
                        this.settings.nonDestructiveResizeSettings.resizePresets,
                        'Resize'
                    );
                }

                // Step 3.2: Determine Destination and Filename
                // - Use the `determineDestination` function to calculate the destination path and new filename for the current file.
                let destinationPath: string;
                let newFilename: string;

                try {
                    const result = await this.folderAndFilenameManagement.determineDestination(
                        file,
                        activeFile,
                        selectedConversionPreset,
                        selectedFilenamePreset,
                        selectedFolderPreset
                    );
                    destinationPath = result.destinationPath;
                    newFilename = result.newFilename;
                } catch (error) {
                    console.error("Error determining destination and filename:", error);
                    new Notice(`Failed to determine destination or filename for "${file.name}". Check console for details.`);
                    return; // Resolve this promise (no further processing for this file)
                }

                // Rest of the steps (3.3 to 3.7) remain the same,
                // using selectedConversionPreset and selectedFilenamePreset
                // ...
                // Step 3.3: Create Destination Folder
                // - Create the destination folder if it doesn't exist.
                try {
                    await this.folderAndFilenameManagement.ensureFolderExists(destinationPath);
                } catch (error) {
                    // Ignore "Folder already exists" error, but handle other errors.
                    if (!error.message.startsWith('Folder already exists')) {
                        console.error("Error creating folder:", error);
                        new Notice(`Failed to create folder "${destinationPath}". Check console for details.`);
                        return; // Resolve this promise
                    }
                }

                // Step 3.4: Handle Filename Conflicts
                // - Check if a file with the same name already exists at the destination.
                // - Apply conflict resolution rules based on the selected filename preset (e.g., increment, reuse, or skip).
                const fullPath = `${destinationPath}/${newFilename}`;
                let existingFile = this.app.vault.getAbstractFileByPath(fullPath);
                let skipFurtherProcessing = false;

                if (selectedFilenamePreset && this.folderAndFilenameManagement.should_skip_rename(file.name, selectedFilenamePreset)) {
                    new Notice(
                        `Skipped renaming/conversion of image "${file.name}" due to skip pattern match.`
                    );
                    skipFurtherProcessing = true;
                } else if (selectedFilenamePreset && selectedFilenamePreset.conflictResolution === "increment") {
                    try {
                        newFilename = await this.folderAndFilenameManagement.handleNameConflicts(
                            destinationPath,
                            newFilename,
                            "increment"
                        );
                        existingFile = this.app.vault.getAbstractFileByPath(
                            `${destinationPath}/${newFilename}`
                        );
                    } catch (error) {
                        console.error("Error handling filename conflicts:", error);
                        new Notice(`Error incrementing filename for "${file.name}". Check console for details.`);
                        return; // Resolve this promise
                    }
                }

                const newFullPath = this.folderAndFilenameManagement.combinePath(destinationPath, newFilename);

                // Step 3.5: Process, Reuse, or Skip
                if (!skipFurtherProcessing) {

                    // Step 3.5.1: Reuse Existing File (if applicable)
                    // - If a file exists and the preset is set to "reuse," insert a link to the existing file and skip processing.
                    if (existingFile && selectedFilenamePreset && selectedFilenamePreset.conflictResolution === "reuse") {
                        this.insertLinkAtCursorPosition(editor, existingFile.path, cursor, selectedLinkFormatPreset, selectedResizePreset);
                        return; // Resolve this promise
                    }


                    // Step 3.5.2: Check for Skipped Conversion BEFORE Processing
                    // - Check if the current file matches a skip pattern defined in the selected conversion preset.
                    // - If it matches, skip the image processing step entirely.
                    if (selectedConversionPreset && this.folderAndFilenameManagement.should_skip_conversion(file.name, selectedConversionPreset)) {
                        new Notice(`Skipped conversion of image "${file.name}" due to skip pattern match in the conversion preset.`);


                        // Save the original file directly to the vault without any processing.
                        // const originalSize = file.size;
                        const fileBuffer = await file.arrayBuffer();
                        const tfile = await this.app.vault.createBinary(newFullPath, fileBuffer) as TFile;

                        if (!tfile) {
                            new Notice(`Failed to create file "${newFilename}". Check console for details.`);
                            return; // Resolve this promise
                        }

                        // Insert a link to the newly created (but unprocessed) file.
                        this.insertLinkAtCursorPosition(editor, tfile.path, cursor, selectedLinkFormatPreset, selectedResizePreset);

                    } else {
                        // Step 3.5.3: Process the Image (ONLY if not skipped)
                        // - Call the `processImage` function to perform image conversion based on the selected preset or default settings.
                        try {
                            const originalSize = file.size;  // Store original size
                            this.processedImage = await this.imageProcessor.processImage(
                                file,
                                selectedConversionPreset
                                    ? selectedConversionPreset.outputFormat
                                    : this.settings.outputFormat,
                                selectedConversionPreset
                                    ? selectedConversionPreset.quality / 100
                                    : this.settings.quality / 100,
                                selectedConversionPreset
                                    ? selectedConversionPreset.colorDepth
                                    : this.settings.colorDepth,
                                selectedConversionPreset
                                    ? selectedConversionPreset.resizeMode
                                    : this.settings.resizeMode,
                                selectedConversionPreset
                                    ? selectedConversionPreset.desiredWidth
                                    : this.settings.desiredWidth,
                                selectedConversionPreset
                                    ? selectedConversionPreset.desiredHeight
                                    : this.settings.desiredHeight,
                                selectedConversionPreset
                                    ? selectedConversionPreset.desiredLongestEdge
                                    : this.settings.desiredLongestEdge,
                                selectedConversionPreset
                                    ? selectedConversionPreset.enlargeOrReduce
                                    : this.settings.enlargeOrReduce,
                                selectedConversionPreset
                                    ? selectedConversionPreset.allowLargerFiles
                                    : this.settings.allowLargerFiles,
                                selectedConversionPreset, // Pass preset to ImageProcessor
                                this.settings
                            );


                            let tfile: TFile;

                            // Step 3.5.4: Create the Image File in Vault
                            // - Create the new image file in the Obsidian vault using `createBinary`.
                            // Show space savings notification
                            // Check if processed image is larger than original
                            if (this.settings.revertToOriginalIfLarger && this.processedImage.byteLength > originalSize) {
                                // User wants to revert AND processed image is larger
                                this.showSizeComparisonNotification(originalSize, this.processedImage.byteLength);
                                new Notice(`Using original image for "${file.name}" as processed image is larger.`);

                                const fileBuffer = await file.arrayBuffer();
                                tfile = await this.app.vault.createBinary(newFullPath, fileBuffer) as TFile;
                            } else {
                                // Processed image is smaller OR user doesn't want to revert
                                this.showSizeComparisonNotification(originalSize, this.processedImage.byteLength);
                                tfile = await this.app.vault.createBinary(newFullPath, this.processedImage) as TFile;
                            }

                            // Step 3.5.5: Insert Link into Editor
                            // - Insert the Markdown link to the newly created image file into the editor at the current cursor position.
                            await this.insertLinkAtCursorPosition(editor, tfile.path, cursor, selectedLinkFormatPreset, selectedResizePreset);
                        } catch (error) {
                            // Step 3.5.6: Handle Image Processing Errors
                            // - Catch and display errors that occur during image processing.
                            console.error("Image processing failed:", error);
                            if (error instanceof Error) {
                                if (error.message.includes("File already exists")) {
                                    new Notice(`Failed to process image: File "${newFilename}" already exists.`);
                                } else if (error.message.includes("Invalid input file type")) {
                                    new Notice(`Failed to process image: Invalid input file type for "${file.name}".`);
                                } else {
                                    new Notice(`Failed to process image "${file.name}": ${error.message}. Check console for details.`);
                                }
                            } else {
                                new Notice(`Failed to process image "${file.name}". Check console for details.`);
                            }
                            return; // Resolve this promise
                        } finally {
                            // Clear memory after processing
                            this.clearMemory();
                        }
                    }
                } else {
                    // Step 3.6: Handle Skipped Processing
                    // - If further processing is skipped due to filename conflict resolution, insert a link to an existing file (if applicable).
                    if (existingFile) {
                        this.insertLinkAtCursorPosition(editor, existingFile.path, cursor, selectedLinkFormatPreset, selectedResizePreset);
                    }
                }
            } catch (error) {
                // Step 3.7: Handle Unexpected Errors
                // - Catch and display any other unexpected errors that might occur.
                console.error("An unexpected error occurred:", error);
                new Notice('An unexpected error occurred. Check console for details.');
            }
        });

        // Step 4: Wait for All Promises to Complete
        // - Use `Promise.all` to wait for all the file processing promises to settle (either fulfilled or rejected).
        await Promise.all(filePromises);
    }

    private async handlePaste(itemData: { kind: string; type: string; file: File | null }[], editor: Editor, cursor: EditorPosition) {
        // Step 1: Filter Supported Image Files
        // - Filter the pasted `itemData` to keep only supported image files.
        const supportedFiles = itemData
            .filter(data => data.kind === "file" && data.file &&
                this.supportedImageFormats.isSupported(data.type, data.file.name))
            .map(data => data.file!)
            .filter((file): file is File => file !== null);

        // Step 2: Check for Active File
        // - Return early if no supported files are found or if there's no active file.
        if (supportedFiles.length === 0) return;

        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('No active file found!');
            return;
        }

        // Step 3: Map Files to Processing Promises
        // - Create an array of promises, each responsible for processing one pasted file.
        const filePromises = supportedFiles.map(async (file) => {
            // Check modal behavior setting
            const modalBehavior = this.settings.modalBehavior;
            let showModal = modalBehavior === "always";

            if (modalBehavior === "ask") {
                showModal = await new Promise<boolean>((resolve) => {
                    new ConfirmDialog(
                        this.app,
                        "Show Preset Selection Modal?",
                        "Do you want to select presets for this image?",
                        "Yes",
                        () => resolve(true)
                    ).open();
                });
            }

            let selectedConversionPreset: ConversionPreset;
            let selectedFilenamePreset: FilenamePreset;
            let selectedFolderPreset: FolderPreset;
            let selectedLinkFormatPreset: LinkFormatPreset;
            let selectedResizePreset: NonDestructiveResizePreset;

            if (showModal) {
                // Show the modal and wait for user selection
                ({
                    selectedConversionPreset,
                    selectedFilenamePreset,
                    selectedFolderPreset,
                    selectedLinkFormatPreset,
                    selectedResizePreset
                } = await new Promise<{
                    selectedConversionPreset: ConversionPreset;
                    selectedFilenamePreset: FilenamePreset;
                    selectedFolderPreset: FolderPreset;
                    selectedLinkFormatPreset: LinkFormatPreset;
                    selectedResizePreset: NonDestructiveResizePreset;
                }>((resolve) => {
                    new PresetSelectionModal(
                        this.app,
                        this.settings,
                        (conversionPreset, filenamePreset, folderPreset, linkFormatPreset, resizePreset) => {
                            resolve({
                                selectedConversionPreset: conversionPreset,
                                selectedFilenamePreset: filenamePreset,
                                selectedFolderPreset: folderPreset,
                                selectedLinkFormatPreset: linkFormatPreset,
                                selectedResizePreset: resizePreset,
                            });
                        },
                        this,
                        this.variableProcessor
                    ).open();
                }));
            } else {
                // Use default presets from settings using the generic getter
                selectedConversionPreset = this.getPresetByName(
                    this.settings.selectedConversionPreset,
                    this.settings.conversionPresets,
                    'Conversion'
                );

                selectedFilenamePreset = this.getPresetByName(
                    this.settings.selectedFilenamePreset,
                    this.settings.filenamePresets,
                    'Filename'
                );

                selectedFolderPreset = this.getPresetByName(
                    this.settings.selectedFolderPreset,
                    this.settings.folderPresets,
                    'Folder'
                );

                selectedLinkFormatPreset = this.getPresetByName(
                    this.settings.linkFormatSettings.selectedLinkFormatPreset,
                    this.settings.linkFormatSettings.linkFormatPresets,
                    'Link Format'
                );

                selectedResizePreset = this.getPresetByName(
                    this.settings.nonDestructiveResizeSettings.selectedResizePreset,
                    this.settings.nonDestructiveResizeSettings.resizePresets,
                    'Resize'
                );
            }
            // Step 3.2: Determine Destination and Filename
            // - Calculate the destination path and new filename for the current file.
            try {
                let destinationPath: string;
                let newFilename: string;

                try {
                    const result = await this.folderAndFilenameManagement.determineDestination(
                        file,
                        activeFile,
                        selectedConversionPreset,
                        selectedFilenamePreset,
                        selectedFolderPreset
                    );
                    destinationPath = result.destinationPath;
                    newFilename = result.newFilename;
                } catch (error) {
                    console.error("Error determining destination and filename:", error);
                    new Notice(`Failed to determine destination or filename for "${file.name}". Check console for details.`);
                    return; // Resolve this promise
                }

                // Step 3.3: Create Destination Folder
                // - Create the destination folder if it doesn't exist.
                try {
                    await this.folderAndFilenameManagement.ensureFolderExists(destinationPath);
                } catch (error) {
                    if (!error.message.startsWith('Folder already exists')) {
                        console.error("Error creating folder:", error);
                        new Notice(`Failed to create folder: ${destinationPath}`);
                        return; // Resolve this promise
                    }
                }

                // Step 3.4: Handle Filename Conflicts
                // - Check for filename conflicts and apply conflict resolution rules.
                const fullPath = `${destinationPath}/${newFilename}`;
                let existingFile = this.app.vault.getAbstractFileByPath(fullPath);
                let skipFurtherProcessing = false;

                if (
                    selectedFilenamePreset &&
                    this.folderAndFilenameManagement.should_skip_rename(
                        file.name,
                        selectedFilenamePreset
                    )
                ) {
                    new Notice(
                        `Skipped renaming/conversion of image "${file.name}" due to skip pattern match.`
                    );
                    skipFurtherProcessing = true;
                } else if (
                    selectedFilenamePreset &&
                    selectedFilenamePreset.conflictResolution === "increment"
                ) {
                    try {
                        newFilename = await this.folderAndFilenameManagement.handleNameConflicts(
                            destinationPath,
                            newFilename,
                            "increment"
                        );
                        existingFile = this.app.vault.getAbstractFileByPath(
                            `${destinationPath}/${newFilename}`
                        );
                    } catch (error) {
                        console.error("Error handling filename conflicts:", error);
                        new Notice(`Error incrementing filename for "${file.name}". Check console for details.`);
                        return; // Resolve this promise
                    }
                }

                const newFullPath = this.folderAndFilenameManagement.combinePath(destinationPath, newFilename);

                // Step 3.5: Process, Reuse, or Skip
                if (!skipFurtherProcessing) {
                    // Step 3.5.1: Reuse Existing File (if applicable)
                    // - If the file exists and the preset is set to "reuse," insert a link to the existing file.
                    if (existingFile && selectedFilenamePreset && selectedFilenamePreset.conflictResolution === "reuse") {
                        this.insertLinkAtCursorPosition(editor, existingFile.path, cursor, selectedLinkFormatPreset, selectedResizePreset);
                        return;
                    }

                    // Step 3.5.2: Check for Skipped Conversion BEFORE Processing
                    // - Check if the current file matches a skip pattern in the conversion preset.
                    // - If it matches, skip image processing entirely.
                    if (selectedConversionPreset && this.folderAndFilenameManagement.should_skip_conversion(file.name, selectedConversionPreset)) {
                        new Notice(`Skipped conversion of image "${file.name}" due to skip pattern match in the conversion preset.`);

                        // Save the original file directly to the vault without any processing.
                        // const originalSize = file.size;
                        const fileBuffer = await file.arrayBuffer();
                        const tfile = await this.app.vault.createBinary(newFullPath, fileBuffer) as TFile;

                        if (!tfile) {
                            new Notice(`Failed to create file: ${newFilename}`);
                            return; // Resolve this promise
                        }

                        // Insert a link to the newly created (unprocessed) file.
                        this.insertLinkAtCursorPosition(editor, tfile.path, cursor, selectedLinkFormatPreset, selectedResizePreset);
                    } else {
                        // Step 3.5.3: Process the Image (ONLY if not skipped)
                        // - Process the image using the selected or default settings.
                        try {
                            const originalSize = file.size;
                            this.processedImage = await this.imageProcessor.processImage(
                                file,
                                selectedConversionPreset
                                    ? selectedConversionPreset.outputFormat
                                    : this.settings.outputFormat,
                                selectedConversionPreset
                                    ? selectedConversionPreset.quality / 100
                                    : this.settings.quality / 100,
                                selectedConversionPreset
                                    ? selectedConversionPreset.colorDepth
                                    : this.settings.colorDepth,
                                selectedConversionPreset
                                    ? selectedConversionPreset.resizeMode
                                    : this.settings.resizeMode,
                                selectedConversionPreset
                                    ? selectedConversionPreset.desiredWidth
                                    : this.settings.desiredWidth,
                                selectedConversionPreset
                                    ? selectedConversionPreset.desiredHeight
                                    : this.settings.desiredHeight,
                                selectedConversionPreset
                                    ? selectedConversionPreset.desiredLongestEdge
                                    : this.settings.desiredLongestEdge,
                                selectedConversionPreset
                                    ? selectedConversionPreset.enlargeOrReduce
                                    : this.settings.enlargeOrReduce,
                                selectedConversionPreset
                                    ? selectedConversionPreset.allowLargerFiles
                                    : this.settings.allowLargerFiles,
                                selectedConversionPreset, // Pass preset to ImageProcessor
                                this.settings
                            );

                            let tfile: TFile;
                            // Step 3.5.4: Create the Image File in Vault
                            // - Create the new image file in the Obsidian vault using `createBinary`.
                            // - Show space savings notification
                            // Check if processed image is larger than original
                            if (this.settings.revertToOriginalIfLarger && this.processedImage.byteLength > originalSize) {
                                // User wants to revert AND processed image is larger
                                this.showSizeComparisonNotification(originalSize, this.processedImage.byteLength);
                                new Notice(`Using original image for "${file.name}" as processed image is larger.`);

                                const fileBuffer = await file.arrayBuffer();
                                tfile = await this.app.vault.createBinary(newFullPath, fileBuffer) as TFile;
                            } else {
                                // Processed image is smaller OR user doesn't want to revert
                                this.showSizeComparisonNotification(originalSize, this.processedImage.byteLength);
                                tfile = await this.app.vault.createBinary(newFullPath, this.processedImage) as TFile;
                            }


                            if (!tfile) {
                                new Notice(`Failed to create file "${newFilename}". Check console for details.`);
                                return; // Resolve this promise
                            }

                            // Step 3.5.5: Insert Link into Editor
                            // - Insert the link to the new image into the editor.
                            this.insertLinkAtCursorPosition(editor, tfile.path, cursor, selectedLinkFormatPreset, selectedResizePreset);
                        } catch (error) {
                            // Step 3.5.6: Handle Image Processing Errors
                            // - Handle errors during image processing.
                            console.error("Image processing failed:", error);
                            if (error instanceof Error) {
                                if (error.message.includes("File already exists")) {
                                    new Notice(`Failed to process image: File "${newFilename}" already exists.`);
                                } else if (error.message.includes("Invalid input file type")) {
                                    new Notice(`Failed to process image: Invalid input file type for "${file.name}".`);
                                } else {
                                    new Notice(`Failed to process image "${file.name}": ${error.message}. Check console for details.`);
                                }
                            } else {
                                new Notice(`Failed to process image "${file.name}". Check console for details.`);
                            }
                            return; // Resolve this promise
                        }
                    }
                } else {
                    // Step 3.6: Handle Skipped Processing
                    // - If skipping, insert a link to an existing file or do nothing.
                    if (existingFile) {
                        this.insertLinkAtCursorPosition(editor, existingFile.path, cursor, selectedLinkFormatPreset, selectedResizePreset);
                    }
                }
            } catch (error) {
                // Step 3.7: Handle Unexpected Errors
                console.error("An unexpected error occurred:", error);
                new Notice('An unexpected error occurred. Check console for details.');
            } finally {
                // Clear memory after processing
                this.clearMemory();
            }
        });

        // Step 4: Wait for All Promises to Complete
        // - Wait for all file processing promises to settle.
        await Promise.all(filePromises);
    }

    // Helper function to insert link at the specified cursor position
    private async insertLinkAtCursorPosition(
        editor: Editor,
        linkPath: string,
        cursor: EditorPosition,
        selectedLinkFormatPreset?: LinkFormatPreset,
        selectedResizePreset?: NonDestructiveResizePreset
    ) {

        const activeFile = this.app.workspace.getActiveFile();

        // Use the passed presets or fall back to the plugin settings
        const linkFormatPresetToUse = selectedLinkFormatPreset || this.settings.linkFormatSettings.linkFormatPresets.find(
            (p) => p.name === this.settings.linkFormatSettings.selectedLinkFormatPreset
        );

        const resizePresetToUse = selectedResizePreset || this.settings.nonDestructiveResizeSettings.resizePresets.find(
            (p) => p.name === this.settings.nonDestructiveResizeSettings.selectedResizePreset
        );

        // Await the result of formatLink
        const formattedLink = await this.linkFormatter.formatLink(
            linkPath, // Pass the original linkPath
            linkFormatPresetToUse?.linkFormat || "wikilink",
            linkFormatPresetToUse?.pathFormat || "shortest",
            activeFile,
            resizePresetToUse // Now using the selected resize preset
        );


        // ----- FRONT or BACK ---------
        // Insert the link at the saved cursor position
        // - FRONT:Keeps the cursor at the front by default (by doing nothing) when cursorLocation is "front"
        editor.replaceRange(formattedLink, cursor);

        // Use positive check for "back"
        // - We have to be carefull not to place it to the back 2 times.
        if (this.settings.dropPasteCursorLocation === "back") {
            editor.setCursor({
                line: cursor.line,
                ch: cursor.ch + formattedLink.length,
            });
        }
    }

    private formatFileSize(bytes: number): string {
        if (bytes < 1024) {
            return `${bytes} bytes`;
        } else if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(1)} KB`;
        } else {
            return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        }
    }

    private showSizeComparisonNotification(originalSize: number, newSize: number) {
        if (!this.settings.showSpaceSavedNotification) return;

        const originalSizeFormatted = this.formatFileSize(originalSize);
        const newSizeFormatted = this.formatFileSize(newSize);

        const percentChange = ((newSize - originalSize) / originalSize * 100).toFixed(1);
        const changeSymbol = newSize > originalSize ? '+' : '';

        const message = `${originalSizeFormatted} → ${newSizeFormatted} (${changeSymbol}${percentChange}%)`;
        new Notice(message);
    }

    getPresetByName<T extends { name: string }>(
        presetName: string,
        presetArray: T[],
        presetType: string
    ): T {
        const preset = presetArray.find(p => p.name === presetName);
        if (!preset) {
            console.warn(`${presetType} preset "${presetName}" not found, using default`);
            return presetArray[0];
        }
        return preset;
    }

    private clearMemory() {
        // Clear the processed image buffer
        if (this.processedImage) {
            this.processedImage = null;
        }

        // Following might be pointless, but lets do it still  - clear any ArrayBuffers or Blobs in memory
        if (this.temporaryBuffers) {
            this.temporaryBuffers.forEach(buffer => {
                buffer = null;
            });
            this.temporaryBuffers = [];
        }
    }
}
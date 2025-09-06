// BatchImageProcessor.ts
import { App, TFile, TFolder, Notice } from 'obsidian';
import ImageConverterPlugin from './main';
import {
    ResizeMode,
    EnlargeReduce,
    ImageProcessor,
} from './ImageProcessor';
import { FolderAndFilenameManagement } from "./FolderAndFilenameManagement";


export class BatchImageProcessor {
    constructor(
        private app: App,
        private plugin: ImageConverterPlugin,
        private imageProcessor: ImageProcessor,
        private folderAndFilenameManagement: FolderAndFilenameManagement
    ) { }
    
    async processImagesInNote(noteFile: TFile): Promise<void> {

        try {
            const {
                ProcessCurrentNoteconvertTo: convertTo,
                ProcessCurrentNotequality: quality,
                ProcessCurrentNoteResizeModalresizeMode: resizeMode,
                ProcessCurrentNoteresizeModaldesiredWidth: desiredWidth,
                ProcessCurrentNoteresizeModaldesiredHeight: desiredHeight,
                ProcessCurrentNoteresizeModaldesiredLength: desiredLength,
                ProcessCurrentNoteEnlargeOrReduce: enlargeOrReduce,
                allowLargerFiles,
                ProcessCurrentNoteSkipFormats: processCurrentNoteSkipFormats,
                ProcessCurrentNoteskipImagesInTargetFormat: processCurrentNoteSkipImagesInTargetFormat
            } = this.plugin.settings;

            const isKeepOriginalFormat = convertTo === 'disabled';
            const noCompression = quality === 1;
            const noResize = resizeMode === 'None';
            const targetFormat = convertTo;
            const outputFormat = convertTo === 'disabled' ? 'ORIGINAL' : convertTo.toUpperCase() as 'WEBP' | 'JPEG' | 'PNG' | 'ORIGINAL';
            const colorDepth = 1; // Assuming full color depth for now, adjust if needed

            // Parse skip formats
            const skipFormats = processCurrentNoteSkipFormats
                .toLowerCase()
                .split(',')
                .map(format => format.trim())
                .filter(format => format.length > 0);

            // Get all image files in the note
            let linkedFiles: TFile[] = [];

            if (noteFile.extension === 'canvas') {
                // Handle canvas file
                linkedFiles = await this.getImageFilesFromCanvas(noteFile);
            } else {
                // Handle markdown file
                linkedFiles = this.getLinkedImageFiles(noteFile);
            }

            // If no images found at all
            if (linkedFiles.length === 0) {
                new Notice('No images found in the note.');
                return;
            }

            // Check if all images are either in target format or in skip list
            const allImagesSkippable = linkedFiles.every(file =>
                (file.extension === (isKeepOriginalFormat ? file.extension : targetFormat)) ||
                skipFormats.includes(file.extension.toLowerCase())
            );

            // Early return with appropriate message if no processing is needed
            if (allImagesSkippable && noCompression && noResize) {
                if (isKeepOriginalFormat) {
                    new Notice('No processing needed: All images are either in skip list or kept in original format with no compression or resizing.');
                } else {
                    new Notice(`No processing needed: All images are either in skip list or already in ${targetFormat.toUpperCase()} format with no compression or resizing.`);
                }
                return;
            }

            // Early return if no processing is needed
            if (isKeepOriginalFormat && noCompression && noResize) {
                new Notice('No processing needed: Original format selected with no compression or resizing.');
                return;
            }

            // Filter files that actually need processing
            const filesToProcess = linkedFiles.filter(file =>
                this.shouldProcessImage(file, isKeepOriginalFormat, targetFormat, skipFormats, processCurrentNoteSkipImagesInTargetFormat)
            );

            if (filesToProcess.length === 0) {
                if (processCurrentNoteSkipImagesInTargetFormat) {
                    new Notice(`No processing needed: All images are already in ${isKeepOriginalFormat ? 'their original' : targetFormat.toUpperCase()} format.`);
                } else {
                    new Notice('No images found that need processing.');
                }
                return;
            }

            let imageCount = 0;
            const statusBarItemEl = this.plugin.addStatusBarItem();
            const startTime = Date.now();

            const totalImages = filesToProcess.length;

            for (const linkedFile of filesToProcess) {
                imageCount++;

                const imageData = await this.app.vault.readBinary(linkedFile);
                const imageBlob = new Blob([imageData], { type: `image/${linkedFile.extension}` });

                const processedImageData = await this.imageProcessor.processImage(
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

                // Construct the new file path based on conversion settings
                const newFileName = `${linkedFile.basename}.${outputFormat.toLowerCase()}`;
                const newFilePath = linkedFile.path.replace(linkedFile.name, newFileName);

                // Rename the file (async operation, should be awaited)
                if (linkedFile.path !== newFilePath) {
                    await this.app.fileManager.renameFile(linkedFile, newFilePath);
                }

                // Get the renamed file using the new path
                const renamedFile = this.app.vault.getAbstractFileByPath(newFilePath) as TFile;

                if (!renamedFile) {
                    console.error('Failed to find renamed file:', newFilePath);
                    continue; // Skip to the next file if the rename failed
                }

                // Modify the file content with processed image data
                await this.app.vault.modifyBinary(renamedFile, processedImageData);

                // Update links only if the file was renamed
                if (linkedFile.path !== newFilePath) {
                    await this.updateLinksInNote(noteFile, linkedFile.path, newFilePath);
                }

                const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
                statusBarItemEl.setText(
                    `Processing image ${imageCount} of ${totalImages}, elapsed time: ${elapsedTime} seconds`
                );
            }

            const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
            statusBarItemEl.setText(`Finished processing ${imageCount} images, total time: ${totalTime} seconds`);
            window.setTimeout(() => {
                statusBarItemEl.remove();
            }, 5000);

        } catch (error) {
            console.error('Error processing images in current note:', error);
            new Notice(`Error processing images: ${error.message}`);
        }
    }



    private async getImageFilesFromCanvas(canvasFile: TFile): Promise<TFile[]> {
        const canvasContent = await this.app.vault.read(canvasFile);
        const canvasData = JSON.parse(canvasContent);
        const linkedFiles: TFile[] = [];

        const getImagesFromNodes = (nodes: any[]): void => {
            for (const node of nodes) {
                if (node.type === 'file' && node.file) {
                    const file = this.app.vault.getAbstractFileByPath(node.file);
                    if (file instanceof TFile && this.plugin.supportedImageFormats.isSupported(undefined, file.name)) {
                        linkedFiles.push(file);
                    }
                }
                if (node.children && Array.isArray(node.children)) {
                    getImagesFromNodes(node.children);
                }
            }
        };

        if (canvasData.nodes && Array.isArray(canvasData.nodes)) {
            getImagesFromNodes(canvasData.nodes);
        }

        return linkedFiles;
    }

    private getLinkedImageFiles(noteFile: TFile): TFile[] {
        const { resolvedLinks } = this.app.metadataCache;
        const linksInCurrentNote = resolvedLinks[noteFile.path];

        return Object.keys(linksInCurrentNote)
            .map(link => this.app.vault.getAbstractFileByPath(link))
            .filter((file): file is TFile => file instanceof TFile && this.plugin.supportedImageFormats.isSupported(undefined, file.name));
    }


    async processImagesInFolder(folderPath: string, recursive: boolean): Promise<void> {
        // ... (logic from old processFolderImages, updated to use imageProcessor.processImage)
        try {
            const folder = this.app.vault.getAbstractFileByPath(folderPath);
            if (!(folder instanceof TFolder)) {
                new Notice('Error: Invalid folder path.');
                return;
            }

            // Get settings from the modal
            const {
                ProcessCurrentNoteconvertTo: convertTo,
                ProcessCurrentNotequality: quality,
                ProcessCurrentNoteResizeModalresizeMode: resizeMode,
                ProcessCurrentNoteresizeModaldesiredWidth: desiredWidth,
                ProcessCurrentNoteresizeModaldesiredHeight: desiredHeight,
                ProcessCurrentNoteresizeModaldesiredLength: desiredLength,
                ProcessCurrentNoteEnlargeOrReduce: enlargeOrReduce,
                allowLargerFiles,
                ProcessCurrentNoteSkipFormats: processCurrentNoteSkipFormats,
            } = this.plugin.settings;

            const outputFormat = convertTo === 'disabled' ? 'ORIGINAL' : convertTo.toUpperCase() as 'WEBP' | 'JPEG' | 'PNG' | 'ORIGINAL';
            const colorDepth = 1; // Assuming full color depth for now, adjust if needed

            const skipFormats = processCurrentNoteSkipFormats
                .toLowerCase()
                .split(',')
                .map(format => format.trim())
                .filter(format => format.length > 0);

            const images = this.getImageFiles(folder, recursive);
            if (images.length === 0) {
                new Notice('No images found in the folder.');
                return;
            }

            let imageCount = 0;
            const statusBarItemEl = this.plugin.addStatusBarItem();
            const startTime = Date.now();
            const totalImages = images.length;

            for (const image of images) {
                // Skip image if its format is in the skipFormats list
                if (skipFormats.includes(image.extension.toLowerCase())) {
                    console.log(`Skipping image ${image.name} (format in skip list)`);
                    continue; // Skip to the next image
                }

                imageCount++;

                // Construct the new file path based on conversion settings
                const newFileName = `${image.basename}.${outputFormat.toLowerCase()}`;
                const newFilePath = image.path.replace(image.name, newFileName);

                const imageData = await this.app.vault.readBinary(image);
                const imageBlob = new Blob([imageData], { type: `image/${image.extension}` });

                const processedImageData = await this.imageProcessor.processImage(
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

                // Rename the file if the format has changed
                if (image.path !== newFilePath) {
                    await this.app.fileManager.renameFile(image, newFilePath);
                }

                // Get the renamed file using the new path
                const renamedFile = this.app.vault.getAbstractFileByPath(newFilePath) as TFile;

                if (!renamedFile) {
                    console.error('Failed to find renamed file:', newFilePath);
                    continue; // Skip to the next file if the rename failed
                }

                // Modify the file content with processed image data
                await this.app.vault.modifyBinary(renamedFile, processedImageData);

                // No need to update links in notes when processing a whole folder, right?
                // If you do, you would need to iterate over all notes and call updateLinksInNote()

                const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
                statusBarItemEl.setText(
                    `Processing image ${imageCount} of ${totalImages}, elapsed time: ${elapsedTime} seconds`
                );
            }

            const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
            statusBarItemEl.setText(`Finished processing ${imageCount} images, total time: ${totalTime} seconds`);
            window.setTimeout(() => {
                statusBarItemEl.remove();
            }, 5000);

        } catch (error) {
            console.error('Error processing images in folder:', error);
            new Notice(`Error processing images: ${error.message}`);
        }
    }

    // Add helper methods like getImageFiles, shouldProcessImage, etc. (update accordingly)
    private getImageFiles(folder: TFolder, recursive: boolean): TFile[] {
        let images: TFile[] = [];
        folder.children.forEach(child => {
            if (child instanceof TFile && this.plugin.supportedImageFormats.isSupported(undefined, child.name)) {
                images.push(child);
            } else if (recursive && child instanceof TFolder) {
                images = images.concat(this.getImageFiles(child, recursive));
            }
        });
        return images;
    }



    async processAllVaultImages(): Promise<void> {
        try {
            const {
                ProcessAllVaultconvertTo: convertTo,
                ProcessAllVaultquality: quality,
                ProcessAllVaultResizeModalresizeMode: resizeMode,
                ProcessAllVaultResizeModaldesiredWidth: desiredWidth,
                ProcessAllVaultResizeModaldesiredHeight: desiredHeight,
                ProcessAllVaultResizeModaldesiredLength: desiredLength,
                ProcessAllVaultEnlargeOrReduce: enlargeOrReduce,
                allowLargerFiles,
                ProcessAllVaultSkipFormats: skipFormatsSetting,
                ProcessAllVaultskipImagesInTargetFormat: skipTargetFormat,
            } = this.plugin.settings;

            const isKeepOriginalFormat = convertTo === 'disabled';
            const noCompression = quality === 1;
            const noResize = resizeMode === 'None';
            const targetFormat = convertTo;

            const outputFormat =
                convertTo === "disabled"
                    ? "ORIGINAL"
                    : (convertTo.toUpperCase() as "WEBP" | "JPEG" | "PNG" | "ORIGINAL");
            const colorDepth = 1;

            const skipFormats = skipFormatsSetting
                .toLowerCase()
                .split(",")
                .map((format) => format.trim())
                .filter((format) => format.length > 0);

            const imageFiles = await this.getAllImageFiles();

            // If no images found at all
            if (imageFiles.length === 0) {
                new Notice('No images found in the vault.');
                return;
            }

            // Check if all images are either in target format or in skip list
            const allImagesSkippable = imageFiles.every(file =>
                (file.extension === (isKeepOriginalFormat ? file.extension : targetFormat)) ||
                skipFormats.includes(file.extension.toLowerCase())
            );

            // Early return with appropriate message if no processing is needed
            if (allImagesSkippable && noCompression && noResize) {
                if (isKeepOriginalFormat) {
                    new Notice('No processing needed: All vault images are either in skip list or kept in original format with no compression or resizing.');
                } else {
                    new Notice(`No processing needed: All vault images are either in skip list or already in ${targetFormat.toUpperCase()} format with no compression or resizing.`);
                }
                return;
            }

            // Filter files that actually need processing
            const filesToProcess = imageFiles.filter(file =>
                this.shouldProcessImage(file, isKeepOriginalFormat, targetFormat, skipFormats, skipTargetFormat)
            );

            if (filesToProcess.length === 0) {
                if (skipTargetFormat) {
                    new Notice(`No processing needed: All vault images are either in ${isKeepOriginalFormat ? 'their original' : targetFormat.toUpperCase()} format or in skip list.`);
                } else {
                    new Notice('No images found that need processing.');
                }
                return;
            }

            let imageCount = 0;
            const statusBarItemEl = this.plugin.addStatusBarItem();
            const startTime = Date.now();
            const totalImages = filesToProcess.length;

            for (const image of filesToProcess) {

                imageCount++;

                const imageData = await this.app.vault.readBinary(image);
                const imageBlob = new Blob([imageData], {
                    type: `image/${image.extension}`,
                });

                const processedImageData =
                    await this.imageProcessor.processImage(
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

                // Construct the new file path based on conversion settings
                const newFileName = `${image.basename}.${outputFormat.toLowerCase()}`;
                let newFilePath = image.path.replace(image.name, newFileName);

                // Check for conflicts and generate unique name if necessary using FolderAndFilenameManagement
                if (
                    image.path !== newFilePath &&
                    this.app.vault.getAbstractFileByPath(newFilePath)
                ) {
                    newFilePath =
                        await this.folderAndFilenameManagement.handleNameConflicts(
                            image.parent?.path || "",
                    newFileName
                );
                }

                // Rename the file if the format has changed
                if (image.path !== newFilePath) {
                    await this.app.fileManager.renameFile(image, newFilePath);
                }

                // Get the renamed file using the new path
                const renamedFile = this.app.vault.getAbstractFileByPath(
                    newFilePath
                ) as TFile;

                if (!renamedFile) {
                    console.error(
                        "Failed to find renamed file:",
                        newFilePath
                    );
                    continue; // Skip to the next file if the rename failed
                }

                // Modify the file content with processed image data
                await this.app.vault.modifyBinary(
                    renamedFile,
                    processedImageData
                );

                // Update links in all notes to point to the renamed file
                await this.updateLinksInAllNotes(image.path, newFilePath);

                const elapsedTime = (
                    (Date.now() - startTime) /
                    1000
                ).toFixed(2);
                statusBarItemEl.setText(
                    `Processing image ${imageCount} of ${totalImages}, elapsed time: ${elapsedTime} seconds`
                );
            }

            const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
            statusBarItemEl.setText(
                `Finished processing ${imageCount} images, total time: ${totalTime} seconds`
            );
            window.setTimeout(() => {
                statusBarItemEl.remove();
            }, 5000);
        } catch (error) {
            console.error("Error processing images:", error);
            new Notice(`Error processing images: ${error.message}`);
        }
    }

    // Add helper methods like getAllImageFiles, shouldProcessImage, etc. (update accordingly)
    async getAllImageFiles(): Promise<TFile[]> {
        const allFiles = this.app.vault.getFiles();
        const imageFiles = allFiles.filter(file =>
            this.plugin.supportedImageFormats.isSupported(undefined, file.name)
        );

        // Get images from canvas files
        const canvasFiles = allFiles.filter(file =>
            file instanceof TFile &&
            file.extension === 'canvas'
        );

        // Process canvas files and collect image paths
        for (const canvasFile of canvasFiles) {
            const canvasImages = await this.getImagesFromCanvas(canvasFile);
            for (const imagePath of canvasImages) {
                const imageFile = this.app.vault.getAbstractFileByPath(imagePath);
                if (imageFile instanceof TFile && this.plugin.supportedImageFormats.isSupported(undefined, imageFile.name)) {
                    if (!imageFiles.find(existing => existing.path === imageFile.path)) {
                        imageFiles.push(imageFile);
                    }
                }
            }
        }

        return imageFiles;
    }

    async getImagesFromCanvas(file: TFile): Promise<string[]> {
        const images: string[] = [];
        const content = await this.app.vault.read(file);
        const canvasData = JSON.parse(content);

        if (canvasData.nodes && Array.isArray(canvasData.nodes)) {
            for (const node of canvasData.nodes) {
                if (node.type === "file" && node.file) {
                    images.push(node.file);
                }
            }
        }

        return images;
    }

    shouldProcessImage(image: TFile, isKeepOriginalFormat: boolean, targetFormat: string, skipFormats: string[], skipImagesInTargetFormat: boolean): boolean {
        const effectiveTargetFormat = isKeepOriginalFormat
            ? image.extension
            : targetFormat;

        // Skip files with extensions in the skip list
        if (skipFormats.includes(image.extension.toLowerCase())) {
            console.log(`Skipping ${image.name}: Format ${image.extension} is in skip list`);
            return false;
        }

        // Skip images already in target format (or original format if disabled)
        if (skipImagesInTargetFormat &&
            image.extension === effectiveTargetFormat) {
            console.log(`Skipping ${image.name}: Already in ${effectiveTargetFormat} format`);
            return false;
        }

        return true;
    }

    async updateLinksInAllNotes(
        oldPath: string,
        newPath: string
    ): Promise<void> {
        const allMarkdownFiles = this.app.vault.getMarkdownFiles();
        for (const note of allMarkdownFiles) {
            await this.updateLinksInNote(note, oldPath, newPath);
        }

        // Update links in canvas files as well
        const canvasFiles = this.app.vault
            .getFiles()
            .filter((file) => file.extension === "canvas");
        for (const canvasFile of canvasFiles) {
            await this.updateCanvasFileLinks(canvasFile, oldPath, newPath);
        }
    }

    async updateLinksInNote(
        noteFile: TFile,
        oldPath: string,
        newPath: string
    ): Promise<void> {
        const oldLinkText = this.escapeRegexCharacters(oldPath);
        const newLinkText = this.escapeRegexCharacters(newPath);

        const content = await this.app.vault.read(noteFile);
        const newContent = content.replace(
            new RegExp(oldLinkText, "g"),
            newLinkText
        );

        if (content !== newContent) {
            await this.app.vault.modify(noteFile, newContent);
            console.log(`Links updated in ${noteFile.path}`);
        }
    }

    private escapeRegexCharacters(text: string): string {
        return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    async updateCanvasFileLinks(
        canvasFile: TFile,
        oldPath: string,
        newPath: string
    ) {
            try {
                const content = await this.app.vault.read(canvasFile);
                const canvasData = JSON.parse(content);
    
                const updateNodePaths = (nodes: any[]) => {
                    for (const node of nodes) {
                        if (node.type === 'file' && node.file === oldPath) {
                            node.file = newPath;
                        }
                        if (node.children && Array.isArray(node.children)) {
                            updateNodePaths(node.children);
                        }
                    }
                };
    
                if (canvasData.nodes && Array.isArray(canvasData.nodes)) {
                    updateNodePaths(canvasData.nodes);
                    await this.app.vault.modify(canvasFile, JSON.stringify(canvasData, null, 2));
                }
            } catch (error) {
                console.error('Error updating canvas file links:', error);
            }
        }

    // private async updateMarkdownLinks(noteFile: TFile, oldPath: string, newPath: string): Promise<void> {
    //     const oldLinkText = this.escapeRegexCharacters(oldPath);
    //     const newLinkText = this.escapeRegexCharacters(newPath);

    //     const content = await this.app.vault.read(noteFile);
    //     const newContent = content.replace(new RegExp(oldLinkText, 'g'), newLinkText);

    //     if (content !== newContent) {
    //         await this.app.vault.modify(noteFile, newContent);
    //         console.log(`Links updated in ${noteFile.path}`);
    //     }
    // }

    // private async updateCanvasLinks(canvasFile: TFile, oldPath: string, newPath: string): Promise<void> {
    //     try {
    //         const content = await this.app.vault.read(canvasFile);
    //         const canvasData = JSON.parse(content);

    //         let changesMade = false;
    //         for (const node of canvasData.nodes) {
    //             if (node.type === 'file' && node.file === oldPath) {
    //                 node.file = newPath;
    //                 changesMade = true;
    //             }
    //         }

    //         if (changesMade) {
    //             await this.app.vault.modify(canvasFile, JSON.stringify(canvasData, null, 2));
    //             console.log(`Links updated in canvas file ${canvasFile.path}`);
    //         }
    //     } catch (error) {
    //         console.error('Error updating canvas file links:', error);
    //     }
    // }
}
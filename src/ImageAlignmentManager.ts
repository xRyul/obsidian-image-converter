import { App, Notice, TFile, EventRef, FileSystemAdapter, debounce, Debouncer } from 'obsidian';
import { ImageAlignment, ImageAlignmentOptions } from './ImageAlignment';
import { AsyncLock } from './AsyncLock';
import ImageConverterPlugin from './main';
import { SupportedImageFormats } from './SupportedImageFormats';
import { ImageResizer } from './ImageResizer';

export interface ImagePositionData {
    position: 'left' | 'center' | 'right' | 'none';
    width?: string;
    height?: string;
    wrap: boolean;
}

export interface ImageAlignmentCache {
    [notePath: string]: {
        [imageHash: string]: ImagePositionData
    }
}

export class ImageAlignmentManager {
    private app: App;
    private plugin: ImageConverterPlugin;
    private supportedImageFormats: SupportedImageFormats;
    private imageResizer: ImageResizer;

    cache: ImageAlignmentCache = {};
    private imageObserver: MutationObserver | null = null;
    public lock = new AsyncLock();
    private imageAlignment: ImageAlignment; // Instance of the new class
    private imageStates: Map<string, ImageAlignmentOptions> = new Map();

    // BE cautions of using DOT files. Obsidian Sync will not sync dot files.
    // private readonly CACHE_FILE = '.obsidian/image-converter-image-alignments.json';
    private cacheFilePath: string;
    private pluginDir: string;

    // Array to store event references
    private eventRefs: EventRef[] = [];
    private cleanupIntervalId: number | null = null;
    private debouncedValidateNoteCache: Debouncer<[notePath: string, noteContent: string], Promise<void>>;
    
    constructor(plugin: ImageConverterPlugin, supportedImageFormats: SupportedImageFormats, imageResizer: ImageResizer) {
        this.app = plugin.app;
        this.plugin = plugin;
        this.pluginDir = this.getPluginDir();
        this.updateCacheFilePath();

        this.imageAlignment = new ImageAlignment(this.plugin, this);
        this.supportedImageFormats = supportedImageFormats;
        this.imageResizer = imageResizer;

        this.debouncedValidateNoteCache = debounce(
            this.validateNoteCache.bind(this),
            300, 
            true 
        ) as Debouncer<[notePath: string, noteContent: string], Promise<void>>;
    }

    public async initialize() {
        // console.log("Initializing")
        await this.loadCache();
        this.registerEvents();
        this.setupImageObserver(); // STILL needed for managing images inside callouts etc
        this.scheduleCacheCleanup();
    }


    public updateCacheFilePath() {
        const cacheLocation = this.plugin.settings.imageAlignment_cacheLocation;
        if (cacheLocation === ".obsidian") {
            this.cacheFilePath = ".obsidian/image-converter-image-alignments.json";
        } else {
            // It has to be "plugin" now
            this.cacheFilePath = `${this.pluginDir}/image-converter-image-alignments.json`;
        }
    }
    
    private getPluginDir(): string {
        const pluginMainFile = (this.plugin as any).manifest.dir;
        if (!pluginMainFile) {
            console.error('Could not determine plugin directory');
            return '';
        }
        return pluginMainFile;
    }

    public getCache(): ImageAlignmentCache {
        return this.cache;
    }

    public async loadCache() {
        try {
            const adapter = this.app.vault.adapter;
            // OPTION 1. Keep it in plugins folder, but Obsidian Sync will not sync it so alignment wont work on all devices
            // const cachePath = `${this.pluginDir}/${this.CACHE_FILE}`;
            // Option 2. Keep it in the .obsidian e.g. '.obsidian/image-converter-image-alignments.json';
            // Use this.cacheFilePath instead of the hardcoded path
            if (await adapter.exists(this.cacheFilePath)) {
                const data = await adapter.read(this.cacheFilePath);
                this.cache = JSON.parse(data);
            }
        } catch (error) {
            console.error('Error loading image alignment cache:', error);
            this.cache = {};
        }
    }

    public async saveCache() {
        try {
            if (!this.pluginDir) {
                console.error('Plugin directory not found');
                return;
            }

            const adapter = this.app.vault.adapter;
            // OPTION 1. Keep it in plugins folder, but Obsidian Sync will not sync it so alignment wont work on all devices
            // const cachePath = `${this.pluginDir}/${this.CACHE_FILE}`;
            // Option 2. Keep it in the .obsidian e.g. '.obsidian/image-converter-image-alignments.json';
            await adapter.write(
                this.cacheFilePath,
                JSON.stringify(this.cache, null, 2)
            );
        } catch (error) {
            console.error('Error saving image alignment cache:', error);
        }
    }




    private registerEvents() {
        // console.log("Registering events")
        this.eventRefs.push(
            this.app.workspace.on("window-open", (newWindow, leaf) => {
                // Delay the execution slightly to ensure the new window's DOM is ready
                setTimeout(() => {
                    this.setupImageObserver();
                }, 500);
                const currentFile = this.app.workspace.getActiveFile();
                
                if (currentFile) {
                    // console.log("current file path:", currentFile.path)
                    void this.applyAlignmentsToNote(currentFile.path);
                }
            })
        );

        this.eventRefs.push(
            this.app.workspace.on('layout-change', () => {
                // Trigger a full re-application of alignments for the current note
                const currentFile = this.app.workspace.getActiveFile();
                if (currentFile) {
                    // console.log("current file path:", currentFile.path)
                    void this.applyAlignmentsToNote(currentFile.path);
                }
            })
        );

        this.eventRefs.push(
            this.app.vault.on('delete', async (file) => {
                if (file instanceof TFile) {
                    if (file.extension === 'md') {
                        await this.removeNoteFromCache(file.path);
                    } else if (this.supportedImageFormats.isSupported(undefined, file.name)) {
                        const allNotes = Object.keys(this.getCache());
                        for (const notePath of allNotes) {
                            // Get hash for the deleted image in the context of each note
                            const imageHash = this.getImageHash(notePath, file.path);
                            await this.removeImageFromCache(notePath, imageHash); // Pass hash instead of path
                        }
                    }

                    // Targeted validation after a file is deleted
                    const activeFile = this.app.workspace.getActiveFile();
                    if (activeFile && activeFile.extension === 'md') {
                        const content = await this.app.vault.cachedRead(activeFile);
                        this.validateNoteCache(activeFile.path, content);
                    }
                }
            })
        );

        this.eventRefs.push(
            this.app.vault.on('rename', async (file, oldPath) => {
                if (file instanceof TFile) {
                    if (file.extension === 'md') {
                        // Renaming a note (this part is fine)
                        if (this.cache[oldPath]) {
                            this.cache[file.path] = this.cache[oldPath];
                            delete this.cache[oldPath];
                            await this.saveCache();
                        }
                    } else if (this.supportedImageFormats.isSupported(undefined, file.name)) {
                        // Renaming an image
                        const allNotes = Object.keys(this.cache);
                        for (const notePath of allNotes) {
                            const oldImageHash = this.getImageHash(notePath, oldPath);
                            const newImageHash = this.getImageHash(notePath, file.path);

                            if (this.cache[notePath][oldImageHash]) {
                                this.cache[notePath][newImageHash] = this.cache[notePath][oldImageHash];
                                delete this.cache[notePath][oldImageHash];
                            }
                        }
                        await this.saveCache();
                    }

                    // Targeted validation after a file is renamed
                    const activeFile = this.app.workspace.getActiveFile();
                    if (activeFile && activeFile.extension === 'md') {
                        const content = await this.app.vault.cachedRead(activeFile);
                        this.validateNoteCache(activeFile.path, content);
                    }
                }
            })
        );

        // ----------------- THIS IS TOO EXPENSIVE TO RUN - AND WAS ONLY NEEDED to track ink removal which is anyway handled by cache cleanup
        // this.eventRefs.push(
        //     this.app.vault.on('modify', async (file) => {
        //         if (file instanceof TFile && file.extension === 'md') {
        //             console.count("Modifying")
        //             const content = await this.app.vault.cachedRead(file); // Use cachedRead
        //             this.debouncedValidateNoteCache(file.path, content); // Use debounced version
        //         }
        //     })
        // );
    }

    private setupImageObserver() {
        if (this.imageObserver) {
            this.imageObserver.disconnect();
        }

        const processImage = (img: HTMLImageElement) => {
            // Skip if resizing is in progress using imageResizer's resizeState
            if (this.imageResizer.resizeState.isResizing ||
                this.imageResizer.resizeState.isDragging ||
                this.imageResizer.resizeState.isScrolling ||
                img.hasAttribute('data-resize-edge') ||
                img.hasAttribute('data-resize-active') ||
                img.hasClass('image-converter-aligned')) {
                return;
            }

            const src = img.getAttr('src');
            if (!src) return;

            const relativeSrc = this.getRelativePath(src); // Normalize the src

            const currentFile = this.app.workspace.getActiveFile();
            if (!currentFile) return;

            // Use getImageHash function which includes the note path
            const imageHash = this.getImageHash(currentFile.path, relativeSrc);
            // console.log("Image hash inside observer:", imageHash)
            const alignments = this.cache[currentFile.path];
            if (!alignments) return;

            const positionData = alignments[imageHash];
            if (positionData) {
                this.imageAlignment.applyAlignmentToImage(img, positionData);
            }
        };

        this.imageObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        if (node instanceof HTMLImageElement) {
                            processImage(node);
                        } else if (node instanceof Element) {
                            node.findAll('img').forEach((img) =>
                                processImage(img as HTMLImageElement)
                            );
                        }
                    });
                }
            });
        });

        this.imageObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src', 'class']
        });
    }


    public async saveImageAlignmentToCache(
        notePath: string,
        imageSrc: string,
        position: "left" | "center" | "right" | "none",
        width?: string,
        height?: string,
        wrap = false
    ) {
        try {
            await this.lock.acquire("cacheOperation", async () => {

                 // Skip cache updates during active scrolling
                // if (this.imageResizer.resizeState.isScrolling) {
                //     return;
                // }

                // Normalize imageSrc to a relative path
                const relativeImageSrc = this.getRelativePath(imageSrc);
    
                // console.log("saveImageAlignmentToCache DETAILS:");
                // console.log("- Note Path:", notePath);
                // console.log("- Original Image Src:", imageSrc);
                // console.log("- Relative Image Src:", relativeImageSrc);
    
                // Use the normalized relative path for hash generation
                const imageHash = this.getImageHash(notePath, relativeImageSrc);
                // console.log("Calculated Image Hash:", imageHash);
    
                if (!this.cache[notePath]) {
                    this.cache[notePath] = {};
                }
    
                this.cache[notePath][imageHash] = {
                    position,
                    width: width || "",
                    height: height || "", // Store height
                    wrap,
                };
    
                // console.log("Updated Cache:", this.cache);
                await this.saveCache();
            });
        } catch (error) {
            console.error("Error in saveImageAlignmentToCache:", error);
        }
    }


    public getImageHash(notePath: string, imageSrc: string): string {
        // First, normalize the image source
        const relativePath = this.getRelativePath(imageSrc);
    
        // console.log("getImageHash DETAILS:");
        // console.log("- Note Path:", notePath);
        // console.log("- Original Image Src:", imageSrc);
        // console.log("- Normalized Relative Path:", relativePath);
    
        // Always use the normalized relative path for hashing
        const combinedPath = `${notePath}:${relativePath}`;
        const hash = murmurHash3_128(combinedPath, 0);
        
        // console.log("Calculated Image Hash:", hash);
        return hash;
    }
    
    public getImageAlignment(notePath: string, imageSrc: string) {
        // console.log("getImageAlignment DETAILS:");
        // console.log("- Note Path:", notePath);
        // console.log("- Image Source:", imageSrc);
        
        const imageHash = this.getImageHash(notePath, imageSrc);
        // console.log("Calculated Image Hash:", imageHash);
        
        // console.log("Full Cache:", this.cache);
        // console.log("Note-specific Cache:", this.cache[notePath]);
        
        const alignment = this.cache[notePath]?.[imageHash];
        // console.log("Found Alignment:", alignment);
        
        return alignment;
    }

    
    public getRelativePath(imageSrc: string): string {
        // console.log("Original image SRC:", imageSrc);

        // If it's an online URL, return as-is
        if (imageSrc.startsWith('http://') || imageSrc.startsWith('https://')) {
            // console.log("Online image found returing original SRC", imageSrc);
            return imageSrc;
        }

        // Remove query parameters
        const srcWithoutQuery = imageSrc.split('?')[0];
        // console.log("Clean full path after extensions:", srcWithoutQuery);
        imageSrc = srcWithoutQuery;


        // Handle app:// and file:// URIs
        if (imageSrc.startsWith('app://') || imageSrc.startsWith('file:///')) {
            let osPath = '';
            if (imageSrc.startsWith('app://')) {
                const appUriParts = imageSrc.substring('app://'.length).split('/');
                if (appUriParts.length > 1) {
                    osPath = decodeURIComponent(appUriParts.slice(1).join('/'));
                }
                // console.log("Full OS path:", osPath);
            } else if (imageSrc.startsWith('file:///')) {
                osPath = decodeURIComponent(imageSrc.substring('file:///'.length));
                // console.log("Full OS path:", osPath);
            }

            if (osPath) {
                let basePath: string | null = null;
                if (this.app.vault.adapter instanceof FileSystemAdapter) {
                    basePath = this.app.vault.adapter.getBasePath();
                }
                // console.log("Base path:", basePath);


                if (basePath) {
                    const normalizedBasePath = basePath.toLowerCase().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
                    const normalizedOsPath = osPath.toLowerCase().replace(/\\/g, '/').replace(/^\/+/, '');
                    // console.log("normalized base path:", normalizedBasePath);
                    // console.log("normalized OS pathh:", normalizedOsPath);


                    if (normalizedOsPath.startsWith(normalizedBasePath)) {
                        // Extract the relative path
                        let relativePath = osPath.substring(basePath.length);
                        relativePath = relativePath.replace(/^\/+/, ''); // Remove leading slash

                        // console.log("FINAL CLEANEDUP Relative path:", relativePath);
                        return relativePath;
                    }
                }
            }
        }

        // Fallback: try to extract filename
        const parts = imageSrc.split('/');
        const filename = parts[parts.length - 1];

        // console.log("FAILED extracting relative path (it didnt start with app file URI or basepath)", filename);
        return filename;
    }








    public async applyAlignmentsToNote(notePath: string) {
        try {
            await this.lock.acquire('applyAlignments', async () => {
                const alignments = this.cache[notePath];
                if (!alignments) return;

                // Only target images in the markdown content area
                // const contentEl = document.querySelector('.cm-content');
                // if (!contentEl) return;

                const images = document.querySelectorAll('img');
                // console.log(`Found ${images.length} content images`);

                images.forEach((img) => {
                    const src = img.getAttr('src');
                    if (!src) return;

                    // Convert SRC+NOTEPATH into hash
                    const imageHash = this.getImageHash(notePath, src);
                    // Check if hash is inside the chache file
                    const positionData = alignments[imageHash];

                    if (positionData) {
                        this.imageAlignment.applyAlignmentToImage(
                            img as HTMLImageElement,
                            positionData
                        );
                    }
                });
            });
        } catch (error) {
            console.error('Error in applyAlignmentsToNote:', error);
        }
    }


    public async cleanCache() {
        await this.lock.acquire('cacheCleanup', async () => {
            console.time("Cache cleanup time");
            const newCache: ImageAlignmentCache = {};

            for (const notePath in this.cache) {
                // Check if note still exists
                const noteFile = this.app.vault.getAbstractFileByPath(notePath);
                if (!noteFile) continue;

                newCache[notePath] = {};

                for (const imageHash in this.cache[notePath]) {
                    let imageExists = false;

                    // Iterate through all files in the vault
                    const allFiles = this.app.vault.getFiles();
                    for (const file of allFiles) {
                        if (this.supportedImageFormats.isSupported(undefined, file.name)) {
                            // Calculate the hash for each image in the context of the current note
                            const currentImageHash = this.getImageHash(notePath, file.path);

                            // Check if the calculated hash matches the one in the cache
                            if (currentImageHash === imageHash) {
                                imageExists = true;
                                break; // No need to check other files if found
                            }
                        }
                    }

                    if (imageExists) {
                        newCache[notePath][imageHash] = this.cache[notePath][imageHash];
                    }
                }

                // Remove note entry if it has no images
                if (Object.keys(newCache[notePath]).length === 0) {
                    delete newCache[notePath];
                }
            }

            this.cache = newCache;
            await this.saveCache();
            console.timeEnd("Cache cleanup time");
            console.log('Cache cleaned:', this.cache);
        });
    }

    public async validateNoteCache(notePath: string, noteContent: string) {
        // console.log("------------------------------------");
        // console.log(`validateNoteCache called for: ${notePath}`);
        // console.log("Note content:", noteContent);

        await this.lock.acquire('validateCache', async () => {

            // if simply resizing the image no need to validate, this place is only to remove from cache
            if (this.imageResizer.resizeState.isDragging || this.imageResizer.resizeState.isResizing || this.imageResizer.resizeState.isScrolling ) {
                return;
            }

            // **Early exit if no cache for the note**
            if (!this.cache[notePath]) {
                // console.log(`No cache found for note: ${notePath}`);
                // console.log("------------------------------------");
                return;
            }

            // **Extract image links and exit early if none are found**
            const imageLinks = this.extractImageLinks(noteContent);
            if (imageLinks.length === 0) {
                // console.log(`No image links found in note: ${notePath}`);
                // If the cache exists but there are no images, we should clear the cache for this note.
                if (this.cache[notePath]) {
                    delete this.cache[notePath];
                    await this.saveCache();
                }
                // console.log("------------------------------------");
                return;
            }

            // console.log("Extracted image links (before hashing):", imageLinks);

            const cachedImages = Object.keys(this.cache[notePath]);
            // console.log("Cached image hashes:", cachedImages);

            // Convert image links to hashes
            const imageHashes = imageLinks.map(link => this.getImageHash(notePath, link));
            // console.log("Calculated image hashes:", imageHashes);

            // Find cached images that are no longer in the note
            const imagesToRemove = cachedImages.filter(cachedImageHash => !imageHashes.includes(cachedImageHash));
            // console.log("Images to remove (hashes):", imagesToRemove);

            // Remove orphaned entries
            for (const imageToRemoveHash of imagesToRemove) {
                // console.log(`Removing orphaned image entry: ${imageToRemoveHash} from note: ${notePath}`);
                delete this.cache[notePath][imageToRemoveHash];
            }

            // If no images left in cache for this note, remove the note entry
            if (Object.keys(this.cache[notePath]).length === 0) {
                // console.log(`Removing note entry from cache (no images left): ${notePath}`);
                delete this.cache[notePath];
            }

            await this.saveCache();
            // console.log("Cache after validation:", this.cache);
            // console.log("------------------------------------");
        });
    }

    private async handleOperationError(error: Error, operation: string) {
        console.error(`Error during ${operation}:`, error);

        await this.lock.acquire('errorHandling', async () => {
            // Clear any pending operations
            this.imageStates.clear();

            // Validate and repair cache
            await this.validateCache();

            // Notify user of error (if you have a notification system)
            if (this.plugin instanceof ImageConverterPlugin) {
                // Example notification (implement according to your UI system)
                new Notice(
                    `Error during ${operation}. Cache has been validated.`,
                    5000
                );
            }
        });
    }

    // private async updateImageState(imagePath: string, state: Partial<ImageAlignmentOptions>) {
    //     const currentState = this.imageStates.get(imagePath) || { align: 'none', wrap: false };
    //     const newState = { ...currentState, ...state };
    //     this.imageStates.set(imagePath, newState);

    //     // Apply visual feedback for updating state
    //     const images = document.querySelectorAll(`img[src="${imagePath}"]`);
    //     images.forEach(img => {
    //         if (newState.align !== 'none') {
    //             img.classList.add('image-updating');
    //         } else {
    //             img.classList.remove('image-updating');
    //         }
    //     });
    // }

    private async validateCache() {
        await this.lock.acquire('validation', async () => {
            const currentFile = this.app.workspace.getActiveFile();
            if (currentFile) {
                const content = await this.app.vault.cachedRead(currentFile); // Use cachedRead here
                await this.validateNoteCache(currentFile.path, content);
            }
        });
    }

    // Helper method to extract image links from note content
    private extractImageLinks(content: string): string[] {
        const imageLinks: string[] = [];
    
        // Match standard markdown images
        const markdownImageRegex = /!\[[^\]]*?(?:\|\d+(?:\|\d+)?)?\]\(([^)\s"]+)(?:\s+"[^"]*")?\)/g;
    
        // Match Obsidian wiki-style images
        const wikiImageRegex = /!\[\[([^\]]+?)(?:\|[^\]]+?)?\]\]/g;
    
        // Extract standard markdown images
        let match;
        while ((match = markdownImageRegex.exec(content)) !== null) {
            // Capture only the URL part (group 1)
            imageLinks.push(match[1]);
        }
    
        // Extract wiki-style images
        while ((match = wikiImageRegex.exec(content)) !== null) {
            imageLinks.push(match[1]);
        }
    
        return imageLinks;
    }

    // Add method to remove cache for specific image
    public async removeImageFromCache(notePath: string, imageSrc: string) {
        await this.lock.acquire("cacheOperation", async () => {
            // Normalize imageSrc to a relative path
            const relativeImageSrc = this.getRelativePath(imageSrc);
            // Use the normalized relative path for hash generation
            const imageHash = this.getImageHash(notePath, relativeImageSrc);
            if (this.cache[notePath] && this.cache[notePath][imageHash]) {
                // console.log(`Removing image with hash ${imageHash} from note ${notePath}`);
                delete this.cache[notePath][imageHash];

                // Remove note entry if it has no images
                if (Object.keys(this.cache[notePath]).length === 0) {
                    delete this.cache[notePath];
                }

                await this.saveCache();
            } else {
                // console.log(`Image with hash ${imageHash} not found in note ${notePath}`);
            }
        });
    }

    // Add method to remove cache for specific note
    public async removeNoteFromCache(notePath: string) {
        if (this.cache[notePath]) {
            delete this.cache[notePath];
            await this.saveCache();
        }
    }

    
    // public async preserveAlignmentDuringResize(
    //     notePath: string,
    //     imageSrc: string,
    //     width?: string
    // ) {
    //     const normalizedSrc = this.normalizeImagePath(imageSrc);

    //     // Find the matching cache entry
    //     const noteCache = this.cache[notePath];
    //     if (!noteCache) return;

    //     // Look for matching entry in cache
    //     const cacheKey = Object.keys(noteCache).find(key =>
    //         this.normalizeImagePath(key) === normalizedSrc
    //     );

    //     if (cacheKey && noteCache[cacheKey]) {
    //         const alignments = noteCache[cacheKey];
    //         // Update only the width while preserving position and wrap
    //         await this.saveImageAlignmentToCache(
    //             notePath,
    //             imageSrc,
    //             alignments.position,
    //             width,
    //             alignments.wrap
    //         );
    //     }
    // }

    // public async debugCache() {
    //     console.log("Current cache contents:", this.cache);
    //     const activeFile = this.app.workspace.getActiveFile();
    //     if (activeFile) {
    //         console.log("Active file:", activeFile.path);
    //         console.log("Cache for active file:", this.cache[activeFile.path]);
    //     }

    //     const images = document.querySelectorAll('img');
    //     console.log("Current images in document:", Array.from(images).map(img => ({
    //         src: img.getAttribute('src'),
    //         normalized: this.normalizeImagePath(img.getAttribute('src'))
    //     })));
    // }

    // normalizeImagePath(src: string | null): string {
    //     if (!src) return '';

    //     // Remove query parameters and decode URI components
    //     const cleanSrc = decodeURIComponent(src.split('?')[0]);

    //     // Extract the base filename without extension
    //     const match = cleanSrc.match(/([^/\\]+?)(?:-\d+)?(?:\.[^.]+)?$/);
    //     const filename = match ? match[1] : cleanSrc;

    //     console.log("Normalized path:", filename, "from:", src);
    //     return filename;
    // }


    // Clean up entries for non-existent files
    

    scheduleCacheCleanup() {
        // Clear any existing interval
        if (this.cleanupIntervalId) {
            window.clearInterval(this.cleanupIntervalId);
        }

        const interval = this.plugin.settings.imageAlignment_cacheCleanupInterval;
        if (interval > 0) {
            this.cleanupIntervalId = window.setInterval(() => {
                void this.cleanCache();
            }, interval);
        }
    }

    public cleanupObserver() {
        if (this.imageObserver) {
            this.imageObserver.disconnect();
            this.imageObserver = null;
        }

    }

    onunload() {
        // Disconnect the MutationObserver
        if (this.imageObserver) {
            this.imageObserver.disconnect();
            this.imageObserver = null;
        }

        // Unregister all events
        this.eventRefs.forEach((eventRef) => {
            this.app.workspace.offref(eventRef);
        });
        this.eventRefs = [];

        if (this.cleanupIntervalId) {
            window.clearInterval(this.cleanupIntervalId);
        }
    }
}

// MurmurHash3 (32-bit)
// - For quick hashing of relative image paths
function murmurHash3_128(key: string, seed: number): string {
    let h1 = seed >>> 0;
    let h2 = seed >>> 0;
    let h3 = seed >>> 0;
    let h4 = seed >>> 0;

    const c1 = 0x87c37b91;
    const c2 = 0x4cf5ad43;

    const length = key.length;
    const nblocks = length >>> 4; // for performance use bitshift instead of equivalent Math.floor(length / 16)

    for (let i = 0; i < nblocks; i++) {
        const i16 = i * 16;

        let k1 = (key.charCodeAt(i16) & 0xff) |
            ((key.charCodeAt(i16 + 1) & 0xff) << 8) |
            ((key.charCodeAt(i16 + 2) & 0xff) << 16) |
            ((key.charCodeAt(i16 + 3) & 0xff) << 24);

        let k2 = (key.charCodeAt(i16 + 4) & 0xff) |
            ((key.charCodeAt(i16 + 5) & 0xff) << 8) |
            ((key.charCodeAt(i16 + 6) & 0xff) << 16) |
            ((key.charCodeAt(i16 + 7) & 0xff) << 24);

        let k3 = (key.charCodeAt(i16 + 8) & 0xff) |
            ((key.charCodeAt(i16 + 9) & 0xff) << 8) |
            ((key.charCodeAt(i16 + 10) & 0xff) << 16) |
            ((key.charCodeAt(i16 + 11) & 0xff) << 24);

        let k4 = (key.charCodeAt(i16 + 12) & 0xff) |
            ((key.charCodeAt(i16 + 13) & 0xff) << 8) |
            ((key.charCodeAt(i16 + 14) & 0xff) << 16) |
            ((key.charCodeAt(i16 + 15) & 0xff) << 24);


        k1 = Math.imul(k1, c1); k1 = (k1 << 15) | (k1 >>> 17); k1 = Math.imul(k1, c2); h1 ^= k1;

        h1 = (h1 << 19) | (h1 >>> 13); h1 = (Math.imul(h1, 5) + 0xe6546b64) >>> 0;

        k2 = Math.imul(k2, c1); k2 = (k2 << 15) | (k2 >>> 17); k2 = Math.imul(k2, c2); h2 ^= k2;

        h2 = (h2 << 17) | (h2 >>> 15); h2 = (Math.imul(h2, 5) + 0xe6546b64) >>> 0;

        k3 = Math.imul(k3, c1); k3 = (k3 << 15) | (k3 >>> 17); k3 = Math.imul(k3, c2); h3 ^= k3;

        h3 = (h3 << 15) | (h3 >>> 17); h3 = (Math.imul(h3, 5) + 0xe6546b64) >>> 0;

        k4 = Math.imul(k4, c1); k4 = (k4 << 15) | (k4 >>> 17); k4 = Math.imul(k4, c2); h4 ^= k4;

        h4 = (h4 << 13) | (h4 >>> 19); h4 = (Math.imul(h4, 5) + 0xe6546b64) >>> 0;
    }

    // Tail handling for remaining bytes
    let k1 = 0;
    let k2 = 0;
    let k3 = 0;
    let k4 = 0;
    const tailStart = nblocks * 16;
    const tailLen = length % 16;

    if (tailLen > 0) {
        switch (tailLen) {
            case 15: k4 ^= (key.charCodeAt(tailStart + 14) & 0xff) << 16; // fallthrough
            case 14: k4 ^= (key.charCodeAt(tailStart + 13) & 0xff) << 8;  // fallthrough
            case 13: k4 ^= (key.charCodeAt(tailStart + 12) & 0xff) << 0;
                k4 = Math.imul(k4, c1); k4 = (k4 << 15) | (k4 >>> 17); k4 = Math.imul(k4, c2); h4 ^= k4; // fallthrough
            case 12: k3 ^= (key.charCodeAt(tailStart + 11) & 0xff) << 24; // fallthrough
            case 11: k3 ^= (key.charCodeAt(tailStart + 10) & 0xff) << 16; // fallthrough
            case 10: k3 ^= (key.charCodeAt(tailStart + 9) & 0xff) << 8;  // fallthrough
            case 9: k3 ^= (key.charCodeAt(tailStart + 8) & 0xff) << 0;
                k3 = Math.imul(k3, c1); k3 = (k3 << 15) | (k3 >>> 17); k3 = Math.imul(k3, c2); h3 ^= k3; // fallthrough
            case 8: k2 ^= (key.charCodeAt(tailStart + 7) & 0xff) << 24; // fallthrough
            case 7: k2 ^= (key.charCodeAt(tailStart + 6) & 0xff) << 16; // fallthrough
            case 6: k2 ^= (key.charCodeAt(tailStart + 5) & 0xff) << 8;  // fallthrough
            case 5: k2 ^= (key.charCodeAt(tailStart + 4) & 0xff) << 0;
                k2 = Math.imul(k2, c1); k2 = (k2 << 15) | (k2 >>> 17); k2 = Math.imul(k2, c2); h2 ^= k2; // fallthrough
            case 4: k1 ^= (key.charCodeAt(tailStart + 3) & 0xff) << 24; // fallthrough
            case 3: k1 ^= (key.charCodeAt(tailStart + 2) & 0xff) << 16; // fallthrough
            case 2: k1 ^= (key.charCodeAt(tailStart + 1) & 0xff) << 8;  // fallthrough
            case 1: k1 ^= (key.charCodeAt(tailStart + 0) & 0xff) << 0;
                k1 = Math.imul(k1, c1); k1 = (k1 << 15) | (k1 >>> 17); k1 = Math.imul(k1, c2); h1 ^= k1;
        }
    }

    // Finalization
    h1 ^= length; h2 ^= length; h3 ^= length; h4 ^= length;

    h1 = h1 + h2 >>> 0; h1 = h1 + h3 >>> 0; h1 = h1 + h4 >>> 0;
    h2 = h2 + h1 >>> 0; h2 = h2 + h3 >>> 0; h2 = h2 + h4 >>> 0;
    h3 = h3 + h1 >>> 0; h3 = h3 + h2 >>> 0; h3 = h3 + h4 >>> 0;
    h4 = h4 + h1 >>> 0; h4 = h4 + h2 >>> 0; h4 = h4 + h3 >>> 0;


    h1 ^= h1 >>> 16; h1 = Math.imul(h1, 0x85ebca6b); h1 ^= h1 >>> 13; h1 = Math.imul(h1, 0xc2b2ae35); h1 ^= h1 >>> 16;
    h2 ^= h2 >>> 16; h2 = Math.imul(h2, 0x85ebca6b); h2 ^= h2 >>> 13; h2 = Math.imul(h2, 0xc2b2ae35); h2 ^= h2 >>> 16;
    h3 ^= h3 >>> 16; h3 = Math.imul(h3, 0x85ebca6b); h3 ^= h3 >>> 13; h3 = Math.imul(h3, 0xc2b2ae35); h3 ^= h3 >>> 16;
    h4 ^= h4 >>> 16; h4 = Math.imul(h4, 0x85ebca6b); h4 ^= h4 >>> 13; h4 = Math.imul(h4, 0xc2b2ae35); h4 ^= h4 >>> 16;


    return (
        ("00000000" + (h4 >>> 0).toString(16)).slice(-8) +
        ("00000000" + (h3 >>> 0).toString(16)).slice(-8) +
        ("00000000" + (h2 >>> 0).toString(16)).slice(-8) +
        ("00000000" + (h1 >>> 0).toString(16)).slice(-8)
    );
}
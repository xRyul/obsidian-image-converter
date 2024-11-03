// working 2
import { App, MarkdownView, Notice, Plugin, TFile, PluginSettingTab, Platform, Setting, Editor, Modal, TextComponent, ButtonComponent, Menu, MenuItem, normalizePath } from 'obsidian';
// Browsers use the MIME type, not the file extension this module allows 
// us to be more precise when default MIME checking options fail
import mime from "./mime.min.js"

/*

UTIF, HEIC, and probe modules - Instead of always loading it,
we now load them only and only, when TIFF, heic image is detected - this 
increases load speed efficiency drastically.

import UTIF from './UTIF.js'; 
import probe from 'probe-image-size';
let heic: any;
if (!Platform.isMobile) {
	import('heic-convert').then(module => {
		heic = module.default;
	});
}

*/

// For the sake of build
declare module 'obsidian' {
    interface Vault {
        getConfig(key: string): any;
    }
}

interface Listener {
	(this: Document, ev: Event): void;
}

// Update QueueItem interface
interface QueueItem {
    file: TFile;
    addedAt: number;
    viewType?: 'markdown' | 'canvas' | 'excalidraw';
    parentFile?: TFile;
    processed: boolean;    // Track processing status
	originalName?: string; // Track original file name, which prevents the same file from being processed multiple times
	originalPath?: string;  // Track the original file path
	newPath?: string;
	isMobileAttachment?: boolean;
}

interface DropInfo {
    totalExpectedFiles: number;
    totalProcessedFiles: number;
    batchId: string;
    files: Array<{
        name: string;
        size: number;
        type: string;
    }>;  // Add tracking for individual files
    timeoutId?: NodeJS.Timeout;  // Track the timeout
}

// Define possible modifier keys
type ModifierKey = 'Shift' | 'Control' | 'Alt' | 'Meta' | 'None';

interface ImageConvertSettings {
	autoRename: boolean; // Controls whether files should be automatically renamed
	showRenameNotice: boolean; // Controls whether notifications should be shown for renames
	useCustomRenaming: boolean;
	customRenameTemplate: string; // Renaming structure specified by the user
	customRenameDefaultTemplate: string; // For reset functionality

	convertToWEBP: boolean;
	convertToJPG: boolean;
	convertToPNG: boolean;
	convertTo: string;
	quality: number;

	baseTimeout: number;
	timeoutPerMB: number;

	showProgress: boolean;
	showSummary: boolean;

	ProcessAllVaultconvertTo: string;
	ProcessAllVaultquality: number;
	ProcessAllVaultResizeModalresizeMode: string;
	ProcessAllVaultResizeModaldesiredWidth: number;
	ProcessAllVaultResizeModaldesiredHeight: number;
	ProcessAllVaultResizeModaldesiredLength: number;
	ProcessAllVaultskipImagesInTargetFormat: boolean;

	ProcessCurrentNoteconvertTo: string;
	ProcessCurrentNotequality: number;
	ProcessCurrentNoteResizeModalresizeMode: string;
	ProcessCurrentNoteresizeModaldesiredWidth: number;
	ProcessCurrentNoteresizeModaldesiredHeight: number;
	ProcessCurrentNoteresizeModaldesiredLength: number;

	attachmentLocation: 'default' | 'root' | 'current' | 'subfolder' | 'customOutput';
	// attachmentSpecifiedFolder: string;
	attachmentSubfolderName: string;
	customOutputPath: string;
	previewPath: string;
	manage_duplicate_filename: string;

	resizeMode: string;
	autoNonDestructiveResize: string,
	customSize: string,
	customSizeLongestSide: string,
	desiredWidth: number;
	desiredHeight: number;
	desiredLength: number;

	resizeByDragging: boolean;
    resizeWithScrollwheel: boolean;
	scrollwheelModifier: ModifierKey;
	allowResizeInReadingMode: boolean;

	rightClickContextMenu: boolean;

	rememberScrollPosition: boolean;
	cursorPosition: 'front' | 'back';

	useMdLinks: boolean;
	useRelativePath: boolean;
}

interface SettingsTab {
	id: string;
	name: string;
	icon?: string; // Optional icon for the tab
}

interface LinkUpdateOptions {
    activeView: MarkdownView;
    element: HTMLImageElement | HTMLVideoElement;
    newWidth: number;
    newHeight: number;
    settings: {
        cursorPosition: string;
    };
}

const DEFAULT_SETTINGS: ImageConvertSettings = {
	autoRename: true,
	showRenameNotice: false,
	useCustomRenaming: false,
	customRenameTemplate: '{noteName}-{date:YYYYMMDDHHmmssSSS}',
	customRenameDefaultTemplate: '{noteName}-{date:YYYYMMDDHHmmssSSS}',

	convertToWEBP: true,
	convertToJPG: false,
	convertToPNG: false,
	convertTo: 'webp',
	quality: 0.75,

	baseTimeout: 20000,
	timeoutPerMB: 1000,

	showProgress: true,
	showSummary: true,

	ProcessAllVaultconvertTo: 'webp',
	ProcessAllVaultquality: 0.75,
	ProcessAllVaultResizeModalresizeMode: 'None',
	ProcessAllVaultResizeModaldesiredWidth: 600,
	ProcessAllVaultResizeModaldesiredHeight: 800,
	ProcessAllVaultResizeModaldesiredLength: 800,
	ProcessAllVaultskipImagesInTargetFormat: true,

	ProcessCurrentNoteconvertTo: 'webp',
	ProcessCurrentNotequality: 0.75,
	ProcessCurrentNoteResizeModalresizeMode: 'None',
	ProcessCurrentNoteresizeModaldesiredWidth: 600,
	ProcessCurrentNoteresizeModaldesiredHeight: 800,
	ProcessCurrentNoteresizeModaldesiredLength: 800,

	attachmentLocation: 'default',
	// attachmentSpecifiedFolder: '',
	attachmentSubfolderName: '',
	customOutputPath: '',
	previewPath: '',
	manage_duplicate_filename: 'duplicate_rename',

	resizeMode: 'None',
	autoNonDestructiveResize: "disabled",
	customSize: "",
	customSizeLongestSide: "",
	desiredWidth: 600,
	desiredHeight: 800,
	desiredLength: 800,

	resizeByDragging: true,
    resizeWithScrollwheel: true,
	scrollwheelModifier: 'Shift',
	allowResizeInReadingMode: false,
	rightClickContextMenu: true,

	rememberScrollPosition: true,
	cursorPosition: 'back',

	useMdLinks: false,
	useRelativePath: false
}

export default class ImageConvertPlugin extends Plugin {
	settings: ImageConvertSettings;
	longestSide: number | null = null;
	widthSide: number | null = null;
	storedImageName: string | null = null; // get imagename for comparison
	
	// Declare the properties
	pasteListener: (event: ClipboardEvent) => void;
	dropListener: (event: DragEvent) => void;
	mouseOverHandler: (event: MouseEvent) => void;

	// Queue
	private fileHashes = new Set<string>();
    private progressEl: HTMLElement | null = null;
    private fileQueue: QueueItem[] = [];
    private isProcessingQueue = false;
    private currentBatchTotal = 0;
	private readonly SIZE_FACTOR = 1024 * 1024; // 1MB

    private batchStarted = false;
    private dropInfo: DropInfo | null = null;
	private batchId = '';  // Track current batch

	// Statistics tracking
    private totalSizeBeforeBytes = 0;
    private totalSizeAfterBytes = 0;
    private processedFiles: { name: string; savedBytes: number }[] = [];

	private statusBarItemEl: HTMLElement | null = null;
	private counters: Map<string, number> = new Map();
	private userAction = false;

	// Pause/Resume
	private isConversionPaused = false; // track the status, paused?
	private isConversionPaused_statusTimeout: number | null = null; // hide status 

	// Drag Resize
    private resizeState: {
        isResizing: boolean;
        startX: number;
        startY: number;
        startWidth: number;
        startHeight: number;
        element: HTMLImageElement | HTMLVideoElement | null;
    } = {
        isResizing: false,
        startX: 0,
        startY: 0,
        startWidth: 0,
        startHeight: 0,
        element: null
    };

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new ImageConvertTab(this.app, this));

		// Create progress container
        this.progressEl = document.body.createDiv('image-converter-progress');
        this.progressEl.style.display = 'none';

		// Add evenet listeners on paste and drop to prevent filerenaming during `sync` or `git pull`
		// This allows us to check if  file was created as a result of a user action (like dropping 
		// or pasting an image into a note) rather than a git pull action.
		// true when a user action is detected and false otherwise. 
		// let userAction = false;
		// set to true, then reset back to `false` after 100ms. This way, 'create' event handler should
		// get triggered only if its an image and if image was created within 100ms of a 'paste/drop' event
		// also if pasting, check if it is an External Link and wether to apply '| size' syntax to the link
		this.pasteListener = (event: ClipboardEvent) => {
			if (this.isConversionPaused) return; // check if paused

			this.userAction = true;
			this.batchStarted = true;
		
			// Clear previous batch hashes
			this.fileHashes.clear();
		
			// Reset statistics
			this.totalSizeBeforeBytes = 0;
			this.totalSizeAfterBytes = 0;
			this.processedFiles = [];
		
			// Generate new batch ID
			this.batchId = Date.now().toString();
		
			// Analyze clipboard items
			const items = event.clipboardData?.items;
			if (!items) return;
		
			// Get image items and their details
			const imageItems = Array.from(items)
				.filter(item => item.kind === 'file' && item.type.startsWith('image/'))
				.map(item => {
					const file = item.getAsFile();
					return {
						name: file?.name || 'clipboard-image',
						size: file?.size || 0,
						type: item.type
					};
				});
			
			// Calculate adaptive timeout based on files
			const calculateTimeout = (files: typeof imageItems) => {
				const BASE_TIMEOUT = 10000;  // 10 seconds base
				const SIZE_FACTOR = 1000;    // 1 second per MB
		
				let timeout = BASE_TIMEOUT;
				
				files.forEach(file => {
					const sizeInMB = file.size / (1024 * 1024);
					const fileTypeMultiplier = 
						file.type === 'image/heic' ? 3 :
						file.type === 'image/tiff' ? 2 :
						file.type === 'image/png' ? 1.5 :
						1;
					
					timeout += (sizeInMB * SIZE_FACTOR * fileTypeMultiplier);
				});
		
				return Math.min(Math.max(timeout, 10000), 300000);
			};
		
			const timeout = calculateTimeout(imageItems);
		
			// Initialize dropInfo for paste operation
			this.dropInfo = {
				totalExpectedFiles: imageItems.length,
				totalProcessedFiles: 0,
				batchId: this.batchId,
				files: imageItems,
				timeoutId: setTimeout(() => {
					if (this.dropInfo?.batchId === this.batchId) {
						const incompleteBatch = this.fileQueue.length > 0;
						if (incompleteBatch) {
							this.dropInfo.timeoutId = setTimeout(() => {
								this.userAction = false;
								this.batchStarted = false;
								this.dropInfo = null;
							}, calculateTimeout(this.dropInfo.files.slice(this.dropInfo.totalProcessedFiles)));
						} else {
							this.userAction = false;
							this.batchStarted = false;
							this.dropInfo = null;
						}
					}
				}, timeout)
			};
		
			if (this.settings.showProgress) {
				this.updateProgressUI(0, imageItems.length, 'Starting processing...');
			}
		
			// Handle external link resizing if needed
			/* ----------------------------------------------------------------------------*/
			// Get the clipboard data as HTML and parse it as Markdown LINK
			const clipboardHTML = event.clipboardData?.getData('text/html') || '';
			const parser = new DOMParser();
			const doc = parser.parseFromString(clipboardHTML, 'text/html');
			const img = doc.querySelector('img');

			let markdownImagefromClipboard = '';
			if (img) {
				const altText = img.alt;
				const src = img.src;
				markdownImagefromClipboard = `![${altText}](${src})`;
			}

			// CLEAN external link and Apply custom size on external links: e.g.: | 100
			// Check if the clipboard data is an external link
			const linkPattern = /!\[(.*?)\]\((.*?)\)/;
			if (this.settings.autoNonDestructiveResize === "customSize" || this.settings.autoNonDestructiveResize === "fitImage") {
				if (linkPattern.test(markdownImagefromClipboard)) {
					// Handle the external link
					const match = markdownImagefromClipboard.match(linkPattern);
					if (match) {
						let altText = match[1];
						const currentLink = match[2];
						const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
						if (activeView) {
							const editor = activeView.editor;
							let longestSide;
							if (this.settings.autoNonDestructiveResize === "customSize") {
								longestSide = this.settings.customSize;
							} else if (this.settings.autoNonDestructiveResize === "fitImage") {
								longestSide = this.settings.customSizeLongestSide;
							}
							altText = altText.replace(/\|\d+(\|\d+)?/g, ''); // remove any sizing info from alt text
							const newMarkdown = `![${altText}|${longestSide}](${currentLink})`;
							const lineNumber = editor.getCursor().line;
							const lineContent = editor.getLine(lineNumber);

							// Preserve existing elements e.g. order/unordered list, comment, code
							// find the start and end position of the image link in the line
							const startPos = lineContent.indexOf(`![${altText}`);
							const endPos = lineContent.indexOf(')', startPos) + 1;

							// update the size value in the image's markdown link
							if (startPos !== -1 && endPos !== -1) {
								editor.replaceRange(newMarkdown, { line: lineNumber, ch: startPos }, { line: lineNumber, ch: endPos });
							}
						}
					}
				}
			}

			/* ----------------------------------------------------------------------------*/
			/* ----------------------------------------------------------------------------*/
		};

		this.dropListener = (event: DragEvent) => {
			if (this.isConversionPaused) return; // check if paused
			this.userAction = true;
			this.batchStarted = true;

			// Clear previous batch hashes
			this.fileHashes.clear();

			// Reset counters
			this.totalSizeBeforeBytes = 0;
			this.totalSizeAfterBytes = 0;
			this.processedFiles = [];
			
			// Clear any existing timeout
			if (this.dropInfo?.timeoutId) {
				clearTimeout(this.dropInfo.timeoutId);
			}
		
			this.batchId = Date.now().toString();
		
			// Enhanced file analysis
			let imageFiles: Array<{name: string; size: number; type: string}> = [];
			if (event.dataTransfer?.files) {
				imageFiles = Array.from(event.dataTransfer.files)
					.map(file => {
						const mimeType = mime.getType(file.name) || file.type;
						return {
							name: file.name,
							size: file.size,
							type: mimeType
						};
					});
			}
		
			// Calculate adaptive timeout based on file types and sizes
			const calculateTimeout = (files: Array<{ name: string; size: number; type: string }>) => {
				const BASE_TIMEOUT = 10000;  // 10 seconds base
				const SIZE_FACTOR = 1000;    // 1 second per MB
				
				let timeout = BASE_TIMEOUT;
			
				files.forEach(file => {
					// Get the MIME type using mime package if available
					const mimeType = mime.getType(file.name) || file.type;
					
					// Calculate multiplier based on MIME type
					const fileTypeMultiplier = 
						mimeType === 'image/heic' ? 3 :  // HEIC takes longer
						mimeType === 'image/tiff' ? 2 :  // TIFF takes longer
						mimeType === 'image/png' ? 1.5 : // PNG takes a bit longer
						1;  // Default multiplier for other formats
					
					// Add to the base timeout
					const sizeInMB = file.size / (1024 * 1024);
					timeout += (sizeInMB * SIZE_FACTOR * fileTypeMultiplier);
				});
			
				return Math.min(Math.max(timeout, 10000), 300000); // Between 10s and 5min
			};
			
		
			const timeout = calculateTimeout(imageFiles);
		
			// Initialize new dropInfo
			this.dropInfo = {
				totalExpectedFiles: imageFiles.length,
				totalProcessedFiles: 0,
				batchId: this.batchId,
				files: imageFiles,
				timeoutId: setTimeout(() => {
					if (this.dropInfo?.batchId === this.batchId) {
						// Instead of resetting, check if processing is still ongoing
						const incompleteBatch = this.fileQueue.length > 0;
						if (incompleteBatch) {
							// Extend timeout if files are still being processed
							this.dropInfo.timeoutId = setTimeout(() => {
								this.userAction = false;
								this.batchStarted = false;
								this.dropInfo = null;
							}, calculateTimeout(this.dropInfo.files.slice(this.dropInfo.totalProcessedFiles)));
						} else {
							this.userAction = false;
							this.batchStarted = false;
							this.dropInfo = null;
						}
					}
				}, timeout)
			};
		
			if (this.settings.showProgress) {
				this.updateProgressUI(0, imageFiles.length, 'Starting processing...');
			}
		};

		// Wait for layout to be ready
		this.app.workspace.onLayoutReady(() => {
			// Register listeners for all supported view types
			const supportedViewTypes = ['markdown', 'canvas', 'excalidraw'];
			supportedViewTypes.forEach(viewType => {
				const leaves = this.app.workspace.getLeavesOfType(viewType);
				leaves.forEach(leaf => {
					const doc = leaf.view.containerEl.ownerDocument;
					doc.addEventListener("paste", this.pasteListener);
					doc.addEventListener('drop', this.dropListener as EventListener);
				});
			});
	
			// Initialize drag resize functionality
			this.initializeDragResize();
			this.registerScrollWheelResize();
			this.scrollwheelresize_registerMouseoverHandler();

			// Register the create event handler
			this.registerEvent(this.app.vault.on('create', async (file: TFile) => {
				// Check if conversion is paused first
				if (this.isConversionPaused) return;
				// Check if we're on mobile
				const isMobile = Platform.isMobile;
            
				// For mobile, we don't need to check userAction
				if (isMobile) {
					if (!(file instanceof TFile) || !isImage(file)) return;
					
					// Set batch parameters for single file processing
					this.currentBatchTotal = 1;
					this.batchStarted = true;
					this.userAction = true; // Force userAction to true for mobile
	
					// Add to queue with mobile-specific context
					this.fileQueue.push({ 
						file,
						addedAt: Date.now(),
						viewType: 'markdown', // Mobile attachments are typically in markdown
						originalName: file.name,
						originalPath: file.path,
						processed: false,
						isMobileAttachment: true
					});
					
					await this.processQueue();
					
					// Reset state after processing
					setTimeout(() => {
						this.userAction = false;
						this.batchStarted = false;
					}, 1000);
				} else {
					if (!(file instanceof TFile) || !isImage(file) || !this.userAction) return;
		
					// Generate hash first
					const sourceHash = await this.generateSourceHash(file);

					// If we've seen this hash before, check user settings
					if (this.fileHashes.has(sourceHash)) {
						// console.log('Duplicate file content detected:', file.name);

						// Check the user setting for duplicate handling
						const duplicateHandling = this.settings.manage_duplicate_filename;

						if (duplicateHandling === "duplicate_replace") {
							// Log and continue processing, treating it as a new entry
							// console.log('Replacing the existing file:', file.name);
							// No need to skip, just proceed
						} else if (duplicateHandling === "duplicate_rename") {
							// Log and rename the file
							// console.log('Renaming the existing file:', file.name);
							await this.renameFile1(file); // Call a method to rename the file
							// Add hash to our set since we're continuing processing
						} else {
							// If neither option is selected, you can choose to skip or handle accordingly
							return;
						}
					} else {
						// Add hash to our set since it's a new file
						this.fileHashes.add(sourceHash);
					}

					// Check if this file was already processed based on its full name (basename + extension)
					const originalNameWithExt = file.name; // This includes both the basename and extension
					if (this.fileQueue.some(item => item.originalName === originalNameWithExt)) {
						return;
					}

					// Get active view type
					const activeView = this.app.workspace.getActiveViewOfType(MarkdownView)
						|| this.app.workspace.getLeavesOfType("canvas").find(leaf => leaf.view)?.view
						|| this.app.workspace.getLeavesOfType("excalidraw").find(leaf => leaf.view)?.view;

					const viewType = activeView?.getViewType();
					const isValidView = ['markdown', 'canvas', 'excalidraw'].includes(viewType || '');

					if (!isValidView) return;

					// Handle single file drops
					if (!this.batchStarted) {
						this.currentBatchTotal = 1;
					}
					
					// Add to queue with minimal necessary information
					this.fileQueue.push({ 
						file,
						addedAt: Date.now(),
						viewType: viewType as 'markdown' | 'canvas' | 'excalidraw',
						parentFile: viewType !== 'markdown' ? (activeView as any).file : undefined,
						originalName: originalNameWithExt,
						originalPath: file.path,
						processed: false
					});
					
					this.processQueue();
				}
			}));
	
			// Listen for layout changes to register new leaves
			this.registerEvent(
				this.app.workspace.on('layout-change', () => {
					supportedViewTypes.forEach(viewType => {
						const leaves = this.app.workspace.getLeavesOfType(viewType);
						leaves.forEach(leaf => {
							const container = leaf.view.containerEl;
							if (!container.hasAttribute('data-image-converter-registered')) {
								container.setAttribute('data-image-converter-registered', 'true');
								container.ownerDocument.addEventListener("paste", this.pasteListener );
								container.ownerDocument.addEventListener('drop', this.dropListener as EventListener);
							}
						});
					});
					// Reinitialize drag resize on layout changes
					this.initializeDragResize();
				})
			);
		});

		// Context Menu
		// Add event listener for contextmenu event on image elements
		this.register(
			this.onElement(
				document,
				'contextmenu',
				'img',
				this.onContextMenu.bind(this)
			)
		);

		// Add a command to process all images in the vault
		this.addCommand({
			id: 'process-all-vault-images',
			name: 'Process all vault images',
			callback: () => {
				const modal = new ProcessAllVault(this);
				modal.open();
			}
		});

		// Add a command to process all images in the current note
		this.addCommand({
			id: 'process-all-images-current-note',
			name: 'Process all images in current note',
			callback: () => {
				const modal = new ProcessCurrentNote(this);
				modal.open();
			}
		});
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				menu.addItem((item) => {
					item
						.setTitle("Process all images in current note")
						.setIcon("cog")
						.onClick(async () => {
							const modal = new ProcessCurrentNote(this);
							modal.open();
						});
				});
			})
		);

		// Add command to open Image Converter settings
		this.addCommand({
			id: 'open-image-converter-settings',
			name: 'Open Image Converter Settings',
			callback: () => {
				this.openSettingsTab();
			}
		});

		// Add commmand to Pause/Continue image
		this.addCommand({
            id: 'toggle-image-conversion',
            name: 'Toggle Image Conversion (Pause/Resume)',
            callback: () => {
                this.toggleConversion();
            }
        });
	}

	async onunload() {
		// Remove event listeners for all supported view types
		const supportedViewTypes = ['markdown', 'canvas', 'excalidraw'];
		supportedViewTypes.forEach(viewType => {
			const leaves = this.app.workspace.getLeavesOfType(viewType);
			leaves.forEach(leaf => {
				const doc = leaf.view.containerEl.ownerDocument;
				doc.removeEventListener("paste", this.pasteListener);
				doc.removeEventListener("drop", this.dropListener as EventListener);
			});
		});
	
		// Remove drag resize event listeners
		document.removeEventListener('mousedown', this.dragResize_handleMouseDown);
		document.removeEventListener('mousemove', this.dragResize_handleMouseMove);
		document.removeEventListener('mouseup', this.dragResize_handleMouseUp);
		document.removeEventListener('mouseout', this.dragResize_handleMouseOut);
	
		// Remove the resize class from workspace
		this.app.workspace.containerEl.removeClass('image-resize-enabled');
	
		// Your existing cleanup code
		this.fileQueue = [];
		this.isProcessingQueue = false;
		if (this.isConversionPaused_statusTimeout) {
			clearTimeout(this.isConversionPaused_statusTimeout);
			this.isConversionPaused_statusTimeout = null;
		}
		
		if (this.statusBarItemEl) {
			this.statusBarItemEl.remove();
			this.statusBarItemEl = null;
		}
		this.dragResize_cleanupResizeAttributes();
		this.progressEl?.remove();
		this.hideProgressBar();
		this.fileQueue = [];
		this.dropInfo = null;
	}

	// Queue
	/////////////////////////////////
	// Handle large batches of images via the queue
	// - Dynamically adjust batch sizes based on file size
	//		- Larger files = smaller batches
	// 		- Smaller files = larger batches
	// - Add delay between batches to not overload Obsidian
	// - Retry MAX=X times for failed conversions
	// - Timeout. Prevents hanging on problematic files via timeout for extra large files, or when it takes too long to process the image
	/* ------------------------------------------------------------- */
	private async processQueue() {
		if (this.isProcessingQueue) return;
		this.isProcessingQueue = true;
		const currentBatchId = this.batchId;

		try {
			while (this.fileQueue.length > 0) {
				// Check if we're still processing the same batch
				if (currentBatchId !== this.batchId) {
					console.log('Batch ID changed, starting new batch');
					break;
				}
	
				const item = this.fileQueue[0];
				let currentFileSize = 0;

				// Skip if already processed
				if (item.processed) {
					this.fileQueue.shift();
					continue;
				}

				// Extend timeout for large or complex files
				if (this.dropInfo?.batchId === currentBatchId) {
					const currentFileIndex = this.dropInfo.totalProcessedFiles;
					const currentFile = this.dropInfo.files[currentFileIndex];

					if (currentFile) {
						// Get the MIME type using mime package if available
						const mimeType = mime.getType(currentFile.name) || currentFile.type;

						// Check if the file is large or a complex format
						const isLargeFile = currentFile.size > 10 * 1024 * 1024; // 10MB
						const isComplexFormat = ['image/heic', 'image/tiff', 'image/png'].includes(mimeType);

						if (isLargeFile || isComplexFormat) {
							if (this.dropInfo.timeoutId) {
								clearTimeout(this.dropInfo.timeoutId);
							}

							// Calculate extended timeout based on file characteristics
							const extensionTime = Math.max(
								30000, // minimum 30 seconds
								(currentFile.size / (1024 * 1024)) * 2000 // 2 seconds per MB
							) * (isComplexFormat ? 1.5 : 1); // 50% more time for complex formats

							this.dropInfo.timeoutId = setTimeout(() => {
								if (this.dropInfo?.batchId === currentBatchId) {
									const remainingFiles = this.fileQueue.length;
									if (remainingFiles > 0) {
										console.log(`Extended processing time for remaining ${remainingFiles} files`);
									} else {
										this.userAction = false;
										this.batchStarted = false;
										this.dropInfo = null;
									}
								}
							}, extensionTime);
						}
					}
				}

	
				try {
					// Update progress before processing
					if (this.settings.showProgress) {
						this.updateProgressUI(
							this.dropInfo?.totalProcessedFiles || 0,
							this.dropInfo?.totalExpectedFiles || this.fileQueue.length,
							item.file.name
						);
					}
	
					// Get initial file stats
					const initialStat = await this.app.vault.adapter.stat(item.file.path);
					currentFileSize = initialStat?.size || 0;
					this.totalSizeBeforeBytes += currentFileSize;

					const initialSizeBytes = initialStat?.size || 0;
			
					// Calculate adaptive timeout based on file size and type
					const mimeType = mime.getType(item.file.extension.toLowerCase()) || `image/${item.file.extension.toLowerCase()}`;
					const isComplexFormat = ['image/heic', 'image/tiff', 'image/png'].includes(mimeType);

					const timeoutDuration = Math.max(
						this.settings.baseTimeout,
						(initialSizeBytes / this.SIZE_FACTOR * this.settings.timeoutPerMB) *
						(isComplexFormat ? 2 : 1) // Double timeout for complex formats
					);
	
					// Process the file with timeout and retry mechanism
					let attempts = 0;
					const maxAttempts = 1;
					let success = false;
	
					while (attempts < maxAttempts && !success) {
						try {
							await Promise.race([
								this.renameFile1(item.file),
								new Promise((_, reject) =>
									setTimeout(() => reject(new Error('Processing timeout')), timeoutDuration)
								)
							]);
							success = true;
						} catch (error) {
							attempts++;
							if (attempts === maxAttempts) {
								throw error;
							}
							// Wait before retry
							await new Promise(resolve => setTimeout(resolve, 1000));
						}
					}
	
					// Get final stats and calculate savings
					const finalStat = await this.app.vault.adapter.stat(item.file.path);
					const finalSizeBytes = finalStat?.size || 0;
					const savedBytes = initialSizeBytes - finalSizeBytes;
	
					this.totalSizeAfterBytes += finalSizeBytes;
					this.processedFiles.push({
						name: item.file.name,
						savedBytes: savedBytes
					});
	
					// Update dropInfo counter after successful processing
					if (this.dropInfo && this.dropInfo.batchId === currentBatchId) {
						this.dropInfo.totalProcessedFiles++;
					}
	
				} catch (error) {
					console.error(`Error processing ${item.file.name}:`, error);
					new Notice(`Failed to process ${item.file.name}: ${error.message}`);
				}
	
				// Remove processed file from queue
				item.processed = true; // Mark as processed before removing from queue
				this.fileQueue.shift();
	
				// Add small delay between files to prevent system overload
				// Longer delay for large files
				const delayTime = currentFileSize > 5 * 1024 * 1024 ? 500 : 100;
				await new Promise(resolve => setTimeout(resolve, delayTime));
			}
		} finally {
			// Only clean up if we're still on the same batch
			if (currentBatchId === this.batchId) {
				this.isProcessingQueue = false;
	
				// Show summary and cleanup only if batch is complete
				if (this.dropInfo?.totalProcessedFiles === this.dropInfo?.totalExpectedFiles) {
					if (this.settings.showSummary && this.processedFiles.length > 0) {
						this.showBatchSummary();
					}
	
					// Reset everything after showing summary
					this.dropInfo = null;
					this.totalSizeBeforeBytes = 0;
					this.totalSizeAfterBytes = 0;
					this.processedFiles = [];
	
					this.hideProgressBar();
				}

				// Additional check for empty queue
				if (this.fileQueue.length === 0) {
					this.hideProgressBar();
				}

				// Trigger garbage collection hint
				if (global.gc) {
					global.gc();
				}
			}
		}
	}

    private updateProgressUI(current: number, total: number, fileName: string) {
        if (!this.progressEl) return;

        // Use dropInfo if available for consistent counting
        if (this.dropInfo) {
            total = this.dropInfo.totalExpectedFiles;
            current = this.dropInfo.totalProcessedFiles + 1; // +1 for current file
        }

        // Ensure we never show more processed than total
        current = Math.min(current, total);

        // Only show progress UI if there are items to process
		if (total === 0) {
			this.hideProgressBar();
			return;
		}

		this.showProgressBar();
		this.progressEl.empty();

        const progressText = this.progressEl.createDiv('progress-text');
        progressText.setText(`Processing ${current} of ${total}`);
        
        const fileNameEl = this.progressEl.createDiv('file-name');
        fileNameEl.setText(fileName);

        const progressBar = this.progressEl.createDiv('progress-bar');
        const progressFill = progressBar.createDiv('progress-fill');
        const percentage = Math.min((current / total) * 100, 100);
        progressFill.style.width = `${percentage}%`;

		// Hide progress bar if processing is complete
		if (current === total) {
			// Add a small delay before hiding to show completion
			setTimeout(() => this.hideProgressBar(), 1000);
		}
    }
	
	private hideProgressBar() {
		if (this.progressEl) {
			this.progressEl.style.display = 'none';
			this.progressEl.empty();
		}
	}
	
	private showProgressBar() {
		if (this.progressEl) {
			this.progressEl.style.display = 'flex';
		}
	}

    private async generateSourceHash(file: TFile): Promise<string> {
        const binary = await this.app.vault.readBinary(file);

        // Use a better hashing algorithm like SHA-256 for better collision resistance
        const hashBuffer = await crypto.subtle.digest('SHA-256', binary);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        return hashHex; // Return the hexadecimal string of the hash
    }

	/////////////////////////////////

    private formatBytes(bytes: number): string {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    private showBatchSummary() {
        if (this.processedFiles.length === 0) return;  // Don't show empty summary

        const totalSaved = this.totalSizeBeforeBytes - this.totalSizeAfterBytes;
        const overallRatio = ((totalSaved / this.totalSizeBeforeBytes) * 100).toFixed(1);
        
        let summaryText = `📊 Image Converter Summary\n`;
        summaryText += `Files Processed: ${this.processedFiles.length}\n`;
        summaryText += `${this.formatBytes(this.totalSizeBeforeBytes)} -> ${this.formatBytes(this.totalSizeAfterBytes)} (${overallRatio}%)`;
        // summaryText += `Total Size After: ${this.formatBytes(this.totalSizeAfterBytes)}\n`;
        // summaryText += ` Saved: ${this.formatBytes(totalSaved)} \n`;

        // Show individual file savings if batch size is small
        // if (this.processedFiles.length <= 5) {
        //     summaryText += '\nPer file savings:\n';
        //     this.processedFiles.forEach(file => {
        //         summaryText += `${file.name}: ${this.formatBytes(file.savedBytes)}\n`;
        //     });
        // }

        new Notice(summaryText, 10000);
    }


	/* ------------------------------------------------------------- */
	/* ------------------------------------------------------------- */


	onElement(
		el: Document,
		event: keyof HTMLElementEventMap,
		selector: string,
		listener: Listener,
		options?: { capture?: boolean; }
	) {
		el.on(event, selector, listener, options);
		return () => el.off(event, selector, listener, options);
	}

	onContextMenu(event: MouseEvent) {
		// Prevent default context menu from being displayed
		// event.preventDefault();
		// If the 'Disable right-click context menu' setting is enabled, return immediately
		if (!this.settings.rightClickContextMenu) {
			return;
		}
		const target = (event.target as Element);

		const img = event.target as HTMLImageElement;
		const rect = img.getBoundingClientRect();
		const x = event.clientX - rect.left;
		const y = event.clientY - rect.top;
		const edgeSize = 30; // size of the edge in pixels

		// Only show the context menu if the user right-clicks within the center of the image
		if ((x > edgeSize && x < rect.width - edgeSize) && (y > edgeSize && y < rect.height - edgeSize)) {
			// Create new Menu object
			const menu = new Menu();

			// Add option to copy image to clipboard
			menu.addItem((item: MenuItem) =>
				item
					.setTitle('Copy Image')
					.setIcon('copy')
					.onClick(() => {
						// Copy original image data to clipboard
						const img = new Image();
						img.crossOrigin = 'anonymous'; // Set crossOrigin to 'anonymous' for copying external images
						const targetImg = event.target as HTMLImageElement; // Cast target to HTMLImageElement
						img.onload = async function () {
							const canvas = document.createElement('canvas');
							canvas.width = img.naturalWidth;
							canvas.height = img.naturalHeight;
							const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
							ctx.drawImage(img, 0, 0);
							const dataURL = canvas.toDataURL();
							const response = await fetch(dataURL);
							const blob = await response.blob();
							const item = new ClipboardItem({ [blob.type]: blob });
							await navigator.clipboard.write([item]);
							new Notice('Image copied to clipboard');
						};
						img.src = targetImg.src; // Set src after setting crossOrigin
					})
			);

			// Add option to copy Base64 encoded image into clipboard
			menu.addItem((item: MenuItem) =>
				item
					.setTitle('Copy as Base64 encoded image')
					.setIcon('copy')
					.onClick(() => {
						// Copy original image data to clipboard
						const img = new Image();
						img.crossOrigin = 'anonymous'; // Set crossOrigin to 'anonymous'
						const targetImg = event.target as HTMLImageElement; // Cast target to HTMLImageElement
						img.onload = async function () {
							const canvas = document.createElement('canvas');
							canvas.width = img.naturalWidth;
							canvas.height = img.naturalHeight;
							const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
							ctx.drawImage(img, 0, 0);
							const dataURL = canvas.toDataURL();
							await navigator.clipboard.writeText('<img src="' + dataURL + '"/>');
							new Notice('Image copied to clipboard');
						};
						img.src = targetImg.src; // Set src after setting crossOrigin
					})
			);


			// Add option to resize image
			menu.addItem((item: MenuItem) =>
				item
					.setTitle('Resize Image')
					.setIcon('image-file')
					.onClick(async () => {
						// Show resize image modal
						const modal = new ResizeImageModal(this.app, async (width, height) => {
							if (width || height) {
								// Resize image data
								const img = target as HTMLImageElement;
								const canvas = document.createElement('canvas');
								const aspectRatio = img.naturalWidth / img.naturalHeight;
								if (width && !height) {
									canvas.width = parseInt(width);
									canvas.height = canvas.width / aspectRatio;
								} else if (!width && height) {
									canvas.height = parseInt(height);
									canvas.width = canvas.height * aspectRatio;
								} else {
									const newWidth = parseInt(width);
									const newHeight = parseInt(height);
									const newAspectRatio = newWidth / newHeight;
									if (newAspectRatio > aspectRatio) {
										canvas.width = newHeight * aspectRatio;
										canvas.height = newHeight;
									} else {
										canvas.width = newWidth;
										canvas.height = newWidth / aspectRatio;
									}
								}
								const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
								ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
								const dataURL = canvas.toDataURL();

								// Replace original image file with resized image data
								const response = await fetch(dataURL);
								const blob = await response.blob();
								const buffer = await blob.arrayBuffer();

								// Get file path from src attribute
								// Get Vault Name
								const rootFolder = this.app.vault.getName();
								const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
								if (activeView) {
									// Grab full path of an src, it will return full path including Drive letter etc.
									// thus we need to get rid of anything what is not part of the vault
									let imagePath = img.getAttribute('src');
									if (imagePath) {
										// Find the position of the root folder in the path
										const rootFolderIndex = imagePath.indexOf(rootFolder);

										// Remove everything before the root folder
										if (rootFolderIndex !== -1) {
											imagePath = imagePath.substring(rootFolderIndex + rootFolder.length + 1);
										}

										// Remove the query string
										imagePath = imagePath.split('?')[0];
										// Decode percent-encoded characters
										const decodedPath = decodeURIComponent(imagePath);

										const file = this.app.vault.getAbstractFileByPath(decodedPath);
										if (file instanceof TFile && isImage(file)) {
											// Replace the image
											await this.app.vault.modifyBinary(file, buffer);
											// Refresh the image
											if (img.src) {
												const newSrc = img.src + (img.src.includes('?') ? '&' : '?') + new Date().getTime();
												img.src = newSrc;
											}
										}
									}
								}
							}
						});
						modal.open();
					})
			);

			// Delete (Image + md link)
			menu.addItem((item) => {
				item.setTitle('Delete Image from vault')
					.setIcon('trash')
					.onClick(async () => {
						deleteImageFromVault(event, this.app);
					});
			});

			// Show menu at mouse event location
			menu.showAtPosition({ x: event.pageX, y: event.pageY });

			// Prevent the default context menu from appearing
			event.preventDefault();
		}

	}



	/* Drag Resize */
	/* ------------------------------------------------------------- */
	private initializeDragResize() {
		this.registerDomEvent(document, 'mousedown', this.dragResize_handleMouseDown.bind(this));
		this.registerDomEvent(document, 'mousemove', this.dragResize_handleMouseMove.bind(this));
		this.registerDomEvent(document, 'mouseup', this.dragResize_handleMouseUp.bind(this));
		this.registerDomEvent(document, 'mouseout', this.dragResize_handleMouseOut.bind(this));
	
		// Add the base CSS class to workspace
		this.app.workspace.containerEl.addClass('image-resize-enabled');
	
		// Also reinitialize on layout changes
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				// You might want to remove and reapply the class
				this.app.workspace.containerEl.removeClass('image-resize-enabled');
				this.app.workspace.containerEl.addClass('image-resize-enabled');
			})
		);
	}

	private dragResize_isValidTarget(element: HTMLElement): element is HTMLImageElement | HTMLVideoElement {
		if (!this.settings.resizeByDragging) return false;
		
		// Check if we're in reading mode and if it's allowed
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) return false;
		
		if (activeView.getMode() === 'preview' && !this.settings.allowResizeInReadingMode) {
			return false;
		}
	
		// Check if element is valid image/video
		if (!(element instanceof HTMLImageElement || element instanceof HTMLVideoElement)) {
			return false;
		}
	
		// Check if element is in the active view
		return activeView.containerEl.contains(element);
	}

	private dragResize_handleMouseDown(event: MouseEvent) {
		if (!this.settings.resizeByDragging) return;

		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		const target = event.target as HTMLElement;
		// Early return if disabled or in reading mode without permission
		if (!this.settings.resizeByDragging || 
			!activeView || 
			(activeView.getMode() === 'preview' && !this.settings.allowResizeInReadingMode)) {
			return;
		}
		if (!this.dragResize_isValidTarget(target)) return;
	
		const rect = target.getBoundingClientRect();
		const x = event.clientX - rect.left;
		const y = event.clientY - rect.top;
		const edgeSize = 30;
	
		if ((x >= rect.width - edgeSize || x <= edgeSize) || 
			(y >= rect.height - edgeSize || y <= edgeSize)) {
			
			event.preventDefault();
			
			// Set active resize state
			target.setAttribute('data-resize-active', 'true');
			
			this.resizeState = {
				isResizing: true,
				startX: event.clientX,
				startY: event.clientY,
				startWidth: target.clientWidth,
				startHeight: target.clientHeight,
				element: target
			};
		}
	}

	private dragResize_handleMouseMove(event: MouseEvent) {
		if (!this.settings.resizeByDragging) return;

		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView || 
			(activeView.getMode() === 'preview' && !this.settings.allowResizeInReadingMode)) {
			return;
		}

		const target = event.target as HTMLElement;
		
		if (this.resizeState.isResizing && this.resizeState.element) {
			const { newWidth, newHeight } = this.dragResize_calculateNewDimensions(event);
			this.dragResize_updateElementSize(newWidth, newHeight);
			this.dragResize_updateMarkdownContent(newWidth, newHeight);
		} else if (this.dragResize_isValidTarget(target)) {
			const rect = target.getBoundingClientRect();
			const x = event.clientX - rect.left;
			const y = event.clientY - rect.top;
			const edgeSize = 30;
	
			if ((x >= rect.width - edgeSize || x <= edgeSize) || 
				(y >= rect.height - edgeSize || y <= edgeSize)) {
				target.setAttribute('data-resize-edge', 'true');
			} else {
				target.removeAttribute('data-resize-edge');
			}
		}
	}

	private dragResize_handleMouseUp() {
		if (this.resizeState.element) {
			// Clean up all resize-related attributes
			this.resizeState.element.removeAttribute('data-resize-edge');
			this.resizeState.element.removeAttribute('data-resize-active');
			this.dragResize_updateCursorPosition();
		}
	
		this.resizeState = {
			isResizing: false,
			startX: 0,
			startY: 0,
			startWidth: 0,
			startHeight: 0,
			element: null
		};
	}

	private dragResize_handleMouseOut = (event: MouseEvent) => {
		if (!this.settings.resizeByDragging) return;
		const target = event.target as HTMLElement;
		if (this.dragResize_isValidTarget(target) && !this.resizeState.isResizing) {
			target.removeAttribute('data-resize-edge');
		}
	}

    private dragResize_updateElementSize(newWidth: number, newHeight: number) {
        if (!this.resizeState.element) return;

        if (this.resizeState.element instanceof HTMLImageElement) {
            this.resizeState.element.style.width = `${newWidth}px`;
            this.resizeState.element.style.height = `${newHeight}px`;
        } else if (this.resizeState.element instanceof HTMLVideoElement) {
            const containerWidth = this.resizeState.element.parentElement?.clientWidth ?? 0;
            const newWidthPercentage = (newWidth / containerWidth) * 100;
            this.resizeState.element.style.width = `${newWidthPercentage}%`;
        }
    }

    private dragResize_calculateNewDimensions(event: MouseEvent) {
        const deltaX = event.clientX - this.resizeState.startX;
        const aspectRatio = this.resizeState.startWidth / this.resizeState.startHeight;
        
        const newWidth = Math.max(this.resizeState.startWidth + deltaX, 50);
        const newHeight = newWidth / aspectRatio;

        return {
            newWidth: Math.round(newWidth),
            newHeight: Math.round(newHeight)
        };
    }

	private dragResize_updateMarkdownContent(newWidth: number, newHeight: number) {
		if (!this.resizeState.element) return;
	
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) return;
	
		// Store the current element being resized
		const currentElement = this.resizeState.element;
		const currentImageName = getImageName(currentElement);
		
		if (!currentImageName) return;
	
		updateImageLink({
			activeView,
			element: currentElement,
			newWidth,
			newHeight,
			settings: this.settings
		});
	}

	private dragResize_updateCursorPosition() {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView || !this.resizeState.element) return;
	
		const editor = activeView.editor;
		const cursorPos = editor.getCursor();
		const lineContent = editor.getLine(cursorPos.line);
		
		// Get image name safely
		const imageName = getImageName(this.resizeState.element);
		if (!imageName) return;
	
		// Ensure we have valid content to work with
		if (!lineContent.includes(imageName)) return;
	
		let newCursorPos;
		if (this.settings.cursorPosition === 'front') {
			// Look for both internal and external link syntax
			const linkStart = Math.max(lineContent.indexOf('![['), lineContent.indexOf('!['));
			newCursorPos = { line: cursorPos.line, ch: Math.max(linkStart, 0) };
		} else {
			// Handle both internal and external link endings
			const linkEnd = lineContent.indexOf(']]') !== -1 ? 
				lineContent.indexOf(']]') + 2 : 
				lineContent.indexOf(')') + 1;
			newCursorPos = { line: cursorPos.line, ch: Math.min(linkEnd, lineContent.length) };
		}
	
		// Set cursor position immediately without setTimeout
		editor.setCursor(newCursorPos);
	}
	
	// Add cleanup method to remove any lingering attributes
	private dragResize_cleanupResizeAttributes() {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) return;

		// Clean up any images/videos with resize attributes
		activeView.containerEl.querySelectorAll('img, video').forEach(element => {
			element.removeAttribute('data-resize-edge');
			element.removeAttribute('data-resize-active');
		});
	}
	
	/* ------------------------------------------------------------- */
	/* ------------------------------------------------------------- */




	/* Scrolwheel resize*/
	/* ------------------------------------------------------------- */
	// Allow resizing with SHIFT + Scrollwheel
	// Fix a bug which on when hover on external images it would replace 1 image link with another
	// Sometimes it would replace image1 with image2 because there is no way to find linenumber
	// for external links. Linenumber gets shown only for internal images.
	private scrollwheelresize_checkModifierKey(event: WheelEvent): boolean {
		switch (this.settings.scrollwheelModifier) {
			case 'Shift':
				return event.shiftKey;
			case 'Control':
				return event.ctrlKey;
			case 'Alt':
				return event.altKey;
			case 'Meta':
				return event.metaKey;
			case 'None':
				return true;
			default:
				return false;
		}
	}

	private registerScrollWheelResize() {
		this.register(
			this.onElement(
				document,
				"wheel",
				"img, video",
				(event: WheelEvent) => {
					if (!this.settings.resizeWithScrollwheel) return;
					
					const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
					if (!activeView) return;
					// Check if resizing is enabled for Reading Mode
					if (!activeView || 
						(activeView.getMode() === 'preview' && !this.settings.allowResizeInReadingMode)) {
						return;
					}
					const markdownContainer = activeView.containerEl;
					const target = event.target as HTMLElement;
					if (!markdownContainer.contains(target)) return;
	
					// Check for the configured modifier key
					if (!this.scrollwheelresize_checkModifierKey(event)) return;
	
					try {
						const img = event.target as HTMLImageElement | HTMLVideoElement;
						const imageName = getImageName(img);
	
                        if (!imageName || imageName !== this.storedImageName) {
                            return;
                        }
	
						// Prevent default scrolling behavior when using modifier
						event.preventDefault();
	
						const { newWidth, newHeight, newLeft, newTop } = 
							resizeImageScrollWheel(event, img);
						
						if (img instanceof HTMLImageElement) {
							img.style.width = `${newWidth}px`;
							img.style.height = `${newHeight}px`;
							img.style.left = `${newLeft}px`;
							img.style.top = `${newTop}px`;
						} else if (img instanceof HTMLVideoElement) {
							img.style.width = `${newWidth}%`;
						}
	
						const editor = activeView.editor;
						updateImageLink({
							activeView,
							element: img,
							newWidth,
							newHeight,
							settings: this.settings
						});
						
						// Handle cursor position after update
						this.scrollwheelresize_updateCursorPosition(editor, imageName);
	
					} catch (error) {
						console.error('An error occurred:', error);
					}
				}
			)
		);
	}

	private scrollwheelresize_registerMouseoverHandler() {
		this.register(
			this.onElement(
				document,
				"mouseover",
				"img, video",
				(event: MouseEvent) => {
					const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
					if (!activeView) return;
					// Check if resizing is enabled for Reading Mode
					if (!activeView || 
						(activeView.getMode() === 'preview' && !this.settings.allowResizeInReadingMode)) {
						return;
					}
					const markdownContainer = activeView.containerEl;
					const target = event.target as HTMLElement;
					if (!markdownContainer.contains(target)) return;
	
					// Check if the current modifier is pressed
					const modifierPressed = this.settings.scrollwheelModifier === 'None' ? false :
						event[`${this.settings.scrollwheelModifier.toLowerCase()}Key` as keyof MouseEvent];
					
					if (modifierPressed) return;
	
					const img = event.target as HTMLImageElement | HTMLVideoElement;
					this.storedImageName = getImageName(img);
				}
			)
		);
	}

    private scrollwheelresize_updateCursorPosition(editor: Editor, imageName: string | null) {
        if (!imageName) return;  // Early return if imageName is null

        const cursorPos = editor.getCursor();
        const lineContent = editor.getLine(cursorPos.line);
        
        let newCursorPos;
        if (this.settings.cursorPosition === 'front') {
            const linkStart = Math.max(lineContent.indexOf('![['), lineContent.indexOf('!['));
            newCursorPos = { line: cursorPos.line, ch: Math.max(linkStart, 0) };
        } else {
            const linkEnd = lineContent.indexOf(']]') !== -1 ? 
                lineContent.indexOf(']]') + 2 : 
                lineContent.indexOf(')') + 1;
            newCursorPos = { line: cursorPos.line, ch: Math.min(linkEnd, lineContent.length) };
        }
        editor.setCursor(newCursorPos);
    }

	/* ------------------------------------------------------------- */
	/* ------------------------------------------------------------- */




	// Toogle to Pause / Continue image conversion
	private toggleConversion(): void {
		this.isConversionPaused = !this.isConversionPaused;
		
		// Clear any existing timeout for status bar removal
		if (this.isConversionPaused_statusTimeout) {
			clearTimeout(this.isConversionPaused_statusTimeout);
			this.isConversionPaused_statusTimeout = null;
		}
		
		// Create status bar item if it doesn't exist
		if (!this.statusBarItemEl) {
			this.statusBarItemEl = this.addStatusBarItem();
		}
		
		if (this.isConversionPaused) {
			this.statusBarItemEl.setText('Image Conversion: Paused ⏸️');
			new Notice('Image conversion paused');
			// Clear current queue if any
			this.fileQueue = [];
			this.isProcessingQueue = false;
			this.hideProgressBar();
		} else {
			this.statusBarItemEl.setText('Image Conversion: Active ▶️');
			new Notice('Image conversion resumed');
			// Remove status bar item after 5 seconds
			this.isConversionPaused_statusTimeout = window.setTimeout(() => {
				if (this.statusBarItemEl) {
					this.statusBarItemEl.remove();
					this.statusBarItemEl = null;
				}
			}, 5000);
		}
	}

    async openSettingsTab() {
        const setting = (this.app as any).setting;
        if (setting) {
            await setting.open();
            setting.openTabById(this.manifest.id);
        } else {
            new Notice('Unable to open settings. Please check if the settings plugin is enabled.');
        }
    }

	// Work on the file
	/* ------------------------------------------------------------- */
	async renameFile1(file: TFile): Promise<string> {	
		const activeFile = this.getActiveFile();
		if (!activeFile) {
			throw new Error('No active file found');
		}

		// Store original values 
		const originalName = file.name;

		// 1. Process the image and save it
		const binary = await this.app.vault.readBinary(file);
		const imgBlob = await this.processImage(file, binary);

		if (imgBlob instanceof Blob) {
			const arrayBuffer = await imgBlob.arrayBuffer();
			await this.app.vault.modifyBinary(file, arrayBuffer);
		}

		// 2. while we are here - reading the image, lets check its width too. 
		// So we could later pass it into custom sizing options etc. 
		// Only check it if the setting for customSize or fitImage is enabled  as there are the only options currently need it
		if (this.settings.autoNonDestructiveResize === "customSize" || this.settings.autoNonDestructiveResize === "fitImage") {
			try {
				this.widthSide = await getImageWidthSide(binary);
				const maxWidth = printEditorLineWidth(this.app);
				if (this.widthSide !== null && typeof maxWidth === 'number') {
					this.settings.customSizeLongestSide = (this.widthSide < maxWidth ? this.widthSide : maxWidth).toString();
					await this.saveSettings();
				}
			} catch (error) {
				console.error('Could not determine image dimensions, using default settings');
			}
		}

		// 3. check if renaming is needed
		let newName: string;
		if (this.settings.autoRename) {
			newName = await this.generateNewName(file, activeFile);
		} else {
			newName = await this.keepOrgName(file);
		}

		// Store original values 
		// sourcePath indicates path of a note
		const sourcePath = activeFile.path;
		const linkText = this.makeLinkText(file, sourcePath);


		// 4. Create all folders before the links! And make sure they exist before dealing with links! 
		const generateNewPath = await this.createOutputFolders(newName, file, activeFile);
		const newPath = normalizePath(generateNewPath); // Normalise new path. This helps us when dealing with paths generated by variables


		// 5. Update file and document
		// Only rename if the path actually changed
	
		await this.updateFileAndDocument(file, newPath, activeFile, sourcePath, linkText);
		
		// Show notification only if enabled AND the file was actually renamed
		if (this.settings.showRenameNotice) {
			new Notice(`Renamed: ${decodeURIComponent(originalName)} → ${decodeURIComponent(newName)}`);
		}


		return newPath;
	}

	private async processImage(file: TFile, binary: ArrayBuffer): Promise<Blob> {
		// Determine the MIME type using the mime module
		const mimeType = mime.getType(file.extension) || `image/${file.extension}`;
	
		let imgBlob = new Blob([binary], { type: mimeType });
	
		// Handle special formats based on MIME type
		if (mimeType === 'image/tiff') {
			imgBlob = await handleTiffImage(binary);
		} else if (mimeType === 'image/heic') {
			imgBlob = await handleHeicImage(file, binary, this.settings, this.app);
		}
	
		// Process compression if quality is not 100%
		if (this.settings.quality !== 1) {
			imgBlob = await this.convertImageFormat(imgBlob, file.extension);
		}
	
		return imgBlob;
	}

	private async convertImageFormat(imgBlob: Blob, originalExtension: string): Promise<Blob> {
		const format = this.settings.convertTo === 'disabled' ? originalExtension : this.settings.convertTo;

		const conversionParams = {
			quality: this.settings.quality,
			resizeMode: this.settings.resizeMode,
			desiredWidth: this.settings.desiredWidth,
			desiredHeight: this.settings.desiredHeight,
			desiredLength: this.settings.desiredLength
		};

		let arrayBuffer: ArrayBuffer;

		switch (format) {
			case 'webp':
				arrayBuffer = await convertToWebP(
					imgBlob,
					conversionParams.quality,
					conversionParams.resizeMode,
					conversionParams.desiredWidth,
					conversionParams.desiredHeight,
					conversionParams.desiredLength
				);
				break;
			case 'jpg':
				arrayBuffer = await convertToJPG(
					imgBlob,
					conversionParams.quality,
					conversionParams.resizeMode,
					conversionParams.desiredWidth,
					conversionParams.desiredHeight,
					conversionParams.desiredLength
				);
				break;
			case 'png':
				arrayBuffer = await convertToPNG(
					imgBlob,
					conversionParams.quality,
					conversionParams.resizeMode,
					conversionParams.desiredWidth,
					conversionParams.desiredHeight,
					conversionParams.desiredLength
				);
				break;
			default:
				return imgBlob;
		}

		return new Blob([arrayBuffer], { type: `image/${format}` });
	}

	private async createOutputFolders(newName: string, file: TFile, activeFile: TFile): Promise<string> {
		
		const basePath = await this.getBasePath(activeFile, file);
		await this.ensureFolderExists(basePath); // Add this line
		
		// Split the path and handle each component
		const pathComponents = normalizePath(basePath).split('/').filter(Boolean);
		let currentPath = '';
	
		for (const component of pathComponents) {
			const nextPath = currentPath ? `${currentPath}/${component}` : component;
			
			// Check if a folder exists with any case
			const existingFolder = await this.getFolderWithAnyCase(nextPath);
			
			if (existingFolder) {
				// Use the existing folder's case
				currentPath = existingFolder;
			} else {
				// Create new folder with original case
				await this.app.vault.createFolder(nextPath);
				currentPath = nextPath;
			}
		}
	
		return `${currentPath}/${newName}`;
	}

	private async getFolderWithAnyCase(path: string): Promise<string | null> {
		const components = path.split('/');
		const folderName = components.pop();
		const parentPath = components.join('/');
	
		try {
			const parentContents = await this.app.vault.adapter.list(parentPath);
			const matchingFolder = parentContents.folders.find(f => 
				f.split('/').pop()?.toLowerCase() === folderName?.toLowerCase()
			);
			return matchingFolder || null;
		} catch {
			return null;
		}
	}

	private async updateFileAndDocument(file: TFile, newPath: string, activeFile: TFile, sourcePath: string, linkText: string): Promise<void> {
		try {
			const decodedNewPath = decodeURIComponent(newPath);
			const normalizedNewPath = normalizePath(decodedNewPath);

			// Add case conflict check
			await this.checkForCaseConflicts(normalizedNewPath);
			
			// Get the actual case-sensitive path that exists on the filesystem
			const actualPath = await this.getActualCasePath(normalizedNewPath);
			let finalPath = actualPath || normalizedNewPath; // Use actual path if exists, otherwise use normalized

			// Check if the Destination Image File already exists if it does then add -1 etc.
			// Handle duplicates
			if (this.settings.manage_duplicate_filename === 'duplicate_replace') {
				if (await this.fileExistsWithAnyCase(finalPath)) {
					const existingFile = await this.app.vault.getAbstractFileByPath(finalPath);
					if (existingFile instanceof TFile) {
						await this.app.vault.delete(existingFile);
					}
				}
			} else if (this.settings.manage_duplicate_filename === 'duplicate_rename') {
				let suffix = 1;
				while (await this.fileExistsWithAnyCase(finalPath)) {
					const extensionIndex = finalPath.lastIndexOf('.');
					if (extensionIndex !== -1) {
						finalPath = `${finalPath.substring(0, extensionIndex)}-${suffix}${finalPath.substring(extensionIndex)}`;
					} else {
						finalPath = `${finalPath}-${suffix}`;
					}
					suffix++;
				}
			}

			// Perform the rename
			// Only perform rename if paths are different (case-insensitive comparison)
			if (!this.pathsAreEqual(file.path, finalPath)) {
				await this.app.vault.rename(file, finalPath);
			}
			// Create MARKDOWN link or WIKI link
			const newLinkText = this.createImageLink(this.makeLinkText(file, sourcePath));

			// Add the size to the markdown link
			// if (this.settings.autoNonDestructiveResize === "customSize" || this.settings.autoNonDestructiveResize === "fitImage") {
			// 	let size;
			// 	if (this.settings.autoNonDestructiveResize === "customSize") {
			// 		size = this.settings.customSize;
			// 	} else if (this.settings.autoNonDestructiveResize === "fitImage") {
			// 		size = this.settings.customSizeLongestSide;
			// 	}
	
			// 	// Handle all three types of links
			// 	if (newLinkText.startsWith('![[')) {
			// 		// Wiki-style internal link
			// 		newLinkText = newLinkText.replace(']]', `|${size}]]`);
			// 	} else if (newLinkText.startsWith('![')) {
			// 		// Standard markdown link
			// 		const altTextMatch = newLinkText.match(/!\[(.*?)\]/);
			// 		const urlMatch = newLinkText.match(/\((.*?)\)/);
					
			// 		if (altTextMatch && urlMatch) {
			// 			const altText = altTextMatch[1].replace(/\|.*$/, ''); // Remove any existing size
			// 			const url = urlMatch[1];
			// 			newLinkText = `![${altText}|${size}](${url})`;
			// 		}
			// 	}
			// }
			// Get the editor
			const editor = this.getActiveEditor(activeFile.path);
			if (!editor) {
				console.log("No active editor found");
				return;
			}

			// PT1 of 2 Preserve the scroll position
			const scrollInfo = editor.getScrollInfo() as { top: number; left: number };

			// Multi-drop-rename
			const cursor = editor.getCursor();
			const currentLine = cursor.line;
			const findText = this.escapeRegExp(linkText);
			const replaceText = newLinkText;
			const docContent = editor.getValue();
			const regex = new RegExp(findText, 'g');
			const newContent = docContent.replace(regex, replaceText);
			editor.setValue(newContent);

			// Restore the scroll position
			editor.scrollTo(scrollInfo.left, scrollInfo.top);

			// Scroll to the last image if rememberScrollPosition is disabled
			if (!this.settings.rememberScrollPosition) {
				const lastLine = newContent.split('\n').length - 1;
				editor.scrollIntoView({ from: { line: lastLine, ch: 0 }, to: { line: lastLine, ch: 0 } });
			}

			// Set the cursor position based on the setting
			/* ---------------------------------------------------------*/
			const lineContent = newContent.split('\n')[currentLine];
			let newCursorPos;
			if (this.settings.cursorPosition === 'front') {
				// Find the index of newLinkText in the current line, not the entire document
				const linkIndex = lineContent.indexOf(newLinkText);
				// If link is found in current line, position cursor before it
				if (linkIndex !== -1) {
					newCursorPos = { line: currentLine, ch: linkIndex };
				} else {
					// Fallback to beginning of line if link not found
					newCursorPos = { line: currentLine, ch: 0 };
				}
			} else {
				newCursorPos = { line: currentLine, ch: lineContent.length };
			}

			// Validate cursor position before setting
			if (newCursorPos.line >= 0 &&
				newCursorPos.line < editor.lineCount() &&
				newCursorPos.ch >= 0 &&
				newCursorPos.ch <= lineContent.length) {
				editor.setCursor(newCursorPos);
			} else {
				console.warn('Invalid cursor position, defaulting to start of line');
				editor.setCursor({ line: currentLine, ch: 0 });
			}
			/* ---------------------------------------------------------*/
			/* ---------------------------------------------------------*/

			// Ensure the current line is in a visible position
			editor.scrollIntoView({ from: { line: currentLine, ch: 0 }, to: { line: currentLine, ch: 0 } });
		} catch (err) {
			console.error('Error during file update:', err);
			// if (this.settings.showRenameNotice) {
			// 	new Notice(`Failed to update ${file.name}: ${err}`);
			// }
			throw err;
		}
	}
	
	// ///////////// Helper for output management
	private async fileExistsWithAnyCase(path: string): Promise<boolean> {
		// Split the path into components
		const pathComponents = path.split('/').filter(Boolean);
		const fileName = pathComponents.pop(); // Get the last component (file name)
		let currentPath = '';
	
		// Check each folder level
		for (const component of pathComponents) {
			const files = await this.app.vault.adapter.list(currentPath);
			const matchingFolder = files.folders.find(f => 
				f.split('/').pop()?.toLowerCase() === component.toLowerCase()
			);
			
			if (!matchingFolder) {
				return false;
			}
			currentPath = matchingFolder;
		}
	
		// Finally check the file name
		const files = await this.app.vault.adapter.list(currentPath);
		return files.files.some(f => 
			f.split('/').pop()?.toLowerCase() === fileName?.toLowerCase()
		);
	}

	private async getActualCasePath(path: string): Promise<string | null> {
		const components = path.split('/').filter(Boolean);
		let currentPath = '';
	
		for (const component of components) {
			try {
				const list = await this.app.vault.adapter.list(currentPath);
				
				// Check both files and folders
				const match = [...list.files, ...list.folders].find(p => 
					p.split('/').pop()?.toLowerCase() === component.toLowerCase()
				);
				
				if (match) {
					currentPath = match;
				} else {
					return null; // Path doesn't exist
				}
			} catch {
				return null;
			}
		}
	
		return currentPath;
	}

	private async ensureFolderExists(path: string): Promise<void> {
		const normalizedPath = normalizePath(path);
		if (!(await this.app.vault.adapter.exists(normalizedPath))) {
			const folders = normalizedPath.split('/').filter(Boolean);
			let currentPath = '';
			
			for (const folder of folders) {
				currentPath += (currentPath ? '/' : '') + folder;
				if (!(await this.app.vault.adapter.exists(currentPath))) {
					await this.app.vault.createFolder(currentPath);
				} else {
					// Get the actual case of the existing folder
					const existingFolder = await this.app.vault.getAbstractFileByPath(currentPath);
					if (existingFolder && existingFolder.name !== folder) {
						// Use the existing case
						currentPath = currentPath.substring(0, currentPath.lastIndexOf('/')) + '/' + existingFolder.name;
					}
				}
			}
		}
	}

	private async checkForCaseConflicts(path: string): Promise<void> {
		const folder = path.substring(0, path.lastIndexOf('/'));
		// const fileName = path.substring(path.lastIndexOf('/') + 1);
		
		const files = await this.app.vault.adapter.list(folder);
		const conflictingFiles = files.files.filter(f => 
			f.toLowerCase() === path.toLowerCase() && f !== path
		);
		
		if (conflictingFiles.length > 0) {
			console.warn(`Case conflict detected for ${path}. Existing files: ${conflictingFiles.join(', ')}`);
		}
	}

	private pathsAreEqual(path1: string, path2: string): boolean {
		// Option1 obsidian noralize path
		// return normalizePath(path1).toLowerCase() === normalizePath(path2).toLowerCase();

		// Option2 
		// Normalize paths before comparison
		const normalize = (p: string) => {
			// Remove leading/trailing slashes and normalize multiple slashes
			return p.replace(/^\/+|\/+$/g, '')
					.replace(/\/+/g, '/')
					.toLowerCase();
		};
		
		return normalize(path1) === normalize(path2);
	}

	private async getBasePath(activeFile: TFile, file: TFile): Promise<string> {
		let basePath: string;
	
		switch (this.settings.attachmentLocation) {
			case 'default':
				basePath = file.path.substring(0, file.path.lastIndexOf('/'));
				break;
			case 'root':
				basePath = '/';
				break;
			case 'current':
				basePath = activeFile.path.substring(0, activeFile.path.lastIndexOf('/'));
				break;
			case 'subfolder': {
				const currentPath = activeFile.path.substring(0, activeFile.path.lastIndexOf('/'));
				const processedSubfolder = await this.processSubfolderVariables(
					this.settings.attachmentSubfolderName,
					file,
					activeFile
				);
				basePath = `${currentPath}/${processedSubfolder}`;
				break;
			}
			case 'customOutput':
				basePath = await this.processSubfolderVariables(
					this.settings.customOutputPath,
					file,
					activeFile
				);
				break;
			default:
				basePath = '/';
		}
	
		return normalizePath(basePath);
	}
	
	private escapeRegExp(string: string): string {
		return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}
	/* ------------------------------------------------------------- */
	/* ------------------------------------------------------------- */

	// Naming
	/* ------------------------------------------------------------- */
	async generateNewName(file: TFile, activeFile: TFile): Promise<string> {
		let newName: string;

		if (this.settings.useCustomRenaming) {
			// Use custom template
			newName = await this.processSubfolderVariables(
				this.settings.customRenameTemplate,
				file,
				activeFile
			);

			// Ensure the name is safe for filesystem
			newName = this.sanitizeFileName(newName);
		} else {
			newName = await this.keepOrgName(file);
		}

		// Handle file extension
		let extension = file.extension;
		if (this.settings.convertTo && this.settings.convertTo !== 'disabled') {
			extension = this.settings.convertTo;
		}

		if (!newName.endsWith(`.${extension}`)) {
			return `${newName}.${extension}`;
		}
	
		return newName;
	}

	async keepOrgName(file: TFile): Promise<string> {
		let newName = file.basename;

		// Ensure the name is safe for filesystem
		newName = this.sanitizeFileName(newName);

		let extension = file.extension;
		if (this.settings.convertTo && this.settings.convertTo !== 'disabled') {
			extension = this.settings.convertTo;
		}

		// Avoid double extension: check if newName already includes an extension
		if (!newName.endsWith(`.${extension}`)) {
			return `${newName}.${extension}`;
		}

		return newName;
	}

	makeLinkText(file: TFile, sourcePath: string, subpath?: string): string {
		// Store the original case of the filename
		const originalName = file.basename + '.' + file.extension;
		const link = this.app.fileManager.generateMarkdownLink(file, sourcePath, subpath);
		
		// Ensure the link uses the original case
		return link.replace(/\[\[(.*?)\]\]/, (match, p1) => {
			const linkPath = p1.split('|')[0];
			const displayText = p1.split('|')[1] || '';
			
			if (linkPath.toLowerCase() === originalName.toLowerCase()) {
				return `[[${originalName}${displayText ? '|' + displayText : ''}]]`;
			}
			return match;
		});
	}

	// WIKI or MD links
	private createImageLink(path: string): string {
		// Remove any existing Markdown or Wikilink structures from the path
		let cleanPath = path.trim();
	
		// Remove existing Markdown image link structure (e.g., ![](path))
		if (cleanPath.startsWith('![') && cleanPath.includes('](')) {
			cleanPath = cleanPath.replace(/!\[.*?\]\((.*?)\)/, '$1');
		}
	
		// Remove existing Wikilink structure (e.g., ![[path]])
		cleanPath = cleanPath.replace(/!?\[\[|\]\]/g, '');
	
		// Add './' if MD links is enabled and user wants ./ specifically to append it nad if it is already not at the start
		if (this.settings.useRelativePath && this.settings.useMdLinks && !cleanPath.startsWith('./')) {
			if (!cleanPath.startsWith('../')) {
				cleanPath = `../${cleanPath}`;
			}
		}
	
		// Check user default settings whether their default is set for WIKI or Markdown links
		// - when it is set to default WIKI links, then all URL encoding for relative/shortest/absolute paths e.g. for empty spaces is already  handled by Obsidian itself
		// - but if it is disabled and we use Markdown links throughout ALL vault, we need to encode links ourselves
		// Get Obsidian's link settings
		const useMarkdownLinks = this.app.vault.getConfig('useMarkdownLinks');
		// Encode path if Obsidian is set to use Wiki links + OUR pLUGIN setting is turned ON + path contains spaces or special chars
		if (!useMarkdownLinks && this.settings.useMdLinks && /[\s!@#$%^&*()+=[\]{};:'",<>?|\\]/.test(cleanPath)) {
			// Split the path to encode each segment separately
			const pathSegments = cleanPath.split('/');
			cleanPath = pathSegments
				.map(segment => encodeURIComponent(segment))
				.join('/');
		}
	
		// Create the link based on plugin settings
		if (this.settings.useMdLinks) {
			const size = this.settings.autoNonDestructiveResize === "customSize" ? 
				this.settings.customSize : 
				this.settings.autoNonDestructiveResize === "fitImage" ? 
				this.settings.customSizeLongestSide : '';
			
			return size ? `![|${size}](${cleanPath})` : `![](${cleanPath})`;
		} else {
			const size = this.settings.autoNonDestructiveResize === "customSize" ? 
				this.settings.customSize : 
				this.settings.autoNonDestructiveResize === "fitImage" ? 
				this.settings.customSizeLongestSide : '';
	
			return size ? `![[${cleanPath}|${size}]]` : `![[${cleanPath}]]`;
		}
	}

	private sanitizeFileName(fileName: string): string {
		// Remove invalid filename characters
		let safe = fileName.replace(/[<>:"/\\|?*]/g, '_');

		// Prevent starting with dots (hidden files)
		safe = safe.replace(/^\.+/, '');

		// Limit length (filesystem dependent, using 255 as safe default)
		if (safe.length > 255) {
			safe = safe.slice(0, 255);
		}

		return safe;
	}

	async processSubfolderVariables(template: string, file: TFile, activeFile: TFile): Promise<string> {
		const moment = (window as any).moment;
		let result = template;

		// Handle {randomHex:X} pattern
		const hexPattern = /{randomHex:(\d+)}/g;
		let hexMatch;
		while ((hexMatch = hexPattern.exec(template)) !== null) {
			const size = parseInt(hexMatch[1]);
			const randomHex = this.generateRandomHex(Math.ceil(size / 2)); // Since each byte gives 2 hex chars
			// If odd length requested, trim one character
			const finalHex = size % 2 === 0 ? randomHex : randomHex.slice(0, -1);
			result = result.replace(hexMatch[0], finalHex);
		}

		// Allow user to specify what they want to hashe.g. filename, fodlerpaht , any name etc. 
		// {MD5:filename} -> full MD5 hash of filename
		// {MD5:filename:8} -> first 8 characters of MD5 hash
		// {MD5:path} -> hash of file path
		// {MD5:fullpath} -> hash of complete path including filename
		// {MD5:parentfolder} -> hash of immediate parent folder name
		// {MD5:rootfolder} -> hash of root folder name
		// {MD5:extension} -> hash of file extension
		// {MD5:notename} -> hash of current note name
		// {MD5:notefolder} -> hash of current note's folder
		// {MD5:notepath} -> hash of current note's full path
		// {MD5:custom text} -> hash of custom text
		const md5Pattern = /{MD5:([\w\-./]+?)(?::(\d+))?}/g;
		let md5Match;
		while ((md5Match = md5Pattern.exec(template)) !== null) {
			const hashType = md5Match[1].toLowerCase();
			const length = md5Match[2] ? parseInt(md5Match[2]) : undefined;
			let textToHash = '';

			switch (hashType) {
				case 'filename':
					textToHash = file.basename;
					break;
				case 'imagePath':
					textToHash = file.path;
					break;
				case 'fullpath':
					textToHash = file.parent ? `${file.parent.path}/${file.basename}` : file.basename;
					break;
				case 'parentfolder':
					textToHash = file.parent?.name || '';
					break;
				case 'rootfolder':
					textToHash = file.path.split('/')[0] || '';
					break;
				case 'extension':
					textToHash = file.extension;
					break;
				case 'notename':
					textToHash = activeFile.basename;
					break;
				case 'notefolder':
					textToHash = activeFile.parent?.name || '';
					break;
				case 'notepath':
					textToHash = activeFile.path;
					break;
				default:
					textToHash = hashType; // hash the text itself
			}

			let md5Hash = await this.generateMD5(textToHash);

			// If length is specified, truncate the hash
			if (length && length > 0 && length < md5Hash.length) {
				md5Hash = md5Hash.substring(0, length);
			}

			result = result.replace(md5Match[0], md5Hash);
		}

		// Counter pattern handling
		const counterPattern = /{counter:(\d+)}/g;
		let counterMatch;
		while ((counterMatch = counterPattern.exec(template)) !== null) {
			const padding = counterMatch[1].length;
			const count = await this.getNextCounter(file.parent?.path || '');
			const paddedCount = count.toString().padStart(padding, '0');
			result = result.replace(counterMatch[0], paddedCount);
		}

		// Date pattern handling with moment.js
		const datePattern = /{date:(.*?)}/g;
		let dateMatch;
		while ((dateMatch = datePattern.exec(template)) !== null) {
			const format = dateMatch[1];
			try {
				const formattedDate = moment().format(format);
				result = result.replace(dateMatch[0], formattedDate);
			} catch (error) {
				console.error(`Invalid date format: ${format}`);
				result = result.replace(dateMatch[0], moment().format('YYYY-MM-DD'));
			}
		}

		// Size pattern handling
		const sizePattern = /{size:(MB|KB|B):(\d+)}/g;
		let sizeMatch;
		while ((sizeMatch = sizePattern.exec(template)) !== null) {
			const unit = sizeMatch[1];
			const decimals = parseInt(sizeMatch[2]);
			const size = file.stat?.size || 0;
			let formattedSize = '0';

			switch (unit) {
				case 'MB':
					formattedSize = (size / (1024 * 1024)).toFixed(decimals);
					break;
				case 'KB':
					formattedSize = (size / 1024).toFixed(decimals);
					break;
				case 'B':
					formattedSize = size.toFixed(decimals);
					break;
			}
			result = result.replace(sizeMatch[0], formattedSize);
		}

		// Basic file information
		const replacements: Record<string, string> = {
			'{imageName}': file.basename,
			'{noteName}': activeFile.basename,
			'{parentFolder}': activeFile.parent?.parent?.name || '',
			'{directory}': activeFile.parent?.path || '',
			'{folderName}': activeFile.parent?.name || '',
			
			'{depth}': (file.path.match(/\//g) || []).length.toString(),
			'{vaultName}': this.app.vault.getName(),
			'{vaultPath}': (this.app.vault.adapter as any).getBasePath?.() || '',

			'{timezone}': Intl.DateTimeFormat().resolvedOptions().timeZone,
			'{locale}': navigator.language,

			// Basic date formats
			'{today}': moment().format('YYYY-MM-DD'),
			'{YYYY-MM-DD}': moment().format('YYYY-MM-DD'),
			'{tomorrow}': moment().add(1, 'day').format('YYYY-MM-DD'),
			'{yesterday}': moment().subtract(1, 'day').format('YYYY-MM-DD'),

			// Time units
			'{startOfWeek}': moment().startOf('week').format('YYYY-MM-DD'),
			'{endOfWeek}': moment().endOf('week').format('YYYY-MM-DD'),
			'{startOfMonth}': moment().startOf('month').format('YYYY-MM-DD'),
			'{endOfMonth}': moment().endOf('month').format('YYYY-MM-DD'),
			
			// Relative dates
			'{nextWeek}': moment().add(1, 'week').format('YYYY-MM-DD'),
			'{lastWeek}': moment().subtract(1, 'week').format('YYYY-MM-DD'),
			'{nextMonth}': moment().add(1, 'month').format('YYYY-MM-DD'),
			'{lastMonth}': moment().subtract(1, 'month').format('YYYY-MM-DD'),

			// Natural language time differences
			'{daysInMonth}': moment().daysInMonth().toString(),
			'{weekOfYear}': moment().week().toString(),
			'{quarterOfYear}': moment().quarter().toString(),

			'{week}': moment().format('w'),
			'{w}': moment().format('w'),
			'{quarter}': moment().format('Q'),
			'{Q}': moment().format('Q'),
			'{dayOfYear}': moment().format('DDD'),
			'{DDD}': moment().format('DDD'),

			'{monthName}': moment().format('MMMM'),
			'{MMMM}': moment().format('MMMM'),
			'{dayName}': moment().format('dddd'),
			'{dddd}': moment().format('dddd'),
			'{dateOrdinal}': moment().format('Do'),
			'{Do}': moment().format('Do'),
			'{relativeTime}': moment().fromNow(),

			'{fileType}': file.extension,
			'{currentDate}': moment().format('YYYY-MM-DD'),
			'{yyyy}': moment().format('YYYY'),
			'{mm}': moment().format('MM'),
			'{dd}': moment().format('DD'),
			'{time}': moment().format('HH-mm-ss'),
			'{HH}': moment().format('HH'),
			'{timestamp}': Date.now().toString(),
			'{weekday}': moment().format('dddd'),
			'{month}': moment().format('MMMM'),
			'{calendar}': moment().calendar(),
			'{platform}': navigator.platform,
			'{userAgent}': navigator.userAgent,
			'{random}': Math.random().toString(36).substring(2, 8),
			'{uuid}': crypto.randomUUID(),

			// -  {randomHex:N} 
			// - `{counter:000}` - Incremental counter with padding (e.g., 001, 002, 003)
			// - `{date:YYYY-MM}` - Date using moment.js format (supports all moment.js patterns)
			// - `{size:MB:2}` - File size with unit (MB/KB/B) and decimal places


		};

		// File stats based replacements
		if (file.stat) {
			const fileSizeB = file.stat.size;
			const fileSizeKB = (fileSizeB / 1024).toFixed(2);
			const fileSizeMB = (fileSizeB / (1024 * 1024)).toFixed(2);

			Object.assign(replacements, {
				'{creationDate}': moment(file.stat.ctime).format('YYYY-MM-DD'),
				'{modifiedDate}': moment(file.stat.mtime).format('YYYY-MM-DD'),
				// '{accessedDate}': moment(file.stat.atime).format('YYYY-MM-DD'),
				'{sizeMB}': fileSizeMB + 'MB',
				'{sizeB}': fileSizeB.toString(),
				'{sizeKB}': fileSizeKB,
			});
		}

		try {
			// Try to get image dimensions and metadata
			const binary = await this.app.vault.readBinary(file);
			const blob = new Blob([binary], { type: `image/${file.extension}` });

			// Get image dimensions
			const img = new Image();
			await new Promise((resolve, reject) => {
				img.onload = resolve;
				img.onerror = reject;
				img.src = URL.createObjectURL(blob);
			});

			// Calculate additional properties
			const aspectRatio = img.width / img.height;
			const isSquare = Math.abs(aspectRatio - 1) < 0.01;
			const pixelCount = img.width * img.height;
			const fileSizeInBytes = binary.byteLength;

			Object.assign(replacements, {
				// Existing properties
				'{width}': img.width.toString(),
				'{height}': img.height.toString(),
				'{ratio}': aspectRatio.toFixed(2),
				'{aspectRatio}': aspectRatio.toFixed(3),
				'{orientation}': img.width > img.height ? 'landscape' : (img.width < img.height ? 'portrait' : 'square'),
				'{quality}': this.settings.quality.toString(),
				'{resolution}': `${img.width}x${img.height}`,
				'{megapixels}': (pixelCount / 1000000).toFixed(2),

				// New properties
				'{isSquare}': isSquare.toString(),
				'{pixelCount}': pixelCount.toString(),
				'{aspectRatioType}': (() => {
					if (isSquare) return '1:1';
					if (Math.abs(aspectRatio - 1.33) < 0.1) return '4:3';
					if (Math.abs(aspectRatio - 1.78) < 0.1) return '16:9';
					if (Math.abs(aspectRatio - 1.6) < 0.1) return '16:10';
					return 'custom';
				})(),
				'{resolutionCategory}': (() => {
					if (pixelCount < 100000) return 'tiny';      // < 0.1MP  (e.g., 316x316 or smaller)
					if (pixelCount < 500000) return 'small';     // < 0.5MP  (e.g., 707x707 or smaller)
					if (pixelCount < 2000000) return 'medium';   // < 2MP    (e.g., 1414x1414 or smaller)
					if (pixelCount < 8000000) return 'large';    // < 8MP    (e.g., 2828x2828 or smaller)
					return 'very-large';                         // >= 8MP   (e.g., larger than 2828x2828)
				})(),
				'{fileSizeCategory}': (() => {
					const sizeInBytes = fileSizeInBytes;
					if (sizeInBytes < 50 * 1024) return '0-50KB';
					if (sizeInBytes < 200 * 1024) return '51-200KB';
					if (sizeInBytes < 1024 * 1024) return '201-1024KB';
					if (sizeInBytes < 5 * 1024 * 1024) return '1025KB-5MB';
					if (sizeInBytes < 10 * 1024 * 1024) return '5MB-10MB';
					return '10MB+';                                  
				})(),
				'{dominantDimension}': img.width > img.height ? 'width' : (img.width < img.height ? 'height' : 'equal'),
				'{dimensionDifference}': Math.abs(img.width - img.height).toString(),
				'{bytesPerPixel}': (fileSizeInBytes / pixelCount).toFixed(2),
				'{compressionRatio}': (fileSizeInBytes / (pixelCount * 3)).toFixed(2), // Assuming RGB
				'{maxDimension}': Math.max(img.width, img.height).toString(),
				'{minDimension}': Math.min(img.width, img.height).toString(),
				'{diagonalPixels}': Math.sqrt(img.width * img.width + img.height * img.height).toFixed(0),
				'{aspectRatioSimplified}': (() => {
					const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
					const w = img.width;
					const h = img.height;
					const divisor = gcd(w, h);
					return `${w/divisor}:${h/divisor}`;
				})(),
				'{screenFitCategory}': (() => {
					const standardWidth = 1920;
					const standardHeight = 1080;
					if (img.width <= standardWidth && img.height <= standardHeight) return 'fits-1080p';
					if (img.width <= 2560 && img.height <= 1440) return 'fits-1440p';
					if (img.width <= 3840 && img.height <= 2160) return 'fits-4k';
					return 'above-4k';
				})(),
			});

			URL.revokeObjectURL(img.src);

			// EXIF data handling
			// try {
			// 	const exifr = await import('exifr').then(module => module.default);
			// 	const exifData = await exifr.parse(blob);
			// 	if (exifData) {
			// 		Object.assign(replacements, {
			// 			'{dpi}': exifData.XResolution?.toString() || '',
			// 			'{colorModel}': exifData.ColorSpace || '',
			// 			'{compression}': exifData.Compression?.toString() || '',
			// 			'{exif}': JSON.stringify(exifData).slice(0, 50),
			// 		});
			// 	}
			// } catch (error) {
			// 	console.debug('EXIF data extraction failed:', error);
			// }
		} catch (error) {
			console.debug('Image processing failed:', error);
		}

		// Replace all variables in the template
		for (const [key, value] of Object.entries(replacements)) {
			const regex = new RegExp(this.escapeRegExp(key), 'i');
			// Use a non-regex replacement first to avoid special characters issues
			result = result.replace(regex, value);
		}

		// Clean up the path
		// 1. Replace multiple slashes with single slash
		result = result.replace(/\/+/g, '/');
		// 2. Replace invalid characters with underscore, but preserve slashes
		result = result.split('/').map(segment =>
			segment.replace(/[<>:"\\|?*]/g, '_')
		).join('/');

		// 3. Remove leading/trailing slashes
		result = result.replace(/^\/+|\/+$/g, '');

		return result;
	}

	public async generatePathPreview(template: string, file: TFile): Promise<string> {
		return this.processSubfolderVariables(template, file, file);
	}

	// private normalizePath(path: string): string {
	// 	return path.toLowerCase();
	// }

	// Helper function to manage counters for renaming e.g. -001 002 003 etc. 
	private async getNextCounter(folderPath: string): Promise<number> {
		const counterKey = `counter-${folderPath}`;
		let counter = this.counters.get(counterKey) || 0;
		counter++;
		this.counters.set(counterKey, counter);
		return counter;
	}

	generateRandomHex(size: number) {
		const array = new Uint8Array(size);
		window.crypto.getRandomValues(array);
		return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
	}

	private async generateMD5(text: string): Promise<string> {
		// Implementation of MD5 algorithm
		function md5(string: string): string {
			function rotateLeft(value: number, shift: number): number {
				return (value << shift) | (value >>> (32 - shift));
			}

			function addUnsigned(lX: number, lY: number): number {
				const lX8 = lX & 0x80000000;
				const lY8 = lY & 0x80000000;
				const lX4 = lX & 0x40000000;
				const lY4 = lY & 0x40000000;
				const lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF);

				if (lX4 & lY4) {
					return lResult ^ 0x80000000 ^ lX8 ^ lY8;
				}
				if (lX4 | lY4) {
					if (lResult & 0x40000000) {
						return lResult ^ 0xC0000000 ^ lX8 ^ lY8;
					} else {
						return lResult ^ 0x40000000 ^ lX8 ^ lY8;
					}
				} else {
					return lResult ^ lX8 ^ lY8;
				}
			}

			function F(x: number, y: number, z: number): number {
				return (x & y) | ((~x) & z);
			}

			function G(x: number, y: number, z: number): number {
				return (x & z) | (y & (~z));
			}

			function H(x: number, y: number, z: number): number {
				return x ^ y ^ z;
			}

			function I(x: number, y: number, z: number): number {
				return y ^ (x | (~z));
			}

			function FF(a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number {
				a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac));
				return addUnsigned(rotateLeft(a, s), b);
			}

			function GG(a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number {
				a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac));
				return addUnsigned(rotateLeft(a, s), b);
			}

			function HH(a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number {
				a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac));
				return addUnsigned(rotateLeft(a, s), b);
			}

			function II(a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number {
				a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac));
				return addUnsigned(rotateLeft(a, s), b);
			}

			function convertToWordArray(string: string): number[] {
				let lWordCount: number;
				const lMessageLength = string.length;
				const lNumberOfWordsTemp1 = lMessageLength + 8;
				const lNumberOfWordsTemp2 = (lNumberOfWordsTemp1 - (lNumberOfWordsTemp1 % 64)) / 64;
				const lNumberOfWords = (lNumberOfWordsTemp2 + 1) * 16;
				const lWordArray = Array(lNumberOfWords - 1);
				let lBytePosition = 0;
				let lByteCount = 0;

				while (lByteCount < lMessageLength) {
					lWordCount = (lByteCount - (lByteCount % 4)) / 4;
					lBytePosition = (lByteCount % 4) * 8;
					lWordArray[lWordCount] = (lWordArray[lWordCount] || 0) | (string.charCodeAt(lByteCount) << lBytePosition);
					lByteCount++;
				}

				lWordCount = (lByteCount - (lByteCount % 4)) / 4;
				lBytePosition = (lByteCount % 4) * 8;
				lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition);
				lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
				lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;

				return lWordArray;
			}

			function wordToHex(lValue: number): string {
				let WordToHexValue = "",
					WordToHexValueTemp = "",
					lByte, lCount;

				for (lCount = 0; lCount <= 3; lCount++) {
					lByte = (lValue >>> (lCount * 8)) & 255;
					WordToHexValueTemp = "0" + lByte.toString(16);
					WordToHexValue = WordToHexValue + WordToHexValueTemp.substr(WordToHexValueTemp.length - 2, 2);
				}

				return WordToHexValue;
			}

			const x = convertToWordArray(string);
			let k, AA, BB, CC, DD, a, b, c, d;
			const S11 = 7, S12 = 12, S13 = 17, S14 = 22;
			const S21 = 5, S22 = 9, S23 = 14, S24 = 20;
			const S31 = 4, S32 = 11, S33 = 16, S34 = 23;
			const S41 = 6, S42 = 10, S43 = 15, S44 = 21;

			a = 0x67452301;
			b = 0xEFCDAB89;
			c = 0x98BADCFE;
			d = 0x10325476;

			for (k = 0; k < x.length; k += 16) {
				AA = a;
				BB = b;
				CC = c;
				DD = d;

				a = FF(a, b, c, d, x[k], S11, 0xD76AA478);
				d = FF(d, a, b, c, x[k + 1], S12, 0xE8C7B756);
				c = FF(c, d, a, b, x[k + 2], S13, 0x242070DB);
				b = FF(b, c, d, a, x[k + 3], S14, 0xC1BDCEEE);
				a = FF(a, b, c, d, x[k + 4], S11, 0xF57C0FAF);
				d = FF(d, a, b, c, x[k + 5], S12, 0x4787C62A);
				c = FF(c, d, a, b, x[k + 6], S13, 0xA8304613);
				b = FF(b, c, d, a, x[k + 7], S14, 0xFD469501);
				a = FF(a, b, c, d, x[k + 8], S11, 0x698098D8);
				d = FF(d, a, b, c, x[k + 9], S12, 0x8B44F7AF);
				c = FF(c, d, a, b, x[k + 10], S13, 0xFFFF5BB1);
				b = FF(b, c, d, a, x[k + 11], S14, 0x895CD7BE);
				a = FF(a, b, c, d, x[k + 12], S11, 0x6B901122);
				d = FF(d, a, b, c, x[k + 13], S12, 0xFD987193);
				c = FF(c, d, a, b, x[k + 14], S13, 0xA679438E);
				b = FF(b, c, d, a, x[k + 15], S14, 0x49B40821);

				a = GG(a, b, c, d, x[k + 1], S21, 0xF61E2562);
				d = GG(d, a, b, c, x[k + 6], S22, 0xC040B340);
				c = GG(c, d, a, b, x[k + 11], S23, 0x265E5A51);
				b = GG(b, c, d, a, x[k], S24, 0xE9B6C7AA);
				a = GG(a, b, c, d, x[k + 5], S21, 0xD62F105D);
				d = GG(d, a, b, c, x[k + 10], S22, 0x2441453);
				c = GG(c, d, a, b, x[k + 15], S23, 0xD8A1E681);
				b = GG(b, c, d, a, x[k + 4], S24, 0xE7D3FBC8);
				a = GG(a, b, c, d, x[k + 9], S21, 0x21E1CDE6);
				d = GG(d, a, b, c, x[k + 14], S22, 0xC33707D6);
				c = GG(c, d, a, b, x[k + 3], S23, 0xF4D50D87);
				b = GG(b, c, d, a, x[k + 8], S24, 0x455A14ED);
				a = GG(a, b, c, d, x[k + 13], S21, 0xA9E3E905);
				d = GG(d, a, b, c, x[k + 2], S22, 0xFCEFA3F8);
				c = GG(c, d, a, b, x[k + 7], S23, 0x676F02D9);
				b = GG(b, c, d, a, x[k + 12], S24, 0x8D2A4C8A);

				a = HH(a, b, c, d, x[k + 5], S31, 0xFFFA3942);
				d = HH(d, a, b, c, x[k + 8], S32, 0x8771F681);
				c = HH(c, d, a, b, x[k + 11], S33, 0x6D9D6122);
				b = HH(b, c, d, a, x[k + 14], S34, 0xFDE5380C);
				a = HH(a, b, c, d, x[k + 1], S31, 0xA4BEEA44);
				d = HH(d, a, b, c, x[k + 4], S32, 0x4BDECFA9);
				c = HH(c, d, a, b, x[k + 7], S33, 0xF6BB4B60);
				b = HH(b, c, d, a, x[k + 10], S34, 0xBEBFBC70);
				a = HH(a, b, c, d, x[k + 13], S31, 0x289B7EC6);
				d = HH(d, a, b, c, x[k], S32, 0xEAA127FA);
				c = HH(c, d, a, b, x[k + 3], S33, 0xD4EF3085);
				b = HH(b, c, d, a, x[k + 6], S34, 0x4881D05);
				a = HH(a, b, c, d, x[k + 9], S31, 0xD9D4D039);
				d = HH(d, a, b, c, x[k + 12], S32, 0xE6DB99E5);
				c = HH(c, d, a, b, x[k + 15], S33, 0x1FA27CF8);
				b = HH(b, c, d, a, x[k + 2], S34, 0xC4AC5665);

				a = II(a, b, c, d, x[k], S41, 0xF4292244);
				d = II(d, a, b, c, x[k + 7], S42, 0x432AFF97);
				c = II(c, d, a, b, x[k + 14], S43, 0xAB9423A7);
				b = II(b, c, d, a, x[k + 5], S44, 0xFC93A039);
				a = II(a, b, c, d, x[k + 12], S41, 0x655B59C3);
				d = II(d, a, b, c, x[k + 3], S42, 0x8F0CCC92);
				c = II(c, d, a, b, x[k + 10], S43, 0xFFEFF47D);
				b = II(b, c, d, a, x[k + 1], S44, 0x85845DD1);
				a = II(a, b, c, d, x[k + 8], S41, 0x6FA87E4F);
				d = II(d, a, b, c, x[k + 15], S42, 0xFE2CE6E0);
				c = II(c, d, a, b, x[k + 6], S43, 0xA3014314);
				b = II(b, c, d, a, x[k + 13], S44, 0x4E0811A1);
				a = II(a, b, c, d, x[k + 4], S41, 0xF7537E82);
				d = II(d, a, b, c, x[k + 11], S42, 0xBD3AF235);
				c = II(c, d, a, b, x[k + 2], S43, 0x2AD7D2BB);
				b = II(b, c, d, a, x[k + 9], S44, 0xEB86D391);

				a = addUnsigned(a, AA);
				b = addUnsigned(b, BB);
				c = addUnsigned(c, CC);
				d = addUnsigned(d, DD);
			}

			const temp = wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d);
			return temp.toLowerCase();
		}

		try {
			return md5(text);
		} catch (error) {
			console.error('MD5 generation failed:', error);
			return 'error';
		}
	}

	/* ------------------------------------------------------------- */
	/* ------------------------------------------------------------- */

	//Process All Vault
	/* ------------------------------------------------------------- */
	async processAllVaultImages() {
		const getallfiles = this.app.vault.getFiles();
		const files = getallfiles.filter(file => file instanceof TFile && isImage(file) && this.shouldProcessImage(file));
		let imageCount = 0;

		// Create a status bar item
		const statusBarItemEl = this.addStatusBarItem();

		// Record the start time
		const startTime = Date.now();

		for (const file of files) {
			if (isImage(file)) {
				imageCount++;

				// Log each file, this way the log will show files even if there is an error
				console.log(`Processing image ${imageCount} of ${files.length}: ${file.name} ${file.path}`)

				await this.convertAllVault(file);

				await refreshImagesInActiveNote();

				// Calculate the elapsed time
				const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);

				// Update the status bar item
				statusBarItemEl.setText(`Processing image ${imageCount} of ${files.length}, elapsed time: ${elapsedTime} seconds`);
				// Log each file, if there is delay, at least log will show corrupt file
				console.log(`${imageCount} of ${files.length} ${file.name} ${file.path}  ${elapsedTime} seconds elapsed`);
			}
		}

		if (imageCount === 0) {
			new Notice('No images found in the vault.');
		} else {
			new Notice(`${imageCount} images were converted.`);
			// Update the status bar item to show that processing is complete
			const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
			statusBarItemEl.setText(`Finished processing ${imageCount} images, total time: ${totalTime} seconds`);
			// Hide the status bar after 5 seconds
			setTimeout(() => {
				statusBarItemEl.setText('');
			}, 5000); // 5000 milliseconds = 5 seconds
		}
	}

	async convertAllVault(file: TFile) {
		// Check if extension/format needs to be preserved
		let extension = file.extension;
		if (this.settings.ProcessAllVaultconvertTo && this.settings.ProcessAllVaultconvertTo !== 'disabled') {
			extension = this.settings.ProcessAllVaultconvertTo;
			await this.updateAllVaultLinks(file, extension);
		} else {
			await this.updateAllVaultLinks(file, extension);
		}

		const binary = await this.app.vault.readBinary(file);
		let imgBlob = new Blob([binary], { type: `image/${file.extension}` });

		// In your main code:
		if (file.extension === 'tif' || file.extension === 'tiff') {
			imgBlob = await handleTiffImage(binary);
		}

		if (file.extension === 'heic') {
			imgBlob = await convertHeicToFormat(
				binary,
				'JPEG',
				Number(this.settings.ProcessAllVaultquality)
			);
		}

		if (this.settings.ProcessAllVaultquality !== 1) {
			if (this.settings.ProcessAllVaultconvertTo === 'webp') {
				const arrayBufferWebP = await convertToWebP(
					imgBlob,
					Number(this.settings.ProcessAllVaultquality),
					this.settings.ProcessAllVaultResizeModalresizeMode,
					this.settings.ProcessAllVaultResizeModaldesiredWidth,
					this.settings.ProcessAllVaultResizeModaldesiredHeight,
					this.settings.ProcessAllVaultResizeModaldesiredLength
				);
				await this.app.vault.modifyBinary(file, arrayBufferWebP);
			} else if (this.settings.ProcessAllVaultconvertTo === 'jpg') {
				const arrayBufferJPG = await convertToJPG(
					imgBlob,
					Number(this.settings.ProcessAllVaultquality),
					this.settings.ProcessAllVaultResizeModalresizeMode,
					this.settings.ProcessAllVaultResizeModaldesiredWidth,
					this.settings.ProcessAllVaultResizeModaldesiredHeight,
					this.settings.ProcessAllVaultResizeModaldesiredLength
				);
				await this.app.vault.modifyBinary(file, arrayBufferJPG);
			} else if (this.settings.ProcessAllVaultconvertTo === 'png') {
				const arrayBufferPNG = await convertToPNG(
					imgBlob,
					Number(this.settings.ProcessAllVaultquality),
					this.settings.ProcessAllVaultResizeModalresizeMode,
					this.settings.ProcessAllVaultResizeModaldesiredWidth,
					this.settings.ProcessAllVaultResizeModaldesiredHeight,
					this.settings.ProcessAllVaultResizeModaldesiredLength
				);
				await this.app.vault.modifyBinary(file, arrayBufferPNG);
			} else if (this.settings.ProcessAllVaultconvertTo === 'disabled') {
				let arrayBuffer;
				if (file.extension === 'jpg' || file.extension === 'jpeg') {
					arrayBuffer = await convertToJPG(
						imgBlob,
						Number(this.settings.ProcessAllVaultquality),
						this.settings.ProcessAllVaultResizeModalresizeMode,
						this.settings.ProcessAllVaultResizeModaldesiredWidth,
						this.settings.ProcessAllVaultResizeModaldesiredHeight,
						this.settings.ProcessAllVaultResizeModaldesiredLength
					);
				} else if (file.extension === 'png') {
					arrayBuffer = await convertToPNG(
						imgBlob,
						Number(this.settings.ProcessAllVaultquality),
						this.settings.ProcessAllVaultResizeModalresizeMode,
						this.settings.ProcessAllVaultResizeModaldesiredWidth,
						this.settings.ProcessAllVaultResizeModaldesiredHeight,
						this.settings.ProcessAllVaultResizeModaldesiredLength
					);
				} else if (file.extension === 'webp') {
					arrayBuffer = await convertToWebP(
						imgBlob,
						Number(this.settings.ProcessAllVaultquality),
						this.settings.ProcessAllVaultResizeModalresizeMode,
						this.settings.ProcessAllVaultResizeModaldesiredWidth,
						this.settings.ProcessAllVaultResizeModaldesiredHeight,
						this.settings.ProcessAllVaultResizeModaldesiredLength
					);
				}
				if (arrayBuffer) {
					await this.app.vault.modifyBinary(file, arrayBuffer);
				} else {
					new Notice('Error: Failed to compress image.');
				}
			} else {
				new Notice('Error: No format selected for conversion.');
				return;
			}
		} else if (this.settings.ProcessAllVaultquality === 1 && this.settings.ProcessAllVaultResizeModalresizeMode !== 'None') { // Do not compress, but allow resizing
			let arrayBuffer;
			if (file.extension === 'jpg' || file.extension === 'jpeg') {
				arrayBuffer = await convertToJPG(
					imgBlob,
					1,
					this.settings.ProcessAllVaultResizeModalresizeMode,
					this.settings.ProcessAllVaultResizeModaldesiredWidth,
					this.settings.ProcessAllVaultResizeModaldesiredHeight,
					this.settings.ProcessAllVaultResizeModaldesiredLength
				);
			} else if (file.extension === 'png') {
				arrayBuffer = await convertToPNG(
					imgBlob,
					1,
					this.settings.ProcessAllVaultResizeModalresizeMode,
					this.settings.ProcessAllVaultResizeModaldesiredWidth,
					this.settings.ProcessAllVaultResizeModaldesiredHeight,
					this.settings.ProcessAllVaultResizeModaldesiredLength
				);
			} else if (file.extension === 'webp') {
				arrayBuffer = await convertToWebP(
					imgBlob,
					1,
					this.settings.ProcessAllVaultResizeModalresizeMode,
					this.settings.ProcessAllVaultResizeModaldesiredWidth,
					this.settings.ProcessAllVaultResizeModaldesiredHeight,
					this.settings.ProcessAllVaultResizeModaldesiredLength
				);
			}
			if (arrayBuffer) {
				await this.app.vault.modifyBinary(file, arrayBuffer);
			} else {
				new Notice('Error: Failed to resize image.');
			}
		} else {
			new Notice('Original file kept without any compression.');
		}

		const newFilePath = file.path.replace(/\.[^/.]+$/, "." + extension);
		await this.app.vault.rename(file, newFilePath);
	}

	async updateAllVaultLinks(file: TFile, newExtension: string) { // https://forum.obsidian.md/t/vault-rename-file-path-doesnt-trigger-link-update/32317
		// Get the new file path
		const newFilePath = file.path.replace(/\.[^/.]+$/, "." + newExtension);

		// Rename the file and update all links to it
		await this.app.fileManager.renameFile(file, newFilePath);

		// Get all markdown files in the vault
		const markdownFiles = this.app.vault.getMarkdownFiles();

		// Iterate over each markdown file
		for (const markdownFile of markdownFiles) {
			// Read the content of the file
			let content = await this.app.vault.read(markdownFile);

			// Generate a new markdown link for the renamed file
			const newLink = this.app.fileManager.generateMarkdownLink(file, markdownFile.path);

			// Replace all old links with the new link
			const oldLink = `![[${file.basename}]]`;
			content = content.split(oldLink).join(newLink);

			// Write the updated content back to the file
			await this.app.vault.modify(markdownFile, content);
		}
	}

	shouldProcessImage(image: TFile): boolean {
		if (this.settings.ProcessAllVaultskipImagesInTargetFormat && image.extension === this.settings.ProcessAllVaultconvertTo) {
			return false;
		}
		return true;
	}

	/* ------------------------------------------------------------- */
	/* ------------------------------------------------------------- */

	//Process Current Note
	/* ------------------------------------------------------------- */
	async processCurrentNoteImages(note: TFile) {
		let imageCount = 0;
		const statusBarItemEl = this.addStatusBarItem();
		const startTime = Date.now();

		// Get path from image link
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView) {
			const currentFile = activeView.file;
			if (currentFile) {
				const resolvedLinks = this.app.metadataCache.resolvedLinks;
				const linksInCurrentNote = resolvedLinks[currentFile.path];
				const totalLinks = Object.keys(linksInCurrentNote).length;
				for (const link in linksInCurrentNote) {
					const linkedFile = this.app.vault.getAbstractFileByPath(link);
					if (linkedFile instanceof TFile && isImage(linkedFile)) {
						imageCount++;
						await this.convertCurrentNoteImages(linkedFile);
						refreshImagesInActiveNote();
						const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
						statusBarItemEl.setText(`Processing image ${imageCount} of ${totalLinks}, elapsed time: ${elapsedTime} seconds`);
					}
				}
			}
		}

		if (imageCount === 0) {
			new Notice('No images found in the vault.');
		} else {
			new Notice(`${imageCount} images were converted.`);
			const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
			statusBarItemEl.setText(`Finished processing ${imageCount} images, total time: ${totalTime} seconds`);
			setTimeout(() => {
				statusBarItemEl.setText('');
			}, 5000);
		}
	}

	async convertCurrentNoteImages(file: TFile) {
		const activeFile = this.getActiveFile();

		if (!activeFile) {
			new Notice('Error: No active file found.');
			return;
		}

		// Check if extension/format needs to be preserved
		let extension = file.extension;
		if (this.settings.ProcessCurrentNoteconvertTo && this.settings.ProcessCurrentNoteconvertTo !== 'disabled') {
			extension = this.settings.ProcessCurrentNoteconvertTo;
			await this.updateCurrentNoteLinks(activeFile, file, extension);
		} else {
			await this.updateCurrentNoteLinks(activeFile, file, extension);
		}

		const binary = await this.app.vault.readBinary(file);
		let imgBlob = new Blob([binary], { type: `image/${file.extension}` });

		// In your main code:
		if (file.extension === 'tif' || file.extension === 'tiff') {
			imgBlob = await handleTiffImage(binary);
		}

		if (file.extension === 'heic') {
			imgBlob = await convertHeicToFormat(
				binary,
				'JPEG',
				Number(this.settings.ProcessCurrentNotequality)
			);
		}

		if (this.settings.ProcessCurrentNotequality !== 1) { // Compression only works between 0-99
			if (this.settings.ProcessCurrentNoteconvertTo === 'webp') {
				const arrayBufferWebP = await convertToWebP(
					imgBlob,
					Number(this.settings.ProcessCurrentNotequality),
					this.settings.ProcessCurrentNoteResizeModalresizeMode,
					this.settings.ProcessCurrentNoteresizeModaldesiredWidth,
					this.settings.ProcessCurrentNoteresizeModaldesiredHeight,
					this.settings.ProcessCurrentNoteresizeModaldesiredLength
				);
				await this.app.vault.modifyBinary(file, arrayBufferWebP);
			} else if (this.settings.ProcessCurrentNoteconvertTo === 'jpg') {
				const arrayBufferJPG = await convertToJPG(
					imgBlob,
					Number(this.settings.ProcessCurrentNotequality),
					this.settings.ProcessCurrentNoteResizeModalresizeMode,
					this.settings.ProcessCurrentNoteresizeModaldesiredWidth,
					this.settings.ProcessCurrentNoteresizeModaldesiredHeight,
					this.settings.ProcessCurrentNoteresizeModaldesiredLength
				);
				await this.app.vault.modifyBinary(file, arrayBufferJPG);
			} else if (this.settings.ProcessCurrentNoteconvertTo === 'png') {
				const arrayBufferPNG = await convertToPNG(
					imgBlob,
					Number(this.settings.ProcessCurrentNotequality),
					this.settings.ProcessCurrentNoteResizeModalresizeMode,
					this.settings.ProcessCurrentNoteresizeModaldesiredWidth,
					this.settings.ProcessCurrentNoteresizeModaldesiredHeight,
					this.settings.ProcessCurrentNoteresizeModaldesiredLength
				);
				await this.app.vault.modifyBinary(file, arrayBufferPNG);
			} else if (this.settings.ProcessCurrentNoteconvertTo === 'disabled') { // Same as original is selected? 
				let arrayBuffer;
				if (file.extension === 'jpg' || file.extension === 'jpeg') {
					arrayBuffer = await convertToJPG(
						imgBlob,
						Number(this.settings.ProcessCurrentNotequality),
						this.settings.ProcessCurrentNoteResizeModalresizeMode,
						this.settings.ProcessCurrentNoteresizeModaldesiredWidth,
						this.settings.ProcessCurrentNoteresizeModaldesiredHeight,
						this.settings.ProcessCurrentNoteresizeModaldesiredLength
					);
				} else if (file.extension === 'png') {
					arrayBuffer = await convertToPNG(
						imgBlob,
						Number(this.settings.ProcessCurrentNotequality),
						this.settings.ProcessCurrentNoteResizeModalresizeMode,
						this.settings.ProcessCurrentNoteresizeModaldesiredWidth,
						this.settings.ProcessCurrentNoteresizeModaldesiredHeight,
						this.settings.ProcessCurrentNoteresizeModaldesiredLength
					);
				} else if (file.extension === 'webp') {
					arrayBuffer = await convertToWebP(
						imgBlob,
						Number(this.settings.ProcessCurrentNotequality),
						this.settings.ProcessCurrentNoteResizeModalresizeMode,
						this.settings.ProcessCurrentNoteresizeModaldesiredWidth,
						this.settings.ProcessCurrentNoteresizeModaldesiredHeight,
						this.settings.ProcessCurrentNoteresizeModaldesiredLength
					);
				}
				if (arrayBuffer) {
					await this.app.vault.modifyBinary(file, arrayBuffer);
				} else {
					new Notice('Error: Failed to compress image.');
				}
			} else {
				new Notice('Error: No format selected for conversion.');
				return;
			}
		} else if (this.settings.ProcessCurrentNotequality === 1 && this.settings.ProcessCurrentNoteResizeModalresizeMode !== 'None') { // Do not compress, but allow resizing
			let arrayBuffer;
			if (file.extension === 'jpg' || file.extension === 'jpeg') {
				arrayBuffer = await convertToJPG(
					imgBlob,
					1,
					this.settings.ProcessCurrentNoteResizeModalresizeMode,
					this.settings.ProcessCurrentNoteresizeModaldesiredWidth,
					this.settings.ProcessCurrentNoteresizeModaldesiredHeight,
					this.settings.ProcessCurrentNoteresizeModaldesiredLength
				);
			} else if (file.extension === 'png') {
				arrayBuffer = await convertToPNG(
					imgBlob,
					1,
					this.settings.ProcessCurrentNoteResizeModalresizeMode,
					this.settings.ProcessCurrentNoteresizeModaldesiredWidth,
					this.settings.ProcessCurrentNoteresizeModaldesiredHeight,
					this.settings.ProcessCurrentNoteresizeModaldesiredLength
				);
			} else if (file.extension === 'webp') {
				arrayBuffer = await convertToWebP(
					imgBlob,
					1,
					this.settings.ProcessCurrentNoteResizeModalresizeMode,
					this.settings.ProcessCurrentNoteresizeModaldesiredWidth,
					this.settings.ProcessCurrentNoteresizeModaldesiredHeight,
					this.settings.ProcessCurrentNoteresizeModaldesiredLength
				);
			}
			if (arrayBuffer) {
				await this.app.vault.modifyBinary(file, arrayBuffer);
			} else {
				new Notice('Error: Failed to resize image.');
			}
		} else {
			new Notice('Original file kept without any compression.');
		}

		const newFilePath = file.path.replace(/\.[^/.]+$/, "." + extension);
		await this.app.vault.rename(file, newFilePath);
	}

	async updateCurrentNoteLinks(note: TFile, file: TFile, newExtension: string) {
		// Get the new file path
		const newFilePath = file.path.replace(/\.[^/.]+$/, "." + newExtension);

		// Rename the file and update all links to it
		await this.app.fileManager.renameFile(file, newFilePath);

		// Read the content of the note
		let content = await this.app.vault.read(note);

		// Generate a new markdown link for the renamed file
		const newLink = this.app.fileManager.generateMarkdownLink(file, note.path);

		// Replace all old links with the new link
		const oldLink = `![[${file.basename}]]`;
		content = content.split(oldLink).join(newLink);

		// Write the updated content back to the note
		await this.app.vault.modify(note, content);
	}

	/* ------------------------------------------------------------- */
	/* ------------------------------------------------------------- */

	private getActiveFile(): TFile | undefined {
		const markdownFile = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
		if (markdownFile) return markdownFile;
	
		const canvasLeaf = this.app.workspace.getLeavesOfType("canvas").find(leaf => (leaf.view as any)?.file);
		if (canvasLeaf) return (canvasLeaf.view as any).file;
	
		const excalidrawLeaf = this.app.workspace.getLeavesOfType("excalidraw").find(leaf => (leaf.view as any)?.file);
		if (excalidrawLeaf) return (excalidrawLeaf.view as any).file;
	
		return undefined;
	}
	

	getActiveEditor(sourcePath: string): Editor | null {
		let editor: Editor | null = null;
	
		const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (mdView?.file?.path === sourcePath) {
			editor = mdView.editor;
		}
	
		const canvasLeaf = this.app.workspace.getLeavesOfType("canvas").find(leaf => (leaf.view as any)?.file?.path === sourcePath);
		if (canvasLeaf) {
			editor = (canvasLeaf.view as any).canvas?.editor || null;
		}
	
		const excalidrawLeaf = this.app.workspace.getLeavesOfType("excalidraw").find(leaf => (leaf.view as any)?.file?.path === sourcePath);
		if (excalidrawLeaf) {
			editor = (excalidrawLeaf.view as any).excalidrawEditor || null;
		}
	
		return editor;
	}
	

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

function isImage(file: TFile): boolean {
    const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'avif', 'tif', 'tiff', 'bmp', 'svg', 'gif', 'mov'];
    return IMAGE_EXTS.includes(file.extension.toLowerCase());
}

function isBase64Image(src: string): boolean {
	// Check if src starts with 'data:image'
	return src.startsWith('data:image');
}

async function refreshImagesInActiveNote() {
	// {if any note is currently open} Refresh all images {currently will only auto update in Reading Mode}
	const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
	if (activeView) {
		const currentFile = activeView.file;
		if (currentFile) {
			const resolvedLinks = this.app.metadataCache.resolvedLinks;
			const linksInCurrentNote = resolvedLinks[currentFile.path];
			for (const link in linksInCurrentNote) {
				const linkedFile = this.app.vault.getAbstractFileByPath(link);
				if (linkedFile instanceof TFile && isImage(linkedFile)) {
					// Get all img elements in the active note
					const imgs = activeView.contentEl.querySelectorAll('img');
					imgs.forEach((img: HTMLImageElement) => {
						// Check if the img src matches the linked file path
						if (img.src.includes(linkedFile.path)) {
							// Refresh the image
							const newSrc = img.src + (img.src.includes('?') ? '&' : '?') + new Date().getTime();
							img.src = newSrc;
						}
					});
				}
			}
		}
	}
}


/* ------------------------------------------------------------- */
async function handleTiffImage(binary: ArrayBuffer): Promise<Blob> {
	try {
		// Dynamically import UTIF only when needed
		const UTIF = await import('./UTIF.js').then(module => module.default);

		// Convert ArrayBuffer to Uint8Array
		const binaryUint8Array = new Uint8Array(binary);

		// Decode TIFF image
		const ifds = UTIF.decode(binaryUint8Array);
		UTIF.decodeImage(binaryUint8Array, ifds[0]);
		const rgba = UTIF.toRGBA8(ifds[0]);

		// Create canvas and draw image
		const canvas = document.createElement('canvas');
		canvas.width = ifds[0].width;
		canvas.height = ifds[0].height;
		const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
		const imageData = ctx.createImageData(canvas.width, canvas.height);
		imageData.data.set(rgba);
		ctx.putImageData(imageData, 0, 0);

		// Convert canvas to Blob
		return new Promise<Blob>((resolve, reject) => {
			canvas.toBlob((blob) => {
				if (blob) {
					resolve(blob);
				} else {
					reject(new Error('Failed to convert canvas to Blob'));
				}
			});
		});
	} catch (error) {
		console.error('Error processing TIFF image:', error);
		throw new Error('Failed to process TIFF image');
	}
}

async function convertHeicToFormat(
    binary: ArrayBuffer,
    format: 'JPEG' | 'PNG',
    quality: number
): Promise<Blob> {
    try {
        // Import heic-to for both platforms
        const { heicTo } = await import('./heic-to.min.js');

        // Convert ArrayBuffer to Blob
        const blob = new Blob([binary], { type: 'image/heic' });

        // Determine MIME type for the conversion format
        const outputMimeType = mime.getType(format.toLowerCase()) || `image/${format.toLowerCase()}`;

        // Convert using heic-to
        return await heicTo({
            blob: blob,
            type: outputMimeType,
            quality: quality
        });
    } catch (error) {
        console.error('Error converting HEIC:', error);
        throw new Error(`Failed to convert HEIC image: ${error.message}`);
    }
}

async function handleHeicImage(
	file: TFile,
	binary: ArrayBuffer,
	settings: ImageConvertSettings,
	app: App
): Promise<Blob> {
	try {
		if (settings.convertTo === 'disabled') {
			new Notice('Original file kept without any compression or conversion.');
			return new Blob([binary]);
		}

		// Convert to JPEG first regardless of platform
		const imgBlob = await convertHeicToFormat(binary, 'JPEG', 1);

		if (settings.convertTo !== 'disabled') {
			let arrayBuffer;
			switch (settings.convertTo) {
				case 'webp':
					arrayBuffer = await convertToWebP(
						imgBlob,
						Number(settings.quality),
						settings.resizeMode,
						settings.desiredWidth,
						settings.desiredHeight,
						settings.desiredLength
					);
					break;
				case 'jpg':
					arrayBuffer = await convertToJPG(
						imgBlob,
						Number(settings.quality),
						settings.resizeMode,
						settings.desiredWidth,
						settings.desiredHeight,
						settings.desiredLength
					);
					break;
				case 'png':
					arrayBuffer = await convertToPNG(
						imgBlob,
						Number(settings.quality),
						settings.resizeMode,
						settings.desiredWidth,
						settings.desiredHeight,
						settings.desiredLength
					);
					break;
				default:
					throw new Error('No format selected for conversion');
			}

			if (arrayBuffer) {
				await app.vault.modifyBinary(file, arrayBuffer);
			}
		}

		return imgBlob;
	} catch (error) {
		console.error('Error in handleHeicImage:', error);
		throw error;
	}
}

function convertToWebP(file: Blob, quality: number, resizeMode: string, desiredWidth: number, desiredHeight: number, desiredLength: number): Promise<ArrayBuffer> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = (e) => {
			if (!e.target || !e.target.result) {
				reject(new Error('Failed to load file'));
				return;
			}
			const image = new Image();
			image.onload = () => {
				const canvas = document.createElement('canvas');
				const context = canvas.getContext('2d');
				if (!context) {
					reject(new Error('Failed to get canvas context'));
					return;
				}

				// Calculate the new dimensions of the image based on the selected resize mode
				// let imageWidth, imageHeight;
				let imageWidth = 0;
				let imageHeight = 0;
				const aspectRatio = image.naturalWidth / image.naturalHeight;
				switch (resizeMode) {
					case 'None':
						imageWidth = image.naturalWidth;
						imageHeight = image.naturalHeight;
						break
					case 'Fit':
						if (aspectRatio > desiredWidth / desiredHeight) {
							imageWidth = desiredWidth;
							imageHeight = imageWidth / aspectRatio;
						} else {
							imageHeight = desiredHeight;
							imageWidth = imageHeight * aspectRatio;
						}
						break;
					case 'Fill':
						if (aspectRatio > desiredWidth / desiredHeight) {
							imageHeight = desiredHeight;
							imageWidth = imageHeight * aspectRatio;
						} else {
							imageWidth = desiredWidth;
							imageHeight = imageWidth / aspectRatio;
						}
						break;
					case 'LongestEdge':
						if (image.naturalWidth > image.naturalHeight) {
							imageWidth = desiredLength;
							imageHeight = imageWidth / aspectRatio;
						} else {
							imageHeight = desiredLength;
							imageWidth = imageHeight * aspectRatio;
						}
						break;
					case 'ShortestEdge':
						if (image.naturalWidth < image.naturalHeight) {
							imageWidth = desiredLength;
							imageHeight = imageWidth / aspectRatio;
						} else {
							imageHeight = desiredLength;
							imageWidth = imageHeight * aspectRatio;
						}
						break;
					case 'Width':
						imageWidth = desiredWidth;
						imageHeight = desiredWidth / aspectRatio;
						break;
					case 'Height':
						imageHeight = desiredHeight;
						imageWidth = desiredHeight * aspectRatio;
						break;
				}

				let data = '';
				canvas.width = resizeMode === 'Fill' ? desiredWidth : imageWidth;
				canvas.height = resizeMode === 'Fill' ? desiredHeight : imageHeight;
				// context.fillStyle = '#fff';
				// context.fillRect(0, 0, canvas.width, canvas.height);
				context.save();
				context.translate(canvas.width / 2, canvas.height / 2);

				// Draw the resized and/or cropped 	image on the canvas
				context.drawImage(
					image,
					0,
					0,
					resizeMode === 'Fill' ? Math.min(image.naturalWidth, image.naturalHeight * aspectRatio) : image.naturalWidth,
					resizeMode === 'Fill' ? Math.min(image.naturalHeight, image.naturalWidth / aspectRatio) : image.naturalHeight,
					-imageWidth / 2,
					-imageHeight / 2,
					resizeMode === 'Fill' ? desiredWidth : imageWidth,
					resizeMode === 'Fill' ? desiredHeight : imageHeight
				);
				context.restore();
				data = canvas.toDataURL('image/webp', quality);

				const arrayBuffer = base64ToArrayBuffer(data);
				resolve(arrayBuffer);
			};
			image.src = e.target.result.toString();
		};
		reader.readAsDataURL(file);
	});
}

function convertToJPG(imgBlob: Blob, quality: number, resizeMode: string, desiredWidth: number, desiredHeight: number, desiredLength: number): Promise<ArrayBuffer> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = (e) => {
			if (!e.target || !e.target.result) {
				reject(new Error('Failed to load file'));
				return;
			}
			const image = new Image();
			image.onload = () => {
				const canvas = document.createElement('canvas');
				const context = canvas.getContext('2d');
				if (!context) {
					reject(new Error('Failed to get canvas context'));
					return;
				}

				// Calculate the new dimensions of the image based on the selected resize mode
				// let imageWidth, imageHeight;
				let imageWidth = 0;
				let imageHeight = 0;
				const aspectRatio = image.naturalWidth / image.naturalHeight;
				switch (resizeMode) {
					case 'None':
						imageWidth = image.naturalWidth;
						imageHeight = image.naturalHeight;
						break
					case 'Fit':
						if (aspectRatio > desiredWidth / desiredHeight) {
							imageWidth = desiredWidth;
							imageHeight = imageWidth / aspectRatio;
						} else {
							imageHeight = desiredHeight;
							imageWidth = imageHeight * aspectRatio;
						}
						break;
					case 'Fill':
						if (aspectRatio > desiredWidth / desiredHeight) {
							imageHeight = desiredHeight;
							imageWidth = imageHeight * aspectRatio;
						} else {
							imageWidth = desiredWidth;
							imageHeight = imageWidth / aspectRatio;
						}
						break;
					case 'LongestEdge':
						if (image.naturalWidth > image.naturalHeight) {
							imageWidth = desiredLength;
							imageHeight = imageWidth / aspectRatio;
						} else {
							imageHeight = desiredLength;
							imageWidth = imageHeight * aspectRatio;
						}
						break;
					case 'ShortestEdge':
						if (image.naturalWidth < image.naturalHeight) {
							imageWidth = desiredLength;
							imageHeight = imageWidth / aspectRatio;
						} else {
							imageHeight = desiredLength;
							imageWidth = imageHeight * aspectRatio;
						}
						break;
					case 'Width':
						imageWidth = desiredWidth;
						imageHeight = desiredWidth / aspectRatio;
						break;
					case 'Height':
						imageHeight = desiredHeight;
						imageWidth = desiredHeight * aspectRatio;
						break;
				}

				let data = '';
				canvas.width = resizeMode === 'Fill' ? desiredWidth : imageWidth;
				canvas.height = resizeMode === 'Fill' ? desiredHeight : imageHeight;
				// context.fillStyle = '#fff';
				// context.fillRect(0, 0, canvas.width, canvas.height);
				context.save();
				context.translate(canvas.width / 2, canvas.height / 2);

				// Draw the resized and/or cropped 	image on the canvas
				context.drawImage(
					image,
					0,
					0,
					resizeMode === 'Fill' ? Math.min(image.naturalWidth, image.naturalHeight * aspectRatio) : image.naturalWidth,
					resizeMode === 'Fill' ? Math.min(image.naturalHeight, image.naturalWidth / aspectRatio) : image.naturalHeight,
					-imageWidth / 2,
					-imageHeight / 2,
					resizeMode === 'Fill' ? desiredWidth : imageWidth,
					resizeMode === 'Fill' ? desiredHeight : imageHeight
				);
				context.restore();
				data = canvas.toDataURL('image/jpeg', quality);
				const arrayBuffer = base64ToArrayBuffer(data);
				resolve(arrayBuffer);
			};
			image.src = e.target.result.toString();
		};
		reader.readAsDataURL(imgBlob);
	});
}

function convertToPNG(imgBlob: Blob, colorDepth: number, resizeMode: string, desiredWidth: number, desiredHeight: number, desiredLength: number): Promise<ArrayBuffer> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = (e) => {
			if (!e.target || !e.target.result) {
				reject(new Error('Failed to load file'));
				return;
			}
			const image = new Image();
			image.onload = () => {
				const canvas = document.createElement('canvas');
				const context = canvas.getContext('2d');
				if (!context) {
					reject(new Error('Failed to get canvas context'));
					return;
				}

				// Calculate the new dimensions of the image based on the selected resize mode
				// let imageWidth, imageHeight;
				let imageWidth = 0;
				let imageHeight = 0;
				const aspectRatio = image.naturalWidth / image.naturalHeight;
				switch (resizeMode) {
					case 'None':
						imageWidth = image.naturalWidth;
						imageHeight = image.naturalHeight;
						break
					case 'Fit':
						if (aspectRatio > desiredWidth / desiredHeight) {
							imageWidth = desiredWidth;
							imageHeight = imageWidth / aspectRatio;
						} else {
							imageHeight = desiredHeight;
							imageWidth = imageHeight * aspectRatio;
						}
						break;
					case 'Fill':
						if (aspectRatio > desiredWidth / desiredHeight) {
							imageHeight = desiredHeight;
							imageWidth = imageHeight * aspectRatio;
						} else {
							imageWidth = desiredWidth;
							imageHeight = imageWidth / aspectRatio;
						}
						break;
					case 'LongestEdge':
						if (image.naturalWidth > image.naturalHeight) {
							imageWidth = desiredLength;
							imageHeight = imageWidth / aspectRatio;
						} else {
							imageHeight = desiredLength;
							imageWidth = imageHeight * aspectRatio;
						}
						break;
					case 'ShortestEdge':
						if (image.naturalWidth < image.naturalHeight) {
							imageWidth = desiredLength;
							imageHeight = imageWidth / aspectRatio;
						} else {
							imageHeight = desiredLength;
							imageWidth = imageHeight * aspectRatio;
						}
						break;
					case 'Width':
						imageWidth = desiredWidth;
						imageHeight = desiredWidth / aspectRatio;
						break;
					case 'Height':
						imageHeight = desiredHeight;
						imageWidth = desiredHeight * aspectRatio;
						break;
				}

				let data = '';
				canvas.width = resizeMode === 'Fill' ? desiredWidth : imageWidth;
				canvas.height = resizeMode === 'Fill' ? desiredHeight : imageHeight;
				// context.fillStyle = '#fff';
				// context.fillRect(0, 0, canvas.width, canvas.height);
				context.save();
				context.translate(canvas.width / 2, canvas.height / 2);

				// Draw the resized and/or cropped 	image on the canvas
				context.drawImage(
					image,
					0,
					0,
					resizeMode === 'Fill' ? Math.min(image.naturalWidth, image.naturalHeight * aspectRatio) : image.naturalWidth,
					resizeMode === 'Fill' ? Math.min(image.naturalHeight, image.naturalWidth / aspectRatio) : image.naturalHeight,
					-imageWidth / 2,
					-imageHeight / 2,
					resizeMode === 'Fill' ? desiredWidth : imageWidth,
					resizeMode === 'Fill' ? desiredHeight : imageHeight
				);
				context.restore();

				const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
				const reducedImageData = reduceColorDepth(imageData, colorDepth);
				context.putImageData(reducedImageData, 0, 0);
				data = canvas.toDataURL('image/png');
				const arrayBuffer = base64ToArrayBuffer(data);
				resolve(arrayBuffer);
			};
			image.src = e.target.result.toString();
		};
		reader.readAsDataURL(imgBlob);
	});
}

function reduceColorDepth(imageData: ImageData, colorDepth: number): ImageData {
	const canvas = document.createElement('canvas');
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		throw new Error('Failed to get canvas context');
	}
	canvas.width = imageData.width;
	canvas.height = imageData.height;
	ctx.putImageData(imageData, 0, 0);
	const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
	const numColors = Math.pow(256, colorDepth);
	const reducedData = new Uint8ClampedArray(data.length);
	for (let i = 0; i < data.length; i += 4) {
		const r = data[i];
		const g = data[i + 1];
		const b = data[i + 2];
		const reducedR = Math.round(r / (256 / numColors)) * (256 / numColors);
		const reducedG = Math.round(g / (256 / numColors)) * (256 / numColors);
		const reducedB = Math.round(b / (256 / numColors)) * (256 / numColors);
		reducedData[i] = reducedR;
		reducedData[i + 1] = reducedG;
		reducedData[i + 2] = reducedB;
		reducedData[i + 3] = data[i + 3];
	}
	const reducedImageData = new ImageData(reducedData, imageData.width, imageData.height);
	return reducedImageData;
}

function base64ToArrayBuffer(code: string): ArrayBuffer {
	const parts = code.split(';base64,');
	const raw = window.atob(parts[1]);
	const rawLength = raw.length;
	const uInt8Array = new Uint8Array(rawLength);
	for (let i = 0; i < rawLength; ++i) {
		uInt8Array[i] = raw.charCodeAt(i);
	}
	return uInt8Array.buffer;
}
/* ------------------------------------------------------------- */
/* ------------------------------------------------------------- */

function resizeImageScrollWheel(event: WheelEvent, img: HTMLImageElement | HTMLVideoElement) {

	const delta = Math.sign(event.deltaY); // get the direction of the scroll
	const scaleFactor = delta < 0 ? 1.1 : 0.9; // set the scale factor for resizing

	let newWidth;
	if (img instanceof HTMLVideoElement && img.style.width.endsWith('%')) {
		// If the element is a video and the width is in percentages, calculate the new width in percentages
		newWidth = parseFloat(img.style.width) * scaleFactor;
		// Ensure the width is within the range 1% - 100%
		newWidth = Math.max(1, Math.min(newWidth, 100));
	} else {
		// If the element is an image or the width is in pixels, calculate the new width in pixels
		newWidth = img.clientWidth * scaleFactor;
		// Ensure the image doesn't get too small
		newWidth = Math.max(newWidth, 50);
	}

	// Calculate the new height while maintaining the aspect ratio
	const aspectRatio = img.clientWidth / img.clientHeight;
	let newHeight = newWidth / aspectRatio;
	newHeight = Math.max(newHeight, 50); // Ensure the image doesn't get too small

	// Round the values to the nearest whole number
	newWidth = Math.round(newWidth);
	newHeight = Math.round(newHeight);

	// Calculate the new position of the image so that it zooms towards the mouse pointer
	const rect = img.getBoundingClientRect();
	const dx = event.clientX - rect.left; // horizontal distance from left edge of image to mouse pointer
	const dy = event.clientY - rect.top; // vertical distance from top edge of image to mouse pointer
	const newLeft = rect.left - dx * (newWidth / img.clientWidth - 1);
	const newTop = rect.top - dy * (newHeight / img.clientHeight - 1);

	return { newWidth, newHeight, newLeft, newTop };
}

async function getImageWidthSide(binary: ArrayBuffer): Promise<number | null> {
	try {
		if (Platform.isMobile) {
			// Fallback for mobile: create an image element and get dimensions
			return new Promise((resolve, reject) => {
				const blob = new Blob([binary]);
				const url = URL.createObjectURL(blob);
				const img = new Image();

				img.onload = () => {
					URL.revokeObjectURL(url);
					resolve(Math.max(img.width));
				};

				img.onerror = () => {
					URL.revokeObjectURL(url);
					resolve(null); // "Couldnt load an image"
				};

				img.src = url;
			});
		} else {
			// Desktop version using probe-image-size
			const probe = await import('probe-image-size').then(module => module.default);
			const buffer = Buffer.from(binary);
			const result = probe.sync(buffer);

			if (result) {
				return Math.max(result.width);
			}
		}

		console.log("Failed to get image dimensions");
		return null;
	} catch (error) {
		console.error('Error getting image dimensions:', error);
		// Instead of throwing, return null and handle it gracefully
		return null;
	}
}

function printEditorLineWidth(app: App): number {
	const activeView = app.workspace.getActiveViewOfType(MarkdownView);
	if (activeView) {
		// Get the editor's DOM element
		const editorElement = activeView.containerEl.querySelector('.cm-contentContainer');
		if (editorElement) {
			const width = (editorElement as HTMLElement).offsetWidth;
			return Number(width)
		} else {
			console.error('Element not found');
		}
	}
	return 0; // Default value if no editor is found
}



// function updateExternalLink(activeView: MarkdownView, img: HTMLImageElement | HTMLVideoElement, newWidth: number, newHeight: number): void {
// 	// Get the current link and alt text
// 	const currentLink = img.getAttribute("src");
// 	let altText = img.getAttribute("alt");
// 	const editor = activeView.editor;

// 	// Round newWidth to the nearest whole number
// 	const longestSide = Math.round(Math.max(newWidth, newHeight));

// 	if (altText) {
// 		altText = altText.replace(/\|\d+(\|\d+)?/g, ''); // remove any sizing info from alt text
// 	}

// 	// Construct the new markdown with the updated width
// 	const newMarkdown = `![${altText}|${longestSide}](${currentLink})`;

// 	// Get the line number of the current cursor position
// 	const lineNumber = editor.getCursor().line;

// 	// Get the content of the current line
// 	const lineContent = editor.getLine(lineNumber);

// 	// Replace the old markdown with the new one in the current line
// 	// If there is no sizing then add
// 	// If there is sizing then make sure it is the only one and there are no duplicate e.g. | size | size
// 	const updatedLineContent = lineContent.replace(/!\[(.*?)(\|\d+(\|\d+)?)?\]\((.*?)\)/, newMarkdown);

// 	// Update only the current line in the editor
// 	editor.replaceRange(updatedLineContent, { line: lineNumber, ch: 0 }, { line: lineNumber, ch: lineContent.length });
// }
// function updateMarkdownLink(activeView: MarkdownView, img: HTMLImageElement | HTMLVideoElement, imageName: string | null, newWidth: number, newHeight: number) {
// 	if (!imageName) return;

// 	const editor = activeView.editor;
// 	const doc = editor.getDoc();
// 	const lineCount = doc.lineCount();

// 	// Find the line containing the image's markdown link
// 	let lineIndex: number | undefined;
// 	for (let i = 0; i < lineCount; i++) {
// 		const line = doc.getLine(i);

// 		// Get the full image path from the markdown link
// 		const wikiLinkMatch = line.match(/!\[\[(.*?)(?:\|.*?)?\]\]/);
// 		if (wikiLinkMatch) {
// 			const fullPath = wikiLinkMatch[1];
// 			// Check if the line contains our image name at the end of the path
// 			if (fullPath.endsWith(imageName)) {
// 				lineIndex = i;
// 				break;
// 			}
// 		}
// 	}

// 	if (lineIndex !== undefined) {
// 		editor.setCursor({ line: lineIndex, ch: 0 });
// 		const cursor = editor.getCursor();
// 		const line = editor.getLine(cursor.line);

// 		// Calculate the longest side
// 		let longestSide;
// 		if (img instanceof HTMLImageElement) {
// 			const percentageIndex = line.indexOf('%', line.indexOf('|'));
// 			if (percentageIndex !== -1 && percentageIndex < line.indexOf(']]')) {
// 				newWidth = Math.round((newWidth / img.naturalWidth) * 100);
// 				newWidth = Math.min(newWidth, 100);
// 				longestSide = `${newWidth}%`;
// 			} else {
// 				longestSide = Math.round(Math.max(newWidth, newHeight));
// 			}
// 		} else if (img instanceof HTMLVideoElement) {
// 			const percentageIndex = line.indexOf('%', line.indexOf('|'));
// 			if (percentageIndex !== -1 && percentageIndex < line.indexOf(']]')) {
// 				newWidth = Math.min(newWidth, 100);
// 				longestSide = `${newWidth}%`;
// 			} else {
// 				longestSide = Math.round(newWidth);
// 			}
// 		}

// 		// Extract the full path and any existing size information
// 		const match = line.match(/!\[\[(.*?)(?:\|(\d+%?))?\]\]/);
// 		if (match) {
// 			const fullPath = match[1];
// 			const startPos = line.indexOf('![[');
// 			const endPos = line.indexOf(']]', startPos) + 2;

// 			// Preserve the full path and update only the size
// 			editor.replaceRange(`![[${fullPath}|${longestSide}]]`,
// 				{ line: cursor.line, ch: startPos },
// 				{ line: cursor.line, ch: endPos });
// 		}
// 	}
// }
// function resizeBase64Drag(activeView: MarkdownView, imageName: string | null, newWidth: number) {
// 	// When the user starts resizing the image, find and store the line number of the image
// 	// Get the current line content

// 	const editor = activeView.editor;
// 	const doc = editor.getDoc();
// 	const lineCount = doc.lineCount();
// 	let imageLine: number | null = null;

// 	if (imageName !== null) {
// 		for (let i = 0; i < lineCount; i++) {
// 			const line = doc.getLine(i);
// 			if (line.includes(imageName)) {
// 				imageLine = i;
// 				break;
// 			}
// 		}
// 	}

// 	const lineNumber = imageLine;
// 	if (lineNumber !== null) {
// 		const lineContent = editor.getLine(lineNumber);
// 		// Construct a new width attribute
// 		const newWidthAttribute = `width="${newWidth}"`;

// 		// Replace the old img tag with the new one in the current line
// 		let updatedLineContent = lineContent.replace(/width="[^"]*"/, newWidthAttribute);

// 		// If there was no width attribute in the original tag, add it to the new tag
// 		if (!updatedLineContent.includes(newWidthAttribute)) {
// 			updatedLineContent = updatedLineContent.replace('<img ', `<img ${newWidthAttribute} `);
// 		}

// 		// Update only the current line in the editor
// 		editor.replaceRange(updatedLineContent, { line: lineNumber, ch: 0 }, { line: lineNumber, ch: lineContent.length });
// 	}
// }

function updateImageLink({ activeView, element, newWidth, newHeight, settings }: LinkUpdateOptions): void {
    const editor = activeView.editor;
    const imageName = getImageName(element);
    if (!imageName) return;

    // Find the correct line containing our image
    const doc = editor.getDoc();
    const lineCount = doc.lineCount();
    let targetLine = -1;
    let targetLineContent = '';
    
    const currentLine = editor.getCursor().line;
    const currentLineContent = editor.getLine(currentLine);
    
    // Helper function to decode URL components for comparison
    const normalizeForComparison = (path: string) => {
        try {
            return decodeURIComponent(path).replace(/\\/g, '/');
        } catch {
            return path.replace(/\\/g, '/');
        }
    };

    if (isExternalLink(imageName)) {
        if (currentLineContent.includes(imageName)) {
            targetLine = currentLine;
            targetLineContent = currentLineContent;
        }
    } else {
        // Search through document looking for both exact matches and URL-encoded matches
        const normalizedImageName = normalizeForComparison(imageName);
        for (let i = 0; i < lineCount; i++) {
            const line = editor.getLine(i);
            const normalizedLine = normalizeForComparison(line);
            if (normalizedLine.includes(normalizedImageName)) {
                targetLine = i;
                targetLineContent = line;
                break;
            }
        }
    }

    if (targetLine === -1) return;

    const longestSide = Math.round(Math.max(newWidth, newHeight));

    let updatedContent = targetLineContent;
    let startCh = 0;
    let endCh = targetLineContent.length;

    // Updated pattern to handle both cases:
    // ![|242](path) and ![alttext|242](path)
    const markdownPattern = /!\[([^\]]*?)(?:\|\d+(?:\|\d+)?)?\]\(([^)]+)\)/g;
    const wikiLinkPattern = /!\[\[([^\]]+?)(?:\|\d+(?:\|\d+)?)?\]\]/g;

    let match;
    while ((match = markdownPattern.exec(targetLineContent)) !== null) {
        const fullMatch = match[0];
        const altText = match[1];
        const path = match[2];
        
        const normalizedPath = normalizeForComparison(path);
        const normalizedImageName = normalizeForComparison(imageName);
        
        if (normalizedPath.includes(normalizedImageName)) {
            // Preserve alt text if it exists, otherwise keep empty
            const newAltText = altText.replace(/\|\d+(\|\d+)?/g, '');
            const newMarkdown = `![${newAltText}|${longestSide}](${path})`;
            startCh = match.index;
            endCh = startCh + fullMatch.length;
            updatedContent = newMarkdown;
            break;
        }
    }

    // Only try wiki link pattern if markdown pattern didn't match
    if (startCh === 0 && endCh === targetLineContent.length) {
        while ((match = wikiLinkPattern.exec(targetLineContent)) !== null) {
            const fullMatch = match[0];
            const path = match[1].split('|')[0];
            
            const normalizedPath = normalizeForComparison(path);
            const normalizedImageName = normalizeForComparison(imageName);
            
            if (normalizedPath.includes(normalizedImageName)) {
                const newMarkdown = `![[${path}|${longestSide}]]`;
                startCh = match.index;
                endCh = startCh + fullMatch.length;
                updatedContent = newMarkdown;
                break;
            }
        }
    }

    // Update the content and maintain cursor position
    editor.replaceRange(
        updatedContent,
        { line: targetLine, ch: startCh },
        { line: targetLine, ch: endCh }
    );

    // Set cursor position more accurately
    let finalCursorPos;
    if (settings.cursorPosition === 'front') {
        finalCursorPos = {
            line: targetLine,
            ch: startCh
        };
    } else {
        // Get the updated line content after replacement
        const updatedLineContent = editor.getLine(targetLine);
        
        // Find the end of the link in the updated content
        const endOfLink = (() => {
            const mdMatch = updatedLineContent.slice(startCh).match(/!\[.*?\)\s*/);
            const wikiMatch = updatedLineContent.slice(startCh).match(/!\[\[.*?\]\]\s*/);
            
            if (mdMatch) {
                return startCh + mdMatch[0].length;
            } else if (wikiMatch) {
                return startCh + wikiMatch[0].length;
            }
            return endCh;
        })();

        finalCursorPos = {
            line: targetLine,
            ch: endOfLink
        };
    }

    editor.setCursor(finalCursorPos);
}
function getImageName(img: HTMLImageElement | HTMLVideoElement): string | null {
    let imageName = img.getAttribute("src");
    
    if (!imageName) return null;

    // Handle base64 images
    if (isBase64Image(imageName)) {
        return imageName;
    }
    
    // Handle external links
    if (isExternalLink(imageName)) {
        return imageName;
    }

    try {
        // Decode URI components to handle spaces and special characters
        imageName = decodeURIComponent(imageName);
        
        // Split on forward or backward slashes
        const parts = imageName.split(/[/\\]/);
        
        // Get the filename (last part)
        const fileName = parts[parts.length - 1].split('?')[0];
        
        // Return the full filename including any spaces
        return fileName;
    } catch (error) {
        console.error('Error processing image path:', error);
        return null;
    }
}
function isExternalLink(imageName: string): boolean {
	// This is a simple check that assumes any link starting with 'http' is an external link.
	return imageName.startsWith('http://') || imageName.startsWith('https://');
}


function getFullImagePath(activeView: MarkdownView | null, file: TFile): string | null {
    if (!activeView) return null;

    const editor = activeView.editor;
    const doc = editor.getDoc();
    const lineCount = doc.lineCount();

    // Helper function to normalize paths for comparison
    const normalizeForComparison = (path: string) => {
        return path.replace(/\\/g, '/')
            .replace(/%20/g, ' ')
            .split('?')[0]
            .toLowerCase()
            .trim();
    };

    const normalizedFileName = normalizeForComparison(file.name);
    const normalizedFilePath = normalizeForComparison(file.path);

    // Search for the full image path in the document
    for (let i = 0; i < lineCount; i++) {
        const line = doc.getLine(i);
        
        // Check for wiki-style links with dimensions
        const wikiLinkMatch = line.match(/!\[\[(.*?)(?:\|.*?)?\]\]/);
        if (wikiLinkMatch) {
            const linkPath = wikiLinkMatch[1].split('|')[0];
            const normalizedLinkPath = normalizeForComparison(linkPath);
            if (normalizedLinkPath.endsWith(normalizedFileName) || 
                normalizedLinkPath === normalizedFilePath) {
                return linkPath;
            }
        }
        
        // Check for standard markdown links with dimensions
        const mdLinkMatch = line.match(/!\[([^\]]*?)(?:\|\d+(?:\|\d+)?)?\]\(([^)]+)\)/);
        if (mdLinkMatch) {
            const linkPath = mdLinkMatch[2];
            const normalizedLinkPath = normalizeForComparison(linkPath);
            if (normalizedLinkPath.endsWith(normalizedFileName) || 
                normalizedLinkPath === normalizedFilePath) {
                return linkPath;
            }
        }
    }

    // If no exact match found, return the file path as fallback
    return file.path;
}
function deleteMarkdownLink(activeView: MarkdownView, imagePath: string | null) {
    if (!imagePath) return;

    const editor = activeView.editor;
    const doc = editor.getDoc();
    const lineCount = doc.lineCount();

    // Helper function to normalize paths for comparison
	const normalizeForComparison = (path: string) => {
		try {
			return decodeURIComponent(path)
				.replace(/\\/g, '/')
				.replace(/%20/g, ' ')
				.split('?')[0]  // Remove any query parameters
				.toLowerCase()
				.trim();
		} catch {
			return path
				.replace(/\\/g, '/')
				.replace(/%20/g, ' ')
				.split('?')[0]  // Remove any query parameters
				.toLowerCase()
				.trim();
		}
	};

    const normalizedImagePath = normalizeForComparison(imagePath);

    // Find the line containing the image
    let lineIndex: number | undefined;
    for (let i = 0; i < lineCount; i++) {
        const line = doc.getLine(i);
        
        // Handle base64 images
        if (line.includes('data:image') && imagePath.startsWith('data:image')) {
            if (line.includes(imagePath)) {
                lineIndex = i;
                break;
            }
            continue;
        }

        // Handle external links
        if (isExternalLink(imagePath)) {
            if (line.includes(imagePath)) {
                lineIndex = i;
                break;
            }
            continue;
        }

        // Handle both wiki-style and standard markdown links
        const wikiLinkMatch = line.match(/!\[\[(.*?)(?:\|.*?)?\]\]/);
        const markdownLinkMatch = line.match(/!\[([^\]]*?)(?:\|\d+(?:\|\d+)?)?\]\(([^)]+)\)/);

        if (wikiLinkMatch) {
            const normalizedWikiPath = normalizeForComparison(wikiLinkMatch[1].split('|')[0]);
            if (normalizedWikiPath === normalizedImagePath) {
                lineIndex = i;
                break;
            }
        }

		if (markdownLinkMatch) {
			const normalizedMdPath = normalizeForComparison(markdownLinkMatch[2]);
			const normalizedTargetPath = normalizeForComparison(imagePath);
			
			// Check if either path contains the other
			if (normalizedMdPath.includes(normalizedTargetPath) || 
				normalizedTargetPath.includes(normalizedMdPath)) {
				lineIndex = i;
				break;
			}
		}
    }

    if (lineIndex !== undefined) {
        editor.setCursor({ line: lineIndex, ch: 0 });
        const cursor = editor.getCursor();
        const line = editor.getLine(cursor.line);

        // Find the full markdown link
        let startPos: number;
        let endPos: number;

        if (line.includes('data:image')) {
            // Handle base64 images
            const imgTagRegex = /<img[^>]*src="[^"]*"[^>]*>/;
            const match = imgTagRegex.exec(line);
            if (match) {
                startPos = match.index;
                endPos = startPos + match[0].length;
            } else {
                return;
            }
		} else {
			// Handle all three link types
			// 1. Wiki-style links
			const wikiLinkMatch = line.match(/!\[\[.*?\]\]/);
			if (wikiLinkMatch) {
				startPos = line.indexOf('![[');
				endPos = line.indexOf(']]', startPos) + 2;
			} else {
				// 2. Standard markdown links with or without alt text
				const mdLinkMatch = line.match(/!\[([^\]]*?)(?:\|\d+)*\]\(([^)]+)\)/);
				
				if (mdLinkMatch) {
					startPos = line.indexOf('![');
					endPos = line.indexOf(')', startPos) + 1;
				} else {
					// console.log("No markdown match found");
					return;
				}
			}
		}

		// Delete the markdown link and any trailing whitespace
		let trailingWhitespace = 0;
		while (line[endPos + trailingWhitespace] === ' ' ||
			line[endPos + trailingWhitespace] === '\t') {
			trailingWhitespace++;
		}
		if (line[endPos + trailingWhitespace] === '\n') {
			trailingWhitespace++;
		}

		editor.replaceRange('',
			{ line: cursor.line, ch: startPos },
			{ line: cursor.line, ch: endPos + trailingWhitespace }
		);
	}
}
async function deleteImageFromVault(event: MouseEvent, app: App) {
    const img = event.target as HTMLImageElement;
    const src = img.getAttribute('src');
    if (!src) return;

    const activeView = app.workspace.getActiveViewOfType(MarkdownView);

    try {
        if (src.startsWith('data:image')) {
            // Handle Base64 image
            img.parentNode?.removeChild(img);
            if (activeView) {
                deleteMarkdownLink(activeView, src);
            }
            new Notice('Base64 encoded image deleted from the note');
            return;
        }

        if (src.startsWith('http') || src.startsWith('https')) {
            // Handle external image
            img.parentNode?.removeChild(img);
            if (activeView) {
                deleteMarkdownLink(activeView, src);
            }
            new Notice('External image link deleted from the note');
            return;
        }

        // Handle internal vault images
        const rootFolder = app.vault.getName();
        let imagePath = decodeURIComponent(src);


        // Clean up the path
        const rootFolderIndex = imagePath.indexOf(rootFolder);
        if (rootFolderIndex !== -1) {
            imagePath = imagePath.substring(rootFolderIndex + rootFolder.length + 1);
        }
        imagePath = imagePath.split('?')[0];


        // Get the file from vault
        const file = app.vault.getAbstractFileByPath(imagePath);
        if (file instanceof TFile && isImage(file)) {

            // Get the full markdown line for deletion
            const fullPath = getFullImagePath(activeView, file);

            // Delete the file from vault
            await app.vault.delete(file);

            // Delete the markdown link if we're in a note
            if (activeView && fullPath) {
                deleteMarkdownLink(activeView, fullPath);
            }

            new Notice(`Image deleted: ${file.path}`);
        }
    } catch (error) {
        console.error('Error deleting image:', error);
        new Notice('Failed to delete image. Check console for details.');
    }
}

export class ImageConvertTab extends PluginSettingTab {
	plugin: ImageConvertPlugin;
	private activeTab = 'convert'; // Default tab
	private tabContainer: HTMLElement;
	private contentContainer: HTMLElement;
	private previewEl: HTMLElement;
	private folderSettingsContainer: HTMLElement;
	private filenameSettingsContainer: HTMLElement;

	// Define available tabs
	private tabs: SettingsTab[] = [
		{ id: 'convert', name: 'Convert', icon: 'image-plus' },
		{ id: 'output', name: 'Output', icon: 'folder' },
		{ id: 'settings', name: 'Settings', icon: 'settings' },
		{ id: 'advanced', name: 'Advanced', icon: 'tool' }
	];

	constructor(app: App, plugin: ImageConvertPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}
	
	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Create tab container with modern styling
		this.tabContainer = containerEl.createDiv('nav-tabs-container');
		this.tabContainer.addClasses(['nav-tabs', 'is-tabs']);

		// Create content container
		this.contentContainer = containerEl.createDiv('nav-content-container');

		// Create tabs
		this.createTabs();

		// Display content for default/active tab
		this.displayTabContent(this.activeTab);
	}

	private createTabs(): void {
		const tabHeadersContainer = this.tabContainer.createDiv('nav-buttons-container');

		this.tabs.forEach(tab => {
			const tabButton = tabHeadersContainer.createDiv(`nav-button ${this.activeTab === tab.id ? 'is-active' : ''}`);

			// Add icon if specified
			if (tab.icon) {
				tabButton.createSpan({
					cls: `nav-button-icon ${tab.icon}`
				});
			}

			const text = tabButton.createSpan('nav-button-title');
			text.setText(tab.name);

			tabButton.addEventListener('click', () => {
				// Remove active class from all tabs
				this.tabContainer.findAll('.nav-button').forEach(el =>
					el.removeClass('is-active'));

				// Add active class to clicked tab
				tabButton.addClass('is-active');

				// Update content
				this.activeTab = tab.id;
				this.displayTabContent(tab.id);
			});
		});
	}

	private displayTabContent(tabId: string): void {
		this.contentContainer.empty();

		switch (tabId) {
			case 'convert':
				this.displayConvertSettings();
				break;
			case 'output':
				this.displayOutputSettings();
				break;
			case 'settings':
				this.displayGeneralSettings();
				break;
			case 'advanced':
				this.displayAdvancedSettings();
				break;
		}
	}

	// Convert to:
	private displayConvertSettings(): void {
		const container = this.contentContainer.createDiv('settings-container');

		// Format Setting
		new Setting(container)
			.setName('Format')
			.setDesc('Select format to convert images to')
			.addDropdown(dropdown =>
				dropdown
					.addOptions({
						disabled: 'Same as original',
						webp: 'WebP',
						jpg: 'JPG',
						png: 'PNG'
					})
					.setValue(this.plugin.settings.convertTo)
					.onChange(async value => {
						this.plugin.settings.convertTo = value;
						await this.plugin.saveSettings();
					})
			);

		// Quality Setting
		new Setting(container)
			.setName('Quality')
			.setDesc('0 - low quality, 99 - high quality, 100 - no compression; 75 - recommended')
			.addText(text =>
				text
					.setPlaceholder('Enter quality (0-100)')
					.setValue((this.plugin.settings.quality * 100).toString())
					.onChange(async value => {
						const quality = parseInt(value);
						if (/^\d+$/.test(value) && quality >= 0 && quality <= 100) {
							this.plugin.settings.quality = quality / 100;
							await this.plugin.saveSettings();
						}
					})
			);

		// Resize Mode Setting
		new Setting(container)
			.setName('Image resize mode')
			.setDesc('Select the mode to use when resizing the image')
			.addDropdown(dropdown =>
				dropdown
					.addOptions({
						None: 'None',
						Fit: 'Fit',
						Fill: 'Fill',
						LongestEdge: 'Longest Edge',
						ShortestEdge: 'Shortest Edge',
						Width: 'Width',
						Height: 'Height'
					})
					.setValue(this.plugin.settings.resizeMode)
					.onChange(async value => {
						this.plugin.settings.resizeMode = value;
						await this.plugin.saveSettings();
						if (value !== 'None') {
							const modal = new ResizeModal(this.plugin);
							modal.open();
						}
					})
			);
	}

	// Output
	private displayOutputSettings(): void {
		// Clear the container to prevent duplication
		this.contentContainer.empty();
	
		const container = this.contentContainer.createDiv('settings-container');
	
		new Setting(container)
			.setName('Use Markdown links')
			.setDesc('Auto generate Markdown links for dropped/pasted images')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useMdLinks)
				.setTooltip('Toggle between Markdown and Wiki links')
				.onChange(async (value) => {
					this.plugin.settings.useMdLinks = value;
					await this.plugin.saveSettings();
					new Notice(`Image links will now be in ${value ? 'Markdown' : 'Wiki'} format`);
					
					// Update the settings display to reflect the changes
					this.displayOutputSettings();
				}));
	
		if (this.plugin.settings.useMdLinks) {
			new Setting(container)
				.setName('Prepend paths with "./" for relative linking')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.useRelativePath)
					.onChange(async (value) => {
						this.plugin.settings.useRelativePath = value;
						await this.plugin.saveSettings();
					}));
		}
	
		// Output Location Setting
		new Setting(container)
			.setName("Output Location")
			.setDesc("Select where to save converted images.")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("default", "Default")
					.addOption("root", "Root folder")
					.addOption("current", "Same folder as current file")
					.addOption("subfolder", "In subfolder")
					.addOption("customOutput", "Custom output path")
					.setValue(this.plugin.settings.attachmentLocation)
					.onChange(async (value: 'default' | 'root' | 'current' | 'subfolder' | 'customOutput') => {
						this.plugin.settings.attachmentLocation = value;
						await this.plugin.saveSettings();
						this.updateFolderSettings();
						this.updateConsolidatedPreview();
					});
			});
	
		// Create containers for settings
		this.folderSettingsContainer = container.createDiv('folder-settings');
	
		// File Naming Setting
		new Setting(container)
			.setName('File Naming')
			.setDesc('Choose how to rename processed images')
			.addDropdown(dropdown => 
				dropdown
					.addOptions({
						'disabled': 'Keep original name',
						'custom': 'Custom template'
					})
					.setValue(this.plugin.settings.autoRename ?
						(this.plugin.settings.useCustomRenaming ? 'custom' : 'disabled') : 'disabled')
					.onChange(async (value) => {
						this.plugin.settings.autoRename = value !== 'disabled';
						this.plugin.settings.useCustomRenaming = value === 'custom';
						await this.plugin.saveSettings();
						this.updateFilenameSettings();
						this.updateConsolidatedPreview();
					}));
	
		this.filenameSettingsContainer = container.createDiv('filename-settings');
	
		new Setting(container)
			.setName("If an output file already exists")
			.setDesc("Replace - to replace already existing file in the destination with a new file.\
				Rename - automatically add '-1, -2 -3 etc.' suffix to the end of file")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						duplicate_replace: "Replace",
						duplicate_rename: "Rename"
					})
					.setValue(this.plugin.settings.manage_duplicate_filename)
					.onChange(async (value) => {
						this.plugin.settings.manage_duplicate_filename = value;
						await this.plugin.saveSettings();
						this.updateFilenameSettings();
						this.updateConsolidatedPreview();
					})
			);
	
		// Create preview element first
		this.previewEl = container.createDiv('preview-container');
	
		// Initialize settings
		this.updateFolderSettings();
		this.updateFilenameSettings();
		this.updateConsolidatedPreview();
	}

	private updateFolderSettings(): void {
		this.folderSettingsContainer.empty();

		switch (this.plugin.settings.attachmentLocation) {
			case "subfolder":
				this.createSubfolderSettings(this.folderSettingsContainer);
				break;
			case "customOutput":
				this.createCustomOutputSettings(this.folderSettingsContainer);
				break;
		}
	}

	private createSubfolderSettings(container: HTMLElement): void {
		new Setting(container)
			.setName("Subfolder name")
			.setDesc('Name of subfolder under current note\'s folder')
			.setClass('settings-indent')
			.addText((text) => {
				text.setPlaceholder('images/{yyyy}/{mm}')
					.setValue(this.plugin.settings.attachmentSubfolderName)
					.onChange(async (value) => {
						this.plugin.settings.attachmentSubfolderName = value;
						await this.plugin.saveSettings();
						this.updateConsolidatedPreview(); 
					});
			});
	}

	private createCustomOutputSettings(container: HTMLElement): void {
		new Setting(container)
			.setName("Custom output path")
			.setDesc("Define custom path with variables (e.g., {date}, {title})")
			.setClass('settings-indent')
			.addText((text) => {
				text.setPlaceholder('custom/path/{yyyy}/{mm}')
					.setValue(this.plugin.settings.customOutputPath)
					.onChange(async (value) => {
						this.plugin.settings.customOutputPath = value;
						await this.plugin.saveSettings();
						this.updateConsolidatedPreview();
					});
			});
	}

	private async updateConsolidatedPreview(): Promise<void> {
		try {
			const activeFile = this.app.workspace.getActiveFile();
			const mockFile = activeFile || this.app.vault.getFiles()[0];
			if (!mockFile) return;
	
			// Create preview sections
			this.previewEl.empty();
			
			// Main preview showing just the final path
			const previewContainer = this.previewEl.createDiv('preview-container');
			previewContainer.createEl('div', { text: 'Preview:', cls: 'preview-label' });
			
			// Get path template based on settings
			let pathTemplate = '';
			switch (this.plugin.settings.attachmentLocation) {
				case 'subfolder':
					pathTemplate = `${mockFile.parent?.path ?? ''}/${this.plugin.settings.attachmentSubfolderName}`;
					break;
				case 'customOutput':
					pathTemplate = this.plugin.settings.customOutputPath;
					break;
				case 'root':
					pathTemplate = '/';
					break;
				case 'current':
					pathTemplate = mockFile.parent?.path ?? '';
					break;
				default:
					pathTemplate = '{Default Obsidian Settings}';
			}
	
			// Get filename template
			const filenameTemplate = this.plugin.settings.autoRename && this.plugin.settings.useCustomRenaming
				? this.plugin.settings.customRenameTemplate
				: '{imageName}';
	
			// Process variables
			const fullTemplate = `${pathTemplate}/${filenameTemplate}.${this.plugin.settings.convertTo}`;
			const processedPath = await this.plugin.processSubfolderVariables(fullTemplate, mockFile, mockFile);
	
			// Show the final processed path
			previewContainer.createEl('div', { 
				text: processedPath,
				cls: 'preview-path' 
			});
	
			// Show available variables only when relevant settings are selected
			if (this.shouldShowVariables()) {
				this.addVariablesHelper(previewContainer);
			}
	
		} catch (error) {
			console.error('Preview generation error:', error);
			this.previewEl.empty();
			this.previewEl.createEl('div', { text: 'Error generating preview', cls: 'preview-error' });
		}
	}

	private shouldShowVariables(): boolean {
		// Show variables only when custom path or custom filename is being used
		return (
			this.plugin.settings.attachmentLocation === 'customOutput' ||
			// this.plugin.settings.attachmentLocation === 'specified' ||
			this.plugin.settings.attachmentLocation === 'subfolder' ||
			(this.plugin.settings.autoRename && this.plugin.settings.useCustomRenaming)
		);
	}

	private addVariablesHelper(container: HTMLElement): void {
		const helperContainer = container.createDiv('variables-helper');
		const toggleButton = helperContainer.createEl('button', {
			text: 'Show available variables',
			cls: 'variables-toggle'
		});
		
		const variablesContent = helperContainer.createDiv('variables-content');
		variablesContent.style.display = 'none';
	
		const variables = this.getRelevantVariables();
		
		if (variables.length > 0) {
			const variablesList = variablesContent.createEl('div', { cls: 'variables-list' });
			variables.forEach(variable => {
				if (variable.startsWith('== ') && variable.endsWith(' ==')) {
					// This is a category header
					variablesList.createEl('h4', {
						text: variable.replace(/==/g, '').trim(),
						cls: 'variables-category-header'
					});
				} else if (variable) { // Skip empty strings
					variablesList.createEl('div', {
						text: variable,
						cls: 'variable-item'
					});
				}
			});
		}
	
		toggleButton.addEventListener('click', () => {
			const isHidden = variablesContent.style.display === 'none';
			variablesContent.style.display = isHidden ? 'block' : 'none';
			toggleButton.textContent = isHidden 
				? 'Hide available variables' 
				: 'Show available variables';
		});
	}
	
	private getRelevantVariables(): string[] {
		const categories = {
			'File & Note Information': [
				'{imageName} - Original image name',
				'{noteName} - Current note name',
				'{fileType} - File extension',
				'{parentFolder} - Parent folder name',
				'{directory} - Current note directory path',
				'{folderName} - Current folder name',
				'{depth} - Number of subfolder levels',
				'{vaultName} - Obsidian vault name',
				'{vaultPath} - Full vault path'
			],
	
			'Date & Time Formats': [
				'{date:YYYY-MM-DD} - Custom date format (supports moment.js patterns)',
				'{today} - Current date (YYYY-MM-DD)',
				'{tomorrow} - Tomorrow\'s date',
				'{yesterday} - Yesterday\'s date',
				'{YYYY-MM-DD} - Current date formatted',
				'{yyyy} - Current year',
				'{mm} - Current month number',
				'{dd} - Current day number',
				'{time} - Current time (HH-mm-ss)',
				'{HH} - Current hour',
				'{timestamp} - Unix timestamp'
			],
	
			'Natural Language Dates': [
				'{monthName} - Full month name (e.g., January)',
				'{MMMM} - Full month name (moment.js format)',
				'{dayName} - Full day name (e.g., Monday)',
				'{dddd} - Full day name (moment.js format)',
				'{dateOrdinal} - Day with ordinal (e.g., 1st, 2nd)',
				'{Do} - Day with ordinal (moment.js format)',
				'{relativeTime} - Relative time (e.g., 2 hours ago)',
				'{calendar} - Natural calendar format'
			],
	
			'Time Periods': [
				'{startOfWeek} - First day of current week',
				'{endOfWeek} - Last day of current week',
				'{startOfMonth} - First day of current month',
				'{endOfMonth} - Last day of current month',
				'{nextWeek} - Same day next week',
				'{lastWeek} - Same day last week',
				'{nextMonth} - Same day next month',
				'{lastMonth} - Same day last month'
			],
	
			'Time Units': [
				'{daysInMonth} - Number of days in current month',
				'{weekOfYear} - Current week number',
				'{week} - Week number (short)',
				'{w} - Week number (shortest)',
				'{quarter} - Current quarter',
				'{Q} - Quarter (shortest)',
				'{dayOfYear} - Day of year (1-365)',
				'{DDD} - Day of year (moment.js format)'
			],
	
			'Image Properties': [
				'{width} - Image width in pixels',
				'{height} - Image height in pixels',
				'{ratio} - Width/height ratio (2 decimals)',
				'{aspectRatio} - Width/height ratio (3 decimals)',
				'{resolution} - Full resolution (e.g., 1920x1080)',
				'{orientation} - landscape, portrait, or square',
				'{quality} - Current conversion quality',
				'{megapixels} - Image megapixels',
				'{isSquare} - Whether image is square (true/false)',
				'{pixelCount} - Total number of pixels',
				'{aspectRatioType} - Common ratio (16:9, 4:3, etc.)',
				'{resolutionCategory} - tiny (316x316), small, medium, large, very-large (2828x2828++)',
				'{fileSizeCategory} - returns 1 of the 6 file size categories: 0-50KB, 51-200KB, 201-1024KB, 1025KB-5MB, 5MB-10MB, 10MB+',
				'{dominantDimension} - width, height, or equal',
				'{dimensionDifference} - Pixel difference between width/height',
				'{bytesPerPixel} - Average bytes per pixel',
				'{compressionRatio} - Image compression ratio',
				'{maxDimension} - Larger dimension in pixels',
				'{minDimension} - Smaller dimension in pixels',
				'{diagonalPixels} - Diagonal resolution',
				'{aspectRatioSimplified} - Simplified ratio (e.g., 16:9)',
				'{screenFitCategory} - fits-1080p, fits-1440p, fits-4k, above-4k'
			],
	
			'Size Variables': [
				'{size:MB:2} - Size in MB with 2 decimal places',
				'{size:KB:1} - Size in KB with 1 decimal place',
				'{size:B:0} - Size in bytes with no decimals',
				'{sizeMB} - Size in MB',
				'{sizeKB} - Size in KB',
				'{sizeB} - Size in bytes'
			],
	
			'File Statistics': [
				'{creationDate} - File creation date',
				'{modifiedDate} - Last modified date'
			],
	
			'System Information': [
				'{timezone} - System timezone',
				'{locale} - System locale',
				'{platform} - Operating system platform',
				'{userAgent} - Browser user agent'
			],
	
			'Unique Identifiers': [
				'{MD5:filename} - MD5 hash of filename',
				'{MD5:filename:8} - First 8 chars of filename MD5 hash',
				'{MD5:path} - MD5 hash of file path',
				'{MD5:fullpath} - MD5 hash of complete path',
				'{MD5:parentfolder} - MD5 hash of parent folder name',
				'{MD5:rootfolder} - MD5 hash of root folder name',
				'{MD5:extension} - MD5 hash of file extension',
				'{MD5:notename} - MD5 hash of current note name',
				'{MD5:notefolder} - MD5 hash of current note\'s folder',
				'{MD5:notepath} - MD5 hash of current note\'s path',
				'{MD5:custom text} - MD5 hash of custom text',
				'{randomHex:6} - Random hex string of specified length',
				'{counter:000} - Incremental counter with padding',
				'{random} - Random alphanumeric string',
				'{uuid} - Random UUID'
			]
		};
	
		return Object.entries(categories).flatMap(([category, vars]) => [
			`== ${category} ==`,
			...vars,
			'' // Add empty string for spacing between categories
		]);
	}
	
	private updateFilenameSettings(): void {
		this.filenameSettingsContainer.empty();
	
		if (this.plugin.settings.autoRename && this.plugin.settings.useCustomRenaming) {
			new Setting(this.filenameSettingsContainer)
				.setName("Filename template")
				.setDesc("Use variables like {date}, {noteName}, {imageName}, {MD5} to create your own custom filenaming format")
				.setClass('settings-indent')
				.addText((text) => {
					text.setPlaceholder('{noteName}-{date}')
						.setValue(this.plugin.settings.customRenameTemplate)
						.onChange(async (value) => {
							this.plugin.settings.customRenameTemplate = value;
							await this.plugin.saveSettings();
							this.updateConsolidatedPreview();  // Add this for real-time updates
						});
				});
		}
	}

	
	// Settings / Extras
	private displayGeneralSettings(): void {
		// Clear the container first
		const container = this.contentContainer;
		container.empty();
		
		container.createDiv('settings-container', (settingsContainer) => {
			// Image Resize Controls Group
			settingsContainer.createEl('h3', { text: 'Non-destructive image resizing' });
			settingsContainer.createEl('p', { text: 'Below settings allow you to adjust image dimensions using the standard ObsidianMD\
													method by modifying image links. For instance, to change the width of ![[Engelbart.jpg]],\
													we add "| 100" at the end, resulting in ![[Engelbart.jpg | 100]]' });

			// Non-destructive resize settings
			new Setting(settingsContainer)
				.setName("Non-destructive resize")
				.setDesc("Automatically apply '|size' to dropped/pasted images")
				.addDropdown((dropdown) =>
					dropdown
						.addOptions({
							disabled: "None",
							fitImage: "Fit Image",
							customSize: "Custom"
						})
						.setValue(this.plugin.settings.autoNonDestructiveResize)
						.onChange(async (value) => {
							this.plugin.settings.autoNonDestructiveResize = value;
							await this.plugin.saveSettings();
							this.displayGeneralSettings();
						})
				);

			// Show custom size setting immediately after non-destructive resize if "Custom" is selected
			if (this.plugin.settings.autoNonDestructiveResize === "customSize") {
				new Setting(settingsContainer)
					.setName("Custom size")
					.setDesc("Specify the default size which should be applied on all dropped/pasted images. For example, if you specify \
							custom size as '250' then when you drop or paste an 'image.jpg' it would become ![[image.jpg | 250]] ")
					.setClass('settings-indent')
					.addText((text) => {
						text.setPlaceholder("800")
							.setValue(this.plugin.settings.customSize)
							.onChange(async (value) => {
								this.plugin.settings.customSize = value;
								await this.plugin.saveSettings();
							});
					});
			}

			// Resize by dragging (main toggle)
			new Setting(settingsContainer)
				.setName('Resize by dragging edge of an image')
				.setDesc('Turn this on to allow resizing images by dragging the edge of an image')
				.addToggle(toggle =>
					toggle
						.setValue(this.plugin.settings.resizeByDragging)
						.onChange(async value => {
							this.plugin.settings.resizeByDragging = value;
							await this.plugin.saveSettings();
							// Refresh the entire settings display
							this.displayGeneralSettings();
						})
				);

			// Shift + Scrollwheel resize (only shown if resizeByDragging is enabled)
			new Setting(settingsContainer)
				.setName('Enable scrollwheel resize')
				.setDesc('Allow resizing images using the scrollwheel')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.resizeWithScrollwheel)
					.onChange(async (value) => {
						this.plugin.settings.resizeWithScrollwheel = value;
						await this.plugin.saveSettings();
						// Refresh the modifier dropdown state
						this.display();
					}));

			// Only show modifier selection if scrollwheel resize is enabled
			if (this.plugin.settings.resizeWithScrollwheel) {
				new Setting(settingsContainer)
					.setName('Scrollwheel modifier key')
					.setDesc('Choose which modifier key to hold while using the scrollwheel to resize')
					.addDropdown(dropdown => {
						dropdown
							.addOptions({
								'Shift': 'Shift',
								'Control': 'Control/Command',
								'Alt': 'Alt/Option',
								'Meta': 'Windows/Command',
								'None': 'No modifier'
							})
							.setValue(this.plugin.settings.scrollwheelModifier)
							.onChange(async (value: ModifierKey) => {
								this.plugin.settings.scrollwheelModifier = value;
								await this.plugin.saveSettings();
							});
					});
			}
			
			// Add new setting
			new Setting(settingsContainer)
				.setName('Allow drag resize in Reading mode')
				.setDesc('Non-destructive resizing in Reading Mode is only visual, thus if it is too distractive you can disable it')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.allowResizeInReadingMode)
					.onChange(async (value) => {
						this.plugin.settings.allowResizeInReadingMode = value;
						await this.plugin.saveSettings();
						// Refresh the entire settings display
						this.displayGeneralSettings();
					}))
				.setDisabled(!this.plugin.settings.resizeByDragging); // Disable if drag resize is off

			// Editor Behavior Group
			settingsContainer.createEl('h3', { text: 'Editor Behavior' });
	
			// Cursor Position Setting
			new Setting(settingsContainer)
				.setName('Cursor position')
				.setDesc('Choose cursor position after processing the image')
				.addDropdown(dropdown => dropdown
					.addOption('front', 'Front of the link')
					.addOption('back', 'Back of the link')
					.setValue(this.plugin.settings.cursorPosition)
					.onChange(async (value) => {
						this.plugin.settings.cursorPosition = value as 'front' | 'back';
						await this.plugin.saveSettings();
					}));


			new Setting(settingsContainer)
				.setName('Remember scroll position')
				.setDesc('This is work in progress. Toggle ON to remember the scroll position when processing images. Toggle OFF to automatically scroll to the last image')
				.addToggle(toggle => {
					toggle.setValue(this.plugin.settings.rememberScrollPosition)
						.setDisabled(true)
						.onChange(async (value) => {
							this.plugin.settings.rememberScrollPosition = value;
							await this.plugin.saveSettings();
						})
				});

			// Context Menu Setting
			new Setting(settingsContainer)
				.setName('Right-click menu')
				.setDesc('Enable right-click context menu')
				.addToggle(toggle =>
					toggle
						.setValue(this.plugin.settings.rightClickContextMenu)
						.onChange(async value => {
							this.plugin.settings.rightClickContextMenu = value;
							await this.plugin.saveSettings();
						})
				);
				

			// Notifications Group
			settingsContainer.createEl('h3', { text: 'Notifications' });
				
			new Setting(settingsContainer)
				.setName('Show progress notification')
				.setDesc('Show processing status report when multiple images were detected e.g.: When enabled it will show "Processing 1 of 20" ')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.showProgress)
					.onChange(async (value) => {
						this.plugin.settings.showProgress = value;
						await this.plugin.saveSettings();
					}));
	
			new Setting(settingsContainer)
				.setName('Show summary notification')
				.setDesc('Show summary after processing completes')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.showSummary)
					.onChange(async (value) => {
						this.plugin.settings.showSummary = value;
						await this.plugin.saveSettings();
					}));
	
			new Setting(settingsContainer)
				.setName('Show rename notification')
				.setDesc('Show notification when files are renamed')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.showRenameNotice)
					.onChange(async value => {
						this.plugin.settings.showRenameNotice = value;
						await this.plugin.saveSettings();
					}));
		});
	}

	// Advanced
	private displayAdvancedSettings(): void {
		const container = this.contentContainer.createDiv('settings-container');
		container.createDiv('settings-container', (settingsContainer) => {
		settingsContainer.createEl('p', { text: 'Below settings allow you to specify how long Obsidian should \
												wait before timing-out the image processing. E.g.: when file is extra\
												large 100MB+ it might freeze Obsidian - Image Converter will try to do\
												the best it can to process it - however if it takes too long it will stop' });
		})

		// Timeout Settings
		new Setting(container)
			.setName('Base timeout (seconds)')
			.setDesc('Base processing timeout for all images')
			.addText(text => text
				.setValue((this.plugin.settings.baseTimeout / 1000).toString())
				.onChange(async (value) => {
					this.plugin.settings.baseTimeout = parseInt(value) * 1000;
					await this.plugin.saveSettings();
				}));

		new Setting(container)
			.setName('Additional timeout per MB')
			.setDesc('Additional processing time (seconds) per MB')
			.addText(text => text
				.setValue((this.plugin.settings.timeoutPerMB / 1000).toString())
				.onChange(async (value) => {
					this.plugin.settings.timeoutPerMB = parseInt(value) * 1000;
					await this.plugin.saveSettings();
				}));
	}

}

class ResizeModal extends Modal {
	plugin: ImageConvertPlugin;

	constructor(plugin: ImageConvertPlugin) {
		super(plugin.app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// Add an explanation of the selected resize mode
		let explanation = '';
		switch (this.plugin.settings.resizeMode) {
			case 'Fit':
				explanation = 'Fit mode resizes the image to fit within the desired dimensions while maintaining the aspect ratio of the image.';
				break;
			case 'Fill':
				explanation = 'Fill mode resizes the image to fill the desired dimensions while maintaining the aspect ratio of the image. This may result in cropping of the image.';
				break;
			case 'LongestEdge':
				explanation = 'Longest Edge mode resizes the longest side of the image to match the desired length while maintaining the aspect ratio of the image.';
				break;
			case 'ShortestEdge':
				explanation = 'Shortest Edge mode resizes the shortest side of the image to match the desired length while maintaining the aspect ratio of the image.';
				break;
			case 'Width':
				explanation = 'Width mode resizes the width of the image to match the desired width while maintaining the aspect ratio of the image.';
				break;
			case 'Height':
				explanation = 'Height mode resizes the height of the image to match the desired height while maintaining the aspect ratio of the image.';
				break;
		}
		contentEl.createEl('p', { text: explanation });

		// Add input fields for the desired dimensions based on the selected resize mode
		if (['Fit', 'Fill'].includes(this.plugin.settings.resizeMode)) {
			const widthInput = new TextComponent(contentEl)
				.setPlaceholder('Width')
				.setValue(this.plugin.settings.desiredWidth.toString());

			const heightInput = new TextComponent(contentEl)
				.setPlaceholder('Height')
				.setValue(this.plugin.settings.desiredHeight.toString());

			// Add a button to save the settings and close the modal
			new ButtonComponent(contentEl)
				.setButtonText('Save')
				.onClick(async () => {
					const width = parseInt(widthInput.getValue());
					if (/^\d+$/.test(widthInput.getValue()) && width > 0) {
						this.plugin.settings.desiredWidth = width;
					}

					const height = parseInt(heightInput.getValue());
					if (/^\d+$/.test(heightInput.getValue()) && height > 0) {
						this.plugin.settings.desiredHeight = height;
					}

					await this.plugin.saveSettings();
					this.close();
				});
		} else {
			const lengthInput = new TextComponent(contentEl)
				.setPlaceholder('Enter desired length in pixels')
				.setValue(
					['LongestEdge', 'ShortestEdge', 'Width', 'Height'].includes(this.plugin.settings.resizeMode)
						? this.plugin.settings.desiredWidth.toString()
						: this.plugin.settings.desiredHeight.toString()
				);

			// Add a button to save the settings and close the modal
			new ButtonComponent(contentEl)
				.setButtonText('Save')
				.onClick(async () => {
					const length = parseInt(lengthInput.getValue());
					if (/^\d+$/.test(lengthInput.getValue()) && length > 0) {
						if (['LongestEdge'].includes(this.plugin.settings.resizeMode)) {
							this.plugin.settings.desiredLength = length;
						}

						if (['ShortestEdge'].includes(this.plugin.settings.resizeMode)) {
							this.plugin.settings.desiredLength = length;
						}

						if (['Width'].includes(this.plugin.settings.resizeMode)) {
							this.plugin.settings.desiredWidth = length;
						}

						if (['Height'].includes(this.plugin.settings.resizeMode)) {
							this.plugin.settings.desiredHeight = length;
						}
					}

					await this.plugin.saveSettings();
					this.close();
				});
		}
	}
}

class ResizeImageModal extends Modal {
	width: string;
	height: string;
	onSubmit: (width: string, height: string) => void;

	constructor(app: App, onSubmit: (width: string, height: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;

		contentEl.createEl('h2', { text: 'Enter new dimensions' });
		contentEl.createEl('p', { text: 'Please backup you images, this will resize your original image.' });
		contentEl.createEl('p', { text: 'Aspect ratio is always preserved.' });

		const widthSetting = new Setting(contentEl)
			.setName('Width')
			.addText((text) =>
				text.onChange((value) => {
					this.width = value;
				})
			);
		const messageEl = createEl('span', { text: 'To resize only width, you can leave Height input empty' });
		messageEl.style.fontSize = '12px'
		widthSetting.controlEl.insertBefore(messageEl, widthSetting.controlEl.firstChild);


		const heightSetting = new Setting(contentEl)
			.setName('Height')
			.addText((text) =>
				text.onChange((value) => {
					this.width = value;
				})
			);
		const messageE3 = createEl('span', { text: 'To resize only Height, you can leave width input empty' });
		messageE3.style.fontSize = '12px'
		heightSetting.controlEl.insertBefore(messageE3, heightSetting.controlEl.firstChild);


		const submitBUtton = new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText('Submit')
					.setCta()
					.onClick(() => {
						this.close();
						this.onSubmit(this.width, this.height);
					})
			);

		const messageE4 = createEl('p', { text: '' });
		messageE4.style.fontSize = '12px'
		submitBUtton.controlEl.insertBefore(messageE4, submitBUtton.controlEl.firstChild);

	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}


class ProcessAllVault extends Modal {
	plugin: ImageConvertPlugin;

	constructor(plugin: ImageConvertPlugin) {
		super(plugin.app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;

		const heading = contentEl.createEl('h1');
		heading.textContent = 'Convert, compress and resize';
		const desc = contentEl.createEl('p');
		desc.textContent = 'Running this will modify all your internal images in the Vault. Please create backups. All internal image links will be automatically updated.';

		// Add your settings here
		new Setting(contentEl)
			.setName('Select format to convert images to')
			.setDesc(`"Same as original" - will keep original file format.`)
			.addDropdown(dropdown =>
				dropdown
					.addOptions({ disabled: 'Same as original', webp: 'WebP', jpg: 'JPG', png: 'PNG' })
					.setValue(this.plugin.settings.ProcessAllVaultconvertTo)
					.onChange(async value => {
						this.plugin.settings.ProcessAllVaultconvertTo = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(contentEl)
			.setName('Quality')
			.setDesc('0 - low quality, 99 - high quality, 100 - no compression; 75 - recommended')
			.addText(text =>
				text
					.setPlaceholder('Enter quality (0-100)')
					.setValue((this.plugin.settings.ProcessAllVaultquality * 100).toString())
					.onChange(async value => {
						const quality = parseInt(value);

						if (/^\d+$/.test(value) && quality >= 0 && quality <= 100) {
							this.plugin.settings.ProcessAllVaultquality = quality / 100;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(contentEl)
			.setName('Image resize mode')
			.setDesc('Select the mode to use when resizing the image. Resizing an image will further reduce file-size, but it will resize your actual file, which means that the original file will be modified, and the changes will be permanent.')
			.addDropdown(dropdown =>
				dropdown
					.addOptions({ None: 'None', Fit: 'Fit', Fill: 'Fill', LongestEdge: 'Longest Edge', ShortestEdge: 'Shortest Edge', Width: 'Width', Height: 'Height' })
					.setValue(this.plugin.settings.ProcessAllVaultResizeModalresizeMode)
					.onChange(async value => {
						this.plugin.settings.ProcessAllVaultResizeModalresizeMode = value;
						await this.plugin.saveSettings();

						if (value !== 'None') {
							// Open the ResizeModal when an option is selected
							const modal = new ProcessAllVaultResizeModal(this.plugin);
							modal.open();
						}
					})
			);

		new Setting(contentEl)
			.setName('Skip images in target format')
			.setDesc('Selecting this will skip images that already are in the target format. This is useful if you have a very large library, and want to process images in batches.')
			.addToggle(toggle =>
				toggle
					.setValue(this.plugin.settings.ProcessAllVaultskipImagesInTargetFormat)
					.onChange(async value => {
						this.plugin.settings.ProcessAllVaultskipImagesInTargetFormat = value;
						await this.plugin.saveSettings();
					})
			);

		// Add a submit button
		new ButtonComponent(contentEl)
			.setButtonText('Submit')
			.onClick(() => {
				// Close the modal when the button is clicked
				this.close();
				// Process all images in the vault
				this.plugin.processAllVaultImages();
			});
	}
}
class ProcessAllVaultResizeModal extends Modal {
	plugin: ImageConvertPlugin;

	constructor(plugin: ImageConvertPlugin) {
		super(plugin.app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// Add an explanation of the selected resize mode
		let explanation = '';
		switch (this.plugin.settings.ProcessAllVaultResizeModalresizeMode) {
			case 'Fit':
				explanation = 'Fit mode resizes the image to fit within the desired dimensions while maintaining the aspect ratio of the image.';
				break;
			case 'Fill':
				explanation = 'Fill mode resizes the image to fill the desired dimensions while maintaining the aspect ratio of the image. This may result in cropping of the image.';
				break;
			case 'LongestEdge':
				explanation = 'Longest Edge mode resizes the longest side of the image to match the desired length while maintaining the aspect ratio of the image.';
				break;
			case 'ShortestEdge':
				explanation = 'Shortest Edge mode resizes the shortest side of the image to match the desired length while maintaining the aspect ratio of the image.';
				break;
			case 'Width':
				explanation = 'Width mode resizes the width of the image to match the desired width while maintaining the aspect ratio of the image.';
				break;
			case 'Height':
				explanation = 'Height mode resizes the height of the image to match the desired height while maintaining the aspect ratio of the image.';
				break;
		}
		contentEl.createEl('p', { text: explanation });

		// Add input fields for the desired dimensions based on the selected resize mode
		if (['Fit', 'Fill'].includes(this.plugin.settings.ProcessAllVaultResizeModalresizeMode)) {
			const widthInput = new TextComponent(contentEl)
				.setPlaceholder('Width')
				.setValue(this.plugin.settings.ProcessAllVaultResizeModaldesiredWidth.toString());

			const heightInput = new TextComponent(contentEl)
				.setPlaceholder('Height')
				.setValue(this.plugin.settings.ProcessAllVaultResizeModaldesiredHeight.toString());

			// Add a button to save the settings and close the modal
			new ButtonComponent(contentEl)
				.setButtonText('Save')
				.onClick(async () => {
					const width = parseInt(widthInput.getValue());
					if (/^\d+$/.test(widthInput.getValue()) && width > 0) {
						this.plugin.settings.ProcessAllVaultResizeModaldesiredWidth = width;
					}

					const height = parseInt(heightInput.getValue());
					if (/^\d+$/.test(heightInput.getValue()) && height > 0) {
						this.plugin.settings.ProcessAllVaultResizeModaldesiredHeight = height;
					}

					await this.plugin.saveSettings();
					this.close();
				});
		} else {
			const lengthInput = new TextComponent(contentEl)
				.setPlaceholder('Enter desired length in pixels')
				.setValue(
					['LongestEdge', 'ShortestEdge', 'Width', 'Height'].includes(this.plugin.settings.ProcessAllVaultResizeModalresizeMode)
						? this.plugin.settings.ProcessAllVaultResizeModaldesiredWidth.toString()
						: this.plugin.settings.ProcessAllVaultResizeModaldesiredHeight.toString()
				);

			// Add a button to save the settings and close the modal
			new ButtonComponent(contentEl)
				.setButtonText('Save')
				.onClick(async () => {
					const length = parseInt(lengthInput.getValue());
					if (/^\d+$/.test(lengthInput.getValue()) && length > 0) {
						if (['LongestEdge'].includes(this.plugin.settings.ProcessAllVaultResizeModalresizeMode)) {
							this.plugin.settings.ProcessAllVaultResizeModaldesiredLength = length;
						}

						if (['ShortestEdge'].includes(this.plugin.settings.ProcessAllVaultResizeModalresizeMode)) {
							this.plugin.settings.ProcessAllVaultResizeModaldesiredLength = length;
						}

						if (['Width'].includes(this.plugin.settings.ProcessAllVaultResizeModalresizeMode)) {
							this.plugin.settings.ProcessAllVaultResizeModaldesiredWidth = length;
						}

						if (['Height'].includes(this.plugin.settings.ProcessAllVaultResizeModalresizeMode)) {
							this.plugin.settings.ProcessAllVaultResizeModaldesiredHeight = length;
						}
					}

					await this.plugin.saveSettings();
					this.close();
				});
		}
	}
}

class ProcessCurrentNote extends Modal {
	plugin: ImageConvertPlugin;

	constructor(plugin: ImageConvertPlugin) {
		super(plugin.app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;


		const div1 = contentEl.createEl('div');
		div1.style.display = 'flex';
		div1.style.flexDirection = 'column';
		div1.style.alignItems = 'center';
		div1.style.justifyContent = 'center';

		const heading1 = div1.createEl('h2')
		heading1.textContent = 'Convert, compress and resize';

		let noteName = 'current note';
		let noteExtension = '';
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView && activeView.file) {
			noteName = activeView.file.basename;
			noteExtension = activeView.file.extension;
		} else {
			noteName = "";
		}

		const heading2 = div1.createEl('h6');
		heading2.textContent = `all images in: ${noteName}.${noteExtension}`;
		heading2.style.marginTop = '-18px';

		const desc = div1.createEl('p');
		desc.textContent = 'Running this will modify all internal images in the current note. Please create backups. All internal image links will be automatically updated.';
		desc.style.marginTop = '-10px'; // space between the heading and the paragraph
		desc.style.padding = '20px'; // padding around the div
		desc.style.borderRadius = '10px'; // rounded corners


		// Add your settings here
		new Setting(contentEl)
			.setName('Select format to convert images to')
			.setDesc(`"Same as original" - will keep original file format.`)
			.addDropdown(dropdown =>
				dropdown
					.addOptions({ disabled: 'Same as original', webp: 'WebP', jpg: 'JPG', png: 'PNG' })
					.setValue(this.plugin.settings.ProcessCurrentNoteconvertTo)
					.onChange(async value => {
						this.plugin.settings.ProcessCurrentNoteconvertTo = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(contentEl)
			.setName('Quality')
			.setDesc('0 - low quality, 99 - high quality, 100 - no compression; 75 - recommended')
			.addText(text =>
				text
					.setPlaceholder('Enter quality (0-100)')
					.setValue((this.plugin.settings.ProcessCurrentNotequality * 100).toString())
					.onChange(async value => {
						const quality = parseInt(value);

						if (/^\d+$/.test(value) && quality >= 0 && quality <= 100) {
							this.plugin.settings.ProcessCurrentNotequality = quality / 100;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(contentEl)
			.setName('Image resize mode')
			.setDesc('Select the mode to use when resizing the image. Resizing an image will further reduce file-size, but it will resize your actual file, which means that the original file will be modified, and the changes will be permanent.')
			.addDropdown(dropdown =>
				dropdown
					.addOptions({ None: 'None', Fit: 'Fit', Fill: 'Fill', LongestEdge: 'Longest Edge', ShortestEdge: 'Shortest Edge', Width: 'Width', Height: 'Height' })
					.setValue(this.plugin.settings.ProcessCurrentNoteResizeModalresizeMode)
					.onChange(async value => {
						this.plugin.settings.ProcessCurrentNoteResizeModalresizeMode = value;
						await this.plugin.saveSettings();

						if (value !== 'None') {
							// Open the ResizeModal when an option is selected
							const modal = new ProcessCurrentNoteResizeModal(this.plugin);
							modal.open();
						}
					})
			);

		// Add a submit button
		new ButtonComponent(contentEl)
			.setButtonText('Submit')
			.onClick(() => {
				// Close the modal when the button is clicked
				this.close();
				const currentNote = this.app.workspace.getActiveFile();
				// Check if currentNote is not null
				if (currentNote) {
					// Process all images in the current note
					this.plugin.processCurrentNoteImages(currentNote);
				} else {
					new Notice('Error: No active note found.');
				}
			});

	}
}
class ProcessCurrentNoteResizeModal extends Modal {
	plugin: ImageConvertPlugin;

	constructor(plugin: ImageConvertPlugin) {
		super(plugin.app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// Add an explanation of the selected resize mode
		let explanation = '';
		switch (this.plugin.settings.ProcessCurrentNoteResizeModalresizeMode) {
			case 'Fit':
				explanation = 'Fit mode resizes the image to fit within the desired dimensions while maintaining the aspect ratio of the image.';
				break;
			case 'Fill':
				explanation = 'Fill mode resizes the image to fill the desired dimensions while maintaining the aspect ratio of the image. This may result in cropping of the image.';
				break;
			case 'LongestEdge':
				explanation = 'Longest Edge mode resizes the longest side of the image to match the desired length while maintaining the aspect ratio of the image.';
				break;
			case 'ShortestEdge':
				explanation = 'Shortest Edge mode resizes the shortest side of the image to match the desired length while maintaining the aspect ratio of the image.';
				break;
			case 'Width':
				explanation = 'Width mode resizes the width of the image to match the desired width while maintaining the aspect ratio of the image.';
				break;
			case 'Height':
				explanation = 'Height mode resizes the height of the image to match the desired height while maintaining the aspect ratio of the image.';
				break;
		}
		contentEl.createEl('p', { text: explanation });

		// Add input fields for the desired dimensions based on the selected resize mode
		if (['Fit', 'Fill'].includes(this.plugin.settings.ProcessCurrentNoteResizeModalresizeMode)) {
			const widthInput = new TextComponent(contentEl)
				.setPlaceholder('Width')
				.setValue(this.plugin.settings.ProcessCurrentNoteresizeModaldesiredWidth.toString());

			const heightInput = new TextComponent(contentEl)
				.setPlaceholder('Height')
				.setValue(this.plugin.settings.ProcessCurrentNoteresizeModaldesiredHeight.toString());

			// Add a button to save the settings and close the modal
			new ButtonComponent(contentEl)
				.setButtonText('Save')
				.onClick(async () => {
					const width = parseInt(widthInput.getValue());
					if (/^\d+$/.test(widthInput.getValue()) && width > 0) {
						this.plugin.settings.ProcessCurrentNoteresizeModaldesiredWidth = width;
					}

					const height = parseInt(heightInput.getValue());
					if (/^\d+$/.test(heightInput.getValue()) && height > 0) {
						this.plugin.settings.ProcessCurrentNoteresizeModaldesiredHeight = height;
					}

					await this.plugin.saveSettings();
					this.close();
				});
		} else {
			const lengthInput = new TextComponent(contentEl)
				.setPlaceholder('Enter desired length in pixels')
				.setValue(
					['LongestEdge', 'ShortestEdge', 'Width', 'Height'].includes(this.plugin.settings.ProcessCurrentNoteResizeModalresizeMode)
						? this.plugin.settings.ProcessCurrentNoteresizeModaldesiredWidth.toString()
						: this.plugin.settings.ProcessCurrentNoteresizeModaldesiredHeight.toString()
				);

			// Add a button to save the settings and close the modal
			new ButtonComponent(contentEl)
				.setButtonText('Save')
				.onClick(async () => {
					const length = parseInt(lengthInput.getValue());
					if (/^\d+$/.test(lengthInput.getValue()) && length > 0) {
						if (['LongestEdge'].includes(this.plugin.settings.ProcessCurrentNoteResizeModalresizeMode)) {
							this.plugin.settings.ProcessCurrentNoteresizeModaldesiredLength = length;
						}

						if (['ShortestEdge'].includes(this.plugin.settings.ProcessCurrentNoteResizeModalresizeMode)) {
							this.plugin.settings.ProcessCurrentNoteresizeModaldesiredLength = length;
						}

						if (['Width'].includes(this.plugin.settings.ProcessCurrentNoteResizeModalresizeMode)) {
							this.plugin.settings.ProcessCurrentNoteresizeModaldesiredWidth = length;
						}

						if (['Height'].includes(this.plugin.settings.ProcessCurrentNoteResizeModalresizeMode)) {
							this.plugin.settings.ProcessCurrentNoteresizeModaldesiredHeight = length;
						}
					}

					await this.plugin.saveSettings();
					this.close();
				});
		}
	}
}

// working 2
import { App, View, MarkdownView, Notice, ItemView, DropdownComponent, FileView, Plugin, TFile, Scope, PluginSettingTab, Platform, Setting, Editor, Modal, TextComponent, ButtonComponent, Menu, MenuItem, normalizePath } from 'obsidian';
// Browsers use the MIME type, not the file extension this module allows 
// us to be more precise when default MIME checking options fail
import mime from "./mime.min.js"

import { Canvas, FabricImage, IText, FabricObject, PencilBrush, ActiveSelection, Point, Pattern, util, Path, TEvent, TBrushEventData, ImageFormat } from 'fabric';

type BlendMode = 
    | 'source-over'
    | 'multiply'
    | 'screen'
    | 'overlay'
    | 'darken'
    | 'lighten'
    | 'color-dodge'
    | 'color-burn'
    | 'hard-light'
    | 'soft-light'
    | 'difference'
    | 'exclusion';

type ExtendedImageFormat = ImageFormat | 'webp' | 'avif'; // extend the default jpeg and png types supported by FABRICjs to also include webp
type BackgroundOptions = readonly ['transparent', '#ffffff', '#000000', 'grid', 'dots'];
type BackgroundType = BackgroundOptions[number];

interface ToolPreset {
	size: number;
    color: string;
    opacity: number;
    blendMode: BlendMode;
}


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

interface ObsidianApp extends App {
    plugins: {
        plugins: {
            [key: string]: any;
        };
    };
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
	// newPath?: string;
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
    timeoutId?: number;  // Track the timeout
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
	allowLargerFiles: boolean;

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
	ProcessAllVaultEnlargeOrReduce: 'Always' | 'Reduce' | 'Enlarge';
	ProcessAllVaultSkipFormats: string;

	ProcessCurrentNoteconvertTo: string;
	ProcessCurrentNotequality: number;
	ProcessCurrentNoteResizeModalresizeMode: string;
	ProcessCurrentNoteresizeModaldesiredWidth: number;
	ProcessCurrentNoteresizeModaldesiredHeight: number;
	ProcessCurrentNoteresizeModaldesiredLength: number;
	ProcessCurrentNoteskipImagesInTargetFormat: boolean;
	ProcessCurrentNoteEnlargeOrReduce: 'Always' | 'Reduce' | 'Enlarge';
	ProcessCurrentNoteSkipFormats: string;

	// ProcessCurrentImage_convertTo: string;
	// ProcessCurrentImage_quality: number;
	// ProcessCurrentImage_ResizeModalresizeMode: string
	// ProcessCurrentImage_resizeModaldesiredWidth: number;
	// ProcessCurrentImage_resizeModaldesiredHeight: number;
	// ProcessCurrentImage_resizeModaldesiredLength: number;
	// ProcessCurrentImage_SkipImagesInTargetFormat: boolean;
	// ProcessCurrentImage_EnlargeOrReduce: 'Always' | 'Reduce' | 'Enlarge';
	// ProcessCurrentImage_SkipFormats: string;

	
	attachmentLocation: 'default' | 'root' | 'current' | 'subfolder' | 'customOutput';
	attachmentSubfolderName: string;
	customOutputPath: string;
	previewPath: string;
	manage_duplicate_filename: string;

	destructive_resizeMode: string;
	destructive_desiredWidth: number;
	destructive_desiredHeight: number;
	destructive_desiredLongestEdge: number;
	destructive_enlarge_or_reduce: 'Always' | 'Reduce' | 'Enlarge';

	nondestructive_resizeMode: string,
	nondestructive_resizeMode_customSize: string,
	nondestructive_resizeMode_fitImage: string,
	nondestructive_enlarge_or_reduce: 'Always' | 'Reduce' | 'Enlarge';

	resizeByDragging: boolean;
    resizeWithScrollwheel: boolean;
	scrollwheelModifier: ModifierKey;
	allowResizeInReadingMode: boolean;

	rightClickContextMenu: boolean;

	rememberScrollPosition: boolean;
	cursorPosition: 'front' | 'back';

	useMdLinks: boolean;
	useRelativePath: boolean;
	
	annotationPresets: {
        drawing: ToolPreset[];
        arrow: ToolPreset[];
        text: ToolPreset[];
    };
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
	allowLargerFiles: true,

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
	ProcessAllVaultskipImagesInTargetFormat: false,
	ProcessAllVaultEnlargeOrReduce: 'Always',
	ProcessAllVaultSkipFormats: 'tif,tiff,heic',

	ProcessCurrentNoteconvertTo: 'webp',
	ProcessCurrentNotequality: 0.75,
	ProcessCurrentNoteResizeModalresizeMode: 'None',
	ProcessCurrentNoteresizeModaldesiredWidth: 600,
	ProcessCurrentNoteresizeModaldesiredHeight: 800,
	ProcessCurrentNoteresizeModaldesiredLength: 800,
	ProcessCurrentNoteskipImagesInTargetFormat: false,
	ProcessCurrentNoteEnlargeOrReduce: 'Always',
	ProcessCurrentNoteSkipFormats: 'tif,tiff,heic',

	// ProcessCurrentImage_convertTo: 'webp',
	// ProcessCurrentImage_quality: 0.75,
	// ProcessCurrentImage_ResizeModalresizeMode: 'None',
	// ProcessCurrentImage_resizeModaldesiredWidth: 600,
	// ProcessCurrentImage_resizeModaldesiredHeight: 800,
	// ProcessCurrentImage_resizeModaldesiredLength: 800,
	// ProcessCurrentImage_SkipImagesInTargetFormat: false,
	// ProcessCurrentImage_EnlargeOrReduce: 'Always',
	// ProcessCurrentImage_SkipFormats: 'tif,tiff,heic',

	attachmentLocation: 'default',
	attachmentSubfolderName: '',
	customOutputPath: '',
	previewPath: '',
	manage_duplicate_filename: 'duplicate_rename',

	destructive_resizeMode: 'None',
	destructive_desiredWidth: 600,
	destructive_desiredHeight: 800,
	destructive_desiredLongestEdge: 800,
	destructive_enlarge_or_reduce: 'Always',
	
	nondestructive_resizeMode: "disabled",
	nondestructive_resizeMode_customSize: "",
	nondestructive_resizeMode_fitImage: "", 
	nondestructive_enlarge_or_reduce: 'Always',
	
	resizeByDragging: true,
    resizeWithScrollwheel: true,
	scrollwheelModifier: 'Shift',
	allowResizeInReadingMode: false,
	rightClickContextMenu: true,

	rememberScrollPosition: true,
	cursorPosition: 'back',

	useMdLinks: false,
	useRelativePath: false,

    annotationPresets: {
        drawing: Array(3).fill({
            color: '#000000',
            opacity: 1,
            blendMode: 'source-over' as BlendMode,
            size: 2  // Add default size
        }),
        arrow: Array(3).fill({
            color: '#000000',
            opacity: 1,
            blendMode: 'source-over' as BlendMode,
            size: 8  // Add default size
        }),
        text: Array(3).fill({
            color: '#000000',
            opacity: 1,
            blendMode: 'source-over' as BlendMode,
            size: 24  // Add default size (for text, this is fontSize)
        })
    }
}

export default class ImageConvertPlugin extends Plugin {
	settings: ImageConvertSettings;
	widthSide: number | null = null;
	storedImageName: string | null = null; // get imagename for comparison
	private lastProcessedTime = 0;

	private rafId: number | null = null;
	private handleDragOver = (e: DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
	};

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

	// Escape key to stop conversion
	private isKillSwitchActive = false;


	async onload() {
		this.lastProcessedTime = 0;
		// Load settings first
		await this.loadSettings();
		this.addSettingTab(new ImageConvertTab(this.app, this));

		// Wait for layout to be ready before registering events
		this.app.workspace.onLayoutReady(() => {
			
			// Initialize UI elements
			this.progressEl = document.body.createDiv('image-converter-progress');
			this.progressEl.style.display = 'none';
		
			// Register commands
			this.registerCommands();
			
			
			// Register all event handlers
			this.registerEventHandlers();
	
			// Initialize UI features
			this.initializeDragResize();
			this.registerScrollWheelResize();
			this.scrollwheelresize_registerMouseoverHandler();
	
			// Register for file creation events
			this.registerFileEvents();
	
			// Register for layout changes
			this.registerEvent(
				this.app.workspace.on('layout-change', () => {
					this.registerEventHandlers();
					this.initializeDragResize();
				})
			);
	
			// Register context menu
			this.registerContextMenu();

			// Initialize Fabric.js defaults
			FabricObject.prototype.transparentCorners = false;
			FabricObject.prototype.cornerColor = '#108ee9';
			FabricObject.prototype.cornerStyle = 'circle';

		});
	
		// Register escape key handler
		this.registerDomEvent(
			document, 'keydown', (evt: KeyboardEvent) => {
				if (evt.key === 'Escape' && this.isProcessingQueue) {
					this.activateKillSwitch();
				}
			}
		);
	}

	async onunload() {
		// Clear all registered events (this will handle the editor-paste and editor-drop events)
		// Obsidian's Plugin class automatically cleans up events registered with this.registerEvent()

		// Cancel any pending operations
		this.isKillSwitchActive = true;

		// Remove any remaining DOM event listeners
		const supportedViewTypes = ['markdown', 'canvas', 'excalidraw'];
		supportedViewTypes.forEach(viewType => {
			const leaves = this.app.workspace.getLeavesOfType(viewType);
			leaves.forEach(leaf => {
				const container = leaf.view.containerEl;
				if (container.hasAttribute('data-image-converter-registered')) {
					container.removeAttribute('data-image-converter-registered');
					container.removeEventListener('dragover', this.handleDragOver, true);
				}
			});
		});
	
		// Remove workspace-level listeners
		const workspaceContainer = this.app.workspace.containerEl;
		workspaceContainer.removeEventListener('paste', this.handlePaste, true);
		workspaceContainer.removeEventListener('drop', this.handleDrop, true);
		// Clean up any remaining timeouts
		if (this.dropInfo?.timeoutId) {
			window.clearTimeout(this.dropInfo.timeoutId);
		}
		if (this.isConversionPaused_statusTimeout) {
			window.clearTimeout(this.isConversionPaused_statusTimeout);
		}
	
		// Clean up UI elements
		if (this.statusBarItemEl) {
			this.statusBarItemEl.remove();
		}

		if (this.progressEl) {
			this.progressEl.remove();
		}

		// Remove drag resize event listeners
		document.removeEventListener('mousedown', this.dragResize_handleMouseDown);
		document.removeEventListener('mousemove', this.dragResize_handleMouseMove);
		document.removeEventListener('mouseup', this.dragResize_handleMouseUp);
		document.removeEventListener('mouseout', this.dragResize_handleMouseOut);
	
		// Remove the resize class from workspace
		this.app.workspace.containerEl.removeClass('image-resize-enabled');	

		// Clear all internal states
		this.dragResize_cleanupResizeAttributes();
		this.fileQueue = [];
		this.isProcessingQueue = false;
		this.dropInfo = null;
		this.fileHashes.clear();
		this.processedFiles = [];
		this.statusBarItemEl = null;
		this.progressEl = null;
		this.isConversionPaused_statusTimeout = null;

		this.hideProgressBar();
		if (this.rafId) {
			cancelAnimationFrame(this.rafId);
		}
		this.dragResize_cleanupResizeAttributes();
		this.app.workspace.containerEl.removeClass('image-resize-enabled');
		// Wait for any pending operations to complete
		await new Promise(resolve => window.setTimeout(resolve, 100));

	}


	private activateKillSwitch() {
		this.isKillSwitchActive = true;
		this.isProcessingQueue = false;
		this.userAction = false;
		this.batchStarted = false;
		
		// Clear the file queue
		this.fileQueue = [];
		
		// Clear any existing timeouts
		if (this.dropInfo?.timeoutId) {
			window.clearTimeout(this.dropInfo.timeoutId);
		}
		
		// Reset dropInfo
		this.dropInfo = null;
		
		// Hide progress UI
		this.hideProgressBar();
		
		// Show notice to user
		new Notice('Image processing cancelled');
		
		// Reset kill switch after cleanup
		window.setTimeout(() => {
			this.isKillSwitchActive = false;
		}, 1000);
	}

	// Handle the initial drop/paste and put it in a queue
	/* ------------------------------------------------------------- */
	// private registerEventHandlers() {

	// 	// Register workspace-level events
	// 	this.registerEvent(
	// 		this.app.workspace.on('editor-paste', (evt: ClipboardEvent, editor, view) => {
	// 			if (this.shouldSkipEvent(evt)) return;
	// 			this.handlePaste(evt);
	// 		})
	// 	);
	
	// 	this.registerEvent(
	// 		this.app.workspace.on('editor-drop', (evt: DragEvent, editor, view) => {
	// 			if (this.shouldSkipEvent(evt)) return;
	// 			this.handleDrop(evt);
	// 		})
	// 	);
	
	// 	// Register DOM events using registerDomEvent
	// 	const workspaceContainer = this.app.workspace.containerEl;
		
	// 	this.registerDomEvent(workspaceContainer, 'paste', (evt: ClipboardEvent) => {
	// 		if (this.shouldSkipEvent(evt)) return;
	// 		this.handlePaste(evt);
	// 	}, { capture: true });

	// 	this.registerDomEvent(workspaceContainer, 'drop', (evt: DragEvent) => {
	// 		if (this.shouldSkipEvent(evt)) return;
	// 		this.handleDrop(evt);
	// 	}, { capture: true });

	// 	// Register for specific view types
	// 	const supportedViewTypes = ['markdown', 'canvas', 'excalidraw'];
	// 	supportedViewTypes.forEach(viewType => {
	// 		const leaves = this.app.workspace.getLeavesOfType(viewType);
	// 		leaves.forEach(leaf => {
	// 			const container = leaf.view.containerEl;
	// 			if (!container.hasAttribute('data-image-converter-registered')) {
	// 				container.setAttribute('data-image-converter-registered', 'true');
					
	// 				// Register dragover using registerDomEvent
	// 				this.registerDomEvent(container, 'dragover', (e: DragEvent) => {
	// 					e.preventDefault();
	// 					e.stopPropagation();
	// 				}, { capture: true });
	// 			}
	// 		});
	// 	});
	// }

	private registerEventHandlers() {
		// Register workspace-level events
		this.registerEvent(
			this.app.workspace.on('editor-paste', async (evt: ClipboardEvent, editor, view) => {
				if (this.shouldSkipEvent(evt)) return;
				this.handlePaste(evt);
			})
		);
	
		this.registerEvent(
			this.app.workspace.on('editor-drop', async (evt: DragEvent, editor, view) => {
				if (this.shouldSkipEvent(evt)) return;
				this.handleDrop(evt);
			})
		);
	
		// Register DOM events for workspace container
		const workspaceContainer = this.app.workspace.containerEl;
		this.registerDomEvent(workspaceContainer, 'paste', this.handlePaste.bind(this), { capture: true });
		this.registerDomEvent(workspaceContainer, 'drop', this.handleDrop.bind(this), { capture: true });
	
		// Register for specific view types with proper type checking
		const supportedViewTypes = ['markdown', 'canvas', 'excalidraw'];
		supportedViewTypes.forEach(viewType => {
			const leaves = this.app.workspace.getLeavesOfType(viewType);
			leaves.forEach(async (leaf) => {
				// Type-specific handling
				if (viewType === 'markdown' && leaf.view instanceof MarkdownView) {
					this.setupMarkdownViewHandlers(leaf.view);
				} 
				else if (viewType === 'canvas' && leaf.view instanceof ItemView) {
					this.setupCanvasViewHandlers(leaf.view);
				}
				else if (viewType === 'excalidraw' && leaf.view instanceof ItemView) {
					this.setupExcalidrawViewHandlers(leaf.view);
				}
			});
		});
	}
	
	private setupMarkdownViewHandlers(view: MarkdownView) {
		const container = view.containerEl;
		if (!container.hasAttribute('data-image-converter-registered')) {
			container.setAttribute('data-image-converter-registered', 'true');
			this.registerDomEvent(container, 'dragover', (e: DragEvent) => {
				e.preventDefault();
				e.stopPropagation();
			}, { capture: true });
		}
	}
	
	private setupCanvasViewHandlers(view: ItemView) {
		const container = view.containerEl;
		if (!container.hasAttribute('data-image-converter-registered')) {
			container.setAttribute('data-image-converter-registered', 'true');
			this.registerDomEvent(container, 'dragover', (e: DragEvent) => {
				e.preventDefault();
				e.stopPropagation();
			}, { capture: true });
		}
	}
	
	private setupExcalidrawViewHandlers(view: ItemView) {
		const container = view.containerEl;
		if (!container.hasAttribute('data-image-converter-registered')) {
			container.setAttribute('data-image-converter-registered', 'true');
			this.registerDomEvent(container, 'dragover', (e: DragEvent) => {
				e.preventDefault();
				e.stopPropagation();
			}, { capture: true });
		}
	}


	private shouldSkipEvent(evt: ClipboardEvent | DragEvent): boolean {
		if (this.isConversionPaused || evt.defaultPrevented) {
			return true;
		}

		const target = evt.target as HTMLElement;
		const closestView = target.closest('.workspace-leaf-content');
		if (!closestView) {
			return true;
		}

		const viewType = closestView.getAttribute('data-type');

		// Early return if not a supported view type
		if (!viewType || !['markdown', 'canvas', 'excalidraw'].includes(viewType)) {
			return true;
		}

		// Find the active leaf
		const activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf ||
			this.app.workspace.getLeavesOfType(viewType)[0];

		if (!activeLeaf) {
			return true;
		}

		// Type-specific checks
		if (activeLeaf.view instanceof MarkdownView) {
			return false;
		}
		if (activeLeaf.view instanceof ItemView &&
			(activeLeaf.view.getViewType() === 'canvas' ||
				activeLeaf.view.getViewType() === 'excalidraw')) {
			return false;
		}

		return true;
	}

	private handlePaste(event: ClipboardEvent) {

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
			timeoutId: window.setTimeout(() => {
				if (this.dropInfo?.batchId === this.batchId) {
					const incompleteBatch = this.fileQueue.length > 0;
					if (incompleteBatch) {
						this.dropInfo.timeoutId = window.setTimeout(() => {
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
		if (this.settings.nondestructive_resizeMode === "nondestructive_resizeMode_customSize" || 
			this.settings.nondestructive_resizeMode === "nondestructive_resizeMode_fitImage") {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView && markdownImagefromClipboard) {
				this.handleExternalImageLink(markdownImagefromClipboard, activeView.editor);
			}
		}

		/* ----------------------------------------------------------------------------*/
		/* ----------------------------------------------------------------------------*/
	}
	private handleDrop(event: DragEvent) {

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
			window.clearTimeout(this.dropInfo.timeoutId);
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
			timeoutId: window.setTimeout(() => {
				if (this.dropInfo?.batchId === this.batchId) {
					// Instead of resetting, check if processing is still ongoing
					const incompleteBatch = this.fileQueue.length > 0;
					if (incompleteBatch) {
						// Extend timeout if files are still being processed
						this.dropInfo.timeoutId = window.setTimeout(() => {
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
	
		// Handle external link resizing if needed
		/* ----------------------------------------------------------------------------*/
		// Get the clipboard data as HTML and parse it as Markdown LINK
		if (event.dataTransfer) {
			// Try HTML first as it preserves more formatting
			const htmlData = event.dataTransfer.getData('text/html');
			
			let markdownImageFromDrop = '';
			
			if (htmlData) {
				const parser = new DOMParser();
				const doc = parser.parseFromString(htmlData, 'text/html');
				const img = doc.querySelector('img');
				
				if (img) {
					const altText = img.alt;
					const src = img.src;
					markdownImageFromDrop = `![${altText}](${src})`;
				}
			}

			if (markdownImageFromDrop && 
				(this.settings.nondestructive_resizeMode === "nondestructive_resizeMode_customSize" || 
				this.settings.nondestructive_resizeMode === "nondestructive_resizeMode_fitImage")) {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView) {
					this.handleExternalImageLink(markdownImageFromDrop, activeView.editor);
				}
			}
		}
		/* ----------------------------------------------------------------------------*/
		/* ----------------------------------------------------------------------------*/

		
		if (this.settings.showProgress) {
			this.updateProgressUI(0, imageFiles.length, 'Starting processing...');
		}
	}

	private registerFileEvents() {
		this.registerEvent(
			this.app.vault.on('create', async (file: TFile) => {
				
				if (await this.isExternalOperation(file)) return;
				if (this.isConversionPaused) return;

				const isMobile = Platform.isMobile;
				if (!(file instanceof TFile) || !isImage(file)) return;
	
				// For multiple files, we want to maintain the batch state
				if (!this.batchStarted) {
					this.batchStarted = true;
					this.userAction = true;
				}
				
				if (isMobile) {
					await this.handleMobileFileCreation(file);
				} else {
					await this.handleDesktopFileCreation(file);
				}
			})
		);
	}
	private async isExternalOperation(file: TFile): Promise<boolean> {
		const app = this.app as ObsidianApp;
		
		// Common sync patterns for both mobile and desktop
		const syncPatterns = [
			'.sync-conflict',
			'.git',
			'.remote.',
			'.sync/',
			'.obsidian/plugins/remotely-save/',
			'.obsidian/plugins/syncthing/',
			'sync-index',
			'.obsidian-git'
		];
		
		// Common sync plugins check for both mobile and desktop
		const syncPlugins = ['remotely-save', 'syncthing', 'obsidian-git'];
		const isAnySyncing = syncPlugins.some(pluginId => 
			app.plugins.plugins[pluginId]?.isSyncing ||
			app.plugins.plugins[pluginId]?.status === 'syncing'
		);
	
		// Common checks for both platforms
		const isSyncPath = syncPatterns.some(pattern => file.path.includes(pattern));
		const wasRecentlyProcessed = this.processedFiles.some(
			processedFile => processedFile.name === file.path
		);
	
		if (Platform.isMobile) {
			// Mobile-specific checks
			// Return true only if it's a sync operation or was recently processed
			return isSyncPath || isAnySyncing || wasRecentlyProcessed;
		}
	
		// Desktop-specific checks
		// Check if Obsidian window is not focused
		if (!document.hasFocus()) {
			return true;
		}
	
		// Check if this is a file system operation without user interaction
		if (!this.userAction) {
			return true;
		}

		// Time-based debounce check
		const now = Date.now();
		const isRecentlyProcessed = Boolean(
			this.lastProcessedTime && 
			(now - this.lastProcessedTime) < 1000
		);

		// Final check combining all conditions for desktop
		return isSyncPath || isAnySyncing || wasRecentlyProcessed || !this.userAction || isRecentlyProcessed;
	}
	private async handleMobileFileCreation(file: TFile) {

		// Set batch parameters for single file processing
		this.currentBatchTotal = 1;
		this.batchStarted = true;
		this.userAction = true; // Force userAction to true for mobile
	
		// Generate new batch ID
		this.batchId = Date.now().toString();
	
		try {
			// Add to queue with mobile-specific context
			this.fileQueue.push({ 
				file,
				addedAt: Date.now(),
				viewType: 'markdown', // Mobile attachments typically in markdown
				originalName: file.name,
				originalPath: file.path,
				processed: false,
				isMobileAttachment: true
			});
			
			await this.processQueue();

			// Verify processing success
			const processedFile = await this.app.vault.adapter.stat(file.path);
			if (!processedFile) {
				throw new Error('File not found after processing');
			}

		} catch (error) {
			console.error('Error processing mobile file:', error);
			// Only show notice for actual failures, not successful conversions
			if (!await this.app.vault.adapter.exists(file.path)) {
				new Notice(`Failed to process mobile file: ${file.name}`);
			}
		} finally {
			// Reset state after processing
			window.setTimeout(() => {
				this.userAction = false;
				this.batchStarted = false;
			}, 1000);
		}
	}
	private async handleDesktopFileCreation(file: TFile) {
		if (!this.userAction) return;
	
		try {
			// Generate hash for duplicate detection
			const sourceHash = await this.generateSourceHash(file);
	
			// Handle duplicates based on settings
			if (this.fileHashes.has(sourceHash)) {
				const duplicateHandling = this.settings.manage_duplicate_filename;
	
				switch (duplicateHandling) {
					case "duplicate_replace":
						// Continue processing, treating it as a new entry
						break;
					case "duplicate_rename":
						await this.renameFile1(file);
						break;
					default:
						// Skip processing if neither option is selected
						return;
				}
			} else {
				// Add hash to our set since it's a new file
				this.fileHashes.add(sourceHash);
			}
	
			// Check if this file was already processed
			const originalNameWithExt = file.name;
			if (this.fileQueue.some(item => item.originalName === originalNameWithExt)) {
				return;
			}
	
			// Get active view type and validate
			const activeView = this.getActiveView();
			const viewType = activeView?.getViewType();
			
			if (!this.isValidViewType(viewType)) return;
	
			// Handle single file drops
			if (!this.batchStarted) {
				this.currentBatchTotal = 1;
				this.batchId = Date.now().toString();
			}
	
			// Add to queue with desktop-specific context
			this.fileQueue.push({ 
				file,
				addedAt: Date.now(),
				viewType: viewType as 'markdown' | 'canvas' | 'excalidraw',
				parentFile: viewType !== 'markdown' ? (activeView as any).file : undefined,
				originalName: originalNameWithExt,
				originalPath: file.path,
				processed: false
			});
	
			await this.processQueue();
	
		} catch (error) {
			console.error('Error processing desktop file:', error);
			new Notice(`Failed to process file: ${file.name}`);
		}
	}
	private handleExternalImageLink(markdownText: string, editor: Editor): void {
		const linkPattern = /!\[(.*?)\]\((.*?)\)/;
		const match = markdownText.match(linkPattern);
		
		if (!match) return;
		
		const [, altText, currentLink] = match; // Using comma to skip first element
		const cleanAltText = altText.replace(/\|\d+(\|\d+)?/g, ''); // remove any sizing info
		
		let imageSizeValue = '';
		if (this.settings.nondestructive_resizeMode === "nondestructive_resizeMode_customSize") {
			imageSizeValue = this.settings.nondestructive_resizeMode_customSize;
		} else if (this.settings.nondestructive_resizeMode === "nondestructive_resizeMode_fitImage") {
			imageSizeValue = this.settings.nondestructive_resizeMode_fitImage;
		}
		
		const newMarkdown = `![${cleanAltText}|${imageSizeValue}](${currentLink})`;
		
		const lineContent = editor.getLine(editor.getCursor().line);
		const startPos = lineContent.indexOf(`![${cleanAltText}`);
		const endPos = lineContent.indexOf(')', startPos) + 1;
		
		if (startPos !== -1 && endPos !== -1) {
			editor.replaceRange(
				newMarkdown,
				{ line: editor.getCursor().line, ch: startPos },
				{ line: editor.getCursor().line, ch: endPos }
			);
		}
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
				// Kill switch check aka escape
				if (this.isKillSwitchActive) {
					// console.log('Processing killed by user (ESC pressed)');
					break;
				}
				// Check if we're still processing the same batch
				if (currentBatchId !== this.batchId) {
					// console.log('Batch ID changed, starting new batch');
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
								window.clearTimeout(this.dropInfo.timeoutId);
							}

							// Calculate extended timeout based on file characteristics
							const extensionTime = Math.max(
								30000, // minimum 30 seconds
								(currentFile.size / (1024 * 1024)) * 2000 // 2 seconds per MB
							) * (isComplexFormat ? 1.5 : 1); // 50% more time for complex formats

							this.dropInfo.timeoutId = window.setTimeout(() => {
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
					// Kill switch check before processing each file
					if (this.isKillSwitchActive) {
						break;
					}
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
									window.setTimeout(() => reject(new Error('Processing timeout')), timeoutDuration)
								)
							]);
							success = true;
						} catch (error) {
							attempts++;
							if (attempts === maxAttempts) {
								throw error;
							}
							// Wait before retry
							await new Promise(resolve => window.setTimeout(resolve, 1000));
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
				await new Promise(resolve => window.setTimeout(resolve, delayTime));
			}
		} finally {
			// Only clean up if we're still on the same batch
			if (currentBatchId === this.batchId) {
				this.isProcessingQueue = false;
	
				// Show summary and cleanup only if batch is complete
				if (!this.isKillSwitchActive && this.dropInfo?.totalProcessedFiles === this.dropInfo?.totalExpectedFiles) {
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
		if (!this.progressEl || this.isConversionPaused) {
			this.hideProgressBar();
			return;
		}

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
			window.setTimeout(() => this.hideProgressBar(), 1000);
		}
    }
	
	private hideProgressBar() {
		if (this.progressEl) {
			this.progressEl.style.display = 'none';
			this.progressEl.empty();
		}
		if (this.rafId) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
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
		// Don't show empty summary
        if (this.processedFiles.length === 0) return;

        const totalSaved = this.totalSizeBeforeBytes - this.totalSizeAfterBytes;
        const overallRatio = ((-totalSaved / this.totalSizeBeforeBytes) * 100).toFixed(1);
        
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


	// Work on the file
	/* ------------------------------------------------------------- */
	async renameFile1(file: TFile, parentFile?: TFile): Promise<string> {   
		// We want to ensure we get the specific file where the drop occurred (parentFile)
		// If that's not available, we fall back to Obsidian's getActiveFile()
		// parentFile is actually the TFile  associated with the view where the drop occurred.
		const activeFile = parentFile || this.app.workspace.getActiveFile();
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

			// 2. while we are here - reading converted image, lets check its width too. 
			// So we could later pass it into custom sizing options etc. 
			// Only check it if the setting for nondestructive_resizeMode_customSize or fitImage is enabled  as there are the only options currently need it
			// Fit image = ensures images are never wider than the editor while preserving their original size if they're already smaller than the editor width.
			if (this.settings.nondestructive_resizeMode === "nondestructive_resizeMode_customSize" || this.settings.nondestructive_resizeMode === "nondestructive_resizeMode_fitImage") {
				try {
					this.widthSide = await getImageWidthSide(arrayBuffer);
					const maxWidth = printEditorLineWidth(this.app);
					if (this.widthSide !== null && typeof maxWidth === 'number') {
						this.settings.nondestructive_resizeMode_fitImage = (this.widthSide < maxWidth ? this.widthSide : maxWidth).toString();
						await this.saveSettings();
					}
				} catch (error) {
					console.error('Could not determine image dimensions, using default settings');
				}
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
	
		// Only process if we need to compress or resize
		if (this.settings.convertTo === 'disabled') {
			// If format is "Same as original"
			if (this.settings.quality < 1 || this.needsResize()) {
				// Process compression/resize while maintaining original format
				imgBlob = await this.processOriginalFormat(imgBlob, file.extension);
			}
		} else {
			// Convert to specified format
			imgBlob = await this.convertImageFormat(imgBlob, file.extension);
		}
		
		return imgBlob;
	}

	private needsResize(): boolean {
		return this.settings.destructive_resizeMode !== 'None' &&
			(this.settings.destructive_desiredWidth > 0 ||
				this.settings.destructive_desiredHeight > 0 ||
				this.settings.destructive_desiredLongestEdge > 0);
	}

	private async processOriginalFormat(imgBlob: Blob, extension: string): Promise<Blob> {
		let buffer: ArrayBuffer;
		const ext = extension.toLowerCase();
	
		switch (ext) {
			case 'jpg':
			case 'jpeg':
				buffer = await convertToJPG(
					imgBlob,
					this.settings.quality,
					this.settings.destructive_resizeMode,
					this.settings.destructive_desiredWidth,
					this.settings.destructive_desiredHeight,
					this.settings.destructive_desiredLongestEdge,
					this.settings.destructive_enlarge_or_reduce,
					this.settings.allowLargerFiles
				);
				return new Blob([buffer], { type: 'image/jpeg' });
	
			case 'png':
				buffer = await convertToPNG(
					imgBlob,
					this.settings.quality,
					this.settings.destructive_resizeMode,
					this.settings.destructive_desiredWidth,
					this.settings.destructive_desiredHeight,
					this.settings.destructive_desiredLongestEdge,
					this.settings.destructive_enlarge_or_reduce,
					this.settings.allowLargerFiles
				);
				return new Blob([buffer], { type: 'image/png' });
	
			case 'webp':
				buffer = await convertToWebP(
					imgBlob,
					this.settings.quality,
					this.settings.destructive_resizeMode,
					this.settings.destructive_desiredWidth,
					this.settings.destructive_desiredHeight,
					this.settings.destructive_desiredLongestEdge,
					this.settings.destructive_enlarge_or_reduce,
					this.settings.allowLargerFiles
				);
				return new Blob([buffer], { type: 'image/webp' });
	
			default:
				// For unsupported formats, return original
				return imgBlob;
		}
	}

	private async convertImageFormat(imgBlob: Blob, originalExtension: string): Promise<Blob> {
		const format = this.settings.convertTo === 'disabled' ? originalExtension : this.settings.convertTo;

		const conversionParams = {
			quality: this.settings.quality,
			destructive_resizeMode: this.settings.destructive_resizeMode,
			destructive_desiredWidth: this.settings.destructive_desiredWidth,
			destructive_desiredHeight: this.settings.destructive_desiredHeight,
			destructive_desiredLongestEdge: this.settings.destructive_desiredLongestEdge,
			destructive_enlarge_or_reduce: this.settings.destructive_enlarge_or_reduce,
			allowLargerFiles: this.settings.allowLargerFiles
		};

		let arrayBuffer: ArrayBuffer;

		switch (format) {
			case 'webp':
				arrayBuffer = await convertToWebP(
					imgBlob,
					conversionParams.quality,
					conversionParams.destructive_resizeMode,
					conversionParams.destructive_desiredWidth,
					conversionParams.destructive_desiredHeight,
					conversionParams.destructive_desiredLongestEdge,
					conversionParams.destructive_enlarge_or_reduce,
					conversionParams.allowLargerFiles
				);
				break;
			case 'jpg':
				arrayBuffer = await convertToJPG(
					imgBlob,
					conversionParams.quality,
					conversionParams.destructive_resizeMode,
					conversionParams.destructive_desiredWidth,
					conversionParams.destructive_desiredHeight,
					conversionParams.destructive_desiredLongestEdge,
					conversionParams.destructive_enlarge_or_reduce,
					conversionParams.allowLargerFiles
				);
				break;
			case 'png':
				arrayBuffer = await convertToPNG(
					imgBlob,
					conversionParams.quality,
					conversionParams.destructive_resizeMode,
					conversionParams.destructive_desiredWidth,
					conversionParams.destructive_desiredHeight,
					conversionParams.destructive_desiredLongestEdge,
					conversionParams.destructive_enlarge_or_reduce,
					conversionParams.allowLargerFiles
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
				const originalPath = finalPath; // Save the original path before entering the loop
				let suffix = 1;
			
				while (await this.fileExistsWithAnyCase(finalPath)) {
					finalPath = this.generateNewNameWithSuffix(originalPath, suffix); // Use the original path to generate new names
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
	
	// Helper function to generate a new filename with a numeric suffix
	private generateNewNameWithSuffix(filePath: string, suffix: number): string {
		const extensionIndex = filePath.lastIndexOf('.');
		if (extensionIndex !== -1) {
			return `${filePath.substring(0, extensionIndex)}-${suffix}${filePath.substring(extensionIndex)}`;
		} else {
			return `${filePath}-${suffix}`;
		}
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
			let size = '';
			if (this.settings.nondestructive_resizeMode === "nondestructive_resizeMode_customSize") {
				const targetSize = parseInt(this.settings.nondestructive_resizeMode_customSize);
				const currentWidth = this.widthSide;
	
				if (currentWidth && targetSize) {
					const shouldResize = (
						this.settings.nondestructive_enlarge_or_reduce === 'Always' ||
						(this.settings.nondestructive_enlarge_or_reduce === 'Reduce' && currentWidth > targetSize) ||
						(this.settings.nondestructive_enlarge_or_reduce === 'Enlarge' && currentWidth < targetSize)
					);
	
					size = shouldResize ? this.settings.nondestructive_resizeMode_customSize : '';
				}
			} else if (this.settings.nondestructive_resizeMode === "nondestructive_resizeMode_fitImage") {
				size = this.settings.nondestructive_resizeMode_fitImage;
			}
	
			return size ? `![|${size}](${cleanPath})` : `![](${cleanPath})`;
		} else {
			// Similar logic for wiki links
			let size = '';
			if (this.settings.nondestructive_resizeMode === "nondestructive_resizeMode_customSize") {
				const targetSize = parseInt(this.settings.nondestructive_resizeMode_customSize);
				const currentWidth = this.widthSide;
	
				if (currentWidth && targetSize) {
					const shouldResize = (
						this.settings.nondestructive_enlarge_or_reduce === 'Always' ||
						(this.settings.nondestructive_enlarge_or_reduce === 'Reduce' && currentWidth > targetSize) ||
						(this.settings.nondestructive_enlarge_or_reduce === 'Enlarge' && currentWidth < targetSize)
					);
	
					size = shouldResize ? this.settings.nondestructive_resizeMode_customSize : '';
				}
			} else if (this.settings.nondestructive_resizeMode === "nondestructive_resizeMode_fitImage") {
				size = this.settings.nondestructive_resizeMode_fitImage;
			}
	
			return size ? `![[${cleanPath}|${size}]]` : `![[${cleanPath}]]`;
		}
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



	/* Commands */
	/* ------------------------------------------------------------- */

	private registerCommands() {
		// Process all vault images
		this.addCommand({
			id: 'process-all-vault-images',
			name: 'Process all vault images',
			callback: () => new ProcessAllVault(this).open()
		});
	
		// Process current note images
		this.addCommand({
			id: 'process-all-images-current-note',
			name: 'Process all images in current note',
			callback: () => new ProcessCurrentNote(this).open()
		});
	
		// Open settings
		this.addCommand({
			id: 'open-image-converter-settings',
			name: 'Open Image Converter Settings',
			callback: () => this.command_openSettingsTab()
		});
	
		// Toggle conversion
		this.addCommand({
			id: 'toggle-image-conversion',
			name: 'Toggle Image Conversion (Pause/Resume)',
			callback: () => this.command_toggleConversion()
		});
	}

	// Toogle to Pause / Continue image conversion
	private command_toggleConversion(): void {
		this.isConversionPaused = !this.isConversionPaused;
		
		// Clear any existing timeout for status bar removal
		if (this.isConversionPaused_statusTimeout) {
			window.clearTimeout(this.isConversionPaused_statusTimeout);
			this.isConversionPaused_statusTimeout = null;
		}
		
		// Create status bar item if it doesn't exist
		if (!this.statusBarItemEl) {
			this.statusBarItemEl = this.addStatusBarItem();
		}
		
		if (this.isConversionPaused) {
			this.statusBarItemEl.setText('Image Conversion: Paused ⏸️');
			new Notice('Image conversion paused');
			
			// Clear current queue and state
			this.fileQueue = [];
			this.isProcessingQueue = false;
			
			// Reset batch processing state
			if (this.dropInfo) {
				const timeoutId = (this.dropInfo as DropInfo).timeoutId;
				if (typeof timeoutId === 'number') {
					window.clearTimeout(timeoutId);
				}
				this.dropInfo = null;
			}
			
			this.batchStarted = false;
			this.userAction = false;
			
			// Ensure progress bar is hidden
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

	//////////////////Process All Vault
	async processAllVaultImages() {
		try {
			const isKeepOriginalFormat = this.settings.ProcessAllVaultconvertTo === 'disabled';
			const noCompression = this.settings.ProcessAllVaultquality === 1;
			const noResize = this.settings.ProcessAllVaultResizeModalresizeMode === 'None';
			const targetFormat = this.settings.ProcessAllVaultconvertTo;
	
			// Parse skip formats
			const skipFormats = this.settings.ProcessAllVaultSkipFormats
				.toLowerCase()
				.split(',')
				.map(format => format.trim())
				.filter(format => format.length > 0);
	
			// Get all image files in the vault
			const allFiles = this.app.vault.getFiles();
			const imageFiles = allFiles.filter(file => 
				file instanceof TFile && 
				isImage(file)
			);
	
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
				this.processAllVaultImages_shouldProcessImage(file)
			);
	
			if (filesToProcess.length === 0) {
				if (this.settings.ProcessAllVaultskipImagesInTargetFormat) {
					new Notice(`No processing needed: All vault images are either in ${isKeepOriginalFormat ? 'their original' : targetFormat.toUpperCase()} format or in skip list.`);
				} else {
					new Notice('No images found that need processing.');
				}
				return;
			}
	
			let imageCount = 0;
			const statusBarItemEl = this.addStatusBarItem();
			const startTime = Date.now();
	
			for (const file of filesToProcess) {
				imageCount++;
				console.log(`Processing image ${imageCount} of ${filesToProcess.length}: ${file.name} ${file.path}`);
	
				await this.convertAllVault(file);
				await refreshImagesInActiveNote();
	
				const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
				statusBarItemEl.setText(
					`Processing image ${imageCount} of ${filesToProcess.length}, elapsed time: ${elapsedTime} seconds`
				);
				console.log(`${imageCount} of ${filesToProcess.length} ${file.name} ${file.path} ${elapsedTime} seconds elapsed`);
			}
	
			const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
			statusBarItemEl.setText(`Finished processing ${imageCount} images, total time: ${totalTime} seconds`);
			
			if (imageCount > 0) {
				new Notice(`Successfully processed ${imageCount} images.`);
			}
	
			window.setTimeout(() => {
				statusBarItemEl.setText('');
			}, 5000);
	
		} catch (error) {
			console.error('Error processing vault images:', error);
			new Notice(`Error processing images: ${error.message}`);
		} finally {
			if (this.statusBarItemEl) {
				this.statusBarItemEl.remove();
			}
		}
	}

	async convertAllVault(file: TFile) {
		// Early return if no processing is needed
		if (this.settings.ProcessAllVaultconvertTo === 'disabled' && 
			this.settings.ProcessAllVaultquality === 1 && 
			this.settings.ProcessAllVaultResizeModalresizeMode === 'None') {
			return; // Skip processing entirely
		}
	
		let extension = file.extension;
		let shouldRename = false;
		let newFilePath: string | undefined;
	
		// Only prepare for rename if we're changing to a different format
		if (this.settings.ProcessAllVaultconvertTo && 
			this.settings.ProcessAllVaultconvertTo !== 'disabled' &&
			this.settings.ProcessAllVaultconvertTo !== file.extension) {
			extension = this.settings.ProcessAllVaultconvertTo;
			shouldRename = true;
			newFilePath = await this.getUniqueFilePath(file, extension);
		}
	
		const binary = await this.app.vault.readBinary(file);
		let imgBlob = new Blob([binary], { type: `image/${file.extension}` });
	
		// Handle special formats
		if (file.extension === 'tif' || file.extension === 'tiff') {
			imgBlob = await handleTiffImage(binary);
		}
	
		if (file.extension === 'heic') {
			imgBlob = await convertHeicToFormat(
				binary,
				'JPEG',
				this.settings.ProcessAllVaultquality
			);
		}
	
		const quality = this.settings.ProcessAllVaultquality;
		const resizeMode = this.settings.ProcessAllVaultResizeModalresizeMode;
		const desiredWidth = this.settings.ProcessAllVaultResizeModaldesiredWidth;
		const desiredHeight = this.settings.ProcessAllVaultResizeModaldesiredHeight;
		const desiredLength = this.settings.ProcessAllVaultResizeModaldesiredLength;
		const enlargeOrReduce = this.settings.ProcessAllVaultEnlargeOrReduce;
		const convertTo = this.settings.ProcessAllVaultconvertTo;
		const allowLargerFiles = this.settings.allowLargerFiles;
	
		// Handle quality < 1 (compression) case
		if (quality !== 1) {
			let arrayBuffer: ArrayBuffer | undefined;

			// If format is disabled or same as source format, just compress in original format
			if (convertTo === 'disabled' || convertTo === file.extension) {
				switch (file.extension) {
					case 'jpg':
					case 'jpeg':
						arrayBuffer = await convertToJPG(imgBlob, quality, resizeMode, desiredWidth, desiredHeight, desiredLength, enlargeOrReduce, allowLargerFiles);
						break;
					case 'png':
						arrayBuffer = await convertToPNG(imgBlob, quality, resizeMode, desiredWidth, desiredHeight, desiredLength, enlargeOrReduce, allowLargerFiles);
						break;
					case 'webp':
						arrayBuffer = await convertToWebP(imgBlob, quality, resizeMode, desiredWidth, desiredHeight, desiredLength, enlargeOrReduce, allowLargerFiles);
						break;
				}
			} else {
				// Handle format conversion with compression
				switch (convertTo) {
					case 'webp':
						arrayBuffer = await convertToWebP(imgBlob, quality, resizeMode, desiredWidth, desiredHeight, desiredLength, enlargeOrReduce, allowLargerFiles);
						break;
					case 'jpg':
						arrayBuffer = await convertToJPG(imgBlob, quality, resizeMode, desiredWidth, desiredHeight, desiredLength, enlargeOrReduce, allowLargerFiles);
						break;
					case 'png':
						arrayBuffer = await convertToPNG(imgBlob, quality, resizeMode, desiredWidth, desiredHeight, desiredLength, enlargeOrReduce, allowLargerFiles);
						break;
				}
			}
	
			if (arrayBuffer) {
				await this.app.vault.modifyBinary(file, arrayBuffer);
			} else {
				new Notice('Error: Failed to compress image.');
			}
		} 
		// Handle resize only case (no compression)
			else if (quality === 1 && resizeMode !== 'None') {
			let arrayBuffer: ArrayBuffer | undefined;
			
			switch (file.extension) {
				case 'jpg':
				case 'jpeg':
					arrayBuffer = await convertToJPG(imgBlob, 1, resizeMode, desiredWidth, desiredHeight, desiredLength, enlargeOrReduce, allowLargerFiles);
					break;
				case 'png':
					arrayBuffer = await convertToPNG(imgBlob, 1, resizeMode, desiredWidth, desiredHeight, desiredLength, enlargeOrReduce, allowLargerFiles);
					break;
				case 'webp':
					arrayBuffer = await convertToWebP(imgBlob, 1, resizeMode, desiredWidth, desiredHeight, desiredLength, enlargeOrReduce, allowLargerFiles);
					break;
			}
	
			if (arrayBuffer) {
				await this.app.vault.modifyBinary(file, arrayBuffer);
			} else {
				new Notice('Error: Failed to resize image.');
			}
		}
	
		// Only rename and update links if we're changing formats
		if (shouldRename && newFilePath) {
			await this.updateAllVaultLinks(file, newFilePath);
		}
	}

	async updateAllVaultLinks(file: TFile, newFilePath: string) {
		try {
			// Rename the file first
			await this.app.fileManager.renameFile(file, newFilePath);
	
			// Get the new file reference after renaming
			const newFile = this.app.vault.getAbstractFileByPath(newFilePath) as TFile;
			if (!newFile) {
				console.error('Could not find renamed file:', newFilePath);
				return;
			}
	
			// Get all markdown files in the vault
			const markdownFiles = this.app.vault.getMarkdownFiles();
	
			// Iterate over each markdown file
			for (const markdownFile of markdownFiles) {
				let content = await this.app.vault.read(markdownFile);
				let modified = false;
	
				// Handle different link formats
				const linkPatterns = [
					`![[${file.basename}]]`,                    // Basic wikilink
					`![[${file.basename}.${file.extension}]]`,  // Full filename wikilink
					`![](${file.name})`,                        // Markdown link
				];
	
				const newLink = `![[${newFile.basename}.${newFile.extension}]]`;
	
				// Replace each pattern if found
				for (const pattern of linkPatterns) {
					if (content.includes(pattern)) {
						content = content.split(pattern).join(newLink);
						modified = true;
					}
				}
	
				// Only modify the file if changes were made
				if (modified) {
					await this.app.vault.modify(markdownFile, content);
				}
			}
		} catch (error) {
			// console.error('Error updating links:', error);
			// new Notice(`Error updating links: ${error.message}`);
		}
	}

	processAllVaultImages_shouldProcessImage(image: TFile): boolean {
		const isKeepOriginalFormat = this.settings.ProcessAllVaultconvertTo === 'disabled';
		const effectiveTargetFormat = isKeepOriginalFormat 
			? image.extension 
			: this.settings.ProcessAllVaultconvertTo;
	
		// Get skip formats from settings and parse them
		const skipFormats = this.settings.ProcessAllVaultSkipFormats
			.toLowerCase()
			.split(',')
			.map(format => format.trim())
			.filter(format => format.length > 0);
		
		// Skip files with extensions in the skip list
		if (skipFormats.includes(image.extension.toLowerCase())) {
			console.log(`Skipping ${image.name}: Format ${image.extension} is in skip list`);
			return false;
		}
	
		// Skip images already in target format (or original format if disabled)
		if (this.settings.ProcessAllVaultskipImagesInTargetFormat && 
			image.extension === effectiveTargetFormat) {
			console.log(`Skipping ${image.name}: Already in ${effectiveTargetFormat} format`);
			return false;
		}
		
		return true;
	}

	private async processAllVaultImages_fileExists(path: string): Promise<boolean> {
		try {
			const abstractFile = this.app.vault.getAbstractFileByPath(path);
			return abstractFile !== null;
		} catch {
			return false;
		}
	}

	/////////////////Process Current Note
	async processCurrentNoteImages(note: TFile) {
		try {
			const isKeepOriginalFormat = this.settings.ProcessCurrentNoteconvertTo === 'disabled';
			const noCompression = this.settings.ProcessCurrentNotequality === 1;
			const noResize = this.settings.ProcessCurrentNoteResizeModalresizeMode === 'None';
			const targetFormat = this.settings.ProcessCurrentNoteconvertTo;
	
			// Parse skip formats
			const skipFormats = this.settings.ProcessCurrentNoteSkipFormats
			.toLowerCase()
			.split(',')
			.map(format => format.trim())
			.filter(format => format.length > 0);
			
			// Get all image files in the note first
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!activeView?.file) {
				new Notice('No active note found.');
				return;
			}
	
			const resolvedLinks = this.app.metadataCache.resolvedLinks;
			const linksInCurrentNote = resolvedLinks[activeView.file.path];
			const linkedFiles = Object.keys(linksInCurrentNote)
				.map(link => this.app.vault.getAbstractFileByPath(link))
				.filter((file): file is TFile => 
					file instanceof TFile && 
					isImage(file)
				);
	
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
				this.processCurrentNoteImages_shouldProcessImage(file)
			);
	
			if (filesToProcess.length === 0) {
				if (this.settings.ProcessCurrentNoteskipImagesInTargetFormat) {
					new Notice(`No processing needed: All images are already in ${isKeepOriginalFormat ? 'their original' : targetFormat.toUpperCase()} format.`);
				} else {
					new Notice('No images found that need processing.');
				}
				return;
			}
					
			let imageCount = 0;
			const statusBarItemEl = this.addStatusBarItem();
			const startTime = Date.now();
	
			const totalImages = filesToProcess.length;
	
			for (const linkedFile of filesToProcess) {
				imageCount++;
				await this.convertCurrentNoteImages(linkedFile);
				await refreshImagesInActiveNote();
				
				const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
				statusBarItemEl.setText(
					`Processing image ${imageCount} of ${totalImages}, elapsed time: ${elapsedTime} seconds`
				);
			}
	
			const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
			statusBarItemEl.setText(`Finished processing ${imageCount} images, total time: ${totalTime} seconds`);
			window.setTimeout(() => {
				statusBarItemEl.setText('');
			}, 5000);
	
		} catch (error) {
			console.error('Error processing images in current note:', error);
			new Notice(`Error processing images: ${error.message}`);
		} finally {
			if (this.statusBarItemEl) {
				this.statusBarItemEl.remove();
			}
		}
	}

	async convertCurrentNoteImages(file: TFile) {
		try {
			const isKeepOriginalFormat = this.settings.ProcessCurrentNoteconvertTo === 'disabled';
			const noCompression = this.settings.ProcessCurrentNotequality === 1;
			const noResize = this.settings.ProcessCurrentNoteResizeModalresizeMode === 'None';
	
			// When "Same as original" is selected, treat the file's current extension
			// as the target format
			const effectiveTargetFormat = isKeepOriginalFormat 
				? file.extension 
				: this.settings.ProcessCurrentNoteconvertTo;
	
			// Skip processing if:
			// 1. We're keeping original format (disabled)
			// 2. No compression
			// 3. No resize
			if (isKeepOriginalFormat && noCompression && noResize) {
				console.log(`Skipping ${file.name}: No processing needed`);
				return;
			}
	
			// Skip if the image is already in target format (or original format if disabled)
			if (this.settings.ProcessCurrentNoteskipImagesInTargetFormat &&
				file.extension === effectiveTargetFormat) {
				console.log(`Skipping ${file.name}: Already in ${isKeepOriginalFormat ? 'original' : 'target'} format`);
				return;
			}

			// // Get skip formats from settings and parse them
			// const skipFormats = this.settings.ProcessCurrentNoteSkipFormats
			// 	.toLowerCase()
			// 	.split(',')
			// 	.map((format) => format.trim())
			// 	.filter((format) => format.length > 0);

			// // Skip files with extensions in the skip list
			// if (skipFormats.includes(file.extension.toLowerCase())) {
			// 	return;
			// }
			
			const activeFile = this.app.workspace.getActiveFile();
			if (!activeFile) {
				new Notice('Error: No active file found.');
				return;
			}

			// Prepare for format conversion and renaming
			let extension = file.extension;
			let shouldRename = false;
			let newFilePath: string | undefined;

			if (effectiveTargetFormat && 
				effectiveTargetFormat !== 'disabled' &&
				effectiveTargetFormat !== file.extension) {
				extension = effectiveTargetFormat;
				shouldRename = true;
				newFilePath = await this.getUniqueFilePath(file, extension);
			}

			const binary = await this.app.vault.readBinary(file);
			let imgBlob = new Blob([binary], { type: `image/${file.extension}` });

			// Handle special formats
			if (file.extension === 'tif' || file.extension === 'tiff') {
				imgBlob = await handleTiffImage(binary);
			}

			if (file.extension === 'heic') {
				imgBlob = await convertHeicToFormat(
					binary,
					'JPEG',
					this.settings.ProcessCurrentNotequality
				);
			}

			const quality = this.settings.ProcessCurrentNotequality;
			const resizeMode = this.settings.ProcessCurrentNoteResizeModalresizeMode;
			const desiredWidth = this.settings.ProcessCurrentNoteresizeModaldesiredWidth;
			const desiredHeight = this.settings.ProcessCurrentNoteresizeModaldesiredHeight;
			const desiredLength = this.settings.ProcessCurrentNoteresizeModaldesiredLength;
			const enlargeOrReduce = this.settings.ProcessCurrentNoteEnlargeOrReduce;
			const allowLargerFiles = this.settings.allowLargerFiles;

			let arrayBuffer: ArrayBuffer | undefined;

			// Handle image conversion and compression/resizing
			switch (extension) {
				case 'jpg':
				case 'jpeg':
					arrayBuffer = await convertToJPG(imgBlob, quality, resizeMode, desiredWidth, desiredHeight, desiredLength, enlargeOrReduce, allowLargerFiles);
					break;
				case 'png':
					arrayBuffer = await convertToPNG(imgBlob, quality, resizeMode, desiredWidth, desiredHeight, desiredLength, enlargeOrReduce, allowLargerFiles);
					break;
				case 'webp':
					arrayBuffer = await convertToWebP(imgBlob, quality, resizeMode, desiredWidth, desiredHeight, desiredLength, enlargeOrReduce, allowLargerFiles);
					break;
				default:
					new Notice(`Unsupported image format: ${file.extension}`);
					return;
			}

			// Apply the processed image if available
			if (arrayBuffer) {
				await this.app.vault.modifyBinary(file, arrayBuffer);
			} else {
				new Notice('Error: Failed to process image.');
				return;
			}

			// Rename and update links if necessary
			if (shouldRename && newFilePath) {
				await this.updateCurrentNoteLinks(activeFile, file, extension);
				await this.app.vault.rename(file, newFilePath);
			}
		} catch (error) {
			console.error('Error converting image:', error);
			new Notice(`Error converting image: ${error.message}`);
		}
	}

	async updateCurrentNoteLinks(note: TFile, file: TFile, newExtension: string) {
		try {
			// Rename the file first
			const newFilePath = await this.getUniqueFilePath(file, newExtension);
			await this.app.fileManager.renameFile(file, newFilePath);

			// Get the new file reference after renaming
			const newFile = this.app.vault.getAbstractFileByPath(newFilePath) as TFile;
			if (!newFile) {
				console.error('Could not find renamed file:', newFilePath);
				return;
			}

			// Get the content of the current note
			let content = await this.app.vault.read(note);
			let modified = false;

			// Handle different link formats
			const linkPatterns = [
				`![[${file.basename}]]`,                    // Basic wikilink
				`![[${file.basename}.${file.extension}]]`,  // Full filename wikilink
				`![](${file.name})`,                        // Markdown link
			];

			const newLink = `![[${newFile.basename}.${newFile.extension}]]`;

			// Replace each pattern if found
			for (const pattern of linkPatterns) {
				if (content.includes(pattern)) {
					content = content.split(pattern).join(newLink);
					modified = true;
				}
			}

			// Only modify the file if changes were made
			if (modified) {
				await this.app.vault.modify(note, content);
			}
		} catch (error) {
			console.error('Error updating links:', error);
			new Notice(`Error updating links: ${error.message}`);
		}
	}

	private processCurrentNoteImages_shouldProcessImage(image: TFile): boolean {
		const isKeepOriginalFormat = this.settings.ProcessCurrentNoteconvertTo === 'disabled';
		const effectiveTargetFormat = isKeepOriginalFormat 
			? image.extension 
			: this.settings.ProcessCurrentNoteconvertTo;
	
		// Get skip formats from settings and parse them
		const skipFormats = this.settings.ProcessCurrentNoteSkipFormats
			.toLowerCase()
			.split(',')
			.map(format => format.trim())
			.filter(format => format.length > 0);
		
		// Skip files with extensions in the skip list
		if (skipFormats.includes(image.extension.toLowerCase())) {
			console.log(`Skipping ${image.name}: Format ${image.extension} is in skip list`);
			return false;
		}
	
		// Skip images already in target format (or original format if disabled)
		if (this.settings.ProcessCurrentNoteskipImagesInTargetFormat && 
			image.extension === effectiveTargetFormat) {
			console.log(`Skipping ${image.name}: Already in ${effectiveTargetFormat} format`);
			return false;
		}
		
		return true;
	}
	/* ------------------------------------------------------------- */

	private async getUniqueFilePath(file: TFile, newExtension: string): Promise<string> {
		const dir = file.parent?.path || "";
		const baseName = file.basename;
		let counter = 0;
		let newPath: string;
		
		do {
			newPath = counter === 0 
				? `${dir}/${baseName}.${newExtension}`
				: `${dir}/${baseName}-${counter}.${newExtension}`;
			newPath = newPath.replace(/^\//, ''); // Remove leading slash if present
			counter++;
		} while (await this.processAllVaultImages_fileExists(newPath));
	
		return newPath;
	}

	/* ------------------------------------------------------------- */
	/* ------------------------------------------------------------- */



	/* Context menu */
	/* ------------------------------------------------------------- */

	private registerContextMenu() {
		this.register(
			this.onElement(document, 'contextmenu', 'img', this.onContextMenu.bind(this))
		);
	
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				menu.addItem((item) => {
					item
						.setTitle("Process all images in current note")
						.setIcon("cog")
						.onClick(async () => {
							new ProcessCurrentNote(this).open();
						});
				});
			})
		);
	}

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

		// Check if we're in Canvas view first
		const activeView = this.getActiveView();
		const isCanvasView = activeView?.getViewType() === 'canvas';
	
		// If we're in Canvas view, prevent default and return immediately
		if (isCanvasView) {
			event.preventDefault();
			return;
		}
	
		const target = (event.target as Element);
		if (!(target instanceof HTMLImageElement)) {
			return; // Exit if not an image
		}

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
											
											// Refresh all views that might be showing this image
											const leaves = this.app.workspace.getLeavesOfType('markdown');
											for (const leaf of leaves) {
												const view = leaf.view;
												if (view instanceof MarkdownView) {
													// Store current state
													const currentState = leaf.getViewState();
													// const editor = view.editor;
													// const cursorPosition = editor.getCursor();
													// const scrollInfo = editor.getScrollInfo();
										
													// Force refresh by switching views
													await leaf.setViewState({
														type: 'empty',
														state: {}
													});
										
													// Switch back to the original view
													await leaf.setViewState(currentState);
										
													// Restore cursor and scroll position
													// editor.setCursor(cursorPosition);
													// editor.scrollTo(scrollInfo.left, scrollInfo.top);
												}
											}
										
											// Additionally, refresh any image views of this file
											const imageLeaves = this.app.workspace.getLeavesOfType('image');
											for (const leaf of imageLeaves) {
												const view = leaf.view;
												if (view instanceof FileView && view.file === file) {
													// Refresh the image view
													await leaf.setViewState({
														type: 'image',
														state: { file: file.path }
													});
												}
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

			// Add annotate option
			menu.addItem((item) => {
				item
					.setTitle('Annotate Image')
					.setIcon('pencil')
					.onClick(async () => {
						try {
							// Get the active markdown view
							const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
							if (!activeView) {
								new Notice('No active markdown view');
								return;
							}
			
							// Get the current file (note) being viewed
							const currentFile = activeView.file;
							if (!currentFile) {
								new Notice('No current file found');
								return;
							}
			
							// Get the filename from the src attribute
							const srcAttribute = img.getAttribute('src');
							if (!srcAttribute) {
								new Notice('No source attribute found');
								return;
							}
			
							// Extract just the filename
							const filename = decodeURIComponent(srcAttribute.split('?')[0].split('/').pop() || '');
							// console.log('Extracted filename:', filename);
			
							// Search for the file in the vault
							const matchingFiles = this.app.vault.getFiles().filter(file => 
								file.name === filename
							);
			
							if (matchingFiles.length === 0) {
								console.error('No matching files found for:', filename);
								new Notice(`Unable to find image: ${filename}`);
								return;
							}
			
							// If multiple matches, try to find the one in the same folder as the current note
							const file = matchingFiles.length === 1 
								? matchingFiles[0] 
								: matchingFiles.find(f => {
									// Get the parent folder of the current file
									const parentPath = currentFile.parent?.path;
									return parentPath 
										? f.path.startsWith(parentPath) 
										: false;
								}) || matchingFiles[0];
			
							if (file instanceof TFile) {
								// console.log('Found file:', file.path);
								new ImageAnnotationModal(this.app, this, file).open();
							} else {
								new Notice('Unable to locate image file');
							}
						} catch (error) {
							console.error('Image location error:', error);
							new Notice('Error processing image path');
						}
					});
			});
        
			menu.showAtPosition({ x: event.pageX, y: event.pageY });
			

			// // Prevent the default context menu from appearing
			// event.preventDefault();
		}

	}

	/* ------------------------------------------------------------- */
	/* ------------------------------------------------------------- */


	/* Drag Resize */
	/* ------------------------------------------------------------- */
	private initializeDragResize() {
		if (Platform.isMobile) { return; }

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
		if (Platform.isMobile) { return; }
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

	private dragResize_handleMouseMove = (event: MouseEvent) => {
		if (!this.settings.resizeByDragging) return;
		if (Platform.isMobile) { return; }
		if (this.resizeState.isResizing && this.resizeState.element) {
			if (this.rafId) {
				cancelAnimationFrame(this.rafId);
			}
			
			this.rafId = requestAnimationFrame(() => {
				const { newWidth, newHeight } = this.dragResize_calculateNewDimensions(event);
				this.dragResize_updateElementSize(newWidth, newHeight);
				this.dragResize_updateMarkdownContent(newWidth, newHeight);
			});
		} else {
			this.handleNonResizingMouseMove(event);
		}
	}

	private dragResize_handleMouseUp() {
		if (Platform.isMobile) { return; }
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
		if (Platform.isMobile) { return; }
		const target = event.target as HTMLElement;
		if (this.dragResize_isValidTarget(target) && !this.resizeState.isResizing) {
			target.removeAttribute('data-resize-edge');
		}
	}

    private dragResize_updateElementSize(newWidth: number, newHeight: number) {
        if (!this.resizeState.element) return;
		if (Platform.isMobile) { return; }
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
		if (!this.resizeState.element) return { newWidth: 0, newHeight: 0 };
	
		const deltaX = event.clientX - this.resizeState.startX;
		const aspectRatio = this.resizeState.startWidth / this.resizeState.startHeight;
		
		// Use integer math for better performance
		const newWidth = Math.max(~~(this.resizeState.startWidth + deltaX), 50);
		const newHeight = ~~(newWidth / aspectRatio);
	
		return {
			newWidth: Math.max(50, newWidth),
			newHeight: Math.max(50, newHeight)
		};
	}

	private dragResize_updateMarkdownContent = this.throttle((newWidth: number, newHeight: number) => {
		if (!this.resizeState.element) return;
	
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) return;
	
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
	}, 100);  // Update markdown content at most every 100ms

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
		if (Platform.isMobile) { return; }
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) return;

		// Clean up any images/videos with resize attributes
		activeView.containerEl.querySelectorAll('img, video').forEach(element => {
			element.removeAttribute('data-resize-edge');
			element.removeAttribute('data-resize-active');
		});
	}
	
	private handleNonResizingMouseMove = this.debounce((event: MouseEvent) => {
		if (Platform.isMobile) { return; }
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView || 
			(activeView.getMode() === 'preview' && !this.settings.allowResizeInReadingMode)) {
			return;
		}
	
		const target = event.target as HTMLElement;
		if (this.dragResize_isValidTarget(target)) {
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
	}, 16);  // roughly 60fps

	private debounce<T extends (...args: any[]) => void>(
		func: T,
		wait: number
	): (...args: Parameters<T>) => void {
		let timeout: number;
		return (...args: Parameters<T>) => {
			window.clearTimeout(timeout);
			timeout = window.setTimeout(() => func(...args), wait);
		};
	}
	
	private throttle<T extends (...args: any[]) => void>(
		func: T,
		limit: number
	): (...args: Parameters<T>) => void {
		let inThrottle: boolean;
		return (...args: Parameters<T>) => {
			if (!inThrottle) {
				func(...args);
				inThrottle = true;
				window.setTimeout(() => inThrottle = false, limit);
			}
		};
	}

	/* ------------------------------------------------------------- */
	/* ------------------------------------------------------------- */


	/* Scrolwheel resize*/
	/* ------------------------------------------------------------- */
	// Allow resizing with SHIFT + Scrollwheel
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
					if (Platform.isMobile) { return; }
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
						// event.preventDefault();
	
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
					if (Platform.isMobile) { return; }
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
        if (Platform.isMobile) { return; }
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
	
	private getActiveView(): MarkdownView | View | null {
		return this.app.workspace.getActiveViewOfType(MarkdownView)
			|| this.app.workspace.getLeavesOfType("canvas").find(leaf => leaf.view)?.view
			|| this.app.workspace.getLeavesOfType("excalidraw").find(leaf => leaf.view)?.view
			|| null;
	}
	
	private isValidViewType(viewType: string | undefined): boolean {
		return ['markdown', 'canvas', 'excalidraw'].includes(viewType || '');
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
						settings.destructive_resizeMode,
						settings.destructive_desiredWidth,
						settings.destructive_desiredHeight,
						settings.destructive_desiredLongestEdge,
						settings.destructive_enlarge_or_reduce,
						settings.allowLargerFiles
					);
					break;
				case 'jpg':
					arrayBuffer = await convertToJPG(
						imgBlob,
						Number(settings.quality),
						settings.destructive_resizeMode,
						settings.destructive_desiredWidth,
						settings.destructive_desiredHeight,
						settings.destructive_desiredLongestEdge,
						settings.destructive_enlarge_or_reduce,
						settings.allowLargerFiles
					);
					break;
				case 'png':
					arrayBuffer = await convertToPNG(
						imgBlob,
						Number(settings.quality),
						settings.destructive_resizeMode,
						settings.destructive_desiredWidth,
						settings.destructive_desiredHeight,
						settings.destructive_desiredLongestEdge,
						settings.destructive_enlarge_or_reduce,
						settings.allowLargerFiles
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


// We're working with the original blob at the beginning, but the crucial 
// part is HOW we're creating the new compressed version. The path we take
// to create the compressed version (toDataURL vs toBlob) can result in 
// different compression algorithms being used internally by the browser.
// THIS is IMPORTANT FOR MOBILE.
async function compressOriginalImage(
    file: Blob, 
    quality: number,
    destructive_resizeMode: string,
    destructive_desiredWidth: number,
    destructive_desiredHeight: number,
    destructive_desiredLongestEdge: number,
    destructive_enlarge_or_reduce: 'Always' | 'Reduce' | 'Enlarge'
): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const reader = new FileReader();

        reader.onload = (e) => {
            img.onload = () => {
                const { imageWidth, imageHeight, aspectRatio } = calculateDesiredDimensions(
                    img,
                    destructive_resizeMode,
                    destructive_desiredWidth,
                    destructive_desiredHeight,
                    destructive_desiredLongestEdge,
                    destructive_enlarge_or_reduce
                );

                const canvas = document.createElement('canvas');
                canvas.width = imageWidth;
                canvas.height = imageHeight;

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error('Failed to get canvas context'));
                    return;
                }

                ctx.save();
                ctx.translate(canvas.width / 2, canvas.height / 2);

                const drawWidth = destructive_resizeMode === 'Fill'
                    ? Math.min(img.naturalWidth, img.naturalHeight * aspectRatio)
                    : img.naturalWidth;
                const drawHeight = destructive_resizeMode === 'Fill'
                    ? Math.min(img.naturalHeight, img.naturalWidth / aspectRatio)
                    : img.naturalHeight;

                ctx.drawImage(
                    img,
                    0, 0,
                    drawWidth, drawHeight,
                    -imageWidth / 2, -imageHeight / 2,
                    imageWidth, imageHeight
                );
                ctx.restore();
				
				const blobType = file.type || 'image/jpeg';

                // Use original format instead of hardcoding JPEG
                canvas.toBlob(
                    (blob) => {
                        if (!blob) {
                            reject(new Error('Failed to create blob'));
                            return;
                        }
                        blob.arrayBuffer().then(resolve).catch(reject);
                    },
                    blobType,
                    quality
                );
            };

            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = e.target?.result as string;
        };

        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

async function convertToWebP(
    file: Blob,
    quality: number,
    destructive_resizeMode: string,
    destructive_desiredWidth: number,
    destructive_desiredHeight: number,
    destructive_desiredLongestEdge: number,
    destructive_enlarge_or_reduce: 'Always' | 'Reduce' | 'Enlarge',
    allowLargerFiles: boolean
): Promise<ArrayBuffer> {
    // Early return if no processing needed
    if (quality === 1 && destructive_resizeMode === 'None') {
        return file.arrayBuffer();
    }

    // Helper function to setup canvas with image
    const setupCanvas = async (imageData: string): Promise<{
        canvas: HTMLCanvasElement;
        context: CanvasRenderingContext2D;
    }> => {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
                const { imageWidth, imageHeight, aspectRatio } = calculateDesiredDimensions(
                    image,
                    destructive_resizeMode,
                    destructive_desiredWidth,
                    destructive_desiredHeight,
                    destructive_desiredLongestEdge,
                    destructive_enlarge_or_reduce
                );

                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d', {
                    willReadFrequently: false
                });

                if (!context) {
                    reject(new Error('Failed to get canvas context'));
                    return;
                }

                canvas.width = imageWidth;
                canvas.height = imageHeight;

                const drawWidth = destructive_resizeMode === 'Fill'
                    ? Math.min(image.naturalWidth, image.naturalHeight * aspectRatio)
                    : image.naturalWidth;
                const drawHeight = destructive_resizeMode === 'Fill'
                    ? Math.min(image.naturalHeight, image.naturalWidth / aspectRatio)
                    : image.naturalHeight;

                context.drawImage(
                    image,
                    0, 0,
                    drawWidth, drawHeight,
                    0, 0,
                    imageWidth, imageHeight
                );

                resolve({ canvas, context });
            };
            image.onerror = () => reject(new Error('Failed to load image'));
            image.src = imageData;
        });
    };

    try {
        // Read file as data URL once
        const imageData = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = (e) => resolve(e.target?.result as string);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
        });

        // Setup canvas
        const { canvas } = await setupCanvas(imageData);

        // Try both conversion methods in parallel
        const [blobResult, dataUrlResult] = await Promise.all([
            // Method 1: toBlob approach
            new Promise<ArrayBuffer>((resolve) => {
                canvas.toBlob(
                    async (blob) => {
                        if (!blob) {
                            resolve(new ArrayBuffer(0));
                            return;
                        }
                        resolve(await blob.arrayBuffer());
                    },
                    'image/webp',
                    quality
                );
            }),

            // Method 2: toDataURL approach
            new Promise<ArrayBuffer>((resolve) => {
                const webpData = canvas.toDataURL('image/webp', quality);
                resolve(base64ToArrayBuffer(webpData));
            })
        ]);

        // Get original format compression as well

		// We're working with the original blob at the beginning,but the crucial 
		// part is HOW we're creating the new compressed version. The path we take
		// to create the compressed version (toDataURL vs toBlob) can result in 
		// different compression algorithms being used internally by the browser.
        const originalCompressed = await compressOriginalImage(
            file,
            quality,
            destructive_resizeMode,
            destructive_desiredWidth,
            destructive_desiredHeight,
            destructive_desiredLongestEdge,
            destructive_enlarge_or_reduce
        );

        // Compare all results and choose the smallest one
        const results = [
            { type: 'blob', data: blobResult, size: blobResult.byteLength },
            { type: 'dataUrl', data: dataUrlResult, size: dataUrlResult.byteLength },
            { type: 'original', data: originalCompressed, size: originalCompressed.byteLength }
        ].filter(result => result.size > 0);

        // Sort by size
        results.sort((a, b) => a.size - b.size);

        // If we don't allow larger files, filter out results larger than original
        if (!allowLargerFiles) {
            const validResults = results.filter(result => result.size <= file.size);
            if (validResults.length > 0) {
                console.log(`Using ${validResults[0].type} method (smallest size)`);
                return validResults[0].data;
            }
            // If no valid results, return original file
            return file.arrayBuffer();
        }

        // Return the smallest result
        console.log(`Using ${results[0].type} method (smallest size)`);
        return results[0].data;

    } catch (error) {
        console.error('Conversion error:', error);
        // Fallback to original file
        return file.arrayBuffer();
    }
}

async function convertToJPG(
    file: Blob,
    quality: number,
    destructive_resizeMode: string,
    destructive_desiredWidth: number,
    destructive_desiredHeight: number,
    destructive_desiredLongestEdge: number,
    destructive_enlarge_or_reduce: 'Always' | 'Reduce' | 'Enlarge',
    allowLargerFiles: boolean
): Promise<ArrayBuffer> {
    // Early return if no processing needed
    if (quality === 1 && destructive_resizeMode === 'None') {
        return file.arrayBuffer();
    }

    // Helper function to setup canvas with image
    const setupCanvas = async (imageData: string): Promise<{
        canvas: HTMLCanvasElement;
        context: CanvasRenderingContext2D;
    }> => {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
                const { imageWidth, imageHeight, aspectRatio } = calculateDesiredDimensions(
                    image,
                    destructive_resizeMode,
                    destructive_desiredWidth,
                    destructive_desiredHeight,
                    destructive_desiredLongestEdge,
                    destructive_enlarge_or_reduce
                );

                const canvas = document.createElement('canvas');
                // For JPG, we definitely want to disable alpha
                const context = canvas.getContext('2d', {
                    willReadFrequently: false,
                    alpha: false // JPG doesn't support alpha, so we can disable it
                });

                if (!context) {
                    reject(new Error('Failed to get canvas context'));
                    return;
                }

                canvas.width = imageWidth;
                canvas.height = imageHeight;

                // Fill with white background (for transparent PNGs)
                // context.fillStyle = '#FFFFFF';
                // context.fillRect(0, 0, canvas.width, canvas.height);

                const drawWidth = destructive_resizeMode === 'Fill'
                    ? Math.min(image.naturalWidth, image.naturalHeight * aspectRatio)
                    : image.naturalWidth;
                const drawHeight = destructive_resizeMode === 'Fill'
                    ? Math.min(image.naturalHeight, image.naturalWidth / aspectRatio)
                    : image.naturalHeight;

                context.drawImage(
                    image,
                    0, 0,
                    drawWidth, drawHeight,
                    0, 0,
                    imageWidth, imageHeight
                );

                resolve({ canvas, context });
            };
            image.onerror = () => reject(new Error('Failed to load image'));
            image.src = imageData;
        });
    };

    try {
        // Read file as data URL once
        const imageData = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = (e) => resolve(e.target?.result as string);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
        });

        // Setup canvas
        const { canvas } = await setupCanvas(imageData);

        // Try both conversion methods in parallel
        const [blobResult, dataUrlResult] = await Promise.all([
            // Method 1: toBlob approach
            new Promise<ArrayBuffer>((resolve) => {
                canvas.toBlob(
                    async (blob) => {
                        if (!blob) {
                            resolve(new ArrayBuffer(0));
                            return;
                        }
                        resolve(await blob.arrayBuffer());
                    },
                    'image/jpeg',
                    quality
                );
            }),

            // Method 2: toDataURL approach
            new Promise<ArrayBuffer>((resolve) => {
                const jpegData = canvas.toDataURL('image/jpeg', quality);
                resolve(base64ToArrayBuffer(jpegData));
            })
        ]);

        // Get original format compression as well
        const originalCompressed = await compressOriginalImage(
            file,
            quality,
            destructive_resizeMode,
            destructive_desiredWidth,
            destructive_desiredHeight,
            destructive_desiredLongestEdge,
            destructive_enlarge_or_reduce
        );

        // Compare all results and choose the smallest one
        const results = [
            { type: 'blob', data: blobResult, size: blobResult.byteLength },
            { type: 'dataUrl', data: dataUrlResult, size: dataUrlResult.byteLength },
            // Only include original compression if the input wasn't already JPEG
            ...(file.type !== 'image/jpeg' ? [{ 
                type: 'original', 
                data: originalCompressed, 
                size: originalCompressed.byteLength 
            }] : [])
        ].filter(result => result.size > 0);

        // Sort by size
        results.sort((a, b) => a.size - b.size);

        // If we don't allow larger files, filter out results larger than original
        if (!allowLargerFiles) {
            const validResults = results.filter(result => result.size <= file.size);
            if (validResults.length > 0) {
                console.log(`Using ${validResults[0].type} method (smallest size)`);
                return validResults[0].data;
            }
            // If no valid results, return original file
            return file.arrayBuffer();
        }

        // Return the smallest result
        console.log(`Using ${results[0].type} method (smallest size)`);
        return results[0].data;

    } catch (error) {
        console.error('Conversion error:', error);
        // Fallback to original file
        return file.arrayBuffer();
    }
}

async function convertToPNG(
    file: Blob,
    colorDepth: number,
    destructive_resizeMode: string,
    destructive_desiredWidth: number,
    destructive_desiredHeight: number,
    destructive_desiredLongestEdge: number,
    destructive_enlarge_or_reduce: 'Always' | 'Reduce' | 'Enlarge',
    allowLargerFiles: boolean
): Promise<ArrayBuffer> {
    // Early return if no processing needed
    if (colorDepth === 1 && destructive_resizeMode === 'None') {
        return file.arrayBuffer();
    }

    // Helper function to setup canvas with image
    const setupCanvas = async (imageData: string): Promise<{
        canvas: HTMLCanvasElement;
        context: CanvasRenderingContext2D;
    }> => {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
                const { imageWidth, imageHeight, aspectRatio } = calculateDesiredDimensions(
                    image,
                    destructive_resizeMode,
                    destructive_desiredWidth,
                    destructive_desiredHeight,
                    destructive_desiredLongestEdge,
                    destructive_enlarge_or_reduce
                );

                const canvas = document.createElement('canvas');
                // For PNG, we want to keep alpha channel
                const context = canvas.getContext('2d', {
                    willReadFrequently: colorDepth < 1, // Only if we need color reduction
                    alpha: true
                });

                if (!context) {
                    reject(new Error('Failed to get canvas context'));
                    return;
                }

                canvas.width = imageWidth;
                canvas.height = imageHeight;

                const drawWidth = destructive_resizeMode === 'Fill'
                    ? Math.min(image.naturalWidth, image.naturalHeight * aspectRatio)
                    : image.naturalWidth;
                const drawHeight = destructive_resizeMode === 'Fill'
                    ? Math.min(image.naturalHeight, image.naturalWidth / aspectRatio)
                    : image.naturalHeight;

                context.drawImage(
                    image,
                    0, 0,
                    drawWidth, drawHeight,
                    0, 0,
                    imageWidth, imageHeight
                );

                // Apply color depth reduction if needed
                if (colorDepth < 1) {
                    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
                    const reducedImageData = reduceColorDepth(imageData, colorDepth);
                    context.putImageData(reducedImageData, 0, 0);
                }

                resolve({ canvas, context });
            };
            image.onerror = () => reject(new Error('Failed to load image'));
            image.src = imageData;
        });
    };

    try {
        // Read file as data URL once
        const imageData = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = (e) => resolve(e.target?.result as string);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
        });

        // Setup canvas
        const { canvas } = await setupCanvas(imageData);

        // Try both conversion methods in parallel
        const [blobResult, dataUrlResult] = await Promise.all([
            // Method 1: toBlob approach
            new Promise<ArrayBuffer>((resolve) => {
                canvas.toBlob(
                    async (blob) => {
                        if (!blob) {
                            resolve(new ArrayBuffer(0));
                            return;
                        }
                        resolve(await blob.arrayBuffer());
                    },
                    'image/png'
                );
            }),

            // Method 2: toDataURL approach
            new Promise<ArrayBuffer>((resolve) => {
                const pngData = canvas.toDataURL('image/png');
                resolve(base64ToArrayBuffer(pngData));
            })
        ]);

        // For PNG, we might want to try additional optimization methods
        const results = [
            { type: 'blob', data: blobResult, size: blobResult.byteLength },
            { type: 'dataUrl', data: dataUrlResult, size: dataUrlResult.byteLength }
        ];

        // If input wasn't PNG, add original format as comparison
        if (file.type !== 'image/png') {
            const originalCompressed = await compressOriginalImage(
                file,
                1, // PNG doesn't use quality parameter
                destructive_resizeMode,
                destructive_desiredWidth,
                destructive_desiredHeight,
                destructive_desiredLongestEdge,
                destructive_enlarge_or_reduce
            );
            results.push({
                type: 'original',
                data: originalCompressed,
                size: originalCompressed.byteLength
            });
        }

        // Filter out empty results and sort by size
        const validResults = results
            .filter(result => result.size > 0)
            .sort((a, b) => a.size - b.size);

        // If we don't allow larger files, filter out results larger than original
        if (!allowLargerFiles) {
            const smallerResults = validResults.filter(result => result.size <= file.size);
            if (smallerResults.length > 0) {
                console.log(`Using ${smallerResults[0].type} method (smallest size)`);
                return smallerResults[0].data;
            }
            // If no valid results, return original file
            return file.arrayBuffer();
        }

        // Return the smallest result
        console.log(`Using ${validResults[0].type} method (smallest size)`);
        return validResults[0].data;

    } catch (error) {
        console.error('PNG conversion error:', error);
        // Fallback to original file
        return file.arrayBuffer();
    }
}

function calculateDesiredDimensions(
	image: HTMLImageElement,
	destructive_resizeMode: string,
	destructive_desiredWidth: number,
	destructive_desiredHeight: number,
	destructive_desiredLongestEdge: number,
	destructive_enlarge_or_reduce: 'Always' | 'Reduce' | 'Enlarge'
): { imageWidth: number; imageHeight: number; aspectRatio: number } {
	const aspectRatio = image.naturalWidth / image.naturalHeight;

	let imageWidth = 0;
	let imageHeight = 0;

	switch (destructive_resizeMode) {
		case 'None':
			imageWidth = image.naturalWidth;
			imageHeight = image.naturalHeight;
			break;
		case 'Fit':
			if (aspectRatio > destructive_desiredWidth / destructive_desiredHeight) {
				imageWidth = destructive_desiredWidth;
				imageHeight = imageWidth / aspectRatio;
			} else {
				imageHeight = destructive_desiredHeight;
				imageWidth = imageHeight * aspectRatio;
			}
			break;
		case 'Fill':
			if (aspectRatio > destructive_desiredWidth / destructive_desiredHeight) {
				imageHeight = destructive_desiredHeight;
				imageWidth = imageHeight * aspectRatio;
			} else {
				imageWidth = destructive_desiredWidth;
				imageHeight = imageWidth / aspectRatio;
			}
			break;
		case 'LongestEdge':
			if (image.naturalWidth > image.naturalHeight) {
				imageWidth = destructive_desiredLongestEdge;
				imageHeight = imageWidth / aspectRatio;
			} else {
				imageHeight = destructive_desiredLongestEdge;
				imageWidth = imageHeight * aspectRatio;
			}
			break;
		case 'ShortestEdge':
			if (image.naturalWidth < image.naturalHeight) {
				imageWidth = destructive_desiredLongestEdge;
				imageHeight = imageWidth / aspectRatio;
			} else {
				imageHeight = destructive_desiredLongestEdge;
				imageWidth = imageHeight * aspectRatio;
			}
			break;
		case 'Width':
			imageWidth = destructive_desiredWidth;
			imageHeight = destructive_desiredWidth / aspectRatio;
			break;
		case 'Height':
			imageHeight = destructive_desiredHeight;
			imageWidth = destructive_desiredHeight * aspectRatio;
			break;
	}

	switch (destructive_enlarge_or_reduce) {
		case 'Always':
			// Always resize the image to the desired dimensions, regardless of its size
			break;
		case 'Reduce':
			// Only reduce size if larger
			if (image.naturalWidth > imageWidth || image.naturalHeight > imageHeight) {
				// Do nothing, the desired dimensions are already calculated
			} else {
				imageWidth = image.naturalWidth;
				imageHeight = image.naturalHeight;
			}
			break;
		case 'Enlarge':
			// Only enlarge size if smaller
			if (image.naturalWidth < imageWidth && image.naturalHeight < imageHeight) {
				// Do nothing, the desired dimensions are already calculated
			} else {
				imageWidth = image.naturalWidth;
				imageHeight = image.naturalHeight;
			}
			break;
	}

	return { imageWidth, imageHeight, aspectRatio };
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

// Helper function to convert base64 to ArrayBuffer
function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64.split(',')[1]);
    const length = binary.length;
    const buffer = new ArrayBuffer(length);
    const view = new Uint8Array(buffer);
    
    for (let i = 0; i < length; i++) {
        view[i] = binary.charCodeAt(i);
    }
    
    return buffer;
}
/* ------------------------------------------------------------- */
/* ------------------------------------------------------------- */


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


/* HELPER: for drag resize and scrollwheel */
/* ------------------------------------------------------------- */
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

	// Obsidian supports WIDTHxHEIGHT syntax. But for simplicity we can use only 1 whichever is longer.
	// This helps with setting appropriate initial |size depending on the image at hand
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
/* ------------------------------------------------------------- */
/* ------------------------------------------------------------- */



/* HELPER: delete image from vault */
/* ------------------------------------------------------------- */
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
/* ------------------------------------------------------------- */
/* ------------------------------------------------------------- */


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

		// Basic Settings Container
		const basicSettingsContainer = container.createDiv('basic-settings-container');

		// Format Setting
		new Setting(basicSettingsContainer)
			.setName('Convert to ⓘ ')
			.setDesc('Choose output format for your images')
			.setTooltip('Same as original: preserves current format while applying compression/resizing')
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
		new Setting(basicSettingsContainer)
			.setName('Quality ⓘ')
			.setDesc('Compression level (0-100)')
			.setTooltip('100: No compression (original quality)\n75: Recommended (good balance)\n0-50: High compression (lower quality)')
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

		// Create a separate container for resize-related settings
		const resizeSettingsContainer = container.createDiv('resize-settings-container');

		// Add a heading for resize settings
		resizeSettingsContainer.createEl('h3', { text: '', cls: 'setting-group-heading' });
		
		// Resize Mode Setting
		new Setting(resizeSettingsContainer)
			.setName('Resize Mode ⓘ')
			.setDesc('Choose how images should be resized. Note: Results are permanent.')
			.setTooltip('Fit: Maintains aspect ratio within dimensions\nFill: Exactly matches dimensions\nLongest Edge: Limits the longest side\nShortest Edge: Limits the shortest side\nWidth/Height: Constrains single dimension')
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
					.setValue(this.plugin.settings.destructive_resizeMode)
					.onChange(async value => {
						this.plugin.settings.destructive_resizeMode = value;
						await this.plugin.saveSettings();

						// Clear existing resize-related elements
						const resizeInputsContainer = resizeSettingsContainer.querySelector('.resize-inputs');
						if (resizeInputsContainer) resizeInputsContainer.remove();

						const enlargeReduceContainer = resizeSettingsContainer.querySelector('.enlarge-reduce-setting');
						if (enlargeReduceContainer) enlargeReduceContainer.remove();

						// Add new elements if needed
						if (value !== 'None') {
							this.updateResizeInputs(resizeSettingsContainer, value);
							this.addEnlargeReduceSetting(resizeSettingsContainer);
						}
					})
			);


		// Add initial resize inputs and enlarge/reduce setting if needed
		if (this.plugin.settings.destructive_resizeMode !== 'None') {
			this.updateResizeInputs(resizeSettingsContainer, this.plugin.settings.destructive_resizeMode);
			this.addEnlargeReduceSetting(resizeSettingsContainer);
		}
	}

	private addEnlargeReduceSetting(container: HTMLElement): void {
		const enlargeReduceDiv = container.createDiv('enlarge-reduce-setting');
		new Setting(enlargeReduceDiv)
			.setName('Enlarge or Reduce ⓘ')
			.setDesc('Controls how images are adjusted relative to target size:')
			.setTooltip('• Reduce and Enlarge: Adjusts image to fit specified dimensions\n• Reduce only: Only shrinks image which is larger than target\n• Enlarge only: Only enlarges image which is smaller than target')
			.addDropdown(dropdown =>
				dropdown
					.addOptions({
						Always: 'Reduce and Enlarge',
						Reduce: 'Reduce only',
						Enlarge: 'Enlarge only',
					})
					.setValue(this.plugin.settings.destructive_enlarge_or_reduce)
					.onChange(async (value: 'Always' | 'Reduce' | 'Enlarge') => {
						this.plugin.settings.destructive_enlarge_or_reduce = value;
						await this.plugin.saveSettings();
					})
			);
	}

	private updateResizeInputs(container: HTMLElement, resizeMode: string): void {
		// Remove existing resize inputs
		const existingInputs = container.querySelector('.resize-inputs');
		if (existingInputs) {
			existingInputs.remove();
		}
	
		if (resizeMode === 'None') return;
	
		const inputsContainer = container.createDiv('resize-inputs');
	
		if (['Fit', 'Fill'].includes(resizeMode)) {
			new Setting(inputsContainer)
				.setName('Resize dimensions')
				.addText(text => text
					.setPlaceholder('Width')
					.setValue(this.plugin.settings.destructive_desiredWidth.toString())
					.onChange(async value => {
						const width = parseInt(value);
						if (/^\d+$/.test(value) && width > 0) {
							this.plugin.settings.destructive_desiredWidth = width;
							await this.plugin.saveSettings();
						}
					}))
				.addText(text => text
					.setPlaceholder('Height')
					.setValue(this.plugin.settings.destructive_desiredHeight.toString())
					.onChange(async value => {
						const height = parseInt(value);
						if (/^\d+$/.test(value) && height > 0) {
							this.plugin.settings.destructive_desiredHeight = height;
							await this.plugin.saveSettings();
						}
					}));
		} else {
			new Setting(inputsContainer)
				.setName('Target size')
				.addText(text => text
					.setPlaceholder('Enter desired length in pixels')
					.setValue(this.getInitialValue(resizeMode))
					.onChange(async value => {
						const length = parseInt(value);
						if (/^\d+$/.test(value) && length > 0) {
							await this.updateResizeValue(resizeMode, length);
						}
					}));
		}
	}

	private getInitialValue(resizeMode: string): string {
		switch (resizeMode) {
			case 'LongestEdge':
			case 'ShortestEdge':
				return this.plugin.settings.destructive_desiredLongestEdge.toString();
			case 'Width':
				return this.plugin.settings.destructive_desiredWidth.toString();
			case 'Height':
				return this.plugin.settings.destructive_desiredHeight.toString();
			default:
				return '';
		}
	}

	private async updateResizeValue(resizeMode: string, length: number): Promise<void> {
		switch (resizeMode) {
			case 'LongestEdge':
			case 'ShortestEdge':
				this.plugin.settings.destructive_desiredLongestEdge = length;
				break;
			case 'Width':
				this.plugin.settings.destructive_desiredWidth = length;
				break;
			case 'Height':
				this.plugin.settings.destructive_desiredHeight = length;
				break;
		}
		await this.plugin.saveSettings();
	}

	// Output
	private displayOutputSettings(): void {
		// Clear the container to prevent duplication
		this.contentContainer.empty();
	
		const container = this.contentContainer.createDiv('settings-container');
	
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
							nondestructive_resizeMode_disabled: "None",
							nondestructive_resizeMode_fitImage: "Fit Image",
							nondestructive_resizeMode_customSize: "Custom"
						})
						.setValue(this.plugin.settings.nondestructive_resizeMode)
						.onChange(async (value) => {
							this.plugin.settings.nondestructive_resizeMode = value;
							await this.plugin.saveSettings();
							this.displayGeneralSettings();
						})
				);

			// Show custom size setting immediately after non-destructive resize if "Custom" is selected
			if (this.plugin.settings.nondestructive_resizeMode === "nondestructive_resizeMode_customSize") {
				new Setting(settingsContainer)
					.setName("Custom size")
					.setDesc("Specify the default size which should be applied on all dropped/pasted images. For example, if you specify \
							custom size as '250' then when you drop or paste an 'image.jpg' it would become ![[image.jpg | 250]] ")
					.setClass('settings-indent')
					.addText((text) => {
						text.setPlaceholder("800")
							.setValue(this.plugin.settings.nondestructive_resizeMode_customSize)
							.onChange(async (value) => {
								this.plugin.settings.nondestructive_resizeMode_customSize = value;
								await this.plugin.saveSettings();
							});
					});

				// Add the new resize behavior setting
				new Setting(settingsContainer)
					.setName("Enlarge or Reduce ⓘ")
					.setDesc("Controls how images are adjusted relative to target size:")
					.setTooltip('• Reduce and Enlarge: Adjusts image to fit specified dimensions e.g.: small images upsized, large images downsized. For instance, when you want to keep all your images in the note rendered at the same dimensions equally. Example: Setting width to 800px will make a 400px image expand to 800px and a 1200px image shrink to 800px.\n\n• Reduce only: Only shrinks images if width is larger than the target size. Similarly to "Reduce and Enlarge" option, this is especially useful if you do not want small images to be stretched and pixelated - in particular when dealing with extra small sizes 10px - 200px. Example: With width set to 800px, a 400px image stays 400px while a 1200px image shrinks to 800px.\n\n• Enlarge only: Only enlarges images which have smaller width than target size. This is helpful when you want to upscale small images while keeping larger ones at their original dimensions. Example: With width set to 800px, a 400px image expands to 800px while a 1200px image stays 1200px.')
					.setClass('settings-indent')
					.addDropdown((dropdown) =>
						dropdown
							.addOptions({
								'Always': 'Reduce and Enlarge',
								'Reduce': 'Reduce Only',
								'Enlarge': 'Enlarge Only'
							})
							.setValue(this.plugin.settings.nondestructive_enlarge_or_reduce)
							.onChange(async (value: 'Always' | 'Reduce' | 'Enlarge') => {
								this.plugin.settings.nondestructive_enlarge_or_reduce = value;
								await this.plugin.saveSettings();
							})
					);
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

		new Setting(container)
			.setName('Allow larger file sizes after conversion ⓘ')
            .setTooltip('• When enabled, processed images will be saved even if they are larger than the original.\n• When disabled, it might produce smaller file sizes, but it might also disable any resizing, conversion or compression.\n• Thus, if you really need that file to be at 1000px width, then keep this setting turned ON. Otherwise, if you never use destructive resizing, never use any of the commands to "Process all vault" or "Process all images in current note" and simply want smallest file possible then you can KEEP this OFF.')			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.allowLargerFiles)
				.onChange(async (value) => {
					this.plugin.settings.allowLargerFiles = value;
					await this.plugin.saveSettings();
				}));
		
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


// class ProcessCurrentImage extends Modal {
//     plugin: ImageConvertPlugin;
//     private enlargeReduceSettings: Setting | null = null;
//     private resizeInputSettings: Setting | null = null;
//     private submitButton: ButtonComponent | null = null;
// 	private resizeInputsDiv: HTMLDivElement | null = null;  // Add this
//     private enlargeReduceDiv: HTMLDivElement | null = null; // Add this

//     constructor(plugin: ImageConvertPlugin) {
//         super(plugin.app);
//         this.plugin = plugin;
//     }

// 	private updateResizeInputVisibility(resizeMode: string): void {
// 		if (resizeMode === 'None') {
// 			this.resizeInputSettings?.settingEl.hide();
// 			this.enlargeReduceSettings?.settingEl.hide();
// 		} else {
// 			if (!this.resizeInputSettings) {
// 				this.createResizeInputSettings(resizeMode);
// 			} else {
// 				this.updateResizeInputSettings(resizeMode);
// 			}
// 			if (!this.enlargeReduceSettings) {
// 				this.createEnlargeReduceSettings();
// 			}
// 			this.resizeInputSettings?.settingEl.show();
// 			this.enlargeReduceSettings?.settingEl.show();
// 		}
// 	}

//     private createEnlargeReduceSettings(): void {
//         if (!this.enlargeReduceDiv) return;
//         this.enlargeReduceDiv.empty();
        
//         this.enlargeReduceSettings = new Setting(this.enlargeReduceDiv)
//             .setName('Enlarge or Reduce')
//             .setDesc(
//                 'Reduce and Enlarge - would make sure that image set to specified dimensions are always fit\
//                 inside these dimensions so both actions would be performed: small images would be enlarged\
//                 to fit the dimensions and large images would be reduced;\
//                 Reduce only - only large images will be reduced;\
//                 Enlarge only - only small images will be increased')
//             .addDropdown((dropdown) => 
//                 dropdown
//                     .addOptions({
//                         Always: 'Reduce and Enlarge',
//                         Reduce: 'Reduce only',
//                         Enlarge: 'Enlarge only',
//                     })
//                     .setValue(this.plugin.settings.ProcessCurrentImage_EnlargeOrReduce)
//                     .onChange(async (value: 'Always' | 'Reduce' | 'Enlarge') => {
//                         this.plugin.settings.ProcessCurrentImage_EnlargeOrReduce = value;
//                         await this.plugin.saveSettings();
//                     })
//             );
//     }

//     private createResizeInputSettings(resizeMode: string): void {
//         if (!this.resizeInputsDiv) return;
//         this.resizeInputsDiv.empty();
//         this.resizeInputSettings = new Setting(this.resizeInputsDiv);
//         this.updateResizeInputSettings(resizeMode);
//     }

// 	private updateResizeInputSettings(resizeMode: string): void {
// 		if (!this.resizeInputSettings) return;
	
// 		this.resizeInputSettings.clear();
	
// 		let name = '';
// 		let desc = '';
	
// 		if (['Fit', 'Fill'].includes(resizeMode)) {
// 			name = 'Resize Dimensions';
// 			desc = 'Enter the desired width and height in pixels';
// 			this.resizeInputSettings
// 				.setName(name)
// 				.setDesc(desc)
// 				.addText((text: TextComponent) => text
// 					.setPlaceholder('Width')
// 					.setValue(this.plugin.settings.ProcessCurrentImage_resizeModaldesiredWidth.toString())
// 					.onChange(async (value: string) => {
// 						const width = parseInt(value);
// 						if (/^\d+$/.test(value) && width > 0) {
// 							this.plugin.settings.ProcessCurrentImage_resizeModaldesiredWidth = width;
// 							await this.plugin.saveSettings();
// 						}
// 					}))
// 				.addText((text: TextComponent) => text
// 					.setPlaceholder('Height')
// 					.setValue(this.plugin.settings.ProcessCurrentImage_resizeModaldesiredHeight.toString())
// 					.onChange(async (value: string) => {
// 						const height = parseInt(value);
// 						if (/^\d+$/.test(value) && height > 0) {
// 							this.plugin.settings.ProcessCurrentImage_resizeModaldesiredHeight = height;
// 							await this.plugin.saveSettings();
// 						}
// 					}));
// 		} else {
// 			switch (resizeMode) {
// 				case 'LongestEdge':
// 				case 'ShortestEdge':
// 					name = `${resizeMode} Length`;
// 					desc = 'Enter the desired length in pixels';
// 					break;
// 				case 'Width':
// 					name = 'Width';
// 					desc = 'Enter the desired width in pixels';
// 					break;
// 				case 'Height':
// 					name = 'Height';
// 					desc = 'Enter the desired height in pixels';
// 					break;
// 			}
	
// 			this.resizeInputSettings
// 				.setName(name)
// 				.setDesc(desc)
// 				.addText((text: TextComponent) => text
// 					.setPlaceholder('Length')
// 					.setValue(this.getInitialValue(resizeMode).toString())
// 					.onChange(async (value: string) => {
// 						const length = parseInt(value);
// 						if (/^\d+$/.test(value) && length > 0) {
// 							await this.updateSettingValue(resizeMode, length);
// 						}
// 					}));
// 		}
	
// 		// Update the enlarge/reduce settings in place instead of recreating
// 		if (!this.enlargeReduceSettings) {
// 			this.createEnlargeReduceSettings();
// 		}
// 	}

//     private getInitialValue(resizeMode: string): number {
//         switch (resizeMode) {
//             case 'LongestEdge':
//             case 'ShortestEdge':
//                 return this.plugin.settings.ProcessCurrentImage_resizeModaldesiredLength;
//             case 'Width':
//                 return this.plugin.settings.ProcessCurrentImage_resizeModaldesiredWidth;
//             case 'Height':
//                 return this.plugin.settings.ProcessCurrentImage_resizeModaldesiredHeight;
//             default:
//                 return 0;
//         }
//     }

//     private async updateSettingValue(resizeMode: string, value: number): Promise<void> {
//         switch (resizeMode) {
//             case 'LongestEdge':
//             case 'ShortestEdge':
//                 this.plugin.settings.ProcessCurrentImage_resizeModaldesiredLength = value;
//                 break;
//             case 'Width':
//                 this.plugin.settings.ProcessCurrentImage_resizeModaldesiredWidth = value;
//                 break;
//             case 'Height':
//                 this.plugin.settings.ProcessCurrentImage_resizeModaldesiredHeight = value;
//                 break;
//         }
//         await this.plugin.saveSettings();
//     }

//     onOpen() {
//         const { contentEl } = this;

// 		const div1 = contentEl.createEl('div');
// 		div1.style.display = 'flex';
// 		div1.style.flexDirection = 'column';
// 		div1.style.alignItems = 'center';
// 		div1.style.justifyContent = 'center';

// 		const heading1 = div1.createEl('h2')
// 		heading1.textContent = 'Convert, compress and resize';
	
// 		let imageName = 'current image';
// 		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

// 		if (activeView && activeView.file) {
// 			const element = this.app.workspace.getActiveFile();
// 			if (element instanceof HTMLImageElement) {
// 				imageName = element.getAttribute('src') || 'current image';
// 			} else {
// 				// Retrieve the image name from the context menu event
// 				const contextMenuEvent = this.plugin.contextMenuEvent;
// 				if (contextMenuEvent && contextMenuEvent.target instanceof HTMLImageElement) {
// 					imageName = contextMenuEvent.target.getAttribute('src') || 'current image';
// 				}
// 			}
// 		}
	
// 		const heading2 = div1.createEl('h6');
// 		heading2.textContent = `${imageName}`;
// 		heading2.style.marginTop = '-18px';
	
// 		const desc = div1.createEl('p');
// 		desc.textContent = 'Running this will modify the selected image. Please create backups. The image link will be automatically updated.';
// 		desc.style.marginTop = '-10px';
// 		desc.style.padding = '20px';
// 		desc.style.borderRadius = '10px';
	
// 		const settingsContainer = contentEl.createDiv('settings-container');

//         new Setting(settingsContainer)
//             .setName('Select format to convert images to')
//             .setDesc(`"Same as original" - will keep original file format.`)
//             .addDropdown(dropdown =>
//                 dropdown
//                     .addOptions({ disabled: 'Same as original', webp: 'WebP', jpg: 'JPG', png: 'PNG' })
//                     .setValue(this.plugin.settings.ProcessCurrentImage_convertTo)
//                     .onChange(async value => {
//                         this.plugin.settings.ProcessCurrentImage_convertTo = value;
//                         await this.plugin.saveSettings();
//                     })
//             );

//         new Setting(settingsContainer)
//             .setName('Quality')
//             .setDesc('0 - low quality, 99 - high quality, 100 - no compression; 75 - recommended')
//             .addText(text =>
//                 text
//                     .setPlaceholder('Enter quality (0-100)')
//                     .setValue((this.plugin.settings.ProcessCurrentImage_quality * 100).toString())
//                     .onChange(async value => {
//                         const quality = parseInt(value);
//                         if (/^\d+$/.test(value) && quality >= 0 && quality <= 100) {
//                             this.plugin.settings.ProcessCurrentImage_quality = quality / 100;
//                             await this.plugin.saveSettings();
//                         }
//                     })
//             );

// 		// Create a dedicated container for resize-related settings
// 		const resizeContainer = settingsContainer.createDiv('resize-settings-container');


// 		new Setting(resizeContainer)
// 			.setName('Image resize mode')
// 			.setDesc('Select the mode to use when resizing the image. Resizing an image will further reduce file-size, but it will resize your actual file, which means that the original file will be modified, and the changes will be permanent.')
// 			.addDropdown(dropdown =>
// 				dropdown
// 					.addOptions({
// 						None: 'None',
// 						Fit: 'Fit',
// 						Fill: 'Fill',
// 						LongestEdge: 'Longest Edge',
// 						ShortestEdge: 'Shortest Edge',
// 						Width: 'Width',
// 						Height: 'Height'
// 					})
// 					.setValue(this.plugin.settings.ProcessCurrentImage_ResizeModalresizeMode)
// 					.onChange(async value => {
// 						this.plugin.settings.ProcessCurrentImage_ResizeModalresizeMode = value;
// 						await this.plugin.saveSettings();
// 						this.updateResizeInputVisibility(value);
// 					})
// 			);
// 		// Create placeholder divs for resize inputs and enlarge/reduce settings
// 		this.resizeInputsDiv = resizeContainer.createDiv('resize-inputs');
// 		this.enlargeReduceDiv = resizeContainer.createDiv('enlarge-reduce-settings');

//         // Initially create and show/hide resize inputs based on current mode
//         this.updateResizeInputVisibility(this.plugin.settings.ProcessCurrentImage_ResizeModalresizeMode);

// 		// Add the missing settings
// 		new Setting(settingsContainer)
// 			.setName('Skip File Formats')
// 			.setDesc('Comma-separated list of file formats to skip (e.g., tif,tiff,heic). Leave empty to process all formats.')
// 			.addText(text =>
// 				text
// 					.setPlaceholder('tif,tiff,heic')
// 					.setValue(this.plugin.settings.ProcessCurrentImage_SkipFormats)
// 					.onChange(async (value) => {
// 						this.plugin.settings.ProcessCurrentImage_SkipFormats = value;
// 						await this.plugin.saveSettings();
// 					})
// 			);

// 		new Setting(settingsContainer)
// 			.setName('Skip images in target format')
// 			.setDesc('Selecting this will skip images that already are in the target format. This is useful if you have a very large library, and want to process images in batches.')
// 			.addToggle(toggle =>
// 				toggle
// 					.setValue(this.plugin.settings.ProcessCurrentImage_SkipImagesInTargetFormat)
// 					.onChange(async value => {
// 						this.plugin.settings.ProcessCurrentImage_SkipImagesInTargetFormat = value;
// 						await this.plugin.saveSettings();
// 					})
// 			);

// 		// Initially create and show/hide resize inputs based on current mode
// 		this.updateResizeInputVisibility(this.plugin.settings.ProcessCurrentImage_ResizeModalresizeMode);

// 		// Add submit button in a container at the bottom
// 		const buttonContainer = settingsContainer.createDiv('button-container');

// 		this.submitButton = new ButtonComponent(buttonContainer)
// 			.setButtonText('Submit')
// 			.onClick(() => {
// 				this.close();
// 				const currentNote = this.app.workspace.getActiveFile();
// 				if (currentNote) {
// 					this.plugin.processCurrentNoteImages(currentNote);
// 				} else {
// 					new Notice('Error: No active note found.');
// 				}
// 			});
// 	}
// }

class ProcessAllVault extends Modal {
    plugin: ImageConvertPlugin;
    private enlargeReduceSettings: Setting | null = null;
    private resizeInputSettings: Setting | null = null;
    private submitButton: ButtonComponent | null = null;
    private resizeInputsDiv: HTMLDivElement | null = null;
    private enlargeReduceDiv: HTMLDivElement | null = null;

    constructor(plugin: ImageConvertPlugin) {
        super(plugin.app);
        this.plugin = plugin;
    }

    private updateResizeInputVisibility(resizeMode: string): void {
        if (resizeMode === 'None') {
            if (this.resizeInputSettings) {
                this.resizeInputSettings.settingEl.hide();
            }
            if (this.enlargeReduceSettings) {
                this.enlargeReduceSettings.settingEl.hide();
            }
        } else {
            if (!this.resizeInputSettings) {
                this.createResizeInputSettings(resizeMode);
            } else {
                this.updateResizeInputSettings(resizeMode);
            }
            
            if (!this.enlargeReduceSettings) {
                this.createEnlargeReduceSettings();
            }
            
            this.resizeInputSettings?.settingEl.show();
            this.enlargeReduceSettings?.settingEl.show();
        }
    }

    private createEnlargeReduceSettings(): void {
        if (!this.enlargeReduceDiv) return;
        
        this.enlargeReduceDiv.empty();
        
        this.enlargeReduceSettings = new Setting(this.enlargeReduceDiv)
            .setClass('enlarge-reduce-setting')
            .setName('Enlarge or Reduce ⓘ')
            .setDesc('Controls how images are adjusted relative to target size:')
            .setTooltip('• Reduce and Enlarge: Adjusts all images to fit specified dimensions\n• Reduce only: Only shrinks images larger than target\n• Enlarge only: Only enlarges images smaller than target')
            .addDropdown((dropdown) => {
                dropdown
                    .addOptions({
                        Always: 'Reduce and Enlarge',
                        Reduce: 'Reduce only',
                        Enlarge: 'Enlarge only',
                    })
                    .setValue(this.plugin.settings.ProcessAllVaultEnlargeOrReduce)
                    .onChange(async (value: 'Always' | 'Reduce' | 'Enlarge') => {
                        this.plugin.settings.ProcessAllVaultEnlargeOrReduce = value;
                        await this.plugin.saveSettings();
                    });
            });
    }

    private createResizeInputSettings(resizeMode: string): void {
        if (!this.resizeInputsDiv) return;
        
        this.resizeInputsDiv.empty();
        
        this.resizeInputSettings = new Setting(this.resizeInputsDiv)
            .setClass('resize-input-setting');
        
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
                    .setValue(this.plugin.settings.ProcessAllVaultResizeModaldesiredWidth.toString())
                    .onChange(async (value: string) => {
                        const width = parseInt(value);
                        if (/^\d+$/.test(value) && width > 0) {
                            this.plugin.settings.ProcessAllVaultResizeModaldesiredWidth = width;
                            await this.plugin.saveSettings();
                        }
                    }))
                .addText((text: TextComponent) => text
                    .setPlaceholder('Height')
                    .setValue(this.plugin.settings.ProcessAllVaultResizeModaldesiredHeight.toString())
                    .onChange(async (value: string) => {
                        const height = parseInt(value);
                        if (/^\d+$/.test(value) && height > 0) {
                            this.plugin.settings.ProcessAllVaultResizeModaldesiredHeight = height;
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
    }

    private getInitialValue(resizeMode: string): number {
        switch (resizeMode) {
            case 'LongestEdge':
            case 'ShortestEdge':
                return this.plugin.settings.ProcessAllVaultResizeModaldesiredLength;
            case 'Width':
                return this.plugin.settings.ProcessAllVaultResizeModaldesiredWidth;
            case 'Height':
                return this.plugin.settings.ProcessAllVaultResizeModaldesiredHeight;
            default:
                return 0;
        }
    }

    private async updateSettingValue(resizeMode: string, value: number): Promise<void> {
        switch (resizeMode) {
            case 'LongestEdge':
            case 'ShortestEdge':
                this.plugin.settings.ProcessAllVaultResizeModaldesiredLength = value;
                break;
            case 'Width':
                this.plugin.settings.ProcessAllVaultResizeModaldesiredWidth = value;
                break;
            case 'Height':
                this.plugin.settings.ProcessAllVaultResizeModaldesiredHeight = value;
                break;
        }
        await this.plugin.saveSettings();
    }

    onOpen() {
        const { contentEl } = this;

        // Create main container
        const mainContainer = contentEl.createDiv({ cls: 'image-convert-modal' });

        // Header section
        const headerContainer = mainContainer.createDiv({ cls: 'modal-header' });
        headerContainer.createEl('h2', { text: 'Convert, compress and resize' });
        headerContainer.createEl('p', {
            cls: 'modal-warning',
            text: 'Running this will modify all your internal images in the Vault. Please create backups. All internal image links will be automatically updated.'
        });

        // Settings container
        const settingsContainer = mainContainer.createDiv({ cls: 'settings-container' });

        // Format and Quality Container
        const formatQualityContainer = settingsContainer.createDiv({ cls: 'format-quality-container' });

        // Convert To setting
        new Setting(formatQualityContainer)
            .setName('Convert to ⓘ ')
            .setDesc('Choose output format for your images')
            .setTooltip('Same as original: preserves current format while applying compression/resizing')
            .addDropdown(dropdown =>
                dropdown
                    .addOptions({
                        disabled: 'Same as original',
                        webp: 'WebP',
                        jpg: 'JPG',
                        png: 'PNG'
                    })
                    .setValue(this.plugin.settings.ProcessAllVaultconvertTo)
                    .onChange(async value => {
                        this.plugin.settings.ProcessAllVaultconvertTo = value;
                        await this.plugin.saveSettings();
                    })
            );

        // Quality setting
        new Setting(formatQualityContainer)
            .setName('Quality ⓘ')
            .setDesc('Compression level (0-100)')
            .setTooltip('100: No compression (original quality)\n75: Recommended (good balance)\n0-50: High compression (lower quality)')
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

        // Resize Container
        const resizeContainer = settingsContainer.createDiv({ cls: 'resize-container' });

        // Resize Mode setting
        new Setting(resizeContainer)
            .setName('Resize Mode ⓘ')
            .setDesc('Choose how images should be resized. Note: Results are permanent.')
            .setTooltip('Fit: Maintains aspect ratio within dimensions\nFill: Exactly matches dimensions\nLongest Edge: Limits the longest side\nShortest Edge: Limits the shortest side\nWidth/Height: Constrains single dimension')
            .addDropdown(dropdown =>
                dropdown
                    .addOptions({
                        None: 'None',
                        LongestEdge: 'Longest Edge',
                        ShortestEdge: 'Shortest Edge',
                        Width: 'Width',
                        Height: 'Height',
                        Fit: 'Fit',
                        Fill: 'Fill',
                    })
                    .setValue(this.plugin.settings.ProcessAllVaultResizeModalresizeMode)
                    .onChange(async value => {
                        this.plugin.settings.ProcessAllVaultResizeModalresizeMode = value;
                        await this.plugin.saveSettings();
                        this.updateResizeInputVisibility(value);
                    })
            );

        // Create resize inputs and enlarge/reduce containers
        this.resizeInputsDiv = resizeContainer.createDiv({ cls: 'resize-inputs' });
        this.enlargeReduceDiv = resizeContainer.createDiv({ cls: 'enlarge-reduce-settings' });

        // Skip Container
        const skipContainer = settingsContainer.createDiv({ cls: 'skip-container' });

        // Skip formats setting
        new Setting(skipContainer)
            .setName('Skip File Formats ⓘ')
            .setTooltip('Comma-separated list of file formats to skip (e.g., tif,tiff,heic). Leave empty to process all formats.')
            .addText(text =>
                text
                    .setPlaceholder('tif,tiff,heic')
                    .setValue(this.plugin.settings.ProcessAllVaultSkipFormats)
                    .onChange(async value => {
                        this.plugin.settings.ProcessAllVaultSkipFormats = value;
                        await this.plugin.saveSettings();
                    })
            );

        // Skip target format setting
        new Setting(skipContainer)
            .setName('Skip images in target format ⓘ')
			.setTooltip('If image is already in target format, this allows you to skip its compression, conversion and resizing. Processing of all other formats will be still performed.')
            .addToggle(toggle =>
                toggle
                    .setValue(this.plugin.settings.ProcessAllVaultskipImagesInTargetFormat)
                    .onChange(async value => {
                        this.plugin.settings.ProcessAllVaultskipImagesInTargetFormat = value;
                        await this.plugin.saveSettings();
                    })
            );

        // Initialize resize inputs
        this.updateResizeInputVisibility(this.plugin.settings.ProcessAllVaultResizeModalresizeMode);

        // Submit button
        const buttonContainer = settingsContainer.createDiv({ cls: 'button-container' });
        this.submitButton = new ButtonComponent(buttonContainer)
            .setButtonText('Submit')
            .onClick(() => {
                this.close();
                this.plugin.processAllVaultImages();
            });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class ProcessCurrentNote extends Modal {
    plugin: ImageConvertPlugin;
    private enlargeReduceSettings: Setting | null = null;
    private resizeInputSettings: Setting | null = null;
    private submitButton: ButtonComponent | null = null;
	private resizeInputsDiv: HTMLDivElement | null = null;
    private enlargeReduceDiv: HTMLDivElement | null = null;

    constructor(plugin: ImageConvertPlugin) {
        super(plugin.app);
        this.plugin = plugin;
    }

    private updateResizeInputVisibility(resizeMode: string): void {
        // Use Obsidian's methods for showing/hiding
        if (resizeMode === 'None') {
            if (this.resizeInputSettings) {
                this.resizeInputSettings.settingEl.hide();
            }
            if (this.enlargeReduceSettings) {
                this.enlargeReduceSettings.settingEl.hide();
            }
        } else {
            if (!this.resizeInputSettings) {
                this.createResizeInputSettings(resizeMode);
            } else {
                this.updateResizeInputSettings(resizeMode);
            }
            
            if (!this.enlargeReduceSettings) {
                this.createEnlargeReduceSettings();
            }
            
            this.resizeInputSettings?.settingEl.show();
            this.enlargeReduceSettings?.settingEl.show();
        }
    }

    private createEnlargeReduceSettings(): void {
        if (!this.enlargeReduceDiv) return;
        
        // Clear existing content using Obsidian's method
        this.enlargeReduceDiv.empty();
        
        this.enlargeReduceSettings = new Setting(this.enlargeReduceDiv)
            .setClass('enlarge-reduce-setting')
            .setName('Enlarge or Reduce ⓘ')
            .setDesc('Controls how images are adjusted relative to target size:')
            .setTooltip('• Reduce and Enlarge: Adjusts all images to fit specified dimensions\n• Reduce only: Only shrinks images larger than target\n• Enlarge only: Only enlarges images smaller than target')
            .addDropdown((dropdown) => {
                dropdown
                    .addOptions({
                        Always: 'Reduce and Enlarge',
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

	onOpen() {
		const { contentEl } = this;
	
		// Create main container
		const mainContainer = contentEl.createDiv({ cls: 'image-convert-modal' });
	
		// Header section
		const headerContainer = mainContainer.createDiv({ cls: 'modal-header' });
		headerContainer.createEl('h2', { text: 'Convert, compress and resize' });
	
		// Get current note info
		let noteName = 'current note';
		let noteExtension = '';
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView?.file) {
			noteName = activeView.file.basename;
			noteExtension = activeView.file.extension;
		}
	
		headerContainer.createEl('h6', {
			text: `all images in: ${noteName}.${noteExtension}`,
			cls: 'modal-subtitle'
		});
	
		// Warning message
		headerContainer.createEl('p', {
			cls: 'modal-warning',
			text: '⚠️ This will modify all images in the current note. Please ensure you have backups.'
		});
	
		// Settings container
		const settingsContainer = mainContainer.createDiv({ cls: 'settings-container' });
	
		// Format and Quality Container
		const formatQualityContainer = settingsContainer.createDiv({ cls: 'format-quality-container' });
	
		// Convert To setting
		new Setting(formatQualityContainer)
			.setName('Convert to ⓘ ')
			.setDesc('Choose output format for your images')
			.setTooltip('Same as original: preserves current format while applying compression/resizing')
			.addDropdown(dropdown =>
				dropdown
					.addOptions({
						disabled: 'Same as original',
						webp: 'WebP',
						jpg: 'JPG',
						png: 'PNG'
					})
					.setValue(this.plugin.settings.ProcessCurrentNoteconvertTo)
					.onChange(async value => {
						this.plugin.settings.ProcessCurrentNoteconvertTo = value;
						await this.plugin.saveSettings();
					})
			);
	
		// Quality setting
		new Setting(formatQualityContainer)
			.setName('Quality ⓘ')
			.setDesc('Compression level (0-100)')
			.setTooltip('100: No compression (original quality)\n75: Recommended (good balance)\n0-50: High compression (lower quality)')
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
	
		// Resize Container (separate from format/quality)
		const resizeContainer = settingsContainer.createDiv({ cls: 'resize-container' });
	
		// Resize Mode setting
		new Setting(resizeContainer)
			.setName('Resize Mode ⓘ')
			.setDesc('Choose how images should be resized. Note: Results are permanent.')
			.setTooltip('Fit: Maintains aspect ratio within dimensions\nFill: Exactly matches dimensions\nLongest Edge: Limits the longest side\nShortest Edge: Limits the shortest side\nWidth/Height: Constrains single dimension')
			.addDropdown(dropdown =>
				dropdown
					.addOptions({
						None: 'None',
						LongestEdge: 'Longest Edge',
						ShortestEdge: 'Shortest Edge',
						Width: 'Width',
						Height: 'Height',
						Fit: 'Fit',
						Fill: 'Fill',
					})
					.setValue(this.plugin.settings.ProcessCurrentNoteResizeModalresizeMode)
					.onChange(async value => {
						this.plugin.settings.ProcessCurrentNoteResizeModalresizeMode = value;
						await this.plugin.saveSettings();
						this.updateResizeInputVisibility(value);
					})
			);
	
		// Create resize inputs and enlarge/reduce containers
		this.resizeInputsDiv = resizeContainer.createDiv({ cls: 'resize-inputs' });
		this.enlargeReduceDiv = resizeContainer.createDiv({ cls: 'enlarge-reduce-settings' });
	
		// Skip formats Container
		const skipContainer = settingsContainer.createDiv({ cls: 'skip-container' });
	
		// Skip formats setting
		new Setting(skipContainer)
			.setName('Skip File Formats ⓘ')
			.setTooltip('Comma-separated list of file formats to skip (e.g., tif,tiff,heic). Leave empty to process all formats.')
			.addText(text =>
				text
					.setPlaceholder('tif,tiff,heic')
					.setValue(this.plugin.settings.ProcessCurrentNoteSkipFormats)
					.onChange(async value => {
						this.plugin.settings.ProcessCurrentNoteSkipFormats = value;
						await this.plugin.saveSettings();
					})
			);
	
		// Skip target format setting
		new Setting(skipContainer)
			.setName('Skip images in target format ⓘ')
			.setTooltip('If image is already in target format, this allows you to skip its compression, conversion and resizing. Processing of all other formats will be still performed.')
			.addToggle(toggle =>
				toggle
					.setValue(this.plugin.settings.ProcessCurrentNoteskipImagesInTargetFormat)
					.onChange(async value => {
						this.plugin.settings.ProcessCurrentNoteskipImagesInTargetFormat = value;
						await this.plugin.saveSettings();
					})
			);
	
		// Initialize resize inputs
		this.updateResizeInputVisibility(this.plugin.settings.ProcessCurrentNoteResizeModalresizeMode);
	
		// Submit button
		const buttonContainer = settingsContainer.createDiv({ cls: 'button-container' });
		this.submitButton = new ButtonComponent(buttonContainer)
			.setButtonText('Submit')
			.onClick(() => {
				this.close();
				const currentNote = this.app.workspace.getActiveFile();
				if (currentNote) {
					this.plugin.processCurrentNoteImages(currentNote);
				} else {
					new Notice('Error: No active note found.');
				}
			});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}


enum ToolMode {
    None,
    Draw,
    Text,
    Arrow
}

class ImageAnnotationModal extends Modal {
    private canvas: Canvas;
    private file: TFile;
    private plugin: ImageConvertPlugin;


	private currentTool: ToolMode = ToolMode.None;
	private drawButton: ButtonComponent | undefined = undefined;
	private textButton: ButtonComponent | undefined;
	private arrowButton: ButtonComponent | undefined;
    private isDrawingMode = false;
	private isTextMode = false;
	private isArrowMode = false;
	private isTextEditingBlocked = false;
	private _previousStates: { drawingMode: boolean; } | null = null;
	private boundKeyDownHandler: (e: KeyboardEvent) => void;
	private boundKeyUpHandler: (e: KeyboardEvent) => void;
	private preserveObjectStacking = true;

	private readonly brushSizes = [2, 4, 8, 12, 16, 24]; // 6 preset sizes
	private readonly brushOpacities = [0.2, 0.4, 0.6, 0.8, 0.9, 1.0]; // 6 preset opacities
	private currentBrushSizeIndex = 2; // Default to middle size
    private currentOpacityIndex = 5; // Default to full opacity

	private readonly blendModes: BlendMode[] = [
		'source-over',    // Normal
		'multiply',
		'screen',
		'overlay',
		'darken',
		'lighten',
		'color-dodge',
		'color-burn',
		'hard-light',
		'soft-light',
		'difference',
		'exclusion'
	];
	private currentBlendMode: BlendMode = 'source-over';

	private dominantColors: string[] = [];
    private complementaryColors: string[][] = [];

    private isResizing = false;
    private minWidth = 400;
    private minHeight = 300;
    private resizeHandle: HTMLDivElement | null = null;
	
    private isPanning = false;
	private isSpacebarDown = false; // Add this new property
    private lastPanPoint: { x: number; y: number } | null = null;
    private currentZoom = 1;
    private readonly minZoom = 0.1;
    private readonly maxZoom = 10;
	
	private undoStack: string[] = [];
    private redoStack: string[] = [];
    private isUndoRedoAction = false;
    private maxStackSize = 50; // Limit stack size to prevent memory issues


	private currentBackground: BackgroundType = 'transparent';
	private readonly backgroundOptions: BackgroundOptions = ['transparent', '#ffffff', '#000000', 'grid', 'dots'] as const;
	private backgroundDropdown: HTMLElement | null = null;

	constructor(app: App, plugin: ImageConvertPlugin, imageFile: TFile) {
		super(app);
		this.plugin = plugin;
		this.file = imageFile;
		this.modalEl.addClass('image-annotation-modal');
	
		// Ensure close button works
		const closeButton = this.modalEl.querySelector('.modal-close-button');
		if (closeButton) {
			closeButton.addEventListener('click', (e) => {
				e.stopPropagation();
				this.close();
			});
		}

		// Bind the event handlers in the constructor
		this.boundKeyDownHandler = this.handleKeyDown.bind(this);
		this.boundKeyUpHandler = this.handleKeyUp.bind(this);

		// Create a new scope for handling shortcuts
		this.scope = new Scope();
		
		// Register our custom scope
		this.scope.register([], 'Escape', (e: KeyboardEvent) => {
			e.preventDefault();
			e.stopPropagation();
			
			const activeObject = this.canvas?.getActiveObject();
			if (activeObject instanceof IText && activeObject.isEditing) {
				activeObject.exitEditing();
			}
			return false;
		});
		
		// Prevent default handlers
		this.preventDefaultHandlers();
	}

    async onOpen() {
        const { contentEl } = this;
        contentEl.style.padding = '0';
        contentEl.style.overflow = 'hidden';

        const modalContainer = contentEl.createDiv('modal-container');
		this.setupResizable();
		this.setupToolbar(modalContainer);
		
        const canvasContainer = modalContainer.createDiv('canvas-container');
        const canvasEl = canvasContainer.createEl('canvas');

        try {
            const arrayBuffer = await this.app.vault.readBinary(this.file);
            const blob = new Blob([arrayBuffer]);
            const blobUrl = URL.createObjectURL(blob);

            const img = new Image();
            img.onload = () => {
				this.undoStack = [JSON.stringify([])];
				this.redoStack = [];
				// Calculate dimensions to fit the window while maintaining aspect ratio
				const padding = 80;
				const toolbarHeight = 60;
				
				// Calculate maximum available space
				const maxWidth = window.innerWidth * 0.9 - padding;
				const maxHeight = window.innerHeight * 0.9 - padding - toolbarHeight;
				

				// Set canvas dimensions to maximum available space
				const canvasWidth = maxWidth;
				const canvasHeight = maxHeight;
				

				// Initialize canvas with full dimensions
				this.canvas = new Canvas(canvasEl, {
					width: canvasWidth,
					height: canvasHeight,
					backgroundColor: 'transparent', // Light gray background to show canvas bounds
					isDrawingMode: false,
					preserveObjectStacking: this.preserveObjectStacking
				});

				// Calculate image scaling to fit within canvas while maintaining aspect ratio
				const scale = Math.min(
					canvasWidth / img.width,
					canvasHeight / img.height
				) * 0.8; // Scale down slightly to leave margin


				// Add the image to canvas
				const fabricImg = new FabricImage(img, {
					selectable: false,
					evented: false,
					scaleX: scale,
					scaleY: scale,
					objectCaching: true,
					opacity: 1,
					erasable: false,
					crossOrigin: 'anonymous', // Add this line
					strokeWidth: 0
				});

				this.canvas.add(fabricImg);

				this.centerFabricImage(fabricImg);
				
				// Set modal dimensions
				this.modalEl.style.width = `${canvasWidth + padding}px`;
				this.modalEl.style.height = `${canvasHeight + padding + toolbarHeight}px`;
				
				this.analyzeImageColors(img);
				this.setupZoomAndPan();
				this.initializeUndoRedo();
				// ////////////////////////////////////////////////////////////////////////
				// Initialize drawing brush
				this.initializeCanvasEventHandlers();

				// Prevent default behaviors that might interfere
				this.modalEl.addEventListener('mousedown', (e) => {
					if (e.target === this.modalEl) {
						e.preventDefault();
						e.stopPropagation();
					}
				});
				// Prevent keyboard events from bubbling up to Obsidian
				this.modalEl.addEventListener('keydown', (e: KeyboardEvent) => {
					e.preventDefault();
					e.stopPropagation();
				}, true);

				this.modalEl.addEventListener('keyup', (e: KeyboardEvent) => {
					e.preventDefault();
					e.stopPropagation();
				}, true);

				this.setupSelectionEvents();

                URL.revokeObjectURL(blobUrl);
                this.canvas.renderAll();

            };

            img.src = blobUrl;

        } catch (error) {
            console.error('Error loading image:', error);
            new Notice('Error loading image');
            return;
        }
    }
	
	
	private centerFabricImage(fabricImg: FabricImage) {
		if (!this.canvas) return;
	
		// Get canvas dimensions with defaults
		const canvasWidth = this.canvas.width ?? 0;
		const canvasHeight = this.canvas.height ?? 0;
	
		// Get image dimensions with defaults
		const imageWidth = fabricImg.width ?? 0;
		const imageHeight = fabricImg.height ?? 0;
		const scaleX = fabricImg.scaleX ?? 1;
		const scaleY = fabricImg.scaleY ?? 1;
	
		// Calculate centered position
		const left = (canvasWidth - imageWidth * scaleX) / 2;
		const top = (canvasHeight - imageHeight * scaleY) / 2;
	
		// Set the position
		fabricImg.set({
			left,
			top
		});
	}

	
	private updateDrawingModeUI(isDrawing: boolean) {
		this.isDrawingMode = isDrawing;
		this.canvas.isDrawingMode = isDrawing;
		
		// Update object interactivity based on new drawing mode state
		this.updateObjectInteractivity();
		
		if (this.drawButton) {
			if (isDrawing) {
				// this.drawButton.setButtonText('Stop Drawing');
				this.drawButton.buttonEl.addClass('is-active');
			} else {
				// this.drawButton.setButtonText('Draw');
				this.drawButton.buttonEl.removeClass('is-active');
			}
		}
		
		// Ensure canvas is updated
		this.canvas.requestRenderAll();
	}
	
	private updateObjectInteractivity() {
		if (!this.canvas) return;
	
		this.canvas.forEachObject(obj => {
			if (obj instanceof FabricImage) {
				// Background image is never interactive
				obj.selectable = false;
				obj.evented = false;
			} else if (obj instanceof IText) {
				if (this.isDrawingMode) {
					// In drawing mode, text objects should still be editable but not selectable
					obj.selectable = false;
					obj.evented = false;  // Keep evented true for text
					obj.editable = false; // true = Ensure text remains editable
				} else {
					// In other modes, text objects are fully interactive
					obj.selectable = true;
					obj.evented = true;
					obj.editable = true;
				}
			} else {
				// For all other objects (drawings)
				if (this.isTextMode) {
					// In text mode, drawings shouldn't be interactive
					obj.selectable = false;
					obj.evented = false;
				} else {
					// In other modes, drawings are interactive unless in drawing mode
					obj.selectable = !this.isDrawingMode;
					obj.evented = !this.isDrawingMode;
				}
			}
		});
	
		// Update canvas selection property
		this.canvas.selection = !this.isDrawingMode && !this.isTextMode;
		this.canvas.requestRenderAll();
	}


	private createColorSwatches() {
		const colorPickerWrapper = this.modalEl.querySelector('.color-picker-wrapper');
		if (!colorPickerWrapper) return;
	
		const updateObjectColor = (color: string) => {
			const colorPicker = this.modalEl.querySelector('.color-picker') as HTMLInputElement;
			if (colorPicker) {
				colorPicker.value = color;
				
				// Update brush color for drawing mode
				this.updateBrushColor();
				
				// Update selected object(s) color
				if (this.canvas) {
					const activeObject = this.canvas.getActiveObject();
					if (activeObject) {
						if (activeObject.type === 'activeselection') {
							// Handle multiple selection
							const selection = activeObject as ActiveSelection;
							selection.getObjects().forEach(obj => {
								if (obj instanceof IText) {
									obj.set('fill', color);
								} else {
									obj.set('stroke', this.hexToRgba(color, this.brushOpacities[this.currentOpacityIndex]));
								}
							});
						} else {
							// Handle single object
							if (activeObject instanceof IText) {
								activeObject.set('fill', color);
							} else {
								activeObject.set('stroke', this.hexToRgba(color, this.brushOpacities[this.currentOpacityIndex]));
							}
						}
						this.canvas.requestRenderAll();
					}
				}
			}
		};
		
		// Remove existing swatches if any
		const existingSwatches = colorPickerWrapper.querySelector('.color-swatches');
		if (existingSwatches) {
			existingSwatches.remove();
		}
	
		const swatchesContainer = colorPickerWrapper.createDiv('color-swatches');
	
		// Predefined color rows
		const grayScaleColors = ['#000000', '#ffffff', '#d1d3d4', '#a7a9acCC', '#808285', '#58595b'];
		const paletteColors = ['#ff80ff', '#ffc680', '#ffff80', '#80ff9e', '#80d6ff', '#bcb3ff'];
	
		// Create grayscale row
		const grayScaleRow = swatchesContainer.createDiv('color-row');
		grayScaleRow.createSpan('row-label').setText('Grayscale:');
		const grayScaleSwatches = grayScaleRow.createDiv('swatches-container');
		grayScaleColors.forEach(color => {
			const swatch = grayScaleSwatches.createDiv('color-swatch preset');
			swatch.style.backgroundColor = color;
			swatch.setAttribute('title', color);
			swatch.addEventListener('click', () => updateObjectColor(color));
		});
	
		// Create palette row
		const paletteRow = swatchesContainer.createDiv('color-row');
		paletteRow.createSpan('row-label').setText('Palette:');
		const paletteSwatches = paletteRow.createDiv('swatches-container');
		paletteColors.forEach(color => {
			const swatch = paletteSwatches.createDiv('color-swatch preset');
			swatch.style.backgroundColor = color;
			swatch.setAttribute('title', color);
			swatch.addEventListener('click', () => updateObjectColor(color));
		});
	
		// Sort dominant colors by luminosity
		const colorPairs = this.dominantColors.map((dominantColor, index) => ({
			dominant: dominantColor,
			complementary: this.complementaryColors[index][0],
			luminosity: this.getLuminosity(dominantColor)
		})).sort((a, b) => a.luminosity - b.luminosity);
	
		// Create dominant colors row
		const dominantRow = swatchesContainer.createDiv('color-row');
		dominantRow.createSpan('row-label').setText('Dominant:');
		const dominantSwatches = dominantRow.createDiv('swatches-container');
		colorPairs.forEach(pair => {
			const dominantSwatch = dominantSwatches.createDiv('color-swatch dominant');
			dominantSwatch.style.backgroundColor = pair.dominant;
			dominantSwatch.setAttribute('title', pair.dominant);
			dominantSwatch.addEventListener('click', () => updateObjectColor(pair.dominant));
		});

		// Create complementary colors row
		const complementaryRow = swatchesContainer.createDiv('color-row');
		complementaryRow.createSpan('row-label').setText('180:');
		const complementarySwatches = complementaryRow.createDiv('swatches-container');
		colorPairs.forEach(pair => {
			const complementarySwatch = complementarySwatches.createDiv('color-swatch complementary');
			complementarySwatch.style.backgroundColor = pair.complementary;
			complementarySwatch.setAttribute('title', pair.complementary);
			complementarySwatch.addEventListener('click', () => {
				const rgb = this.hslToRgb(pair.complementary);
				const hex = this.rgbToHex(rgb.r, rgb.g, rgb.b);
				updateObjectColor(hex);
			});
		});

		this.createPresetButtons(swatchesContainer);
	}

	private updateBrushColor() {
		if (!this.canvas?.freeDrawingBrush) return;
		
		const colorPicker = this.modalEl.querySelector('.color-picker') as HTMLInputElement;
		if (!colorPicker) return;
	
		const currentColor = colorPicker.value;
		const currentOpacity = this.brushOpacities[this.currentOpacityIndex];
		
		this.canvas.freeDrawingBrush.color = this.hexToRgba(currentColor, currentOpacity);
		this.canvas.freeDrawingBrush.width = this.brushSizes[this.currentBrushSizeIndex];
	}

	private createAndAddText(color: string, x: number, y: number) {
		if (this.isTextEditingBlocked) {
			console.debug('Text creation blocked');
			return;
		}
	
		try {
			const text = new IText('Type here', {
				left: x,
				top: y,
				fontSize: 20,
				fill: color,
				selectable: true,
				evented: true,
				editable: true,
				hasControls: true,
				hasBorders: true,
				centeredScaling: true,
				originX: 'center',
				originY: 'center'
			});
	
			this.canvas?.add(text);
			this.canvas?.setActiveObject(text);
			
			// Force render before entering edit mode
			this.canvas?.requestRenderAll();
			
			// Small delay before entering edit mode
			setTimeout(() => {
				text.enterEditing();
				text.selectAll();
				this.canvas?.requestRenderAll();
			}, 50);
	
		} catch (error) {
			console.error('Error in createAndAddText:', error);
			this.isTextEditingBlocked = false;
		}
	}

	// private recoverTextEditing() {
	// 	if (!this.canvas) return;
		
	// 	this.isTextEditingBlocked = false;
	// 	this.isDrawingMode = false;
	// 	this.canvas.isDrawingMode = false;
		
	// 	const activeObject = this.canvas.getActiveObject();
	// 	if (activeObject instanceof IText) {
	// 		activeObject.selectable = true;
	// 		activeObject.evented = true;
	// 		activeObject.editable = true;
	// 	}
		
	// 	this.canvas.requestRenderAll();
	// }

	private registerHotkeys() {
		this.scope.register(['Mod'], 'S', (evt: KeyboardEvent) => {
			evt.preventDefault();
			this.saveAnnotation();
		});
	
		// Add CMD/CTRL + A handler
		this.scope.register(['Mod'], 'A', (evt: KeyboardEvent) => {
			// Check if we're currently editing text
			if (this.canvas) {
				const activeObject = this.canvas.getActiveObject();
				if (activeObject instanceof IText && activeObject.isEditing) {
					return true; // Allow normal typing when editing text
				}
			}
			evt.preventDefault();
			this.selectAll();
			return false;
		});

		this.scope.register(['Mod'], 'Z', (evt: KeyboardEvent) => {
			evt.preventDefault();
			if (evt.shiftKey) {
				console.log('Redo triggered');
				this.redo();
			} else {
				console.log('Undo triggered');
				this.undo();
			}
			return false;
		});
		
		this.scope.register(['Mod', 'Shift'], 'Z', (evt: KeyboardEvent) => {
			evt.preventDefault();
			console.log('Redo triggered (shift)');
			this.redo();
			return false;
		});

		this.scope.register([], 'A', (evt: KeyboardEvent) => {
			if (this.isTextEditing()) return true;
			evt.preventDefault();
			this.switchTool(this.currentTool === ToolMode.Arrow ? ToolMode.None : ToolMode.Arrow);
			return false;
		});
	

		this.scope.register([], 'B', (evt: KeyboardEvent) => {
			// Check if we're currently editing text
			if (this.canvas) {
				const activeObject = this.canvas.getActiveObject();
				if (activeObject instanceof IText && activeObject.isEditing) {
					return true; // Allow normal typing when editing text
				}
			}
			evt.preventDefault();
			// If text mode is active, disable it first
			if (this.isTextMode) {
				this.toggleTextMode();
			}
			this.toggleDrawingMode(this.drawButton);
			return false;
		});
	
		this.scope.register([], 'T', (evt: KeyboardEvent) => {
			// Check if we're currently editing text
			if (this.canvas) {
				const activeObject = this.canvas.getActiveObject();
				if (activeObject instanceof IText && activeObject.isEditing) {
					return true; // Allow normal typing when editing text
				}
			}
			evt.preventDefault();
			// If drawing mode is active, disable it first
			if (this.isDrawingMode) {
				this.updateDrawingModeUI(false);
			}
			// Just disable drawing mode
			this.toggleTextMode();
			return false;
		});

		// Add delete/backspace handler
		this.scope.register([], 'Delete', (evt: KeyboardEvent) => {
			evt.preventDefault();
			this.deleteSelectedObjects();
			return false;
		});

		this.scope.register([], 'Backspace', (evt: KeyboardEvent) => {
			const activeObject = this.canvas?.getActiveObject();
			if (activeObject instanceof IText && activeObject.isEditing) {
				return true; // Allow normal backspace behavior when editing text
			}
			evt.preventDefault();
			this.deleteSelectedObjects();
			return false;
		});

	}

	
	


	private switchTool(newTool: ToolMode) {
		// Disable all tools first
		this.isDrawingMode = false;
		this.isTextMode = false;
		this.isArrowMode = false;
		
		// Remove active class from all tool buttons
		if (this.drawButton) this.drawButton.buttonEl.removeClass('is-active');
		if (this.textButton) this.textButton.buttonEl.removeClass('is-active');
		if (this.arrowButton) this.arrowButton.buttonEl.removeClass('is-active');
		
		// Enable the selected tool
		switch (newTool) {
			case ToolMode.Draw:
				this.isDrawingMode = true;
				if (this.drawButton) this.drawButton.buttonEl.addClass('is-active');
				if (this.canvas) {
					this.canvas.isDrawingMode = true;
					this.canvas.freeDrawingBrush = new PencilBrush(this.canvas);
					this.updateBrushColor();
					// Set initial brush width for drawing
					this.canvas.freeDrawingBrush.width = this.brushSizes[this.currentBrushSizeIndex];
				}
				break;
				
			case ToolMode.Text:
				this.isTextMode = true;
				if (this.textButton) this.textButton.buttonEl.addClass('is-active');
				if (this.canvas) {
					this.canvas.isDrawingMode = false;
				}
				break;
				
			case ToolMode.Arrow:
				this.isArrowMode = true;
				if (this.arrowButton) this.arrowButton.buttonEl.addClass('is-active');
				if (this.canvas) {
					this.canvas.isDrawingMode = true;
					const arrowBrush = new ArrowBrush(this.canvas);
					this.canvas.freeDrawingBrush = arrowBrush;
					this.updateBrushColor();
					// Set initial brush width for arrow
					arrowBrush.width = this.brushSizes[this.currentBrushSizeIndex];
				}
				break;
				
			case ToolMode.None:
				if (this.canvas) {
					this.canvas.isDrawingMode = false;
				}
				break;
		}
		
		this.currentTool = newTool;
		this.updateObjectInteractivity();
		// Show/hide preset buttons based on tool
		const presetContainer = this.modalEl.querySelector('.preset-buttons');
		if (presetContainer instanceof HTMLElement) {
			presetContainer.style.display = newTool === ToolMode.None ? 'none' : 'flex';
			this.updatePresetButtons();
		}
	}

	private toggleDrawingMode(drawBtn?: ButtonComponent) {
		const newTool = this.currentTool === ToolMode.Draw ? ToolMode.None : ToolMode.Draw;
		this.switchTool(newTool);
	}
	
	private toggleTextMode() {
		const newTool = this.currentTool === ToolMode.Text ? ToolMode.None : ToolMode.Text;
		this.switchTool(newTool);
	}
	
	private toggleArrowMode(arrowBtn?: ButtonComponent) {
		const newTool = this.currentTool === ToolMode.Arrow ? ToolMode.None : ToolMode.Arrow;
		this.switchTool(newTool);
	}


	// Add this method to create preset buttons
	private createPresetButtons(container: Element) {
		// Cast container to HTMLElement
		const containerEl = container as HTMLElement;
		const presetContainer = containerEl.createDiv('preset-buttons');
		presetContainer.style.display = 'none';
		
		// Create 3 preset buttons
		for (let i = 0; i < 3; i++) {
			const presetButton = presetContainer.createDiv(`preset-button preset-${i + 1}`);
			presetButton.createDiv('preset-color');
			presetButton.createSpan('preset-number').setText(`${i + 1}`);
			
			presetButton.addEventListener('click', (e) => {
				if (e.shiftKey) {
					this.savePreset(i);
				} else {
					this.loadPreset(i);
				}
			});
			
			presetButton.setAttribute('title', 'Click to load, Shift+Click to save');
		}
		
		return presetContainer;
	}

	// Add these methods to handle preset functionality
	private async savePreset(index: number) {
		const colorPicker = this.modalEl.querySelector('.color-picker') as HTMLInputElement;
		if (!colorPicker) return;
	
		const preset: ToolPreset = {
			size: this.brushSizes[this.currentBrushSizeIndex],
			color: colorPicker.value,
			opacity: this.brushOpacities[this.currentOpacityIndex],
			blendMode: this.currentBlendMode
		};
	
		// Save to appropriate tool preset array in plugin settings
		if (this.isDrawingMode) {
			this.plugin.settings.annotationPresets.drawing[index] = preset;
		} else if (this.isArrowMode) {
			this.plugin.settings.annotationPresets.arrow[index] = preset;
		} else if (this.isTextMode) {
			this.plugin.settings.annotationPresets.text[index] = preset;
		}
	
		// Save settings
		await this.plugin.saveSettings();
	
		this.updatePresetButtons();
		new Notice(`Preset ${index + 1} saved`);
	}

	private loadPreset(index: number) {
		let preset: ToolPreset;
		
		if (this.isDrawingMode) {
			preset = this.plugin.settings.annotationPresets.drawing[index];
		} else if (this.isArrowMode) {
			preset = this.plugin.settings.annotationPresets.arrow[index];
		} else if (this.isTextMode) {
			preset = this.plugin.settings.annotationPresets.text[index];
		} else {
			return;
		}
	
		// Apply color
		const colorPicker = this.modalEl.querySelector('.color-picker') as HTMLInputElement;
		if (colorPicker) {
			colorPicker.value = preset.color;
		}
	
		// Find and click the appropriate opacity button
		const opacityIndex = this.brushOpacities.indexOf(preset.opacity);
		if (opacityIndex !== -1) {
			this.currentOpacityIndex = opacityIndex;
			const opacityButtons = this.modalEl.querySelectorAll('.opacity-buttons-container button');
			const button = opacityButtons[opacityIndex];
			if (button instanceof HTMLElement) {
				button.click();
			}
		}
	
		// Apply size
		const sizeIndex = this.brushSizes.indexOf(preset.size);
		if (sizeIndex !== -1) {
			this.currentBrushSizeIndex = sizeIndex;
			const sizeButtons = this.modalEl.querySelectorAll('.size-buttons-container button');
			const button = sizeButtons[sizeIndex];
			if (button instanceof HTMLElement) {
				button.click();
			}
		}

		// Set blend mode
		this.currentBlendMode = preset.blendMode;
		const blendModeDropdown = this.modalEl.querySelector('.blend-modes-container select') as HTMLSelectElement;
		if (blendModeDropdown) {
			blendModeDropdown.value = preset.blendMode;
		}
	
		this.updateBrushColor();
	}

	private updatePresetButtons() {
		const presetButtons = this.modalEl.querySelectorAll('.preset-button');
		const currentPresets = this.isDrawingMode ? this.plugin.settings.annotationPresets.drawing :
			this.isArrowMode ? this.plugin.settings.annotationPresets.arrow :
				this.isTextMode ? this.plugin.settings.annotationPresets.text : null;

		if (!currentPresets) return;

		presetButtons.forEach((button, index) => {
			const colorDiv = button.querySelector('.preset-color') as HTMLDivElement;
			if (colorDiv) {
				colorDiv.style.backgroundColor = currentPresets[index].color;
				colorDiv.style.opacity = currentPresets[index].opacity.toString();
			}
		});
	}









	private setupToolbar(container: HTMLElement) {
		const toolbar = container.createDiv('annotation-toolbar');
	
		// Create tool groups
		const drawingGroup = toolbar.createDiv('annotation-toolbar-group drawing-group');
		const brushControls = toolbar.createDiv('annotation-toolbar-group brush-controls');
		const utilityGroup = toolbar.createDiv('annotation-toolbar-group');
	
		// Left section container for drawing tools and colors
		const leftSection = drawingGroup.createDiv('left-section');
	
		// Create a column container for drawing tools
		const drawingToolsColumn = leftSection.createDiv('drawing-tools-column');
	
		// Drawing button
		this.drawButton = new ButtonComponent(drawingToolsColumn)
			.setTooltip('Draw (B)')
			.setIcon('pencil')
			.onClick(() => {
				this.toggleDrawingMode(this.drawButton);
			});
	
		const arrowButton = new ButtonComponent(drawingToolsColumn)
			.setTooltip('Arrow (A)')
			.setIcon('arrow-right')
			.onClick(() => {
				this.toggleArrowMode(arrowButton);
			});
		this.arrowButton = arrowButton;

		// Text button in the same column
		this.textButton = new ButtonComponent(drawingToolsColumn)
			.setTooltip('Add Text (T)')
			.setIcon('type')
			.onClick(() => {
				this.toggleTextMode();
			});

		// Add zoom controls to utility group
		new ButtonComponent(drawingToolsColumn)
			.setTooltip('Reset Zoom (1:1)')
			.setIcon('search')
			.onClick(() => this.resetZoom());

		// Add color picker right next to drawing tools
		const colorPickerWrapper = leftSection.createDiv('color-picker-wrapper');
		const colorPicker = colorPickerWrapper.createEl('input', {
			type: 'color',
			value: '#ff0000'
		});
		colorPicker.addClass('color-picker');
	
		// Update color picker event listener
		colorPicker.addEventListener('input', () => {
			this.updateBrushColor();
			
			if (this.canvas) {
				const activeObject = this.canvas.getActiveObject();
				if (activeObject && activeObject instanceof IText) {
					activeObject.set('fill', colorPicker.value);
					this.canvas.requestRenderAll();
				}
			}
		});

		// Brush controls
		const brushControlsColumn = brushControls.createDiv('brush-controls-column');
		this.createSizeButtons(brushControlsColumn);
		this.createOpacityButtons(brushControlsColumn);
		this.createBlendModeButtons(brushControlsColumn);

		// Add layer control buttons
		const layerControls = brushControlsColumn.createDiv('layer-controls');
		layerControls.createDiv('control-label').setText('Layer:');
		const layerButtonContainer = layerControls.createDiv('button-group');

		// Bring to front button
		new ButtonComponent(layerButtonContainer)
			.setTooltip('Bring to Front')
			.setIcon('arrow-up-to-line')
			.onClick(() => this.bringToFront());

		// Bring forward buttoncreateBackgroundControls
		new ButtonComponent(layerButtonContainer)
			.setTooltip('Bring Forward')
			.setIcon('arrow-up')
			.onClick(() => this.bringForward());

		// Send backward button
		new ButtonComponent(layerButtonContainer)
			.setTooltip('Send Backward')
			.setIcon('arrow-down')
			.onClick(() => this.sendBackward());

		// Send to back button
		new ButtonComponent(layerButtonContainer)
			.setTooltip('Send to Back')
			.setIcon('arrow-down-to-line')
			.onClick(() => this.sendToBack());
		
					
		// Utility tools
		new ButtonComponent(utilityGroup)
			.setTooltip('Clear All')
			.setIcon('trash')
			.onClick(() => this.clearAll());
	
		this.createBackgroundControls(utilityGroup);
		
		const saveBtn = new ButtonComponent(utilityGroup)
			.setTooltip('Save (Ctrl/Cmd + S)')
			.setIcon('checkmark')
			.onClick(() => this.saveAnnotation());

		saveBtn.buttonEl.addClass('mod-cta');
		
		// new ButtonComponent(utilityGroup)
		// 	.setTooltip('Recover Text Editing')
		// 	.setIcon('refresh-cw')
		// 	.onClick(() => this.recoverTextEditing());
	
		this.registerHotkeys();
	}









	private createSizeButtons(container: HTMLElement) {
		const brushControlsColumn = container.createDiv('brush-controls-column');
		
		// Size controls
		const sizeButtonsContainer = brushControlsColumn.createDiv('size-buttons-container');
		const sizeLabel = sizeButtonsContainer.createDiv('control-label');
		sizeLabel.setText('Size:');
		
		const sizeButtonContainer = sizeButtonsContainer.createDiv('button-group');
		
		this.brushSizes.forEach((size, index) => {
			const button = new ButtonComponent(sizeButtonContainer)
				.setButtonText(size.toString())
				.onClick(() => {
					this.currentBrushSizeIndex = index;
					if (this.canvas?.freeDrawingBrush) {
						this.canvas.freeDrawingBrush.width = this.brushSizes[this.currentBrushSizeIndex];
					}
					sizeButtonContainer.querySelectorAll('button').forEach(btn => 
						btn.removeClass('is-active'));
					button.buttonEl.addClass('is-active');
				});
				
			if (index === this.currentBrushSizeIndex) {
				button.buttonEl.addClass('is-active');
			}
		});
	}
	
	private createOpacityButtons(container: HTMLElement) {
		let brushControlsColumn = container.querySelector('.brush-controls-column');
		if (!brushControlsColumn) {
			brushControlsColumn = container.createDiv('brush-controls-column');
		}
		
		const opacityButtonsContainer = brushControlsColumn.createDiv('opacity-buttons-container');
		const opacityLabel = opacityButtonsContainer.createDiv('control-label');
		opacityLabel.setText('Opacity:');
		
		const opacityButtonContainer = opacityButtonsContainer.createDiv('button-group');
		
		this.brushOpacities.forEach((opacity, index) => {
			const button = new ButtonComponent(opacityButtonContainer)
				.setButtonText((opacity * 100).toString() + '') // removed percentage from buttons
				.onClick(() => {
					this.currentOpacityIndex = index;
					
					// Update brush color for drawing mode
					this.updateBrushColor();
					
					// Update selected object(s) opacity
					if (this.canvas) {
						const activeObject = this.canvas.getActiveObject();
						if (activeObject) {
							if (activeObject.type === 'activeselection') {
								// Handle multiple selection
								const selection = activeObject as ActiveSelection;
								selection.getObjects().forEach(obj => {
									this.updateObjectOpacity(obj, opacity);
								});
								selection.dirty = true;
							} else {
								// Handle single object
								this.updateObjectOpacity(activeObject, opacity);
							}
							this.canvas.requestRenderAll();
						}
					}
					
					opacityButtonContainer.querySelectorAll('button').forEach(btn => 
						btn.removeClass('is-active'));
					button.buttonEl.addClass('is-active');
				});
				
			if (index === this.currentOpacityIndex) {
				button.buttonEl.addClass('is-active');
			}
		});
	}
	// Add this helper method to update object opacity
	private updateObjectOpacity(obj: FabricObject, opacity: number) {
		if (obj instanceof IText) {
			// For text objects, update fill opacity
			const currentColor = obj.get('fill') as string;
			if (currentColor.startsWith('rgba')) {
				obj.set('fill', this.updateRgbaOpacity(currentColor, opacity));
			} else {
				obj.set('fill', this.hexToRgba(currentColor, opacity));
			}
		} else {
			// For other objects (paths, arrows), update stroke opacity
			const currentStroke = obj.get('stroke') as string;
			if (currentStroke.startsWith('rgba')) {
				obj.set('stroke', this.updateRgbaOpacity(currentStroke, opacity));
			} else {
				obj.set('stroke', this.hexToRgba(currentStroke, opacity));
			}
		}
		obj.dirty = true;
	}

	// Add this helper method to update rgba opacity
	private updateRgbaOpacity(rgba: string, newOpacity: number): string {
		const matches = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
		if (matches) {
			const [, r, g, b] = matches;
			return `rgba(${r}, ${g}, ${b}, ${newOpacity})`;
		}
		return rgba;
	}


	private createBlendModeButtons(container: HTMLElement) {
		const blendModesContainer = container.createDiv('blend-modes-container');
		const blendModeLabel = blendModesContainer.createDiv('control-label');
		blendModeLabel.setText('Blend:');
		
		// Create a dropdown container
		const dropdownContainer = blendModesContainer.createDiv('dropdown-container');
	
		// Create friendly names mapping
		const friendlyNames: Record<BlendMode, string> = {
			'source-over': 'Normal',
			'multiply': 'Multiply',
			'screen': 'Screen',
			'overlay': 'Overlay',
			'darken': 'Darken',
			'lighten': 'Lighten',
			'color-dodge': 'Dodge',
			'color-burn': 'Burn',
			'hard-light': 'Hard Light',
			'soft-light': 'Soft Light',
			'difference': 'Difference',
			'exclusion': 'Exclusion'
		} as Record<BlendMode, string>;
	
		// Create the dropdown
		const dropdown = new DropdownComponent(dropdownContainer);
		
		// Add options to the dropdown
		this.blendModes.forEach((mode) => {
			dropdown.addOption(mode, friendlyNames[mode]);
		});
	
		// Set initial value
		dropdown.setValue(this.currentBlendMode);
	
		// Add change handler
		dropdown.onChange((value) => {
			const mode = value as BlendMode;
			this.currentBlendMode = mode;
			
			// Update brush blend mode
			if (this.canvas?.freeDrawingBrush) {
				(this.canvas.freeDrawingBrush as any).globalCompositeOperation = mode;
			}
			
			// Update selected object(s)
			if (this.canvas) {
				const activeObject = this.canvas.getActiveObject();
				if (activeObject) {
					if (activeObject.type === 'activeselection') {
						// Handle multiple selection
						const selection = activeObject as ActiveSelection;
						selection.getObjects().forEach(obj => {
							if (!(obj instanceof FabricImage)) {
								obj.globalCompositeOperation = mode;
							}
						});
						selection.dirty = true;
					} else if (!(activeObject instanceof FabricImage)) {
						activeObject.globalCompositeOperation = mode;
					}
					this.canvas.requestRenderAll();
				}
			}
		});
	}


	private bringToFront() {
		if (!this.canvas) return;
		const activeObject = this.canvas.getActiveObject();
		if (!activeObject) return;
	
		if (activeObject.type === 'activeselection') {
			// Handle multiple selection
			const selection = activeObject as ActiveSelection;
			selection.getObjects().forEach(obj => {
				this.canvas?.bringObjectToFront(obj);
			});
			// Ensure selection stays on top
			this.canvas.bringObjectToFront(selection);
		} else {
			this.canvas.bringObjectToFront(activeObject);
		}
		this.canvas.requestRenderAll();
		this.saveState();
	}
	
	private bringForward() {
		if (!this.canvas) return;
		const activeObject = this.canvas.getActiveObject();
		if (!activeObject) return;
	
		if (activeObject.type === 'activeselection') {
			// Handle multiple selection
			const selection = activeObject as ActiveSelection;
			selection.getObjects().forEach(obj => {
				this.canvas?.bringObjectForward(obj);
			});
			// Ensure selection stays on top
			this.canvas.bringObjectForward(selection);
		} else {
			this.canvas.bringObjectForward(activeObject);
		}
		this.canvas.requestRenderAll();
		this.saveState();
	}
	
	private sendBackward() {
		if (!this.canvas) return;
		const activeObject = this.canvas.getActiveObject();
		if (!activeObject) return;
	
		if (activeObject.type === 'activeselection') {
			// Handle multiple selection
			const selection = activeObject as ActiveSelection;
			// Process objects in reverse order to maintain relative positions
			selection.getObjects().reverse().forEach(obj => {
				this.canvas?.sendObjectBackwards(obj);
			});
			// Ensure selection follows
			this.canvas.sendObjectBackwards(selection);
		} else {
			this.canvas.sendObjectBackwards(activeObject);
		}
		this.canvas.requestRenderAll();
		this.saveState();
	}
	
	private sendToBack() {
		if (!this.canvas) return;
		const activeObject = this.canvas.getActiveObject();
		if (!activeObject) return;
	
		if (activeObject.type === 'activeselection') {
			// Handle multiple selection
			const selection = activeObject as ActiveSelection;
			// Process objects in reverse order to maintain relative positions
			selection.getObjects().reverse().forEach(obj => {
				this.canvas?.sendObjectToBack(obj);
				// Move it just in front of the background image
				if (obj !== selection) {
					const objects = this.canvas?.getObjects() || [];
					const index = objects.indexOf(obj);
					if (index > 1) {
						this.canvas?.moveObjectTo(obj, 1);
					}
				}
			});
			// Ensure selection follows
			this.canvas.sendObjectToBack(selection);
		} else {
			this.canvas.sendObjectToBack(activeObject);
			// Move it just in front of the background image
			const objects = this.canvas.getObjects();
			const index = objects.indexOf(activeObject);
			if (index > 1) {
				this.canvas.moveObjectTo(activeObject, 1);
			}
		}
		this.canvas.requestRenderAll();
		this.saveState();
	}







    private setupSelectionEvents() {
        if (!this.canvas) return;
    }

	private deleteSelectedObjects() {
		if (!this.canvas) return;
	
		const activeObject = this.canvas.getActiveObject();
		if (!activeObject) return;
	
		// Allow normal backspace behavior when editing text
		if (activeObject instanceof IText && activeObject.isEditing) {
			return;
		}

		// Handle multiple selection
		if (activeObject.type === 'activeselection') {
			const activeSelection = activeObject as ActiveSelection;
			const objectsToRemove = activeSelection.getObjects();
			
			// Remove each object in the selection except background image
			objectsToRemove.forEach(obj => {
				if (!(obj instanceof FabricImage)) {
					this.canvas?.remove(obj);
				}
			});
			
			// Clear the selection
			this.canvas.discardActiveObject();
		} else {
			// Handle single object deletion
			if (!(activeObject instanceof FabricImage)) {
				this.canvas.remove(activeObject);
			}
		}
	
		this.canvas.requestRenderAll();
	}
	


	private initializeCanvasEventHandlers() {
		if (!this.canvas) return;
		
		// Initialize drawing brush
		this.canvas.freeDrawingBrush = new PencilBrush(this.canvas);
		this.canvas.freeDrawingBrush.width = this.brushSizes[this.currentBrushSizeIndex];
		// Set the blend mode on the brush using type assertion
		(this.canvas.freeDrawingBrush as any).globalCompositeOperation = this.currentBlendMode;

		// Initialize with opacity
		const colorPicker = this.modalEl.querySelector('.color-picker') as HTMLInputElement;
		if (colorPicker) {
			this.updateBrushColor();
		}

		// Add handler for when a path is completed
		this.canvas.on('path:created', (e: any) => {
			if (!this.isUndoRedoAction) {
				// Set the blend mode on the created path
				if (e.path) {
					e.path.globalCompositeOperation = this.currentBlendMode;
					this.canvas?.requestRenderAll();
				}
				this.saveState();
			}
		});
		this.canvas.on('object:added', (e) => {
			this.updateObjectInteractivity();
			if (e.target instanceof FabricImage || this.isUndoRedoAction) return;
			if (!(e.target.type === 'path')) { // Only save state for non-path objects
				this.saveState();
			}
		});


		this.canvas.on('object:modified', (e) => {
			// Don't save state for background image or during undo/redo
			if (e.target instanceof FabricImage || this.isUndoRedoAction) return;
			this.saveState();
		});
		
		this.canvas.on('object:removed', (e) => {
			// Don't save state for background image or during undo/redo
			if (e.target instanceof FabricImage || this.isUndoRedoAction) return;
			this.saveState();
		});
		// Mouse down handler with improved state management
		this.canvas.on('mouse:down', (opt) => {
			const target = opt.target;
			// logState('mouse:down', target);
			
			if (target instanceof IText) {
				this.updateDrawingModeUI(false);
				this.isTextEditingBlocked = false;
				target.selectable = true;
				target.evented = true;
			}
		});
	
		// Enhanced text editing handlers
		this.canvas.on('text:editing:entered', (opt) => {
			const textObject = opt.target;
			// logState('text:editing:entered', textObject);
			
			if (textObject) {
				this.isTextEditingBlocked = false;
				this.updateDrawingModeUI(false);
				textObject.selectable = true;
				textObject.evented = true;
			}
		});
	
		this.canvas.on('text:editing:exited', (opt) => {
			const textObject = opt.target;
			// logState('text:editing:exited', textObject);
			
			if (textObject) {
				this.isTextEditingBlocked = false;
				textObject.selectable = true;
				textObject.evented = true;
			}
		});
	
		// Enhanced double click handler
		this.canvas.on('mouse:dblclick', (opt) => {
			if (!this.isTextMode || this.isDrawingMode || this.isTextEditingBlocked) {
				console.debug('Blocked text creation - not in text mode or text editing blocked');
				return;
			}
	
			const target = opt.target;
			if (target instanceof IText) {
				this.isTextEditingBlocked = false;
				target.enterEditing();
				target.selectAll();
				this.canvas?.requestRenderAll();
				return;
			}
	
			try {
				const pointer = this.canvas.getScenePoint(opt.e);
				const colorPicker = this.modalEl.querySelector('.color-picker') as HTMLInputElement;
				const currentColor = colorPicker ? colorPicker.value : '#ff0000';
				this.createAndAddText(currentColor, pointer.x, pointer.y);
			} catch (error) {
				console.error('Error creating text:', error);
				this.isTextEditingBlocked = false; // Reset block on error
			}
		});
	
		// Add a periodic state check
		setInterval(() => {
			const activeObject = this.canvas?.getActiveObject();
			if (activeObject instanceof IText && !activeObject.isEditing && this.isTextEditingBlocked) {
				console.debug('Resetting blocked text editing state');
				this.isTextEditingBlocked = false;
			}
		}, 5000);
	}

	private preventDefaultHandlers() {
		// Create a whitelist of elements we want to allow events on
		const shouldAllowEvent = (e: Event): boolean => {
			const target = e.target as HTMLElement;
			
			// If we're editing text, allow all keyboard events
			const activeObject = this.canvas?.getActiveObject();
			if (activeObject instanceof IText && activeObject.isEditing && e instanceof KeyboardEvent) {
				return true;
			}
	
			return (
				target.tagName.toLowerCase() === 'canvas' ||
				target.closest('.annotation-toolbar') !== null ||
				target.closest('.color-picker-wrapper') !== null ||
				target.closest('.modal-close-button') !== null ||
				target.hasClass('modal-close-button')
			);
		};
	
		// More precise event handling
		const handleEvent = (e: Event) => {
			if (!shouldAllowEvent(e)) {
				e.stopPropagation();
			}
		};
	
		// Handle keyboard events separately
		const handleKeyboard = (e: KeyboardEvent) => {
			const activeObject = this.canvas?.getActiveObject();
			
			// Always allow text editing events
			if (activeObject instanceof IText && activeObject.isEditing) {
				// Only handle specific shortcuts like Ctrl+S
				if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
					e.preventDefault();
					e.stopPropagation();
				}
				return;
			}
	
			// Handle specific keyboard shortcuts
			if (this.isHandledKey(e)) {
				e.preventDefault();
				e.stopPropagation();
				return;
			}
	
			// Let other keyboard events through to the canvas
			if (shouldAllowEvent(e)) {
				return;
			}
	
			// Stop propagation for non-canvas events
			e.stopPropagation();
		};
	
		// Add event listeners with proper targeting
		this.modalEl.addEventListener('mousedown', handleEvent, true);
		this.modalEl.addEventListener('mousemove', handleEvent, true);
		this.modalEl.addEventListener('mouseup', handleEvent, true);
		this.modalEl.addEventListener('click', handleEvent, true);
		this.modalEl.addEventListener('dblclick', handleEvent, true);
		
		// Keyboard events
		this.modalEl.addEventListener('keydown', handleKeyboard, true);
		this.modalEl.addEventListener('keyup', handleKeyboard, true);
	
		// Store the handlers for cleanup
		this._boundHandleEvent = handleEvent;
		this._boundHandleKeyboard = handleKeyboard;
	}
	
	private isHandledKey(e: KeyboardEvent): boolean {
		// Don't handle any keys when editing text
		const activeObject = this.canvas?.getActiveObject();
		if (activeObject instanceof IText && activeObject.isEditing) {
			return false;
		}
	
		return (
			(e.ctrlKey || e.metaKey) && (
				e.key.toLowerCase() === 's' || // Save
				e.key.toLowerCase() === 'a'    // Select all
			) ||
			e.key === 'Escape' || // Close/refresh
			(!this.isTextEditing() && (
				e.key === 'Delete' || // Delete
				e.key === 'Backspace' || // Backspace
				e.key.toLowerCase() === 'b' || // Drawing mode
				e.key.toLowerCase() === 't' || // Text mode
				e.key.toLowerCase() === 'a' // Arrow mode
			))
		);
	}
	
	private isTextEditing(): boolean {
		const activeObject = this.canvas?.getActiveObject();
		return !!(activeObject instanceof IText && activeObject.isEditing);
	}
	

	private _boundHandleEvent: ((e: Event) => void) | null = null;
	private _boundHandleKeyboard: ((e: KeyboardEvent) => void) | null = null;


	private hexToRgba(hex: string, opacity: number): string {
		// Remove the hash if present
		hex = hex.replace('#', '');
		
		// Parse the hex values
		const r = parseInt(hex.substring(0, 2), 16);
		const g = parseInt(hex.substring(2, 4), 16);
		const b = parseInt(hex.substring(4, 6), 16);
		
		// Return rgba string
		return `rgba(${r}, ${g}, ${b}, ${opacity})`;
	}
	private async analyzeImageColors(img: HTMLImageElement): Promise<void> {
        // Create a temporary canvas for analysis
        const tempCanvas = document.createElement('canvas');
        const ctx = tempCanvas.getContext('2d');
        if (!ctx) return;

        // Set canvas size to match image
        tempCanvas.width = img.width;
        tempCanvas.height = img.height;

        // Draw image to canvas
        ctx.drawImage(img, 0, 0);

        // Get image data
        const imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        const pixels = imageData.data;

        // Create color map
        const colorMap = new Map<string, number>();

        // Sample every 4th pixel for performance
        for (let i = 0; i < pixels.length; i += 16) {
            const r = pixels[i];
            const g = pixels[i + 1];
            const b = pixels[i + 2];
            const a = pixels[i + 3];

            // Skip transparent pixels
            if (a < 128) continue;

            // Quantize colors to reduce the number of unique colors
            const quantizedR = Math.round(r / 32) * 32;
            const quantizedG = Math.round(g / 32) * 32;
            const quantizedB = Math.round(b / 32) * 32;

            const hex = this.rgbToHex(quantizedR, quantizedG, quantizedB);
            colorMap.set(hex, (colorMap.get(hex) || 0) + 1);
        }

        // Convert map to array and sort by frequency
        const sortedColors = Array.from(colorMap.entries())
            .map(([color, count]) => ({ color, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 6)
            .map(item => item.color);

        this.dominantColors = sortedColors;
        this.complementaryColors = sortedColors.map(color => this.getComplementaryColors(color));

        // Create color swatches
        this.createColorSwatches();
    }
	private getLuminosity(color: string): number {
		const rgb = this.hexToRgb(color);
		// Using relative luminance formula
		return 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
	}
    private rgbToHex(r: number, g: number, b: number): string {
        return '#' + [r, g, b].map(x => {
            const hex = x.toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        }).join('');
    }
    private hexToRgb(hex: string): { r: number, g: number, b: number } {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : { r: 0, g: 0, b: 0 };
    }
	private getComplementaryColors(hex: string): string[] {
		const rgb = this.hexToRgb(hex);
		const hsl = this.rgbToHsl(rgb.r, rgb.g, rgb.b);
	
		// Return only the complementary color at 180 degrees
		return [this.hslToString((hsl.h + 180) % 360, hsl.s, hsl.l)];
	}
    private rgbToHsl(r: number, g: number, b: number): { h: number, s: number, l: number } {
        r /= 255;
        g /= 255;
        b /= 255;

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h = 0;
        let s = 0;
        const l = (max + min) / 2;

        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }

            h *= 60;
        }

        // Convert s and l to percentages
        s = s * 100;
        const lPercent = l * 100;

        return { h, s: s, l: lPercent };
    }
	private hslToString(h: number, s: number, l: number): string {
        // Ensure h is between 0 and 360
        h = h % 360;
        if (h < 0) h += 360;

        // Keep s and l as percentages
        return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
    }
	private hslToRgb(hslStr: string): { r: number, g: number, b: number } {
        const matches = hslStr.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
        if (!matches) return { r: 0, g: 0, b: 0 };

        const h = parseInt(matches[1]) / 360;
        const s = parseInt(matches[2]) / 100;
        const l = parseInt(matches[3]) / 100;

        let r, g, b;

        if (s === 0) {
            r = g = b = l;
        } else {
            const hue2rgb = (p: number, q: number, t: number) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };

            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;

            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }

        return {
            r: Math.round(r * 255),
            g: Math.round(g * 255),
            b: Math.round(b * 255)
        };
    }



    // Add to your existing onOpen method, after creating modalContainer
    private setupResizable() {
        // Add resize handle
        this.resizeHandle = this.modalEl.createDiv('modal-resize-handle');
        this.resizeHandle.innerHTML = '⋮⋮'; // Or use any icon you prefer

        // Add resize functionality
        this.resizeHandle.addEventListener('mousedown', this.startResize.bind(this));
        document.addEventListener('mousemove', this.resize.bind(this));
        document.addEventListener('mouseup', this.stopResize.bind(this));

        // Add resize class to modal
        this.modalEl.addClass('resizable-modal');
    }

    private startResize(e: MouseEvent) {
        this.isResizing = true;
        this.modalEl.addClass('is-resizing');
        e.preventDefault();
    }

	private resize(e: MouseEvent) {
		if (!this.isResizing || !this.canvas) return;
	
		const modalRect = this.modalEl.getBoundingClientRect();
		const newWidth = Math.max(this.minWidth, e.clientX - modalRect.left);
		const newHeight = Math.max(this.minHeight, e.clientY - modalRect.top);
	
		this.modalEl.style.width = `${newWidth}px`;
		this.modalEl.style.height = `${newHeight}px`;
	
		const toolbar = this.modalEl.querySelector('.annotation-toolbar') as HTMLElement;
		const toolbarHeight = toolbar?.offsetHeight ?? 0;
		const padding = 40;
	
		// Update canvas size
		this.canvas.setDimensions({
			width: newWidth - padding,
			height: newHeight - toolbarHeight - padding
		});
	
		// Get background image
		const backgroundImage = this.canvas.getObjects()[0] as FabricImage;
		if (backgroundImage) {
			// Safely get image dimensions with defaults
			const imageWidth = backgroundImage.width ?? 1;  // Use 1 to avoid division by zero
			const imageHeight = backgroundImage.height ?? 1;
	
			// Calculate scale safely
			const scale = Math.min(
				(newWidth - padding) / imageWidth,
				(newHeight - toolbarHeight - padding) / imageHeight
			) * 0.8; // Keep some margin
	
			backgroundImage.set({
				scaleX: scale,
				scaleY: scale
			});
		}
	
		// Keep all objects within visible canvas area
		const canvasWidth = this.canvas.width ?? 0;
		const canvasHeight = this.canvas.height ?? 0;
	
		this.canvas.getObjects().slice(1).forEach(obj => {
			const objBounds = obj.getBoundingRect();
			
			// Ensure object stays within canvas bounds
			if (objBounds.left < 0) {
				obj.set('left', 0);
			}
			if (objBounds.top < 0) {
				obj.set('top', 0);
			}
			if (objBounds.left + objBounds.width > canvasWidth) {
				obj.set('left', Math.max(0, canvasWidth - objBounds.width));
			}
			if (objBounds.top + objBounds.height > canvasHeight) {
				obj.set('top', Math.max(0, canvasHeight - objBounds.height));
			}
		});
	
		this.canvas.requestRenderAll();
	}

    private stopResize() {
        this.isResizing = false;
        this.modalEl.removeClass('is-resizing');
    }





	private setupZoomAndPan() {
		if (!this.canvas) return;
	
		// Zoom with mouse wheel
		this.canvas.on('mouse:wheel', (opt) => {
			const event = opt.e as WheelEvent;
			event.preventDefault();
			event.stopPropagation();

			const point = this.canvas.getScenePoint(event);
			const delta = event.deltaY;
			let newZoom = this.currentZoom * (delta > 0 ? 0.95 : 1.05);
			
			newZoom = Math.min(Math.max(newZoom, this.minZoom), this.maxZoom);
			
			if (newZoom !== this.currentZoom) {
				// Get background image before zooming
				const backgroundImage = this.canvas.getObjects()[0] as FabricImage;
				
				// Disable object caching temporarily
				if (backgroundImage) {
					backgroundImage.objectCaching = false;
				}

				this.zoomToPoint(point, newZoom);

				// Re-enable object caching after a short delay
				setTimeout(() => {
					if (backgroundImage) {
						backgroundImage.objectCaching = true;
						this.canvas?.requestRenderAll();
					}
				}, 100);
			}
		});
	
		// Add event listeners using the bound handlers
		document.addEventListener('keydown', this.boundKeyDownHandler);
		document.addEventListener('keyup', this.boundKeyUpHandler);
	
		// Update mouse events
		this.canvas.on('mouse:down', (opt) => {
			if (this.isSpacebarDown && opt.e) {
				this.isPanning = true;
				this.canvas.defaultCursor = 'grabbing';
				const event = opt.e as MouseEvent;
				this.lastPanPoint = { x: event.clientX, y: event.clientY };
			}
		});
	
		this.canvas.on('mouse:move', (opt) => {
			if (!this.isPanning || !this.lastPanPoint || !opt.e) return;
			
			const event = opt.e as MouseEvent;
			const currentPoint = { x: event.clientX, y: event.clientY };
			
			const deltaX = currentPoint.x - this.lastPanPoint.x;
			const deltaY = currentPoint.y - this.lastPanPoint.y;
			
			this.canvas.relativePan(new Point(deltaX, deltaY));
			this.lastPanPoint = currentPoint;
		});
	
		this.canvas.on('mouse:up', () => {
			if (this.isPanning) {
				this.isPanning = false;
				this.lastPanPoint = null;
				this.canvas.defaultCursor = this.isSpacebarDown ? 'grab' : 'default';
			}
		});
	}
	

	private handleKeyDown(e: KeyboardEvent) {
		if (e.code === 'Space') {
			// Check if we're editing text or if there's an active text object
			const activeObject = this.canvas?.getActiveObject();
			if (activeObject instanceof IText) {
				if (activeObject.isEditing) {
					return; // Allow normal spacebar behavior for text editing
				}
			}
	
			// Prevent default only if we're not editing text
			if (!this.isSpacebarDown) {
				e.preventDefault();
				this.isSpacebarDown = true;
				this.canvas.defaultCursor = 'grab';
				
				// Store previous drawing mode state
				const wasDrawingMode = this.isDrawingMode;
				
				// Temporarily disable drawing and text modes
				if (this.isDrawingMode) {
					this.canvas.isDrawingMode = false;
				}
	
				// Store these states to restore them later
				this._previousStates = {
					drawingMode: wasDrawingMode
				};
			}
		}

		// Add undo/redo handling
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
			e.preventDefault();
			e.stopPropagation();
			
			if (e.shiftKey) {
				this.redo();
			} else {
				this.undo();
			}
		}
	}
	
	private handleKeyUp(e: KeyboardEvent) {
		if (e.code === 'Space') {
			// Check if we're editing text or if there's an active text object
			const activeObject = this.canvas?.getActiveObject();
			if (activeObject instanceof IText) {
				if (activeObject.isEditing) {
					return; // Allow normal spacebar behavior for text editing
				}
			}
	
			e.preventDefault();
			this.isSpacebarDown = false;
			this.isPanning = false;
			this.lastPanPoint = null;
			this.canvas.defaultCursor = 'default';
			
			// Restore previous states
			if (this._previousStates?.drawingMode) {
				this.canvas.isDrawingMode = true;
				this.isDrawingMode = true;
			}
			
			this._previousStates = null;
		}
	}


	private zoomToPoint(point: Point, newZoom: number) {
		if (!this.canvas) return;
	
		const scaleFactor = newZoom / this.currentZoom;
		this.currentZoom = newZoom;
	
		// Get current viewport transform
		const vpt = [...this.canvas.viewportTransform];
		if (!vpt) return;
	
		// Calculate new viewport transform
		const canvasPoint = {
			x: point.x - vpt[4],
			y: point.y - vpt[5]
		};
	
		// Update viewport transform with better precision
		const newVpt: [number, number, number, number, number, number] = [
			newZoom,    // 0: horizontal scaling
			0,          // 1: horizontal skewing
			0,          // 2: vertical skewing
			newZoom,    // 3: vertical scaling
			point.x - canvasPoint.x * scaleFactor,  // 4: horizontal moving
			point.y - canvasPoint.y * scaleFactor   // 5: vertical moving
		];
	
		// Apply new transform
		this.canvas.setViewportTransform(newVpt);
		this.enforceViewportBounds();
	
		// Force background image to update
		const backgroundImage = this.canvas.getObjects()[0] as FabricImage;
		if (backgroundImage) {
			backgroundImage.setCoords();
		}
	
		// Request multiple renders to ensure proper update
		this.canvas.requestRenderAll();
		
		// Additional render after a short delay
		setTimeout(() => {
			this.canvas?.requestRenderAll();
		}, 50);
	}

	private enforceViewportBounds() {
		if (!this.canvas) return;
	
		const vpt = this.canvas.viewportTransform;
		if (!vpt) return;
	
		// Get canvas dimensions
		const canvasWidth = this.canvas.width ?? 0;
		const canvasHeight = this.canvas.height ?? 0;
	
		// Calculate maximum allowed panning based on zoom
		const zoom = this.currentZoom;
		const maxX = canvasWidth * (1 - zoom);
		const maxY = canvasHeight * (1 - zoom);
	
		// Constrain viewport transform
		vpt[4] = Math.min(Math.max(vpt[4], maxX), 0);
		vpt[5] = Math.min(Math.max(vpt[5], maxY), 0);
	
		this.canvas.setViewportTransform(vpt);
	}


	private resetZoom() {
		if (!this.canvas) return;
		
		this.currentZoom = 1;
		this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
		this.canvas.requestRenderAll();
	}


	private createBackgroundControls(container: HTMLElement) {
		// Create the button
		const bgButton = new ButtonComponent(container)
			.setTooltip('Background')
			.setIcon('layout-template')
			.onClick((e: MouseEvent) => {
				e.stopPropagation();
				this.toggleBackgroundDropdown(bgButton.buttonEl);
			});
	
		// Create dropdown (initially hidden)
		this.backgroundDropdown = container.createDiv('background-dropdown');
		this.backgroundDropdown.style.display = 'none';
	
		this.backgroundOptions.forEach(option => {
			const item = this.backgroundDropdown!.createDiv('background-option');
			
			switch (option) {
				case 'transparent': {
					item.createDiv('option-icon').innerHTML = `<svg viewBox="0 0 100 100" width="20" height="20">
						<rect x="0" y="0" width="50" height="50" fill="#ccc"/>
						<rect x="50" y="50" width="50" height="50" fill="#ccc"/>
					</svg>`;
					break;
				}
				case 'grid': {
					item.createDiv('option-icon').innerHTML = `<svg viewBox="0 0 100 100" width="20" height="20">
						<path d="M0 0 L100 0 M0 50 L100 50 M50 0 L50 100" stroke="#000" stroke-width="10"/>
					</svg>`;
					break;
				}
				case 'dots': {
					item.createDiv('option-icon').innerHTML = `<svg viewBox="0 0 100 100" width="20" height="20">
						<circle cx="50" cy="50" r="10"/>
					</svg>`;
					break;
				}
				default: {
					const preview = item.createDiv('color-preview');
					preview.style.backgroundColor = option;
				}
			}
	
			item.addEventListener('click', (e) => {
				e.stopPropagation();
				const activeObject = this.canvas?.getActiveObject();
				if (activeObject instanceof IText && activeObject.isEditing) return;
				
				this.setBackground(option);
				this.hideBackgroundDropdown();
			});
	
			if (option === this.currentBackground) {
				item.addClass('is-active');
			}
		});
	
		// Close dropdown when clicking outside
		document.addEventListener('click', () => {
			this.hideBackgroundDropdown();
		});
	}

	private createBackgroundPattern(type: BackgroundType): string | Pattern {
		if (type === 'grid' || type === 'dots') {
			const patternCanvas = document.createElement('canvas');
			const ctx = patternCanvas.getContext('2d');
			if (!ctx) return 'transparent';
	
			patternCanvas.width = 20;
			patternCanvas.height = 20;
	
			switch (type) {
				case 'grid': {
					ctx.strokeStyle = '#ddd';
					ctx.lineWidth = 1;
					ctx.beginPath();
					ctx.moveTo(0, 0);
					ctx.lineTo(20, 0);
					ctx.moveTo(0, 0);
					ctx.lineTo(0, 20);
					ctx.stroke();
					return new Pattern({
						source: patternCanvas,
						repeat: 'repeat'
					});
				}
				case 'dots': {
					ctx.fillStyle = '#ddd';
					ctx.beginPath();
					ctx.arc(10, 10, 1, 0, Math.PI * 2);
					ctx.fill();
					return new Pattern({
						source: patternCanvas,
						repeat: 'repeat'
					});
				}
			}
		}
		return type;
	}

	private toggleBackgroundDropdown(buttonEl: HTMLElement) {
		if (!this.backgroundDropdown) return;
	
		if (this.backgroundDropdown.style.display === 'none') {
			// Position dropdown below button
			const rect = buttonEl.getBoundingClientRect();
			this.backgroundDropdown.style.top = `${rect.bottom + 5}px`;
			this.backgroundDropdown.style.left = `${rect.left}px`;
			this.backgroundDropdown.style.display = 'block';
		} else {
			this.hideBackgroundDropdown();
		}
	}
	
	private hideBackgroundDropdown() {
		if (this.backgroundDropdown) {
			this.backgroundDropdown.style.display = 'none';
		}
	}

	private setBackground(type: BackgroundType) {
		if (!this.canvas) return;
	
		const pattern = this.createBackgroundPattern(type);
		
		// Use the correct property to set background
		this.canvas.backgroundColor = pattern;
		this.canvas.requestRenderAll();
	
		this.currentBackground = type;
	
		// Update UI
		const buttons = this.modalEl.querySelectorAll('.background-controls .button-group button');
		buttons.forEach(btn => btn.removeClass('is-active'));
		buttons[this.backgroundOptions.indexOf(type)]?.addClass('is-active');
	}



	private initializeUndoRedo() {
		// Initialize with an empty state
		this.undoStack = [JSON.stringify([])];
		this.redoStack = [];
	}

	private saveState() {
		if (!this.canvas || this.isUndoRedoAction) {
			console.log('Skipping state save - isUndoRedoAction:', this.isUndoRedoAction);
			return;
		}
	
		// Save an empty state initially if this is the first state
		if (this.undoStack.length === 0) {
			this.undoStack.push(JSON.stringify([]));
		}
	
		const objects = this.canvas.getObjects().slice(1);
		const newState = JSON.stringify(objects.map(obj => obj.toObject()));
		
		// Don't save if it's the same as the last state
		if (this.undoStack[this.undoStack.length - 1] === newState) {
			console.log('Skipping duplicate state');
			return;
		}
	
		this.undoStack.push(newState);
		this.redoStack = []; // Clear redo stack when new action is performed
		
	}
	
	private async undo() {
		if (!this.canvas || this.undoStack.length <= 1) { // Changed from 0 to 1 because of initial empty state
			console.log('Cannot undo: no more states');
			return;
		}
	
		this.isUndoRedoAction = true;
	
		try {
			// Get current state before making any changes
			const currentState = this.undoStack.pop(); // Remove current state
			if (currentState) {
				this.redoStack.push(currentState); // Save it to redo stack
			}
	
			// Get the previous state (which we'll restore to)
			const previousState = this.undoStack[this.undoStack.length - 1];
			
			// Clear current objects (except background)
			const objectsToRemove = this.canvas.getObjects().slice(1);
			objectsToRemove.forEach(obj => this.canvas.remove(obj));
	
			// Restore previous state
			if (previousState) {
				const objects = JSON.parse(previousState);
				for (const objData of objects) {
					const enlivenedObjects = await util.enlivenObjects([objData]);
					enlivenedObjects.forEach(obj => {
						if (obj instanceof FabricObject) {
							this.canvas.add(obj);
						}
					});
				}
			}
	
			this.canvas.requestRenderAll();
			
	
		} catch (error) {
			console.error('Error during undo:', error);
		} finally {
			this.isUndoRedoAction = false;
		}
	}
	
	private async redo() {
		if (!this.canvas || this.redoStack.length === 0) {
			console.log('Cannot redo: no more states');
			return;
		}
	
		this.isUndoRedoAction = true;
	
		try {
			// Get the next state from redo stack
			const nextState = this.redoStack.pop();
			if (!nextState) return;
	
			// Save current state to undo stack
			const currentObjects = this.canvas.getObjects().slice(1);
			const currentState = JSON.stringify(currentObjects.map(obj => obj.toObject()));
			this.undoStack.push(currentState);
			
			// Clear current objects (except background)
			const objectsToRemove = this.canvas.getObjects().slice(1);
			objectsToRemove.forEach(obj => this.canvas.remove(obj));
	
			// Restore the next state
			const objects = JSON.parse(nextState);
			for (const objData of objects) {
				const enlivenedObjects = await util.enlivenObjects([objData]);
				enlivenedObjects.forEach(obj => {
					if (obj instanceof FabricObject) {
						this.canvas.add(obj);
					}
				});
			}
	
			this.canvas.requestRenderAll();
			
	
		} catch (error) {
			console.error('Error during redo:', error);
		} finally {
			this.isUndoRedoAction = false;
		}
	}
	

	private clearAll() {
		if (!this.canvas) return;
		
		// Show confirmation dialog
		const confirm = window.confirm('Are you sure you want to clear all annotations?');
		if (!confirm) return;
	
		const objects = this.canvas.getObjects();
		// Remove all objects except the background image (first object)
		objects.slice(1).forEach(obj => this.canvas.remove(obj));
		this.canvas.requestRenderAll();
	}

	private selectAll() {
		if (!this.canvas) return;
	
		// Get all objects except the background image
		const objects = this.canvas.getObjects().slice(1);
		if (objects.length === 0) return;
	
		// If we're in drawing or text mode, temporarily disable it
		const wasDrawingMode = this.isDrawingMode;
		const wasTextMode = this.isTextMode;
	
		if (wasDrawingMode) {
			this.updateDrawingModeUI(false);
		}
		if (wasTextMode) {
			this.toggleTextMode();
		}
	
		// Create a selection of all objects
		if (objects.length === 1) {
			// If there's only one object, select it directly
			this.canvas.setActiveObject(objects[0]);
		} else {
			// If there are multiple objects, create a multiple selection
			const activeSelection = new ActiveSelection(objects, {
				canvas: this.canvas
			});
			this.canvas.setActiveObject(activeSelection);
		}
	
		this.canvas.requestRenderAll();
	
		// Restore previous modes if necessary
		if (wasDrawingMode) {
			this.updateDrawingModeUI(true);
		}
		if (wasTextMode) {
			this.toggleTextMode();
		}
	}


	async saveAnnotation() {
		if (!this.canvas) return;
		
		try {
			// Store original preserveObjectStacking value
			const originalStacking = this.canvas.preserveObjectStacking;
			
			// Temporarily disable preserveObjectStacking for export
			this.canvas.preserveObjectStacking = false;


			// Get MIME type from the file
			const mimeType = mime.getType(this.file.name) || `image/${this.file.extension}`;
			if (!mimeType) throw new Error('Unable to determine file type');
	
			// Determine export format, defaulting to PNG for unsupported types
			let exportFormat: ExtendedImageFormat = 'png';
			
			// Only override if it's one of our supported formats
			if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
				exportFormat = 'jpeg';
			} else if (mimeType === 'image/png') {
				exportFormat = 'png';
			} else if (mimeType === 'image/webp') {
				exportFormat = 'webp';
			} else if (mimeType === 'image/avif') {
				exportFormat = 'avif'
			}

			const objects = this.canvas.getObjects();
			if (objects.length === 0) return;
	
			// Find the background image (it's the only FabricImage in our canvas)
			const backgroundImage = objects.find(obj => obj instanceof FabricImage) as FabricImage;
			if (!backgroundImage) return;
	
			// Force render to ensure all objects are properly positioned
			this.canvas.renderAll();
			await new Promise(resolve => setTimeout(resolve, 100));
	
			// Store original image dimensions and scale
			const originalWidth = backgroundImage.width ?? 0;
			const originalHeight = backgroundImage.height ?? 0;
			const scale = {
				x: backgroundImage.scaleX ?? 1,
				y: backgroundImage.scaleY ?? 1
			};
	
			// Calculate actual displayed dimensions
			const displayWidth = originalWidth * scale.x;
			const displayHeight = originalHeight * scale.y;
	
			// Get background image bounds with safety checks
			const bgLeft = backgroundImage.left ?? 0;
			const bgTop = backgroundImage.top ?? 0;
			const bgRight = bgLeft + displayWidth;
			const bgBottom = bgTop + displayHeight;
	
			// Initialize bounds with background image
			let minX = bgLeft;
			let minY = bgTop;
			let maxX = bgRight;
			let maxY = bgBottom;
	
			// Include annotations in bounds calculation
			const annotations = objects.filter(obj => obj !== backgroundImage);
			if (annotations.length > 0) {
				annotations.forEach(obj => {
					if (!obj.visible) return;
					
					// Get object's absolute bounds
					const objBounds = obj.getBoundingRect();
					
					// Update bounds only if they're valid numbers
					if (isFinite(objBounds.left)) minX = Math.min(minX, objBounds.left);
					if (isFinite(objBounds.top)) minY = Math.min(minY, objBounds.top);
					if (isFinite(objBounds.width)) maxX = Math.max(maxX, objBounds.left + objBounds.width);
					if (isFinite(objBounds.height)) maxY = Math.max(maxY, objBounds.top + objBounds.height);
				});
			}
	
			// Ensure bounds include at least the background image
			minX = Math.min(minX, bgLeft);
			minY = Math.min(minY, bgTop);
			maxX = Math.max(maxX, bgRight);
			maxY = Math.max(maxY, bgBottom);
	
			// Calculate final dimensions
			const finalWidth = maxX - minX;
			const finalHeight = maxY - minY;
	
			// Safety check for dimensions
			if (finalWidth <= 0 || finalHeight <= 0) {
				throw new Error('Invalid export dimensions');
			}
	
			// Calculate scale to maintain original resolution
			const scaleToOriginal = Math.max(
				originalWidth / displayWidth,
				originalHeight / displayHeight
			);
	
			// Reset zoom and viewport temporarily
			const currentVPT = [...this.canvas.viewportTransform] as [number, number, number, number, number, number];
			this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
			this.canvas.setZoom(1);

			// Ensure all objects are visible
			objects.forEach(obj => {
				obj.setCoords();
				obj.visible = true;
			});
			
			// Force another render
			this.canvas.renderAll();
			await new Promise(resolve => setTimeout(resolve, 100));

			// Export with corrected dimensions
			const dataUrl = this.canvas.toDataURL({
				format: exportFormat as ImageFormat,
				quality: 1,
				multiplier: scaleToOriginal,
				left: minX,
				top: minY,
				width: finalWidth,
				height: finalHeight,
				enableRetinaScaling: true
			});
	
			// Restore viewport transform
			this.canvas.setViewportTransform(currentVPT);
			this.canvas.renderAll();

			// Continue with saving...
			// Validate the dataUrl
			if (!dataUrl || dataUrl === 'data:,') {
				throw new Error('Invalid export data');
			}

			// Save the image with validation
			const response = await fetch(dataUrl);
			if (!response.ok) {
				throw new Error('Failed to process export data');
			}

			const blob = await response.blob();
			if (blob.size === 0) {
				throw new Error('Export produced empty image');

			}

			const arrayBuffer = await blob.arrayBuffer();
			await this.app.vault.modifyBinary(this.file, arrayBuffer);
			
			// Success notification
			new Notice('Image saved successfully');

	
			// Get the active view
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!activeView) return;



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
			// Restore original preserveObjectStacking value
			this.canvas.preserveObjectStacking = originalStacking;
			this.canvas.requestRenderAll();
			// Close the modal
			this.close();
		} catch (error) {
			console.error('Save error:', error);
			new Notice('Error saving image');
		}
	}
	
	// Update the cleanup method
	private cleanup() {
		if (this.canvas) {
			this.canvas.off();
			this.canvas.dispose();
		}
	
		// Remove the keyboard event listeners
		document.removeEventListener('keydown', this.boundKeyDownHandler);
		document.removeEventListener('keyup', this.boundKeyUpHandler);
		
		// Remove event listeners using stored bound handlers
		if (this._boundHandleEvent) {
			this.modalEl.removeEventListener('mousedown', this._boundHandleEvent, true);
			this.modalEl.removeEventListener('mousemove', this._boundHandleEvent, true);
			this.modalEl.removeEventListener('mouseup', this._boundHandleEvent, true);
			this.modalEl.removeEventListener('click', this._boundHandleEvent, true);
			this.modalEl.removeEventListener('dblclick', this._boundHandleEvent, true);
		}
	
		if (this._boundHandleKeyboard) {
			this.modalEl.removeEventListener('keydown', this._boundHandleKeyboard, true);
			this.modalEl.removeEventListener('keyup', this._boundHandleKeyboard, true);
		}
	
		// Clear references
		this._boundHandleEvent = null;
		this._boundHandleKeyboard = null;

		// Reset states
		this.isTextEditingBlocked = false;
		this.isDrawingMode = false;
		this.isTextMode = false;
		this._previousStates = null;


		// Reset UI
		if (this.drawButton) {
			this.drawButton.buttonEl.removeClass('is-active');
		}
		if (this.textButton) {
			this.textButton.buttonEl.removeClass('is-active');
		}

		// Reset zoom
		if (this.canvas) {
			this.resetZoom();
		}

		this.isPanning = false;
		this.isSpacebarDown = false;
		this.lastPanPoint = null;
		
		if (this.canvas) {
			this.canvas.defaultCursor = 'default';
		}
		this.undoStack = [];
		this.redoStack = [];
		this.isUndoRedoAction = false;

		this.isArrowMode = false;
		if (this.arrowButton) {
			this.arrowButton.buttonEl.removeClass('is-active');
		}

	}

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
		this.cleanup();

		// Remove resize listeners
		document.removeEventListener('mousemove', this.resize.bind(this));
		document.removeEventListener('mouseup', this.stopResize.bind(this));

    }
}

class ArrowBrush extends PencilBrush {
    private points: Point[] = [];
    private readonly minDistance = 3;
    private currentPath: Path | null = null;
    private currentArrowHead: Path | null = null;
    
    constructor(canvas: Canvas) {
        super(canvas);
        // Initialize with default width if not set
        if (!this.width) {
            this.width = 8; // Default width
        }
    }

    onMouseDown(pointer: Point, ev: TBrushEventData): void {
        this.points = [pointer];
        this.currentPath = null;
        this.currentArrowHead = null;
    }

    onMouseMove(pointer: Point, ev: TBrushEventData): void {
        if (!this.points.length) return;

        const lastPoint = this.points[this.points.length - 1];
        const distance = Math.sqrt(
            Math.pow(pointer.x - lastPoint.x, 2) + 
            Math.pow(pointer.y - lastPoint.y, 2)
        );
        
        if (distance >= this.minDistance) {
            this.points.push(pointer);
            
            // Remove previous preview
            if (this.currentPath) {
                this.canvas.remove(this.currentPath);
            }
            if (this.currentArrowHead) {
                this.canvas.remove(this.currentArrowHead);
            }

            // Create new preview
            this.currentPath = this.createSmoothedPath();
            this.currentArrowHead = this.createArrowHead();

            if (this.currentPath) {
                this.canvas.add(this.currentPath);
            }
            if (this.currentArrowHead) {
                this.canvas.add(this.currentArrowHead);
            }

            this.canvas.requestRenderAll();
        }
    }

    onMouseUp({ e }: TEvent<MouseEvent | PointerEvent | TouchEvent>): boolean {
        if (this.points.length >= 2) {
            // Remove preview paths
            if (this.currentPath) {
                this.canvas.remove(this.currentPath);
            }
            if (this.currentArrowHead) {
                this.canvas.remove(this.currentArrowHead);
            }

            // Create final paths
            const finalPath = this.createSmoothedPath();
            const finalArrowHead = this.createArrowHead();

            if (finalPath) {
                this.canvas.add(finalPath);
            }
            if (finalArrowHead) {
                this.canvas.add(finalArrowHead);
            }

            this.canvas.requestRenderAll();
        }
        
        // Clear for next stroke
        this.points = [];
        this.currentPath = null;
        this.currentArrowHead = null;
        
        return false;
    }

    private createSmoothedPath(): Path | null {
        if (this.points.length < 2) return null;

        try {
            // Simplify points first
            const simplifiedPoints = this.simplifyPoints(this.points, 50);
            
            // Generate control points for smooth curve
            const controlPoints = this.getControlPoints(simplifiedPoints);
            
            // Build the SVG path
            let pathData = `M ${simplifiedPoints[0].x} ${simplifiedPoints[0].y}`;
            
            for (let i = 0; i < controlPoints.length - 1; i++) {
                const cp = controlPoints[i];
                const nextCp = controlPoints[i + 1];
                pathData += ` C ${cp.cp2x} ${cp.cp2y} ${nextCp.cp1x} ${nextCp.cp1y} ${nextCp.x} ${nextCp.y}`;
            }

            return new Path(pathData, {
                stroke: this.color,
                strokeWidth: this.width,
                fill: '',
                strokeLineCap: 'round',
                strokeLineJoin: 'round',
                selectable: false,
                evented: false
            });
        } catch (error) {
            console.error('Error creating smoothed path:', error);
            return null;
        }
    }

    private simplifyPoints(points: Point[], tolerance: number): Point[] {
        if (points.length <= 2) return points;

        const simplified: Point[] = [points[0]];
        let prevPoint = points[0];

        for (let i = 1; i < points.length - 1; i++) {
            const point = points[i];
            const nextPoint = points[i + 1];

            const d1 = Math.hypot(point.x - prevPoint.x, point.y - prevPoint.y);
            const d2 = Math.hypot(nextPoint.x - point.x, nextPoint.y - point.y);

            if (d1 + d2 > tolerance) {
                simplified.push(point);
                prevPoint = point;
            }
        }

        simplified.push(points[points.length - 1]);
        return simplified;
    }

    private getControlPoints(points: Point[]): Array<{
        x: number;
        y: number;
        cp1x: number;
        cp1y: number;
        cp2x: number;
        cp2y: number;
    }> {
        const smoothing = 0.2; // Adjust this value to control curve smoothness (0.2 - 0.3 works well)
        const result = [];

        for (let i = 0; i < points.length; i++) {
            const curr = points[i];
            const prev = points[i - 1] || curr;
            const next = points[i + 1] || curr;

            // Calculate control points
            const dx = next.x - prev.x;
            const dy = next.y - prev.y;

            const cp1x = curr.x - dx * smoothing;
            const cp1y = curr.y - dy * smoothing;
            const cp2x = curr.x + dx * smoothing;
            const cp2y = curr.y + dy * smoothing;

            result.push({
                x: curr.x,
                y: curr.y,
                cp1x,
                cp1y,
                cp2x,
                cp2y
            });
        }

        return result;
    }

    private getAverageDirection(points: Point[], sampleSize = 5): { angle: number; endPoint: Point } {
        const lastPoints = points.slice(-sampleSize);
        if (lastPoints.length < 2) return { angle: 0, endPoint: points[points.length - 1] };

        // Use the last two points for direction
        const p1 = lastPoints[lastPoints.length - 2];
        const p2 = lastPoints[lastPoints.length - 1];
        
        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

        return {
            angle,
            endPoint: p2
        };
    }

    private createArrowHead(): Path | null {
        try {
            if (this.points.length < 2) return null;

            const { angle, endPoint } = this.getAverageDirection(this.points);

            // Calculate arrow head size based on brush width
            const arrowLength = Math.max(this.width * 2, 10);
            const arrowWidth = Math.max(this.width, 5);
            const arrowAngle = Math.PI / 6; // 30 degrees

            // Calculate arrow head points
            const x1 = endPoint.x - arrowLength * Math.cos(angle - arrowAngle);
            const y1 = endPoint.y - arrowLength * Math.sin(angle - arrowAngle);
            const x2 = endPoint.x - arrowLength * Math.cos(angle + arrowAngle);
            const y2 = endPoint.y - arrowLength * Math.sin(angle + arrowAngle);

            // Create the arrow head path data
            const arrowPath = `M ${endPoint.x} ${endPoint.y} L ${x1} ${y1} M ${endPoint.x} ${endPoint.y} L ${x2} ${y2}`;

            return new Path(arrowPath, {
                stroke: this.color,
                strokeWidth: arrowWidth,
                fill: '',
                strokeLineCap: 'round',
                strokeLineJoin: 'round',
                selectable: false,
                evented: false
            });
        } catch (error) {
            console.error('Error creating arrow head:', error);
            return null;
        }
    }
}
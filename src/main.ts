// working 2
import { App, MarkdownView, Notice, Plugin, TFile, PluginSettingTab, Platform, Setting, Editor, Modal, TextComponent, ButtonComponent, Menu, MenuItem, normalizePath } from 'obsidian';
import moment from 'moment';
// import exifr from 'exifr'

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


interface Listener {
	(this: Document, ev: Event): void;
}

interface QueueItem {
	file: TFile;
	attempts: number;
	addedAt: number;
}
interface ImageConvertSettings {
	autoRename: boolean;
	showRenameNotice: boolean;
	useCustomRenaming: boolean;
	customRenameTemplate: string;
	customRenameDefaultTemplate: string; // For reset functionality

	convertToWEBP: boolean;
	convertToJPG: boolean;
	convertToPNG: boolean;
	convertTo: string;
	quality: number;

	baseTimeout: number;
	timeoutPerMB: number;

	showNoticeMessages: boolean; // For processing notices
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

	attachmentLocation: 'disable' | 'root' | 'specified' | 'current' | 'subfolder' | 'customOutput';
	attachmentSpecifiedFolder: string;
	attachmentSubfolderName: string;
	customOutputPath: string;
	previewPath: string;

	resizeMode: string;
	autoNonDestructiveResize: string,
	customSize: string,
	customSizeLongestSide: string,
	desiredWidth: number;
	desiredHeight: number;
	desiredLength: number;
	resizeByDragging: boolean;
	resizeWithShiftScrollwheel: boolean;
	rightClickContextMenu: boolean;

	rememberScrollPosition: boolean;
	cursorPosition: 'front' | 'back';

}

interface SettingsTab {
	id: string;
	name: string;
	icon?: string; // Optional icon for the tab
}


const DEFAULT_SETTINGS: ImageConvertSettings = {
	autoRename: true,
	showRenameNotice: false,
	useCustomRenaming: false,
	customRenameTemplate: '{imageName}-{date:YYYYMMDDHHmmssSSS}',
	customRenameDefaultTemplate: '{imageName}-{date:YYYYMMDDHHmmssSSS}',

	convertToWEBP: true,
	convertToJPG: false,
	convertToPNG: false,
	convertTo: 'webp',
	quality: 0.75,

	baseTimeout: 20000,
	timeoutPerMB: 1000,

	showNoticeMessages: false,
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

	attachmentLocation: 'disable',
	attachmentSpecifiedFolder: '',
	attachmentSubfolderName: '',
	customOutputPath: '',
	previewPath: '',

	resizeMode: 'None',
	autoNonDestructiveResize: "disabled",
	customSize: "",
	customSizeLongestSide: "",
	desiredWidth: 600,
	desiredHeight: 800,
	desiredLength: 800,
	resizeByDragging: true,
	resizeWithShiftScrollwheel: true,
	rightClickContextMenu: true,

	rememberScrollPosition: true,
	cursorPosition: 'back'
}

export default class ImageConvertPlugin extends Plugin {
	settings: ImageConvertSettings;
	longestSide: number | null = null;
	widthSide: number | null = null;

	// Declare the properties
	pasteListener: (event: ClipboardEvent) => void;
	dropListener: (event: DragEvent) => void;
	mouseOverHandler: (event: MouseEvent) => void;

	// Queue
	private fileQueue: QueueItem[] = [];
	private isProcessingQueue = false;
	private currentBatchTotal = 0;
	private processedInCurrentBatch = 0;
	private batchStarted = false;

	private readonly MAX_ATTEMPTS = 3;
	private readonly CONCURRENT_PROCESSING_LIMIT = 4;
	private readonly BASE_TIMEOUT = 20000; // 20 seconds base timeout
	private readonly SIZE_FACTOR = 1024 * 1024; // 1MB
	private readonly TIMEOUT_PER_MB = 1000; // Additional milliseconds per MB

	private statusBarItemEl: HTMLElement;
	private mobileProgressEl: HTMLElement | null = null;

	private counters: Map<string, number> = new Map();

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new ImageConvertTab(this.app, this));

		// Add evenet listeners on paste and drop to prevent filerenaming during `sync` or `git pull`
		// This allows us to check if  file was created as a result of a user action (like dropping 
		// or pasting an image into a note) rather than a git pull action.
		// true when a user action is detected and false otherwise. 
		let userAction = false;
		// set to true, then reset back to `false` after 100ms. This way, 'create' event handler should
		// get triggered only if its an image and if image was created within 100ms of a 'paste/drop' event
		// also if pasting, check if it is an External Link and wether to apply '| size' syntax to the link
		this.pasteListener = (event: ClipboardEvent) => {
			userAction = true;

			// Reset batch counter for new paste operation
			this.currentBatchTotal = 0;
			this.batchStarted = true;
		
			// Handle different types of paste data
			const items = event.clipboardData?.items;
			if (!items) return;
		
			// Count potential images in clipboard
			const imageItems = Array.from(items).filter(item => 
				item.kind === 'file' && item.type.startsWith('image/')
			);
			
			this.currentBatchTotal = imageItems.length;

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
			setTimeout(() => {
				userAction = false;
				this.batchStarted = false;
			}, 10000);
		};

		// Initialize Queue
		this.updateQueueStatus();

		this.dropListener = (event: DragEvent) => {
			userAction = true;

			// Reset batch counter at the start of new drop
			// and then count all. This helps detecting images which were dropped in batches
			this.currentBatchTotal = 0;
			this.batchStarted = true;

			if (event.dataTransfer?.items) {
				const imageFiles = Array.from(event.dataTransfer.items)
					.filter(item => item.kind === 'file' && item.type.startsWith('image/'));
				this.currentBatchTotal = imageFiles.length;
			} else if (event.dataTransfer?.files) {
				const imageFiles = Array.from(event.dataTransfer.files)
					.filter(file => file.type.startsWith('image/'));
				this.currentBatchTotal = imageFiles.length;
			}

			setTimeout(() => {
				userAction = false;
				this.batchStarted = false;
			}, 10000);
		};

		this.app.workspace.onLayoutReady(() => {
			const leaves = this.app.workspace.getLeavesOfType('markdown');
			leaves.forEach(leaf => {
				const doc = leaf.view.containerEl.ownerDocument;
				doc.addEventListener("paste", this.pasteListener);
				doc.addEventListener('drop', this.dropListener as EventListener);
			});

			this.registerEvent(this.app.vault.on('create', (file: TFile) => {
				if (!(file instanceof TFile) || !isImage(file) || !userAction) return;
				if (!this.batchStarted) {
					this.currentBatchTotal = 1;
				}
				this.fileQueue.push({ file, attempts: 0, addedAt: Date.now() });
				this.updateQueueStatus();
				this.processQueue();
			}));
		});

		// Show progress bar on mobile
		this.mobileProgressEl = document.body.createEl('div', {
			cls: 'image-converter-mobile-progress'
		});

		// Check if edge of an image was clicked upon
		this.register(
			this.onElement(
				document,
				"mousedown",
				"img, video",
				(event: MouseEvent) => {
					if (!this.settings.resizeByDragging) return;

					const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
					if (!activeView) return; // Ensure the active view is a Markdown note
					// Check if the image is within the markdown view container
					const markdownContainer = activeView.containerEl;
					const target = event.target as HTMLElement;
					if (!markdownContainer.contains(target)) return;

					// Only prevent default if left mouse button is pressed
					if (event.button === 0) {
						// Fix the behaviour, where image gets duplicated because of the move on drag,
						// disabling the defaults which locks the image (alhtough, links are still movable)
						event.preventDefault();
					}

					const img = event.target as HTMLImageElement | HTMLVideoElement;

					const rect = img.getBoundingClientRect();

					const x = event.clientX - rect.left;
					const y = event.clientY - rect.top;
					const edgeSize = 30; // size of the edge in pixels

					if ((x >= rect.width - edgeSize || x <= edgeSize) || (y >= rect.height - edgeSize || y <= edgeSize)) {
						// user clicked on any of the edges of the image
						// Cursor must be active only on the image or the img markdown link
						// Otherwise resized image will get copied to the active line 
						const startX = event.clientX;
						const startY = event.clientY;
						const startWidth = img.clientWidth;
						const startHeight = img.clientHeight;
						let lastUpdateX = startX;
						let lastUpdateY = startY;
						const updateThreshold = 5; // The mouse must move at least 5 pixels before an update

						const onMouseMove = (event: MouseEvent) => {

							const { newWidth, newHeight } = resizeImageDrag(event, img, startX, startY, startWidth, startHeight);
							// Apply the new dimensions to the image or video
							if (img instanceof HTMLImageElement) {
								img.style.border = 'solid';
								img.style.borderWidth = '2px';
								// img.style.borderColor = 'blue';
								img.style.boxSizing = 'border-box';
								img.style.width = `${newWidth}px`;
								img.style.height = `${newHeight}px`;
							} else if (img instanceof HTMLVideoElement) {
								img.style.border = 'solid';
								img.style.borderWidth = '2px';
								// img.style.borderColor = 'blue';
								img.style.boxSizing = 'border-box';
								// Check if img.parentElement is not null before trying to access its clientWidth property
								if (img.parentElement) {
									const containerWidth = img.parentElement.clientWidth;
									const newWidthPercentage = (newWidth / containerWidth) * 100;
									img.style.width = `${newWidthPercentage}%`;
								}
							}

							// Check if the mouse has moved more than the update threshold
							if (Math.abs(event.clientX - lastUpdateX) > updateThreshold || Math.abs(event.clientY - lastUpdateY) > updateThreshold) {
								const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
								if (activeView) {
									const imageName = getImageName(img);

									if (imageName) { // Check if imageName is not null

										if (isExternalLink(imageName)) {
											// console.log("editing external link")
											updateExternalLink(activeView, img, newWidth, newHeight);
										} else if (isBase64Image(imageName)) {
											// console.log("editing base64 image")
											resizeBase64Drag(activeView, imageName, newWidth)
										} else {
											// console.log("editing internal link")
											updateMarkdownLink(activeView, img, imageName, newWidth, newHeight);
										}
									}
								}

								// Update the last update coordinates
								lastUpdateX = event.clientX;
								lastUpdateY = event.clientY;
							}
						};

						const onMouseUp = () => {
							document.removeEventListener("mousemove", onMouseMove);
							document.removeEventListener("mouseup", onMouseUp);

							// Add a slight delay before setting the cursor position
							setTimeout(() => {
								// Set the cursor position based on the setting
								const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
								if (activeView) {
									const editor = activeView.editor;
									const cursorPos = editor.getCursor();
									const lineContent = editor.getLine(cursorPos.line);
									const imageName = getImageName(img);

									if (imageName) {
										let newCursorPos;
										if (this.settings.cursorPosition === 'front') {
											newCursorPos = { line: cursorPos.line, ch: Math.max(lineContent.indexOf(imageName) - 3, 0) };
										} else {
											const linkEnd = lineContent.indexOf(imageName) + imageName.length + 6;
											newCursorPos = { line: cursorPos.line, ch: Math.min(linkEnd, lineContent.length) };
										}
										editor.setCursor(newCursorPos);
									}
								}
							}, 100); // Adjust the delay as needed
						};
						document.addEventListener("mousemove", onMouseMove);
						document.addEventListener("mouseup", onMouseUp);
					}
				}
			)
		);
		// Custom event listener to handle cursor positioning after resizing
		this.register(this.onElement(document, "mouseup", "img, video", (event: MouseEvent) => {
			const img = event.target as HTMLImageElement | HTMLVideoElement;

			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!activeView) return; // Ensure the active view is a Markdown note
			// Check if the image is within the markdown view container
			const markdownContainer = activeView.containerEl;
			const target = event.target as HTMLElement;
			if (!markdownContainer.contains(target)) return;

			if (activeView) {
				const editor = activeView.editor;
				const cursorPos = editor.getCursor();
				const lineContent = editor.getLine(cursorPos.line);
				const imageName = getImageName(img);

				if (imageName) {
					let newCursorPos;
					if (this.settings.cursorPosition === 'front') {
						newCursorPos = { line: cursorPos.line, ch: Math.max(lineContent.indexOf(imageName) - 3, 0) };
					} else {
						const linkEnd = lineContent.indexOf(imageName) + imageName.length + 6;
						newCursorPos = { line: cursorPos.line, ch: Math.min(linkEnd, lineContent.length) };
					}
					editor.setCursor(newCursorPos);
				}
			}
		}));
		// Create handle to resize image by dragging the edge of an image
		this.register(
			this.onElement(
				document,
				"mouseover",
				"img, video",
				(event: MouseEvent) => {
					if (!this.settings.resizeByDragging) return;
					const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
					if (!activeView) return; // Ensure the active view is a Markdown note
					// Check if the image is within the markdown view container
					const markdownContainer = activeView.containerEl;
					const target = event.target as HTMLElement;
					if (!markdownContainer.contains(target)) return;

					const img = event.target as HTMLImageElement | HTMLVideoElement;
					const rect = img.getBoundingClientRect(); // Cache this
					const edgeSize = 30; // size of the edge in pixels

					// Throttle mousemove events
					let lastMove = 0;
					const mouseOverHandler = (event: MouseEvent) => {
						const now = Date.now();
						if (now - lastMove < 100) return; // Only execute once every 100ms
						lastMove = now;

						const x = event.clientX - rect.left;
						const y = event.clientY - rect.top;

						if ((x >= rect.width - edgeSize || x <= edgeSize) || (y >= rect.height - edgeSize || y <= edgeSize)) {
							img.style.cursor = 'nwse-resize';
							img.style.outline = 'solid';
							img.style.outlineWidth = '10px';
							img.style.outlineColor = '#dfb0f283';
						} else {
							img.style.cursor = 'default';
							img.style.outline = 'none';
						}
					};
					this.registerDomEvent(img, 'mousemove', mouseOverHandler);
				}
			)
		);

		// Reset border/outline when finished resizing
		this.register(
			this.onElement(
				document,
				"mouseout",
				"img, video",
				(event: MouseEvent) => {
					if (!this.settings.resizeByDragging) return;
					const img = event.target as HTMLImageElement | HTMLVideoElement;
					img.style.borderStyle = 'none';
					img.style.outline = 'none';
				}
			)
		);

		// Allow resizing with SHIFT + Scrollwheel
		// Fix a bug which on when hover on external images it would replace 1 image link with another
		// Sometimes it would replace image1 with image2 because there is no way to find linenumber
		// for external links. Linenumber gets shown only for internal images.
		let storedImageName: string | null = null; // get imagename for comparison
		this.register(
			this.onElement(
				document,
				"mouseover",
				"img, video",
				(event: MouseEvent) => {
					const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
					if (!activeView) return; // Ensure the active view is a Markdown note
					// Check if the image is within the markdown view container
					const markdownContainer = activeView.containerEl;
					const target = event.target as HTMLElement;
					if (!markdownContainer.contains(target)) return;
					if (event.shiftKey) { // check if the shift key is pressed
						// console.log('Shift key is pressed. Mouseover event will not fire.');
						return;
					}

					const img = event.target as HTMLImageElement | HTMLVideoElement;
					storedImageName = getImageName(img);
				}
			)
		);
		this.register(
			this.onElement(
				document,
				"wheel",
				"img, video",
				(event: WheelEvent) => {
					if (!this.settings.resizeWithShiftScrollwheel) return;
					const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
					if (!activeView) return; // Ensure the active view is a Markdown note
					// Check if the image is within the markdown view container
					const markdownContainer = activeView.containerEl;
					const target = event.target as HTMLElement;
					if (!markdownContainer.contains(target)) return;
					if (event.shiftKey) { // check if the shift key is pressed

						try {
							const img = event.target as HTMLImageElement | HTMLVideoElement;

							// get the image under the cursor
							const imageName = getImageName(img)

							// if the image under the cursor is not the same as the event target, return
							if (imageName !== storedImageName) {
								// console.log('Started scrolling over a new image');
								return;
							}

							const { newWidth, newHeight, newLeft, newTop } = resizeImageScrollWheel(event, img);
							if (img instanceof HTMLImageElement) {
								img.style.width = `${newWidth}px`;
								img.style.height = `${newHeight}px`;
								img.style.left = `${newLeft}px`;
								img.style.top = `${newTop}px`;

							} else if (img instanceof HTMLVideoElement) {
								img.style.width = `${newWidth}%`;
								// img.style.height = 'auto'; // Maintain the aspect ratio
							}


							const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
							if (activeView) {
								const imageName = getImageName(img);
								if (imageName) { // Check if imageName is not null
									if (isExternalLink(imageName)) {
										// console.log("editing external link")
										updateExternalLink(activeView, img, newWidth, newHeight);
									} else if (isBase64Image(imageName)) {
										// console.log("editing base64 image")
										resizeBase64Drag(activeView, imageName, newWidth)
									} else {
										// console.log("editing internal link")
										updateMarkdownLink(activeView, img, imageName, newWidth, newHeight);
									}
								}
							}

						} catch (error) {
							console.error('An error occurred:', error);
						}

					}
				}
			)
		);


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

	}

	async onunload() {
		// Remove event listener for contextmenu event on image elements
		// Remove the event listeners when the plugin is unloaded
		const leaves = this.app.workspace.getLeavesOfType('markdown');
		leaves.forEach(leaf => {
			const doc = leaf.view.containerEl.ownerDocument;
			doc.removeEventListener("paste", this.pasteListener);
			doc.removeEventListener("drop", this.dropListener as EventListener);
		});
		// Unload border for resizing image
		document.querySelectorAll("img").forEach((img) => {
			img.removeEventListener("mousemove", this.mouseOverHandler);
			// Reset the styles
			img.style.cursor = "default";
			img.style.outline = "none";
		});
		this.fileQueue = [];
		this.isProcessingQueue = false;
		if (this.statusBarItemEl) {
			this.statusBarItemEl.remove();
		}
	}

	// Queue
	/////////////////////////////////
	// Handle large batches of images via the queue
	// - Dynamically adjust batch sizes based on file size
	//		- Larger files = smaller batches
	// 		- Smaller files = larger batches
	// - Add delay between batches to not overload Obsidian
	// - Retry MAX=3 times for failed conversions
	// - Timeout. Prevents hanging on problematic files via timeout for extra large files, or when it takes too long to process the image
	/* ------------------------------------------------------------- */
	private async processQueue() {
		if (this.isProcessingQueue) return;
		this.isProcessingQueue = true;

		const totalImages = this.currentBatchTotal;
		this.processedInCurrentBatch = 0;
		const failedItems: string[] = [];
		const processedItems: string[] = [];

		try {
			while (this.fileQueue.length > 0) {
				const pendingItems = this.fileQueue.slice(0, this.CONCURRENT_PROCESSING_LIMIT);
				const totalSizeMB = await this.calculateTotalSize(pendingItems);
				const effectiveBatchSize = this.calculateEffectiveBatchSize(totalSizeMB);
				const itemsToProcess = pendingItems.slice(0, effectiveBatchSize);

				// Add longer delays for larger files
				// Minimum is 100ms delay
				// Maximum 2000ms = 2s
				const delayBetweenFiles = Math.min(2000, Math.max(100, totalSizeMB * 100));
				await new Promise(resolve => setTimeout(resolve, delayBetweenFiles));

				// Show progress before processing each batch
				itemsToProcess.forEach(item => {
					this.processedInCurrentBatch++;
					if (this.settings.showProgress) {
						this.showProgress(item.file.name, this.processedInCurrentBatch, totalImages);
					}
				});

				const processingPromises = itemsToProcess.map(item =>
					this.processQueueItem(item)
						.catch(error => {
							console.error(`Error processing ${item.file.name}:`, error);
							throw error; // Re-throw to be caught by Promise.allSettled
						})
				);

				const results = await Promise.allSettled(processingPromises);

				results.forEach((result, index) => {
					const item = itemsToProcess[index];
					if (result.status === 'rejected') {
						item.attempts++;

						if (item.attempts < this.MAX_ATTEMPTS) {
							this.fileQueue.push(item);
							if (this.settings.showProgress) {
								new Notice(`Retrying ${item.file.name} (Attempt ${item.attempts + 1}/${this.MAX_ATTEMPTS})`);
							}
							failedItems.push(`${item.file.name} (Retry ${item.attempts + 1}/${this.MAX_ATTEMPTS})`);
						} else {
							if (this.settings.showProgress) {
								new Notice(`Failed to process ${item.file.name} after ${this.MAX_ATTEMPTS} attempts`);
							}
							failedItems.push(`${item.file.name} (Failed after ${this.MAX_ATTEMPTS} attempts)`);
						}
					} else {
						processedItems.push(item.file.name);
					}
				});

				this.fileQueue = this.fileQueue.slice(itemsToProcess.length);
				this.updateQueueStatus();

				if (this.fileQueue.length > 0) {
					const delay = Math.min(0, Math.max(10, totalSizeMB));
					await new Promise(resolve => setTimeout(resolve, delay));
				}
			}
		} finally {
			this.isProcessingQueue = false;
			this.updateQueueStatus();

			if (this.settings.showSummary) {
				this.showSummary(processedItems, failedItems, totalImages);
				// Reset counters after showing summary
				this.currentBatchTotal = 0;
				this.processedInCurrentBatch = 0;
			}
		}
	}

	private async calculateTotalSize(items: QueueItem[]): Promise<number> {
		let totalSize = 0;
		for (const item of items) {
			const stat = await this.app.vault.adapter.stat(item.file.path);
			if (stat) {
				totalSize += stat.size / (1024 * 1024); // Convert to MB
			}
		}
		return totalSize;
	}

	private calculateEffectiveBatchSize(totalSizeMB: number): number {
		// Adjust batch size based on total size
		if (totalSizeMB > 15) return 1;  // Very large files
		if (totalSizeMB > 8) return 2;  // large files
		if (totalSizeMB > 4) return 3;  // Medium files
		return this.CONCURRENT_PROCESSING_LIMIT;  // Normal case
	}

	private async processQueueItem(item: QueueItem): Promise<void> {
		// Pre-check file existence and size
		const stat = await this.app.vault.adapter.stat(item.file.path);
		if (!stat) {
			throw new Error(`Could not get file stats for ${item.file.name}`);
		}

		const initialSizeBytes = stat.size;
		const initialSizeMB = (initialSizeBytes / (1024 * 1024)).toFixed(2);

		// Optimize timeout calculation
		const dynamicTimeout = Math.max(
			this.BASE_TIMEOUT,
			Math.min(
				60000, // Max 60 seconds
				this.BASE_TIMEOUT + (initialSizeBytes / this.SIZE_FACTOR) * this.TIMEOUT_PER_MB
			)
		);

		// Only show notice for larger files
		if (initialSizeBytes > 1024 * 1024) { // Only for files > 1MB
			// console.log(`Processing ${item.file.name} (${initialSizeMB}MB) with ${Math.round(dynamicTimeout/1000)}s timeout`);
			this.showNotice(`Processing ${item.file.name} (${initialSizeMB}MB)`, 'processing');
		}

		let timeoutId: number;

		try {
			await Promise.race([
				new Promise<void>((resolve, reject) => {
					const processFile = () => {
						this.renameFile1(item.file)
							.then(() => this.app.vault.adapter.stat(item.file.path))
							.then(finalStat => {
								if (!finalStat) {
									throw new Error(`Could not get final file stats for ${item.file.name}`);
								}
								const finalSizeBytes = finalStat.size;
								const finalSizeMB = (finalSizeBytes / (1024 * 1024)).toFixed(2);
								const compressionRatio = ((1 - (finalSizeBytes / initialSizeBytes)) * 100).toFixed(1);

								// Only show completion notice for significant compressions
								if (initialSizeBytes > 1024 * 1024 || Number(compressionRatio) > 20) {
									// console.log(`Completed ${item.file.name}: ${initialSizeMB}MB → ${finalSizeMB}MB (${compressionRatio}% reduction)`);
									this.showNotice(`Completed ${item.file.name}: ${initialSizeMB}MB → ${finalSizeMB}MB (${compressionRatio}% reduction)`, 'processing');
								}

								window.clearTimeout(timeoutId);
								resolve();
							})
							.catch(error => {
								window.clearTimeout(timeoutId);
								reject(error);
							});
					};

					processFile();
				}),
				new Promise<void>((_, reject) => {
					timeoutId = window.setTimeout(() => {
						reject(new Error(`Processing timeout after ${Math.round(dynamicTimeout / 1000)}s`));
					}, dynamicTimeout);
				})
			]);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			console.error(`Error processing ${item.file.name}: ${errorMessage}`);
			this.showNotice(`Error processing ${item.file.name}: ${errorMessage}`, 'processing');
			throw error;
		}
	}

	private updateQueueStatus() {
		if (!this.settings.showProgress) return;

		const statusText = this.fileQueue.length === 0 && !this.isProcessingQueue
			? ''
			: `Image: ${this.fileQueue.length} of ${this.currentBatchTotal} remaining${this.isProcessingQueue ? ' (Processing...)' : ''}`;

		if (this.mobileProgressEl) {
			if (statusText) {
				this.mobileProgressEl.empty();
				this.mobileProgressEl.createEl('span', { text: statusText });
				this.mobileProgressEl.addClass('show');
			} else {
				this.mobileProgressEl.removeClass('show');
			}
		}
	}
	/////////////////////////////////

	private showNotice(message: string, noticeType: 'rename' | 'processing') {
		switch (noticeType) {
			case 'rename':
				if (this.settings.autoRename && this.settings.showRenameNotice) {
					new Notice(message);
				}
				break;
			case 'processing':
				if (this.settings.showNoticeMessages) {
					new Notice(message);
				}
				break;
		}
	}

	private showProgress(fileName: string, current: number, total: number) {
		const actualTotal = this.currentBatchTotal || total;
		const progressText = `Processing ${current} of ${actualTotal}: ${fileName}`;

		if (this.mobileProgressEl) {
			this.mobileProgressEl.empty();
			this.mobileProgressEl.createEl('span', { text: progressText });
			this.mobileProgressEl.addClass('show');
		}
	}

	private showSummary(processedItems: string[], failedItems: string[], totalImages: number) {
		if (processedItems.length === 0 && failedItems.length === 0) return;

		let summaryText = `📊 Image Converter Summary\n`;
		summaryText += `Total Images detected: ${totalImages}\n`;

		if (processedItems.length > 0) {
			summaryText += `✓ Successfully processed: ${processedItems.length}\n`;
		}

		if (failedItems.length > 0) {
			summaryText += `❌ Failed: ${failedItems.length}\n`;
			summaryText += 'Failed Items:\n';
			failedItems.forEach(item => {
				summaryText += `  • ${item}\n`;
			});
		}

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


	// Work on the file
	/* ------------------------------------------------------------- */
	async renameFile1(file: TFile): Promise<void> {
		const activeFile = this.getActiveFile();
		if (!activeFile) {
			throw new Error('No active file found');
		}

		try {
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
			let newName = await this.keepOrgName(file, activeFile);
			if (this.settings.autoRename) {
				newName = await this.generateNewName(file, activeFile);
			}

			// Store original values 
			const sourcePath = activeFile.path;
			const originName = file.name;
			const linkText = this.makeLinkText(file, sourcePath);

			// 4. Create all folders before the links! And make sure they exist before dealing with links! 
			const generateNewPath = await this.createOutputFolders(newName, file, activeFile);
			const newPath = normalizePath(generateNewPath); // Normalise new path. This helps us when dealing with paths generated by variables

			// 5. Update file and document
			await this.updateFileAndDocument(file, newPath, activeFile, sourcePath, linkText);

			// Do not show renamed from -> to notice if auto-renaming is disabled 
			if (this.settings.autoRename === true) {
				this.showNotice(
					`Renamed ${decodeURIComponent(originName)} to ${decodeURIComponent(newName)}`, 'rename');
			}
		} catch (error) {
			console.error('Error processing file:', error);
			new Notice(`Failed to process ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
			throw error;
		}
	}

	private async processImage(file: TFile, binary: ArrayBuffer): Promise<Blob> {
		let imgBlob = new Blob([binary], { type: `image/${file.extension}` });

		// Handle special formats
		if (file.extension === 'tif' || file.extension === 'tiff') {
			imgBlob = await handleTiffImage(binary);
		} else if (file.extension === 'heic') {
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
		let basePath: string;

		switch (this.settings.attachmentLocation) {
			case 'disable':
				basePath = file.path.substring(0, file.path.lastIndexOf('/'));
				break;
			case 'root':
				basePath = '/';
				break;
			case 'specified':
				basePath = await this.processSubfolderVariables(
					this.settings.attachmentSpecifiedFolder,
					file,
					activeFile
				);
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

		// Ensure directory exists
		if (!(await this.app.vault.adapter.exists(basePath))) {
			await this.app.vault.createFolder(basePath);
		}

		return `${basePath}/${newName}`;
	}

	private async updateFileAndDocument(file: TFile, newPath: string, activeFile: TFile, sourcePath: string, linkText: string): Promise<void> {
		try {
			const decodedNewPath = decodeURIComponent(newPath);
			await this.app.vault.rename(file, decodedNewPath);

			let newLinkText = this.makeLinkText(file, sourcePath);

			// Add the size to the markdown link
			if (this.settings.autoNonDestructiveResize === "customSize" || this.settings.autoNonDestructiveResize === "fitImage") {
				let size;
				if (this.settings.autoNonDestructiveResize === "customSize") {
					size = this.settings.customSize;
				} else if (this.settings.autoNonDestructiveResize === "fitImage") {
					size = this.settings.customSizeLongestSide;
				}
				if (newLinkText.startsWith('![[')) {
					// This is an internal link
					newLinkText = newLinkText.replace(']]', `|${size}]]`);
				}
			}

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
			// editor.scrollIntoView({ from: { line: currentLine, ch: 0 }, to: { line: currentLine, ch: 0 } });
		} catch (err) {
			console.error('Error during file update:', err);
			new Notice(`Failed to update ${file.name}: ${err}`);
			throw err;
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
			// Use original naming scheme
			newName = activeFile.basename + '-' + moment().format("YYYYMMDDHHmmssSSS");
		}

		// Handle file extension
		let extension = file.extension;
		if (this.settings.convertTo && this.settings.convertTo !== 'disabled') {
			extension = this.settings.convertTo;
		}

		return `${newName}.${extension}`;
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
			'{pathDepth}': activeFile.path.split('/').length.toString(),
			'{directory}': activeFile.parent?.path || '',
			'{folderName}': activeFile.parent?.name || '',


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

			Object.assign(replacements, {
				'{width}': img.width.toString(),
				'{height}': img.height.toString(),
				'{ratio}': (img.width / img.height).toFixed(2),
				'{orientation}': img.width > img.height ? 'landscape' : 'portrait',
				'{resolution}': `${img.width}x${img.height}`,
				'{quality}': this.settings.quality.toString()
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
			// Use a non-regex replacement first to avoid special characters issues
			result = result.split(key).join(value);
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

	makeLinkText(file: TFile, sourcePath: string, subpath?: string): string {
		return this.app.fileManager.generateMarkdownLink(file, sourcePath, subpath);
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

	shouldProcessImage(image: TFile): boolean {
		if (this.settings.ProcessAllVaultskipImagesInTargetFormat && image.extension === this.settings.ProcessAllVaultconvertTo) {
			return false;
		}
		return true;
	}

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

	async keepOrgName(file: TFile, activeFile: TFile): Promise<string> {
		let newName = file.basename;
		let extension = file.extension;
		if (this.settings.convertTo && this.settings.convertTo !== 'disabled') {
			extension = this.settings.convertTo;
		}

		// Encode or decode special characters in the file name
		newName = encodeURIComponent(newName);

		return `${newName}.${extension}`;
	}

	private getActiveFile(): TFile | undefined {
		// Try getting from active markdown view first
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (markdownView?.file) return markdownView.file;

		// Try getting from active leaf if no markdown view
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile) return activeFile;

		// If neither exists, return undefined and handle in calling code
		return undefined;
	}

	getActiveEditor(sourcePath: string): Editor | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view && view.file && view.file.path === sourcePath) {
			return view.editor;
		}
		return null;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

function isImage(file: TFile): boolean {
	const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'tif', 'tiff', 'bmp', 'svg', 'gif', 'mov'];
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

		// Convert using heic-to
		return await heicTo({
			blob: blob,
			type: `image/${format.toLowerCase()}`,
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

function getImageName(img: HTMLImageElement | HTMLVideoElement): string | null {
	// Get the image name from an image element: `src`
	let imageName = img.getAttribute("src");

	// Check if the image name exists
	if (imageName) {
		// Check if the image is a base64 image
		if (isBase64Image(imageName)) {
			// If it's a base64 image, return the entire `src` attribute
			return imageName;
		} else if (!isExternalLink(imageName)) {
			// If it's not an external link, extract the file name
			const parts = imageName.split("/");
			const lastPart = parts.pop();
			if (lastPart) {
				imageName = lastPart.split("?")[0];
				imageName = decodeURIComponent(imageName);
			}
		}
	}
	return imageName;
}
function isExternalLink(imageName: string): boolean {
	// This is a simple check that assumes any link starting with 'http' is an external link.
	return imageName.startsWith('http');
}
function updateExternalLink(activeView: MarkdownView, img: HTMLImageElement | HTMLVideoElement, newWidth: number, newHeight: number): void {
	// Get the current link and alt text
	const currentLink = img.getAttribute("src");
	let altText = img.getAttribute("alt");
	const editor = activeView.editor;

	// Round newWidth to the nearest whole number
	const longestSide = Math.round(Math.max(newWidth, newHeight));

	if (altText) {
		altText = altText.replace(/\|\d+(\|\d+)?/g, ''); // remove any sizing info from alt text
	}

	// Construct the new markdown with the updated width
	const newMarkdown = `![${altText}|${longestSide}](${currentLink})`;

	// Get the line number of the current cursor position
	const lineNumber = editor.getCursor().line;

	// Get the content of the current line
	const lineContent = editor.getLine(lineNumber);

	// Replace the old markdown with the new one in the current line
	// If there is no sizing then add
	// If there is sizing then make sure it is the only one and there are no duplicate e.g. | size | size
	const updatedLineContent = lineContent.replace(/!\[(.*?)(\|\d+(\|\d+)?)?\]\((.*?)\)/, newMarkdown);

	// Update only the current line in the editor
	editor.replaceRange(updatedLineContent, { line: lineNumber, ch: 0 }, { line: lineNumber, ch: lineContent.length });
}
function resizeImageDrag(event: MouseEvent, img: HTMLImageElement | HTMLVideoElement, startX: number, startY: number, startWidth: number, startHeight: number) {
	const currentX = event.clientX;
	const aspectRatio = startWidth / startHeight;

	let newWidth = startWidth;
	newWidth = startWidth + (currentX - startX);
	// Ensure the image doesn't get too small
	newWidth = Math.max(newWidth, 50);


	let newHeight = newWidth / aspectRatio;

	// Round the values to the nearest whole number
	newWidth = Math.round(newWidth);
	newHeight = Math.round(newHeight);

	return { newWidth, newHeight };
}

// function isLinkInPercentage(activeView: MarkdownView, imageName: string): boolean {
//     const editor = activeView.editor;
//     const doc = editor.getDoc();
//     const lineCount = doc.lineCount();

//     // Iterate over each line in the document
//     for (let i = 0; i < lineCount; i++) {
//         const line = doc.getLine(i);

//         // Check if the line contains the image name
//         if (line.includes(imageName)) {
//             // Extract the size from the markdown link
//             const match = line.match(/!\[\[.*\|(.*)\]\]/);
//             if (match && match[1] && match[1].endsWith('%')) {
//                 return true;
//             }
//         }
//     }

//     return false;
// }

function updateMarkdownLink(activeView: MarkdownView, img: HTMLImageElement | HTMLVideoElement, imageName: string | null, newWidth: number, newHeight: number) {
	const editor = activeView.editor;
	const doc = editor.getDoc();
	const lineCount = doc.lineCount();

	// find the line containing the image's markdown link
	let lineIndex: number | undefined;
	for (let i = 0; i < lineCount; i++) {
		const line = doc.getLine(i);
		if (line.includes(`![[${imageName}`)) {
			lineIndex = i;
			break;
		}
	}

	if (lineIndex !== undefined) {
		// move cursor to the line containing the image's markdown link
		editor.setCursor({ line: lineIndex, ch: 0 });
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		// calculate the longest side of the image
		let longestSide;
		if (img instanceof HTMLImageElement) {
			const percentageIndex = line.indexOf('%', line.indexOf(`![[${imageName}`));
			if (percentageIndex !== -1 && percentageIndex < line.indexOf(']]')) {
				// If the original link contains a percentage, calculate the new width as a percentage of the original size
				newWidth = Math.round((newWidth / img.naturalWidth) * 100);
				newWidth = Math.min(newWidth, 100);
				longestSide = `${newWidth}%`;

			} else {
				// If the original link contains a pixel value, continue resizing in pixels
				longestSide = Math.round(Math.max(newWidth, newHeight));
			}
		} else if (img instanceof HTMLVideoElement) {
			// Check if the link already includes a width in percentages
			const percentageIndex = line.indexOf('%', line.indexOf(`![[${imageName}`));
			if (percentageIndex !== -1 && percentageIndex < line.indexOf(']]')) {
				// If it does, continue resizing in percentages
				newWidth = Math.min(newWidth, 100);
				longestSide = `${newWidth}%`;
			} else {
				// If it doesn't, continue resizing in pixels
				longestSide = Math.round(newWidth);
			}
		}
		// find the start and end position of the image link in the line
		const startPos = line.indexOf(`![[${imageName}`);
		const endPos = line.indexOf(']]', startPos) + 2;

		// update the size value in the image's markdown link
		if (startPos !== -1 && endPos !== -1) {
			editor.replaceRange(`![[${imageName}|${longestSide}]]`, { line: cursor.line, ch: startPos }, { line: cursor.line, ch: endPos });
		}
	}
}
function resizeBase64Drag(activeView: MarkdownView, imageName: string | null, newWidth: number) {
	// When the user starts resizing the image, find and store the line number of the image
	// Get the current line content

	const editor = activeView.editor;
	const doc = editor.getDoc();
	const lineCount = doc.lineCount();
	let imageLine: number | null = null;

	if (imageName !== null) {
		for (let i = 0; i < lineCount; i++) {
			const line = doc.getLine(i);
			if (line.includes(imageName)) {
				imageLine = i;
				break;
			}
		}
	}

	const lineNumber = imageLine;
	if (lineNumber !== null) {
		const lineContent = editor.getLine(lineNumber);
		// Construct a new width attribute
		const newWidthAttribute = `width="${newWidth}"`;

		// Replace the old img tag with the new one in the current line
		let updatedLineContent = lineContent.replace(/width="[^"]*"/, newWidthAttribute);

		// If there was no width attribute in the original tag, add it to the new tag
		if (!updatedLineContent.includes(newWidthAttribute)) {
			updatedLineContent = updatedLineContent.replace('<img ', `<img ${newWidthAttribute} `);
		}

		// Update only the current line in the editor
		editor.replaceRange(updatedLineContent, { line: lineNumber, ch: 0 }, { line: lineNumber, ch: lineContent.length });
	}
}
function deleteMarkdownLink(activeView: MarkdownView, imageName: string | null) {
	const editor = activeView.editor;
	const doc = editor.getDoc();
	const lineCount = doc.lineCount();

	// find the line containing the image's markdown link
	let lineIndex: number | undefined;
	for (let i = 0; i < lineCount; i++) {
		const line = doc.getLine(i);
		if (line.includes(`![[${imageName}`) || line.includes(`<img`) && line.includes(`src="${imageName}"`)) {
			lineIndex = i;
			break;
		}
	}

	if (lineIndex !== undefined) {
		// move cursor to the line containing the image's markdown link
		editor.setCursor({ line: lineIndex, ch: 0 });
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);

		// find the start and end position of the image link in the line
		let startPos = line.indexOf(`![[${imageName}`);
		let endPos = line.indexOf(']]', startPos) + 2;

		// if it's not a wikilink, check if it's an HTML img tag e.g.: base64 encoded image
		if (startPos === -1 || endPos === -1) {
			const imgTagRegex = /<img[^>]*src="[^"]*"[^>]*>/;
			const match = imgTagRegex.exec(line);
			if (match) {
				startPos = match.index;
				endPos = startPos + match[0].length;
			}
		}

		// delete the image's markdown link
		if (startPos !== -1 && endPos !== -1) {
			editor.replaceRange('', { line: cursor.line, ch: startPos }, { line: cursor.line, ch: endPos });
		}
	}
}
async function deleteImageFromVault(event: MouseEvent, app: App) {
	// Get the image element and its src attribute
	const img = event.target as HTMLImageElement;
	const src = img.getAttribute('src');
	if (src) {
		// Check if the src is a Base64 encoded image
		if (src.startsWith('data:image')) {
			// Handle Base64 encoded image
			// Delete the image element from the DOM
			img.parentNode?.removeChild(img);
			// Delete the link
			const activeView = app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView) {
				deleteMarkdownLink(activeView, src);
			}
			new Notice('Base64 encoded image deleted from the note');
		} else if (src.startsWith('http') || src.startsWith('https')) {
			// Handle external image link
			// Delete the image element from the DOM
			img.parentNode?.removeChild(img);
			// Delete the link
			const activeView = app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView) {
				deleteMarkdownLink(activeView, src);
			}
			new Notice('External image link deleted from the note');
		} else {
			// Delete image
			// Get Vault Name
			const rootFolder = app.vault.getName();
			const activeView = app.workspace.getActiveViewOfType(MarkdownView);

			if (activeView) {
				// Grab full path of an src, it will return full path including Drive letter etc.
				// thus we need to get rid of anything what is not part of the vault
				let imagePath = img.getAttribute('src');
				if (imagePath) {
					// Decode the URL for cases where vault name might have spaces
					imagePath = decodeURIComponent(imagePath);
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

					const file = app.vault.getAbstractFileByPath(decodedPath);
					if (file instanceof TFile && isImage(file)) {
						// Delete the image
						await app.vault.delete(file);
						// Delete the link
						deleteMarkdownLink(activeView, file.basename);
						new Notice(`Image: ${file.basename} deleted from: ${file.path}`);
					}
				}
			} else {
				// ELSE image is not in the note.
				// Grab full path of an src, it will return full path including Drive letter etc.
				// thus we need to get rid of anything what is not part of the vault
				let imagePath = img.getAttribute('src');
				if (imagePath) {
					// Decode the URL for cases where vault name might have spaces
					imagePath = decodeURIComponent(imagePath);
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

					const file = app.vault.getAbstractFileByPath(decodedPath);
					if (file instanceof TFile && isImage(file)) {
						// Delete the image
						await app.vault.delete(file);

						new Notice(`Image: ${file.basename} deleted from: ${file.path}`);
					}
				}
			}
		}
	}
}

// async function customSizeFitImageSize(){
// 	// Get the computed style of the root element
// 	const style = getComputedStyle(document.documentElement);
// 	// Get the value of the --file-line-width variable
// 	const maxWidth = style.getPropertyValue('--file-line-width');
// 	// Remove 'px' from the end and convert to a number
// 	const maxWidth = Number(maxWidth.slice(0, -2));
// 	const longestSide = this.plugin.longestSide; 

// }

// class ImageConvertTab extends PluginSettingTab {
// 	plugin: ImageConvertPlugin;
//     private previewText: TextComponent;
//     private updatePreviewDebounced: () => void;

// 	constructor(app: App, plugin: ImageConvertPlugin) {
// 		super(app, plugin);
// 		this.plugin = plugin;
// 		this.updatePreviewDebounced = debounce(this.updatePreview.bind(this), 500);
// 	}


//     async updatePreview() {
//         if (!this.previewText) return;

//         try {
//             const activeFile = this.app.workspace.getActiveFile();
//             const mockFile = activeFile || this.app.vault.getFiles()[0];
//             if (!mockFile) return;

//             let pathTemplate = '';
//             switch (this.plugin.settings.attachmentLocation) {
//                 case 'specified':
//                     pathTemplate = this.plugin.settings.attachmentSpecifiedFolder;
//                     break;
//                 case 'subfolder':
//                     pathTemplate = `${mockFile.parent?.path ?? ''}/${this.plugin.settings.attachmentSubfolderName}`;
//                     break;
//                 case 'customOutput':
//                     pathTemplate = this.plugin.settings.customOutputPath;
//                     break;
//                 default:
//                     this.previewText.setValue('Preview not available for this option');
//                     return;
//             }

//             const previewPath = await this.plugin.generatePathPreview(pathTemplate, mockFile);
//             this.previewText.setValue(previewPath);
//         } catch (error) {
//             console.error('Preview generation error:', error);
//             this.previewText.setValue('Error generating preview');
//         }
//     }

// 	display(): void {
// 		const { containerEl } = this;
// 		containerEl.empty();

// 		const heading = containerEl.createEl('h1');
// 		heading.textContent = 'Convert, compress and resize';

// 		new Setting(containerEl)
// 			.setName('Select format to convert images to')
// 			.setDesc(`Turn this on to allow image conversion and compression on drag'n'drop or paste. "Same as original" - will keep original file format.`)
// 			.addDropdown(dropdown =>
// 				dropdown
// 					.addOptions({ disabled: 'Same as original', webp: 'WebP', jpg: 'JPG', png: 'PNG' })
// 					.setValue(this.plugin.settings.convertTo)
// 					.onChange(async value => {
// 						this.plugin.settings.convertTo = value;
// 						await this.plugin.saveSettings();
// 					})
// 			);

// 		new Setting(containerEl)
// 			.setName('Quality')
// 			.setDesc('0 - low quality, 99 - high quality, 100 - no compression; 75 - recommended')
// 			.addText(text =>
// 				text
// 					.setPlaceholder('Enter quality (0-100)')
// 					.setValue((this.plugin.settings.quality * 100).toString())
// 					.onChange(async value => {
// 						const quality = parseInt(value);

// 						if (/^\d+$/.test(value) && quality >= 0 && quality <= 100) {
// 							this.plugin.settings.quality = quality / 100;
// 							await this.plugin.saveSettings();
// 						}
// 					})
// 			);

// 		new Setting(containerEl)
// 			.setName('Image resize mode')
// 			.setDesc('Select the mode to use when resizing the image. Resizing an image will further reduce file-size, but it will resize your actual file, which means that the original file will be modified, and the changes will be permanent.')
// 			.addDropdown(dropdown =>
// 				dropdown
// 					.addOptions({ None: 'None', Fit: 'Fit', Fill: 'Fill', LongestEdge: 'Longest Edge', ShortestEdge: 'Shortest Edge', Width: 'Width', Height: 'Height' })
// 					.setValue(this.plugin.settings.resizeMode)
// 					.onChange(async value => {
// 						this.plugin.settings.resizeMode = value;
// 						await this.plugin.saveSettings();

// 						if (value !== 'None') {
// 							// Open the ResizeModal when an option is selected
// 							const modal = new ResizeModal(this.plugin);
// 							modal.open();
// 						}
// 					})
// 			);

// 		new Setting(containerEl)
// 			.setName('File Renaming')
// 			.setDesc('Choose how to rename dropped/pasted images')
// 			.addDropdown(dropdown => dropdown
// 				.addOptions({
// 					'disabled': 'Keep original name',
// 					'custom': 'Custom template'
// 				})
// 				.setValue(this.plugin.settings.autoRename ? 
// 					(this.plugin.settings.useCustomRenaming ? 'custom' : 'disabled') : 
// 					'disabled')
// 				.onChange(async (value) => {
// 					this.plugin.settings.autoRename = value !== 'disabled';
// 					this.plugin.settings.useCustomRenaming = value === 'custom';
// 					await this.plugin.saveSettings();
// 					this.display();  // Refresh settings
// 				}));


// 		// Show template settings only when custom renaming is enabled
// 		if (this.plugin.settings.autoRename && this.plugin.settings.useCustomRenaming) {
// 			new Setting(containerEl)
// 				.setName('Custom Rename Template')
// 				.setDesc('Template for custom file names')
// 				.setClass('settings-indent')
// 				.addText(text => text
// 					.setPlaceholder('{imageName}-{date:YYYYMMDDHHmmssSSS}')
// 					.setValue(this.plugin.settings.customRenameTemplate)
// 					.onChange(async (value) => {
// 						this.plugin.settings.customRenameTemplate = value;
// 						await this.plugin.saveSettings();
// 					}))
// 				.addButton(button => button
// 					.setButtonText('Reset')
// 					.onClick(async () => {
// 						this.plugin.settings.customRenameTemplate = 
// 							this.plugin.settings.customRenameDefaultTemplate;
// 						await this.plugin.saveSettings();
// 						this.display();
// 					}));

// 			// Add variables documentation indented under custom template
// 			new Setting(containerEl)
// 				.setName('Available Variables')
// 				.setClass('settings-indent')
// 				.setDesc(createFragment(el => {
// 					el.createEl('p', {text: 'You can use these variables in your template:'});
// 					[
// 						'{imageName} - Original file name',
// 						'{noteName} - Active note name',

// 						'{date:YYYY-MM-DD} - Full moment.js support',

// 						'{pathDepth}',
// 						'{directory} - to be removed',
// 						'{parentFolder} - to be removed',
// 						'{folderName} - current folder name',

// 						'{currentDate} - todays date in YYYY-MM-DD',
// 						'{yyyy} - year e.g. 2024',
// 						'{mm} - month e.g.: 12',
// 						'{dd} - day e.g.: 24',
// 						'{time} - 24h format e.g.',
// 						'{HH} - hour',
// 						'{timestamp}',
// 						'{weekday} - e.g.: Monday, Tuesday, Wednesday',
// 						'{month} - e.g.: October, September, December',
// 						'{calendar} - e.g. Today at 9_25 PM',
// 						'{creationDate} - creation date',

// 						'{platform} - e.g. win32',
// 						'{userAgent}',

// 						'{counter:000} - Incremental counter with padding',
// 						'{uuid} - Random UUID',
// 						'{random} - rnadom string of characters e.g. 91c2q1, 09a5xb',
// 						'{randomHex8} - generate random HEX string 8 values long',
// 						'{randomHex16} - generate random HEX string 16 values long',

// 						'{width} - Image width',
// 						'{height} - Image height',
// 						'{resolution} - Image resolution e.g. 1980x1980',
// 						'{quality} - Conversion quality',
// 						'{fileType} - Image filetype e.g. jpg, png , tif, webp, bmp etc.',

// 						'{size:MB:2} - MB, KB, B - digit - specify decimal value',
// 						'{sizeMB} - File size in MB',
// 						'{sizeB}',
// 						'{sizeKB}',
// 						'{ratio} - image ratio',
// 						'{orientation} - e.g. portrait or landscape',

// 						// Add other variables you support
// 					].forEach(item => {
// 						el.createEl('p', {text: item});
// 					});
// 				}));
// 		}

// 		// OUTPUT
// 		// Create the dropdown
// 		new Setting(containerEl)
// 			.setName("Output")
// 			.setDesc("Select where to save converted images. Default - follow rules as defined by Obsidian in 'File & Links' > 'Default location for new attachments'")
// 			.addDropdown((dropdown) => {
// 				dropdown
// 					.addOption("disable", "Default")
// 					.addOption("root", "Root folder")
// 					.addOption("specified", "In the folder specified below")
// 					.addOption("current", "Same folder as current file")
// 					.addOption("subfolder", "In subfolder under current folder [Beta]")
// 					.addOption("customOutput", "Custom output path")
// 					.setValue(this.plugin.settings.attachmentLocation)
// 					.onChange(async (value: 'disable' | 'root' | 'specified' | 'current' | 'subfolder' | 'customOutput') => {
// 						this.plugin.settings.attachmentLocation = value;
// 						await this.plugin.saveSettings();
// 						this.display(); // Refresh the settings display
// 					});
// 			});

// 		// Add preview
// 		const addPathPreview = (containerEl: HTMLElement) => {
// 			const previewSetting = new Setting(containerEl)
// 				.setName("Preview")
// 				.setDesc("Preview of how your path will be resolved")
// 				.setClass('settings-indent');

// 			this.previewText = new TextComponent(previewSetting.controlEl)
// 				.setDisabled(true)
// 				.setValue('Loading preview...');

// 			this.updatePreview();
// 		};

// 		// Add documentation for available patterns
// 		const addVariablesDocumentation = (containerEl: HTMLElement) => {
// 			new Setting(containerEl)
// 				.setName("Available variables")
// 				.setClass('settings-indent')
// 				.setDesc(createFragment(el => {
// 					el.createEl('p', {text: 'You can use these variables in your path:'});
// 					el.createEl('p', {text: '{imageName} - Original image name'});
// 					el.createEl('p', {text: '{noteName} - Current note name'});
// 					el.createEl('p', {text: '{counter:000} - Incremental counter with padding'});
// 					el.createEl('p', {text: '{date:YYYY-MM} - Date using moment.js format'});
// 					el.createEl('p', {text: '{size:MB:2} - File size with decimal places'});
// 					el.createEl('p', {text: '{yyyy}/{mm}/{dd} - Year/Month/Day folders'});
// 					el.createEl('p', {text: '{folderName} - Current folder name'});
// 					el.createEl('p', {text: '{parentFolder} - Parent folder name'});
// 					el.createEl('a', {
// 						text: 'Click here for moment.js date formats',
// 						href: 'https://momentjs.com/docs/#/displaying/format/'
// 					});
// 				}));
// 		};

// 		// Then show the appropriate input field based on the selected option
// 		if (this.plugin.settings.attachmentLocation === "specified") {
// 			new Setting(containerEl)
// 				.setName("Path to specific folder")
// 				.setDesc('If you specify folder path as "/attachments/images" then all processed images will be saved inside "/attachments/images/" folder. If any of the folders do not exist, they will be created.')
// 				.setClass('settings-indent')
//                 .addText((text) => {
//                     text.setPlaceholder('attachments/{yyyy}/{mm}')
//                         .setValue(this.plugin.settings.attachmentSpecifiedFolder)
//                         .onChange(async (value) => {
//                             this.plugin.settings.attachmentSpecifiedFolder = value;
//                             await this.plugin.saveSettings();
//                             this.updatePreviewDebounced();
//                         });
//                 });
// 			addPathPreview(containerEl);
// 			addVariablesDocumentation(containerEl);
// 		}

// 		if (this.plugin.settings.attachmentLocation === "subfolder") {
// 			new Setting(containerEl)
// 				.setName("Subfolder name")
// 				.setDesc('Name of the subfolder to create under the current note\'s folder')
// 				.setClass('settings-indent')
//                 .addText((text) => {
//                     text.setPlaceholder('images/{yyyy}/{mm}')
//                         .setValue(this.plugin.settings.attachmentSubfolderName)
//                         .onChange(async (value) => {
//                             this.plugin.settings.attachmentSubfolderName = value;
//                             await this.plugin.saveSettings();
//                             this.updatePreviewDebounced();
//                         });
//                 });
// 			addPathPreview(containerEl);
// 			addVariablesDocumentation(containerEl);
// 		}

//         if (this.plugin.settings.attachmentLocation === "customOutput") {
//             new Setting(containerEl)
//                 .setName("Custom output path")
//                 .setDesc('Create your own path using variables')
//                 .setClass('settings-indent')
//                 .addText((text) => {
//                     text.setPlaceholder('assets/{yyyy}/{mm}/{imageName}')
//                         .setValue(this.plugin.settings.customOutputPath)
//                         .onChange(async (value) => {
//                             this.plugin.settings.customOutputPath = value;
//                             await this.plugin.saveSettings();
//                             this.updatePreviewDebounced();
//                         });
//                 });

//             addPathPreview(containerEl);
//             addVariablesDocumentation(containerEl);
//         }


// 		/////////////////////////////////////////////

// 		const heading2 = containerEl.createEl("h2");
// 		heading2.textContent = "Non-Destructive Image Resizing:";
// 		const p = containerEl.createEl("p");
// 		p.textContent = 'Below settings allow you to adjust image dimensions using the standard ObsidianMD method by modifying image links. For instance, to change the width of ![[Engelbart.jpg]], we add "| 100" at the end, resulting in ![[Engelbart.jpg | 100]].';
// 		p.style.fontSize = "12px";

// 		/////////////////////////////////////////////
// 		// Create a function to update the custom size setting
// 		// Update function to handle "Fit Image" option
// 		const updateCustomSizeSetting = async (value: string) => {
// 			if (value === "customSize") {
// 				// If "customSize" is selected, show the "Custom size" field
// 				customSizeSetting.settingEl.style.display = 'flex';
// 			} else if (value === "fitImage") {
// 				// If "fitImage" is selected, calculate the size based on the max width of the notes editor and longest side of an image
// 				// const maxWidth = getEditorMaxWidth();
// 				// const longestSide = this.plugin.longestSide; 
// 				// if (longestSide !== null) {  // Check if longestSide is not null before using it
// 				//     this.plugin.settings.customSizeLongestSide = Math.min(maxWidth, longestSide).toString();
// 				// 	await this.plugin.saveSettings();
// 				// }
// 				customSizeSetting.settingEl.style.display = 'none';
// 			} else {
// 				// If neither "customSize" nor "fitImage" is selected, hide the "Custom size" field
// 				customSizeSetting.settingEl.style.display = 'none';
// 			}
// 		};
// 		// Function to get the max width of the notes editor
// 		// const getEditorMaxWidth = () => {
// 		// 	// Get the computed style of the root element
// 		// 	const style = getComputedStyle(document.documentElement);
// 		// 	// Get the value of the --file-line-width variable
// 		// 	const maxWidth = style.getPropertyValue('--file-line-width');
// 		// 	// Remove 'px' from the end and convert to a number
// 		// 	return Number(maxWidth.slice(0, -2));
// 		// };

// 		// Add "Fit Image" option to the dropdown
// 		new Setting(containerEl)
// 			.setName("Non-destructive resize:")
// 			.setDesc(`Automatically apply "|size" to dropped/pasted images.`)
// 			.addDropdown((dropdown) =>
// 				dropdown
// 					.addOptions({ disabled: "None", fitImage: "Fit Image", customSize: "Custom", }) // Add "Fit Image" option
// 					.setValue(this.plugin.settings.autoNonDestructiveResize)
// 					.onChange(async (value) => {
// 						this.plugin.settings.autoNonDestructiveResize = value;
// 						await this.plugin.saveSettings();
// 						updateCustomSizeSetting(value);
// 					})
// 			);


// 		const customSizeSetting = new Setting(containerEl)
// 			.setName('Custom Size:')
// 			.setDesc(`Specify the default size which should be applied on all dropped/pasted images. For example, if you specify custom size as "250" then when you drop or paste an "image.jpg" it would become ![[image.jpg|250]]`)
// 			.addText((text) => {
// 				text.setValue(this.plugin.settings.customSize.toString());
// 				text.onChange(async (value) => {
// 					this.plugin.settings.customSize = value;
// 					await this.plugin.saveSettings();
// 				});
// 			});

// 		// Initially hide the custom size setting
// 		updateCustomSizeSetting(this.plugin.settings.autoNonDestructiveResize);


// 		/////////////////////////////////////////////

// 		new Setting(containerEl)
// 			.setName('Resize by dragging edge of an image')
// 			.setDesc('Turn this on to allow resizing images by dragging the edge of an image.')
// 			.addToggle(toggle =>
// 				toggle
// 					.setValue(this.plugin.settings.resizeByDragging)
// 					.onChange(async value => {
// 						this.plugin.settings.resizeByDragging = value;
// 						await this.plugin.saveSettings();
// 					})
// 			);

// 		new Setting(containerEl)
// 			.setName('Resize with Shift + Scrollwheel')
// 			.setDesc('Toggle this setting to allow resizing images using the Shift key combined with the scroll wheel.')
// 			.addToggle(toggle =>
// 				toggle
// 					.setValue(this.plugin.settings.resizeWithShiftScrollwheel)
// 					.onChange(async value => {
// 						this.plugin.settings.resizeWithShiftScrollwheel = value;
// 						await this.plugin.saveSettings();
// 					})
// 			);

// 		/////////////////////////////////////////////
// 		/////////////////////////////////////////////

// 		const heading2_other = containerEl.createEl("h2");
// 		heading2_other.textContent = "Other";

// 		p.style.fontSize = "12px";
// 		new Setting(containerEl)
// 			.setName('Right-click context menu')
// 			.setDesc('Toggle to enable or disable right-click context menu')
// 			.addToggle(toggle =>
// 				toggle
// 					.setValue(this.plugin.settings.rightClickContextMenu)
// 					.onChange(async value => {
// 						this.plugin.settings.rightClickContextMenu = value;
// 						await this.plugin.saveSettings();
// 					})
// 			);

// 		new Setting(containerEl)
//             .setName('Remember scroll position')
//             .setDesc('Toggle ON to remember the scroll position when processing images. Toggle OFF to automatically scroll to the last image')
//             .addToggle(toggle => toggle
//                 .setValue(this.plugin.settings.rememberScrollPosition)
//                 .onChange(async (value) => {
//                     this.plugin.settings.rememberScrollPosition = value;
//                     await this.plugin.saveSettings();
//                 }));

//         new Setting(containerEl)
//             .setName('Cursor position')
//             .setDesc('Choose the cursor position after processing the image. Front or back of the link.')
//             .addDropdown(dropdown => dropdown
//                 .addOption('front', 'Front')
//                 .addOption('back', 'Back')
//                 .setValue(this.plugin.settings.cursorPosition)
//                 .onChange(async (value) => {
//                     this.plugin.settings.cursorPosition = value as 'front' | 'back';
//                     await this.plugin.saveSettings();
//                 }));


// 		new Setting(containerEl)
// 			.setName('Notification: compression')
// 			.setDesc('Show file size before and after compression')
// 			.addToggle(toggle => toggle
// 				.setValue(this.plugin.settings.showNoticeMessages)
// 				.onChange(async (value) => {
// 					this.plugin.settings.showNoticeMessages = value;
// 					await this.plugin.saveSettings();
// 				}));

// 		new Setting(containerEl)
// 			.setName('Notification: progress')
// 			.setDesc('Show processing status report when multiple images were detected e.g.: When enabled it will show "Processing 1 of 20" ')
// 			.addToggle(toggle => toggle
// 				.setValue(this.plugin.settings.showProgress)
// 				.onChange(async (value) => {
// 					this.plugin.settings.showProgress = value;
// 					await this.plugin.saveSettings();
// 				}));

// 		new Setting(containerEl)
// 			.setName('Notification: summary')
// 			.setDesc('Show summary after processing completes')
// 			.addToggle(toggle => toggle
// 				.setValue(this.plugin.settings.showSummary)
// 				.onChange(async (value) => {
// 					this.plugin.settings.showSummary = value;
// 					await this.plugin.saveSettings();
// 				}));

// 		new Setting(containerEl)
// 			.setName('Notification: rename')
// 			.setDesc('Show notifiction when files are renamed')
// 			.setClass('settings-indent') 
// 			.addToggle(toggle =>
// 				toggle
// 					.setValue(this.plugin.settings.showRenameNotice)
// 					.onChange(async value => {
// 						this.plugin.settings.showRenameNotice = value;
// 						await this.plugin.saveSettings();
// 					})
// 			);
// 		/////////////////////////////////////////////

// 		const heading2_queue = containerEl.createEl("h2");
// 		heading2_queue.textContent = "Advanced:";
// 		const p_queue = containerEl.createEl("p");
// 		p_queue.textContent = 'Below settings allow you to specify how long Obsidian should wait before timing-out the image processing.\
// 								E.g.: when file is extra large 100MB+ it might freeze Obsidian - Image Converter will try to do the \
// 								best it can to process it - however if it takes too long it wil stop';
// 		p_queue.style.fontSize = "12px";

// 		new Setting(containerEl)
// 			.setName('Base timeout (seconds)')
// 			.setDesc('Base processing timeout for all images.')
// 			.addText(text => text
// 				.setValue((this.plugin.settings.baseTimeout / 1000).toString())
// 				.onChange(async (value) => {
// 					this.plugin.settings.baseTimeout = parseInt(value) * 1000;
// 					await this.plugin.saveSettings();
// 				}));

// 		new Setting(containerEl)
// 			.setName('Additional timeout per MB')
// 			.setDesc('Additional processing time (in seconds) per MB of file size')
// 			.addText(text => text
// 				.setValue((this.plugin.settings.timeoutPerMB / 1000).toString())
// 				.onChange(async (value) => {
// 					this.plugin.settings.timeoutPerMB = parseInt(value) * 1000;
// 					await this.plugin.saveSettings();
// 				}));

// 	}
// }



export class ImageConvertTab extends PluginSettingTab {
	plugin: ImageConvertPlugin;
	private previewText: TextComponent;
	// private updatePreviewDebounced: () => void;
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
		// this.updatePreviewDebounced = debounce(this.updatePreview.bind(this), 500);
	}

	async updatePreview() {
		if (!this.previewText) return;

		try {
			const activeFile = this.app.workspace.getActiveFile();
			const mockFile = activeFile || this.app.vault.getFiles()[0];
			if (!mockFile) return;

			let pathTemplate = '';
			switch (this.plugin.settings.attachmentLocation) {
				case 'specified':
					pathTemplate = this.plugin.settings.attachmentSpecifiedFolder;
					break;
				case 'subfolder':
					pathTemplate = `${mockFile.parent?.path ?? ''}/${this.plugin.settings.attachmentSubfolderName}`;
					break;
				case 'customOutput':
					pathTemplate = this.plugin.settings.customOutputPath;
					break;
				default:
					this.previewText.setValue('Preview not available for this option');
					return;
			}

			const previewPath = await this.plugin.generatePathPreview(pathTemplate, mockFile);
			this.previewText.setValue(previewPath);
		} catch (error) {
			console.error('Preview generation error:', error);
			this.previewText.setValue('Error generating preview');
		}
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
		const container = this.contentContainer.createDiv('settings-container');

		// Output Location Setting
		new Setting(container)
			.setName("Output Location")
			.setDesc("Select where to save converted images. Default - follow rules as defined by Obsidian in 'File & Links' > 'Default location for new attachments'")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("disable", "Default")
					.addOption("root", "Root folder")
					.addOption("specified", "In specified folder")
					.addOption("current", "Same folder as current file")
					.addOption("subfolder", "In subfolder")
					.addOption("customOutput", "Custom output path")
					.setValue(this.plugin.settings.attachmentLocation)
					.onChange(async (value: 'disable' | 'root' | 'specified' | 'current' | 'subfolder' | 'customOutput') => {
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

		// Create preview element first
		this.previewEl = container.createDiv('preview-container');



		// Initialize settings
		this.updateFolderSettings();
		this.updateFilenameSettings();
		this.updateConsolidatedPreview();
	}

	// Helper methods for conditional settings
	private createSpecifiedFolderSettings(container: HTMLElement): void {
		new Setting(container)
			.setName("Path to specific folder:")
			.setDesc('If you specify folder path as "/attacments/images" then all processed images will be saved inside "/attacments/images" folder. If any of the folders do not exist, they will be created.')
			.setClass('settings-indent')
			.addText((text) => {
				text.setPlaceholder('attachments/{yyyy}/{mm}')
					.setValue(this.plugin.settings.attachmentSpecifiedFolder)
					.onChange(async (value) => {
						this.plugin.settings.attachmentSpecifiedFolder = value;
						await this.plugin.saveSettings();
						this.updateConsolidatedPreview(); 
					});
			});
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

	private updateFolderSettings(): void {
		this.folderSettingsContainer.empty();

		switch (this.plugin.settings.attachmentLocation) {
			case "specified":
				this.createSpecifiedFolderSettings(this.folderSettingsContainer);
				break;
			case "subfolder":
				this.createSubfolderSettings(this.folderSettingsContainer);
				break;
			case "customOutput":
				this.createCustomOutputSettings(this.folderSettingsContainer);
				break;
		}
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
				case 'specified':
					pathTemplate = this.plugin.settings.attachmentSpecifiedFolder;
					break;
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
					pathTemplate = 'Using default location';
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
			this.plugin.settings.attachmentLocation === 'specified' ||
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
				'{pathDepth} - Folder depth number'
			],
	
			'Date & Time Variables': [
				'{date:YYYY-MM-DD} - Custom date format (supports moment.js patterns)',
				'{yyyy} - Current year',
				'{mm} - Current month',
				'{dd} - Current day',
				'{time} - Current time (HH-mm-ss)',
				'{HH} - Current hour',
				'{timestamp} - Unix timestamp',
				'{weekday} - Day of week',
				'{month} - Month name',
				'{calendar} - Natural language date'
			],
	
			'Image Properties': [
				'{width} - Image width in pixels',
				'{height} - Image height in pixels',
				'{ratio} - Width/height ratio',
				'{resolution} - Full resolution (e.g., 1920x1080)',
				'{orientation} - landscape or portrait',
				'{quality} - Current conversion quality'
			],
	
			'Size Variables': [
				'{size:MB:2} - Size in MB with 2 decimal places',
				'{size:KB:1} - Size in KB with 1 decimal place',
				'{size:B:0} - Size in bytes with no decimals',
				'{sizeMB} - Size in MB',
				'{sizeKB} - Size in KB',
				'{sizeB} - Size in bytes'
			],
	
			'Unique Identifiers': [
				'{MD5:filename} - MD5 hash of filename',
				'{MD5:filename:8} - First 8 chars of filename MD5 hash',
				'{MD5:path} - MD5 hash of file path',
				'{MD5:fullpath} - MD5 hash of complete path',
				'{MD5:parentfolder} - MD5 hash of parent folder name',
				'{MD5:notename} - MD5 hash of current note name',
				'{randomHex:6} - Random hex string of specified length',
				'{counter:000} - Incremental counter with padding',
				'{random} - Random alphanumeric string',
				'{uuid} - Random UUID'
			],
	
			'System Information': [
				'{platform} - Operating system platform',
				'{userAgent} - Browser user agent'
			]
		};
	
		// Modify the `addVariablesHelper` method to use these categories
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
					text.setPlaceholder('{originalName}-{date}')
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
			.setName('Shift + Scrollwheel resize')
			.setDesc('Allow resizing with Shift + Scrollwheel')
			.addToggle(toggle =>
				toggle
					.setValue(this.plugin.settings.resizeWithShiftScrollwheel)
					.onChange(async value => {
						this.plugin.settings.resizeWithShiftScrollwheel = value;
						await this.plugin.saveSettings();
					})
			);
			// Editor Behavior Group
			settingsContainer.createEl('h3', { text: 'Editor Behavior' });
	
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
	
			// Notifications Group
			settingsContainer.createEl('h3', { text: 'Notifications' });
			
			new Setting(settingsContainer)
				.setName('Show compression notification')
				.setDesc('Show file size before and after compression')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.showNoticeMessages)
					.onChange(async (value) => {
						this.plugin.settings.showNoticeMessages = value;
						await this.plugin.saveSettings();
					}));
	
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

// function debounce<T extends (...args: any[]) => any>(
// 	func: T,
// 	wait: number
// ): (...args: Parameters<T>) => void {
// 	let timeout: NodeJS.Timeout;
// 	return (...args: Parameters<T>) => {
// 		const later = () => {
// 			clearTimeout(timeout);
// 			func(...args);
// 		};
// 		clearTimeout(timeout);
// 		timeout = setTimeout(later, wait);
// 	};
// }

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

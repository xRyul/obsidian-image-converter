import { App, MarkdownView, Notice, Plugin, TFile, PluginSettingTab, Setting, Editor, Modal, TextComponent, ButtonComponent, Menu, MenuItem } from 'obsidian';
import { Platform } from 'obsidian';
import UTIF from './UTIF.js';
import moment from 'moment';
// import exifr from 'exifr'
import probe from 'probe-image-size';

// Import heic-convert only on Desktop
let heic: any;
if (!Platform.isMobile) {
	import('heic-convert').then(module => {
		heic = module.default;
	});
}

interface Listener {
	(this: Document, ev: Event): any;
}

interface ImageConvertSettings {
	autoRename: boolean;
	convertToWEBP: boolean;
	convertToJPG: boolean;
	convertToPNG: boolean;
	convertTo: string;
	quality: number;
	ProcessAllVaultconvertTo: string;
	ProcessAllVaultquality: number;
	ProcessAllVaultResizeModalresizeMode: string;
	ProcessAllVaultResizeModaldesiredWidth: number;
	ProcessAllVaultResizeModaldesiredHeight: number;
	ProcessAllVaultResizeModaldesiredLength: number;
	ProcessCurrentNoteconvertTo: string;
	ProcessCurrentNotequality: number;
	ProcessCurrentNoteResizeModalresizeMode: string;
	ProcessCurrentNoteresizeModaldesiredWidth: number;
	ProcessCurrentNoteresizeModaldesiredHeight: number;
	ProcessCurrentNoteresizeModaldesiredLength: number;
	attachmentLocation: string;
	attachmentSpecifiedFolder: string;
	attachmentSubfolderName: string;
	resizeMode: string;
	renameFormat: string;
	autoNonDestructiveResize: string,
	customSize: string,
	customSizeLongestSide: string,
	desiredWidth: number;
	desiredHeight: number;
	desiredLength: number;
	resizeByDragging: boolean;
	resizeWithShiftScrollwheel: boolean;
	rightClickContextMenu: boolean;
}

const DEFAULT_SETTINGS: ImageConvertSettings = {
	autoRename: true,
	convertToWEBP: true,
	convertToJPG: false,
	convertToPNG: false,
	convertTo: 'webp',
	quality: 0.75,
	ProcessAllVaultconvertTo: 'webp',
	ProcessAllVaultquality: 0.75,
	ProcessAllVaultResizeModalresizeMode: 'None',
	ProcessAllVaultResizeModaldesiredWidth: 600,
	ProcessAllVaultResizeModaldesiredHeight: 800,
	ProcessAllVaultResizeModaldesiredLength: 800,
	ProcessCurrentNoteconvertTo: 'webp',
	ProcessCurrentNotequality: 0.75,
	ProcessCurrentNoteResizeModalresizeMode: 'None',
	ProcessCurrentNoteresizeModaldesiredWidth: 600,
	ProcessCurrentNoteresizeModaldesiredHeight: 800,
	ProcessCurrentNoteresizeModaldesiredLength: 800,
	attachmentLocation: 'disable',
	attachmentSpecifiedFolder: '',
	attachmentSubfolderName: '',
	resizeMode: 'None',
	renameFormat: 'date',
	autoNonDestructiveResize: "disabled",
	customSize: "",
	customSizeLongestSide: "",
	desiredWidth: 600,
	desiredHeight: 800,
	desiredLength: 800,
	resizeByDragging: true,
	resizeWithShiftScrollwheel: true,
	rightClickContextMenu: true
}

export default class ImageConvertPLugin extends Plugin {
	settings: ImageConvertSettings;
	longestSide: number | null = null;
	widthSide: number | null = null;

	// Declare the properties
	pasteListener: (event: ClipboardEvent) => void;
	dropListener: () => void;
	mouseOverHandler: (event: MouseEvent) => void;
	fileQueue: TFile[] = [];
	isProcessingQueue = false;

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
			setTimeout(() => userAction = false, 10000);
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
		};

		this.dropListener = () => {
			userAction = true;
			setTimeout(() => userAction = false, 10000);
		};

		this.app.workspace.onLayoutReady(() => {
			document.addEventListener("paste", this.pasteListener);
			document.addEventListener('drop', this.dropListener);
			this.registerEvent(
				this.app.vault.on('create', (file: TFile) => {
					if (!(file instanceof TFile)) return;
					if (isImage(file) && userAction) {
						this.fileQueue.push(file);
						this.processQueue();
					}
					// userAction = false; // uncommented to allow multi-drop
				})
			);
		})




		// Check if edge of an image was clicked upon
		this.register(
			this.onElement(
				document,
				"mousedown",
				"img, video",
				(event: MouseEvent) => {
					if (!this.settings.resizeByDragging) return;

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
								img.style.borderColor = 'blue';
								img.style.boxSizing = 'border-box';
								img.style.width = `${newWidth}px`;
								img.style.height = `${newHeight}px`;
							} else if (img instanceof HTMLVideoElement) {
								img.style.border = 'solid';
								img.style.borderWidth = '2px';
								img.style.borderColor = 'blue';
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
						};
						document.addEventListener("mousemove", onMouseMove);
						document.addEventListener("mouseup", onMouseUp);
					}
				}
			)
		);

		// Create handle to resize image by dragging the edge of an image
		this.register(
			this.onElement(
				document,
				"mouseover",
				"img, video",
				(event: MouseEvent) => {
					if (!this.settings.resizeByDragging) return;
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
		document.removeEventListener('paste', this.pasteListener);
		document.removeEventListener('drop', this.dropListener);
		// Unload border for resizing image
		document.querySelectorAll("img").forEach((img) => {
			img.removeEventListener("mousemove", this.mouseOverHandler);
			// Reset the styles
			img.style.cursor = "default";
			img.style.outline = "none";
		});
	}

	async processQueue() {
		if (this.isProcessingQueue) return;
		this.isProcessingQueue = true;
		while (this.fileQueue.length > 0) {
			const file = this.fileQueue.shift();
			if (!(file instanceof TFile)) return;
			if (isImage(file)) {
				await this.renameFile1(file);
			}

		}
		this.isProcessingQueue = false;
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
						img.onload = async function() {
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
						img.onload = async function() {
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

	async renameFile1(file: TFile) { // 1 added to the naming to differentitate from defualt obsidian renameFile func
		const activeFile = this.getActiveFile();

		if (!activeFile) {
			new Notice('Error: No active file found.');
			return;
		}

		// Start the conversion and show the status indicator
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText(`Converting image... ⏳`);

		// Image as a blob
		const binary = await this.app.vault.readBinary(file);
		let imgBlob = new Blob([binary], { type: `image/${file.extension}` });
		// Get metadata
		// await getEXIF(file);

		if (this.settings.autoNonDestructiveResize === "customSize" || this.settings.autoNonDestructiveResize === "fitImage") {
			this.widthSide = await getImageWidthSide(binary);
			const maxWidth = printEditorLineWidth(this.app);
			if (this.widthSide !== null && typeof maxWidth === 'number') {
				this.settings.customSizeLongestSide = (this.widthSide < maxWidth ? this.widthSide : maxWidth).toString();
				await this.saveSettings();
			}
		}


		if (file.extension === 'tif' || file.extension === 'tiff') {

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
			imgBlob = await new Promise<Blob>((resolve, reject) => {
				canvas.toBlob((blob) => {
					if (blob) {
						resolve(blob);
					} else {
						reject(new Error('Failed to convert canvas to Blob'));
					}
				});
			});

		}

		if (file.extension === 'heic') {
			// Convert ArrayBuffer to Buffer
			const binaryBuffer = Buffer.from(binary);

			// If convertTo is not 'disabled', convert HEIC
			if (this.settings.convertTo !== 'disabled') {
				const outputBuffer = await heic({
					buffer: binaryBuffer,
					format: 'JPEG',
					quality: 1
				});

				imgBlob = new Blob([outputBuffer], { type: 'image/jpeg' });

				if (this.settings.convertTo === 'webp') {
					const arrayBufferWebP = await convertToWebP(
						imgBlob,
						Number(this.settings.quality),
						this.settings.resizeMode,
						this.settings.desiredWidth,
						this.settings.desiredHeight,
						this.settings.desiredLength
					);
					await this.app.vault.modifyBinary(file, arrayBufferWebP);
				} else if (this.settings.convertTo === 'jpg') {
					const arrayBufferJPG = await convertToJPG(
						imgBlob,
						Number(this.settings.quality),
						this.settings.resizeMode,
						this.settings.desiredWidth,
						this.settings.desiredHeight,
						this.settings.desiredLength
					);
					await this.app.vault.modifyBinary(file, arrayBufferJPG);
				} else if (this.settings.convertTo === 'png') {
					const arrayBufferPNG = await convertToPNG(
						imgBlob,
						Number(this.settings.quality),
						this.settings.resizeMode,
						this.settings.desiredWidth,
						this.settings.desiredHeight,
						this.settings.desiredLength
					);
					await this.app.vault.modifyBinary(file, arrayBufferPNG);
				} else {
					new Notice('Error: No format selected for conversion.');
					return;
				}
			} else {
				// Bypass conversion and compression, keep original file
				new Notice('Original file kept without any compression or conversion.');
			}
		}


		if (this.settings.quality !== 1) { // If quality is set to 100, then simply use original image without compression
			if (this.settings.convertTo === 'webp') {
				const arrayBufferWebP = await convertToWebP(
					imgBlob,
					Number(this.settings.quality),
					this.settings.resizeMode,
					this.settings.desiredWidth,
					this.settings.desiredHeight,
					this.settings.desiredLength
				);
				await this.app.vault.modifyBinary(file, arrayBufferWebP);
			} else if (this.settings.convertTo === 'jpg') {
				const arrayBufferJPG = await convertToJPG(
					imgBlob,
					Number(this.settings.quality),
					this.settings.resizeMode,
					this.settings.desiredWidth,
					this.settings.desiredHeight,
					this.settings.desiredLength
				);
				await this.app.vault.modifyBinary(file, arrayBufferJPG);
			} else if (this.settings.convertTo === 'png') {
				const arrayBufferPNG = await convertToPNG(
					imgBlob,
					Number(this.settings.quality),
					this.settings.resizeMode,
					this.settings.desiredWidth,
					this.settings.desiredHeight,
					this.settings.desiredLength
				);
				await this.app.vault.modifyBinary(file, arrayBufferPNG);
			} else if (this.settings.convertTo === 'disabled') {
				// Recognize the dropped image's extension and apply compression
				let arrayBuffer;
				if (file.extension === 'jpg' || file.extension === 'jpeg') {
					arrayBuffer = await convertToJPG(
						imgBlob,
						Number(this.settings.quality),
						this.settings.resizeMode,
						this.settings.desiredWidth,
						this.settings.desiredHeight,
						this.settings.desiredLength
					);
				} else if (file.extension === 'png') {
					arrayBuffer = await convertToPNG(
						imgBlob,
						Number(this.settings.quality),
						this.settings.resizeMode,
						this.settings.desiredWidth,
						this.settings.desiredHeight,
						this.settings.desiredLength
					);
				} else if (file.extension === 'webp') {
					arrayBuffer = await convertToWebP(
						imgBlob,
						Number(this.settings.quality),
						this.settings.resizeMode,
						this.settings.desiredWidth,
						this.settings.desiredHeight,
						this.settings.desiredLength
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
		} else {
			// Bypass conversion and compression, keep original file
			new Notice('Original file kept without any compression.');
		}

		let newName = await this.keepOrgName(file, activeFile);
		if (this.settings.autoRename) {
			newName = await this.generateNewName(file, activeFile);
		}
		const sourcePath = activeFile.path;

		let newPath = '';
		const getFilename = file.path;
		// console.log(this.app.vault.getConfig("attachmentFolderPath"))
		switch (this.settings.attachmentLocation) {
			case 'disable':
				newPath = getFilename.substring(0, getFilename.lastIndexOf('/'));
				break;
			case 'root':
				newPath = '/';
				break;

			case 'specified':
				newPath = this.settings.attachmentSpecifiedFolder;
				break;

			case 'current':
				newPath = activeFile.path.substring(0, activeFile.path.lastIndexOf('/'));
				break;

			case 'subfolder':
				newPath = activeFile.path.substring(0, activeFile.path.lastIndexOf('/')) + '/' + this.settings.attachmentSubfolderName;
				break;
			default:
				newPath = '/';
				break;
		}

		// Check if the folder exists and create it if it doesn't
		if (!(await this.app.vault.adapter.exists(newPath))) {
			await this.app.vault.createFolder(newPath);
		}

		const originName = file.name;

		statusBarItemEl.setText('Image converted ✅');
		new Notice(`Image: ${decodeURIComponent(originName)} converted`);
		statusBarItemEl.setText('');

		const linkText = this.makeLinkText(file, sourcePath);
		newPath = `${newPath}/${newName}`;

		try {
			const decodedNewPath = decodeURIComponent(newPath);
			await this.app.vault.rename(file, decodedNewPath);
		} catch (err) {
			new Notice(`Failed to rename ${decodeURIComponent(newName)}: ${err}`);
			throw err;
		}

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
			// else if (newLinkText.startsWith('![')) {
			//   // This is an external link
			//   newLinkText = newLinkText.replace(']', `|${size}]`);
			// }
		}


		const editor = this.getActiveEditor(sourcePath);
		if (!editor) {
			new Notice(`Failed to rename ${newName}: no active editor`);
			return;
		}
		const cursor = editor.getCursor();


		// Multi-drop-rename
		const currentLine = cursor.line;
		function escapeRegExp(string: string) {
			return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& 表示整个匹配的字符串
		}
		const findText = escapeRegExp(linkText);
		const replaceText = newLinkText;
		const docContent = editor.getValue();
		const regex = new RegExp(findText, 'g');
		const newContent = docContent.replace(regex, replaceText);
		editor.setValue(newContent);
		editor.setCursor({ line: currentLine, ch: 0 });
		// Ensure the current line is in a visible position
		editor.scrollIntoView({ from: { line: currentLine, ch: 0 }, to: { line: currentLine, ch: 0 } });


		// Do not show renamed from -> to notice if auto-renaming is disabled 
		if (this.settings.autoRename === true) {
			new Notice(`Renamed ${decodeURIComponent(originName)} to ${decodeURIComponent(newName)}`);
		}
	}


	//Process All Vault
	async processAllVaultImages() {
		const getallfiles = this.app.vault.getFiles();
		const files = getallfiles.filter(file => file instanceof TFile && isImage(file));
		let imageCount = 0;

		// Create a status bar item
		const statusBarItemEl = this.addStatusBarItem();

		// Record the start time
		const startTime = Date.now();

		for (const file of files) {
			if (isImage(file)) {
				imageCount++;
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

		if (file.extension === 'tif' || file.extension === 'tiff') {
			const binaryUint8Array = new Uint8Array(binary);
			const ifds = UTIF.decode(binaryUint8Array);
			UTIF.decodeImage(binaryUint8Array, ifds[0]);
			const rgba = UTIF.toRGBA8(ifds[0]);
			const canvas = document.createElement('canvas');
			canvas.width = ifds[0].width;
			canvas.height = ifds[0].height;
			const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
			const imageData = ctx.createImageData(canvas.width, canvas.height);
			imageData.data.set(rgba);
			ctx.putImageData(imageData, 0, 0);

			imgBlob = await new Promise<Blob>((resolve, reject) => {
				canvas.toBlob((blob) => {
					if (blob) {
						resolve(blob);
					} else {
						reject(new Error('Failed to convert canvas to Blob'));
					}
				});
			});

		}

		if (file.extension === 'heic') {
			const binaryBuffer = Buffer.from(binary);
			const outputBuffer = await heic({
				buffer: binaryBuffer,
				format: 'JPEG',
				quality: Number(this.settings.ProcessAllVaultquality)
			});
			imgBlob = new Blob([outputBuffer], { type: 'image/jpeg' });
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

	//Process Current Note
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

		if (file.extension === 'tif' || file.extension === 'tiff') {
			const binaryUint8Array = new Uint8Array(binary);
			const ifds = UTIF.decode(binaryUint8Array);
			UTIF.decodeImage(binaryUint8Array, ifds[0]);
			const rgba = UTIF.toRGBA8(ifds[0]);
			const canvas = document.createElement('canvas');
			canvas.width = ifds[0].width;
			canvas.height = ifds[0].height;
			const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
			const imageData = ctx.createImageData(canvas.width, canvas.height);
			imageData.data.set(rgba);
			ctx.putImageData(imageData, 0, 0);

			imgBlob = await new Promise<Blob>((resolve, reject) => {
				canvas.toBlob((blob) => {
					if (blob) {
						resolve(blob);
					} else {
						reject(new Error('Failed to convert canvas to Blob'));
					}
				});
			});

		}

		if (file.extension === 'heic') {
			const binaryBuffer = Buffer.from(binary);
			const outputBuffer = await heic({
				buffer: binaryBuffer,
				format: 'JPEG',
				quality: Number(this.settings.ProcessCurrentNotequality)
			});
			imgBlob = new Blob([outputBuffer], { type: 'image/jpeg' });
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


	generateRandomHex(size: number) {
		const array = new Uint8Array(size);
		window.crypto.getRandomValues(array);
		return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
	}

	makeLinkText(file: TFile, sourcePath: string, subpath?: string): string {
		return this.app.fileManager.generateMarkdownLink(file, sourcePath, subpath);
	}
	async generateNewName(file: TFile, activeFile: TFile): Promise<string> {
		const newName = this.settings.renameFormat == "date" ? activeFile.basename + '-' + moment().format("YYYYMMDDHHmmssSSS") : activeFile.basename + '-' + this.generateRandomHex(16);
		let extension = file.extension;
		if (this.settings.convertTo && this.settings.convertTo !== 'disabled') {
			extension = this.settings.convertTo;
		}
		return `${newName}.${extension}`;
	}

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
	getActiveFile(): TFile | undefined {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file;
		if (file) {
			return file;
		}
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

function isBase64Image(src: any) {
	// Check if src starts with 'data:image'
	return src.startsWith('data:image');
}

// async function getEXIF(file:TFile){
//     // Image as a blob
//     const binary = await this.app.vault.readBinary(file);
//     const imgBlob = new Blob([binary], { type: `image/${file.extension}` });

//     // Use blob to get image metadata
//     const reader = new FileReader();

//     return new Promise((resolve, reject) => {
//         reader.onloadend = async function() {
//             if (reader.result) {
//                 try {
//                     const exif = await exifr.parse(reader.result);
//                     // console.log(exif);
//                     resolve(exif); // Resolve the promise with the exif data
//                 } catch (error) {
//                     reject(error); // Reject the promise with the error
//                 }
//             }
//         };
//         reader.readAsArrayBuffer(imgBlob);
//     });
// }

// async function getLongestSide(binary: ArrayBuffer) {
//     // console.log(binary);
//     // Convert the binary data to a Buffer
//     const buffer = Buffer.from(binary);
//     // Get the image dimensions using probe-image-size
//     const result = probe.sync(buffer);
//     if (result) {
//         // Return the longest side
//         const longestSide = Math.max(result.width, result.height);
//         // console.log("Longest Side of an image:", longestSide);
//         return longestSide;
//     } else {
//         // console.log("Failed to get image dimensions");
//         return null;
//     }
// }


async function getImageWidthSide(binary: ArrayBuffer) {
	// console.log(binary);
	// Convert the binary data to a Buffer
	const buffer = Buffer.from(binary);
	// Get the image dimensions using probe-image-size
	const result = probe.sync(buffer);
	if (result) {
		// Return the longest side
		const widthSide = Math.max(result.width);
		// console.log("Longest Side of an image:", widthSide);
		return widthSide;
	} else {
		console.log("Failed to get image dimensions");
		return null;
	}
}

function printEditorLineWidth(app: App) {
	let editorLineWidth: string | number = '';
	const activeView = app.workspace.getActiveViewOfType(MarkdownView);
	if (activeView) {
		const editorElement = (activeView.editor as any).containerEl;
		const style = getComputedStyle(editorElement);
		editorLineWidth = style.getPropertyValue('--file-line-width');
		// Remove 'px' from the end
		editorLineWidth = editorLineWidth.slice(0, -2);
		// Now convert it into a number
		editorLineWidth = Number(editorLineWidth);

	}
	return editorLineWidth; // Make sure to return or use the variable
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
async function deleteImageFromVault(event: MouseEvent, app: any) {
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

class ImageConvertTab extends PluginSettingTab {
	plugin: ImageConvertPLugin;

	constructor(app: App, plugin: ImageConvertPLugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const heading = containerEl.createEl('h1');
		heading.textContent = 'Convert, compress and resize';

		new Setting(containerEl)
			.setName('Select format to convert images to')
			.setDesc(`Turn this on to allow image conversion and compression on drag'n'drop or paste. "Same as original" - will keep original file format.`)
			.addDropdown(dropdown =>
				dropdown
					.addOptions({ disabled: 'Same as original', webp: 'WebP', jpg: 'JPG', png: 'PNG' })
					.setValue(this.plugin.settings.convertTo)
					.onChange(async value => {
						this.plugin.settings.convertTo = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
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

		new Setting(containerEl)
			.setName('Image resize mode')
			.setDesc('Select the mode to use when resizing the image. Resizing an image will further reduce file-size, but it will resize your actual file, which means that the original file will be modified, and the changes will be permanent.')
			.addDropdown(dropdown =>
				dropdown
					.addOptions({ None: 'None', Fit: 'Fit', Fill: 'Fill', LongestEdge: 'Longest Edge', ShortestEdge: 'Shortest Edge', Width: 'Width', Height: 'Height' })
					.setValue(this.plugin.settings.resizeMode)
					.onChange(async value => {
						this.plugin.settings.resizeMode = value;
						await this.plugin.saveSettings();

						if (value !== 'None') {
							// Open the ResizeModal when an option is selected
							const modal = new ResizeModal(this.plugin);
							modal.open();
						}
					})
			);

		new Setting(containerEl)
			.setName('Auto rename')
			.setDesc(
				`Automatically rename dropped image into current notes name + todays date (YYYYMMDDHHMMSSSSS). For instance, image "testImage.jpg" dropped into note "Howtotakenotes.md" becomes "Howtotakenotes-20230927164411.webp"`
			)
			.addToggle(toggle =>
				toggle
					.setValue(this.plugin.settings.autoRename)
					.onChange(async value => {
						this.plugin.settings.autoRename = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Rename format')
			.setDesc(
				`Select a rename format. Date will append a date. Hex will append a random hexadecimal string.`
			)
			.addDropdown(dropdown => {
				dropdown.addOption("date", "Date")
					.addOption("hex", "Hex")
					.setValue(this.plugin.settings.renameFormat)
					.onChange(async (value) => {
						this.plugin.settings.renameFormat = value;
						await this.plugin.saveSettings();
					});

			});

		// OUTPUT
		// Update outputSetting name and description
		const updateOutputSetting = (value: string) => {
			if (value === "specified") {
				outputSetting.setName("Path to specific folder:");
				outputSetting.setDesc('If you specify folder path as "/attachments/images" then all processed images will be saved inside "/attachments/images/" folder. If any of the folders do not exist, they will be created.');
			} else if (value === "subfolder") {
				outputSetting.setName("Subfolder name:");
				outputSetting.setDesc('Add processed images to a specified folder next to the note you added the image to.  If any of the folders do not exist, they will be created. For example, if your note is located in "00-HOME/Subfolder1/note.md", and I specify that i want to keep all images inside "images" subfolder, then the image will be saved in "00-HOME/Subfolder1/images/."');
			}
		};

		// Create the dropdown
		new Setting(this.containerEl)
			.setName("Output")
			.setDesc("Select where to save converted images. Default - follow rules as defined by Obsidian in 'File & Links' > 'Default location for new attachments'")
			.addDropdown((dropdown) => {
				dropdown.addOption("disable", "Default")
					.addOption("root", "Root folder")
					.addOption("specified", "In the folder specified below")
					.addOption("current", "Same folder as current file")
					.addOption("subfolder", "In subfolder under current folder [Beta]")
					.setValue(this.plugin.settings.attachmentLocation)
					.onChange(async (value) => {
						this.plugin.settings.attachmentLocation = value;
						updateOutputSetting(value);
						outputSetting.settingEl.style.display = value === "specified" || value === "subfolder" ? 'flex' : 'none';
						await this.plugin.saveSettings();
					});
			});

		const outputSetting = new Setting(this.containerEl)
			.addText((text) => {
				let value = "/";
				if (this.plugin.settings.attachmentLocation === "specified" && this.plugin.settings.attachmentSpecifiedFolder) {
					value = this.plugin.settings.attachmentSpecifiedFolder.toString();
				} else if (this.plugin.settings.attachmentLocation === "subfolder" && this.plugin.settings.attachmentSubfolderName) {
					value = this.plugin.settings.attachmentSubfolderName.toString();
				}
				text.setValue(value);
				text.onChange(async (value) => {
					if (this.plugin.settings.attachmentLocation === "specified") {
						this.plugin.settings.attachmentSpecifiedFolder = value;
					} else if (this.plugin.settings.attachmentLocation === "subfolder") {
						this.plugin.settings.attachmentSubfolderName = value;
					}
					await this.plugin.saveSettings();
				});
			});

		// Initially hide the output setting
		outputSetting.settingEl.style.display = 'none';

		// If the dropdown is already set to "specified" or "subfolder", show the output setting
		if (this.plugin.settings.attachmentLocation === "specified" || this.plugin.settings.attachmentLocation === "subfolder") {
			outputSetting.settingEl.style.display = 'flex';
			updateOutputSetting(this.plugin.settings.attachmentLocation);
		}

		/////////////////////////////////////////////

		const heading2 = containerEl.createEl("h2");
		heading2.textContent = "Non-Destructive Image Resizing:";
		const p = containerEl.createEl("p");
		p.textContent = 'Below settings allow you to adjust image dimensions using the standard ObsidianMD method by modifying image links. For instance, to change the width of ![[Engelbart.jpg]], we add "| 100" at the end, resulting in ![[Engelbart.jpg | 100]].';
		p.style.fontSize = "12px";

		/////////////////////////////////////////////
		// Create a function to update the custom size setting
		// Update function to handle "Fit Image" option
		const updateCustomSizeSetting = async (value: string) => {
			if (value === "customSize") {
				// If "customSize" is selected, show the "Custom size" field
				customSizeSetting.settingEl.style.display = 'flex';
			} else if (value === "fitImage") {
				// If "fitImage" is selected, calculate the size based on the max width of the notes editor and longest side of an image
				// const maxWidth = getEditorMaxWidth();
				// const longestSide = this.plugin.longestSide; 
				// if (longestSide !== null) {  // Check if longestSide is not null before using it
				//     this.plugin.settings.customSizeLongestSide = Math.min(maxWidth, longestSide).toString();
				// 	await this.plugin.saveSettings();
				// }
				customSizeSetting.settingEl.style.display = 'none';
			} else {
				// If neither "customSize" nor "fitImage" is selected, hide the "Custom size" field
				customSizeSetting.settingEl.style.display = 'none';
			}
		};
		// Function to get the max width of the notes editor
		// const getEditorMaxWidth = () => {
		// 	// Get the computed style of the root element
		// 	const style = getComputedStyle(document.documentElement);
		// 	// Get the value of the --file-line-width variable
		// 	const maxWidth = style.getPropertyValue('--file-line-width');
		// 	// Remove 'px' from the end and convert to a number
		// 	return Number(maxWidth.slice(0, -2));
		// };

		// Add "Fit Image" option to the dropdown
		new Setting(containerEl)
			.setName("Non-destructive resize:")
			.setDesc(`Automatically apply "|size" to dropped/pasted images.`)
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ disabled: "None", fitImage: "Fit Image", customSize: "Custom", }) // Add "Fit Image" option
					.setValue(this.plugin.settings.autoNonDestructiveResize)
					.onChange(async (value) => {
						this.plugin.settings.autoNonDestructiveResize = value;
						await this.plugin.saveSettings();
						updateCustomSizeSetting(value);
					})
			);


		const customSizeSetting = new Setting(containerEl)
			.setName('Custom Size:')
			.setDesc(`Specify the default size which should be applied on all dropped/pasted images. For example, if you specify custom size as "250" then when you drop or paste an "image.jpg" it would become ![[image.jpg|250]]`)
			.addText((text) => {
				text.setValue(this.plugin.settings.customSize.toString());
				text.onChange(async (value) => {
					this.plugin.settings.customSize = value;
					await this.plugin.saveSettings();
				});
			});

		// Initially hide the custom size setting
		updateCustomSizeSetting(this.plugin.settings.autoNonDestructiveResize);



		/////////////////////////////////////////////

		new Setting(containerEl)
			.setName('Resize by dragging edge of an image')
			.setDesc('Turn this on to allow resizing images by dragging the edge of an image.')
			.addToggle(toggle =>
				toggle
					.setValue(this.plugin.settings.resizeByDragging)
					.onChange(async value => {
						this.plugin.settings.resizeByDragging = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Resize with Shift + Scrollwheel')
			.setDesc('Toggle this setting to allow resizing images using the Shift key combined with the scroll wheel.')
			.addToggle(toggle =>
				toggle
					.setValue(this.plugin.settings.resizeWithShiftScrollwheel)
					.onChange(async value => {
						this.plugin.settings.resizeWithShiftScrollwheel = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Right-click context menu')
			.setDesc('Toggle to enable or disable right-click context menu')
			.addToggle(toggle =>
				toggle
					.setValue(this.plugin.settings.rightClickContextMenu)
					.onChange(async value => {
						this.plugin.settings.rightClickContextMenu = value;
						await this.plugin.saveSettings();
					})
			);

	}
}

class ResizeModal extends Modal {
	plugin: ImageConvertPLugin;

	constructor(plugin: ImageConvertPLugin) {
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
	plugin: ImageConvertPLugin;

	constructor(plugin: ImageConvertPLugin) {
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
	plugin: ImageConvertPLugin;

	constructor(plugin: ImageConvertPLugin) {
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
	plugin: ImageConvertPLugin;

	constructor(plugin: ImageConvertPLugin) {
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
	plugin: ImageConvertPLugin;

	constructor(plugin: ImageConvertPLugin) {
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


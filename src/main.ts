import { App, MarkdownView, Notice, Plugin, TFile, PluginSettingTab, Setting, Editor, Modal, TextComponent, ButtonComponent, Menu, MenuItem } from 'obsidian';
import { Platform } from 'obsidian';
import UTIF from './UTIF.js';


// Import heic-convert only on Desktop
let heic:any;
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
	dirpath: string;
	saveInNoteFolder: boolean;
	resizeMode: string;
	desiredWidth: number;
	desiredHeight: number;
	desiredLength: number;
	resizeByDragging: boolean;
	resizeWithShiftScrollwheel: boolean;
}

const DEFAULT_SETTINGS: ImageConvertSettings = {
	autoRename: true,
	convertToWEBP: true,
	convertToJPG: false,
	convertToPNG: false,
	convertTo: '',
	quality: 0.75,
	dirpath: '',
	saveInNoteFolder: false,
	resizeMode: 'None',
	desiredWidth: 600,
	desiredHeight: 800,
	desiredLength: 800,
	resizeByDragging: true,
	resizeWithShiftScrollwheel: true
}

export default class ImageConvertPLugin extends Plugin {
	settings: ImageConvertSettings;

	async onload() {
		await this.loadSettings();
		this.registerEvent(
			this.app.vault.on('create', (file: TFile) => {
				if (!(file instanceof TFile)) return;
				const timeGapMs = Date.now() - file.stat.ctime;
				if (timeGapMs > 1e3) return; // 1s
				if (isImage(file)) {
					this.renameFile(file);
				}
			})
		);

		// Add event listener for contextmenu event on image elements
		this.register(
            this.onElement(
                document,
                'contextmenu',
                'img',
                this.onContextMenu.bind(this)
            )
        );

		// Check if edge of an image was clicked upon
		this.register(
			this.onElement(
				document,
				"mousedown",
				"img",
				(event: MouseEvent) => {
					if (!this.settings.resizeByDragging) return;
					// Fix the behaviour, where image gets duplicated because of the move on drag,
					// disabling the defaults which locks the image (alhtough, links are still movable)
					event.preventDefault(); 
					const img = event.target as HTMLImageElement;
					const rect = img.getBoundingClientRect();
					const x = event.clientX - rect.left;
					const y = event.clientY - rect.top;
					const edgeSize = 30; // size of the edge in pixels
					if ((x >= rect.width - edgeSize || x <= edgeSize) || (y >= rect.height - edgeSize || y <= edgeSize)) {
						// user clicked on any of the edges of the image
						// Cursor must be active only on the image or the img markdown link
						// Otherwise resized image will get copied to the active line 
						const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
						if (activeView) {
							const editor = activeView.editor;
							const doc = editor.getDoc();
							const lineCount = doc.lineCount();
							// read the image filename and its extension
							let imageName = img.getAttribute('src');
							if (imageName) {
								const parts = imageName.split('/');
								const lastPart = parts.pop();
								if (lastPart) {
									imageName = lastPart.split('?')[0];
									// decode percent-encoded characters
									imageName = decodeURIComponent(imageName);
									// replace %20 with space character
									imageName = imageName.replace(/%20/g, ' ');

								}
							}

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
							}
						}
						const startX = event.clientX;
						const startY = event.clientY;
						const startWidth = img.clientWidth;
						const startHeight = img.clientHeight;
						const aspectRatio = startWidth / startHeight;

						const onMouseMove = (event: MouseEvent) => {
							const currentX = event.clientX;
							const currentY = event.clientY;
							// let newWidth, newHeight;
							let newWidth = 0;
							let newHeight = 0;
							if (x >= rect.width - edgeSize && y >= rect.height - edgeSize) {
								newWidth = startWidth + (currentX - startX);
								newHeight = newWidth / aspectRatio;
							} else if (x <= edgeSize && y <= edgeSize) {
								newWidth = startWidth - (currentX - startX);
								newHeight = newWidth / aspectRatio;
							} else if (x >= rect.width - edgeSize && y <= edgeSize) {
								newWidth = startWidth + (currentX - startX);
								newHeight = newWidth / aspectRatio;
							} else if (x <= edgeSize && y >= rect.height - edgeSize) {
								newWidth = startWidth - (currentX - startX);
								newHeight = newWidth / aspectRatio;
							} else if (x >= rect.width - edgeSize || x <= edgeSize) {
								if (x >= rect.width - edgeSize) {
									newWidth = startWidth + (currentX - startX);
								} else {
									newWidth = startWidth - (currentX - startX);
								}
								newHeight = newWidth / aspectRatio;
							} else if (y >= rect.height - edgeSize || y <= edgeSize) {
								if (y >= rect.height - edgeSize) {
									newHeight = startHeight + (currentY - startY);
								} else {
									newHeight = startHeight - (currentY - startY);
								}
								newWidth = newHeight * aspectRatio;
							}
							img.style.width = `${newWidth}px`;
							img.style.height = `${newHeight}px`;

							// update the size value in the image's markdown link
							const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
							if (activeView) {
								const editor = activeView.editor;
								const cursor = editor.getCursor();
								const line = editor.getLine(cursor.line);
								// calculate the longest side of the image
								const longestSide = Math.round(Math.max(newWidth, newHeight));
								// read the image filename and its extension
								let imageName = img.getAttribute('src');
								if (imageName) {
									const parts = imageName.split('/');
									const lastPart = parts.pop();
									if (lastPart) {
										imageName = lastPart.split('?')[0];
										// decode percent-encoded characters
										imageName = decodeURIComponent(imageName);
										// replace %20 with space character
										imageName = imageName.replace(/%20/g, ' ');
									}
								}

								// update the size value in the image's markdown link
								editor.replaceRange(`![[${imageName}|${longestSide}]]`, { line: cursor.line, ch: 0 }, { line: cursor.line, ch: line.length });
							}

						};

						const onMouseUp = () => {
							document.removeEventListener('mousemove', onMouseMove);
							document.removeEventListener('mouseup', onMouseUp);
						};

						document.addEventListener('mousemove', onMouseMove);
						document.addEventListener('mouseup', onMouseUp);
					}
				}
			)
		);

		// Create handle to resize image by dragging the edge of an image
		this.register(
			this.onElement(
				document,
				"mouseover",
				"img",
				(event: MouseEvent) => {
					if (!this.settings.resizeByDragging) return;
					const img = event.target as HTMLImageElement;
					const rect = img.getBoundingClientRect();
					const x = event.clientX - rect.left;
					const y = event.clientY - rect.top;
					const edgeSize = 30; // size of the edge in pixels
					if ((x >= rect.width - edgeSize || x <= edgeSize) || (y >= rect.height - edgeSize || y <= edgeSize)) {
						// user is hovering over any of the edges of the image
						img.style.cursor = 'nwse-resize'; // change cursor to resize cursor
						img.style.outline = 'solid'; // add dashed outline around image
						img.style.outlineWidth = '10px';
						img.style.outlineColor = '#dfb0f283';
					} else {
						// user is not hovering over any of the sedges of the image
						img.style.cursor = 'default'; // change cursor back to default
						img.style.outline = 'none'; // remove outline from image
					}
				}
			)
		);

		// Reset border/outline when finished resizing
		this.register(
			this.onElement(
				document,
				"mouseout",
				"img",
				(event: MouseEvent) => {
					if (!this.settings.resizeByDragging) return;
					const img = event.target as HTMLImageElement;
					img.style.borderStyle = 'none';
					img.style.outline = 'none';
				}
			)
		);

		// Allow resizing with SHIFT + Scrollwheel
		this.register(
			this.onElement(
				document,
				"wheel",
				"img",
				(event: WheelEvent) => {
					if (!this.settings.resizeWithShiftScrollwheel) return;
					if (event.shiftKey) { // check if the Alt key is pressed
						// event.preventDefault(); // prevent default behavior of wheel event on images
						const img = event.target as HTMLImageElement;
						const delta = Math.sign(event.deltaY); // get the direction of the scroll
						const scaleFactor = 1.1; // set the scale factor for resizing
						let newWidth, newHeight;

						if (delta < 0) {
							// user scrolled up, increase the size of the image
							newWidth = img.clientWidth * scaleFactor;
							newHeight = img.clientHeight * scaleFactor;
						} else {
							// user scrolled down, decrease the size of the image
							newWidth = img.clientWidth / scaleFactor;
							newHeight = img.clientHeight / scaleFactor;
						}
						img.style.width = `${newWidth}px`;
						img.style.height = `${newHeight}px`;

						// update the size value in the image's markdown link
						const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
						if (activeView) {
							const editor = activeView.editor;
							const doc = editor.getDoc();
							const lineCount = doc.lineCount();
							// read the image filename and its extension
							let imageName = img.getAttribute('src');
							if (imageName) {
								const parts = imageName.split('/');
								const lastPart = parts.pop();
								if (lastPart) {
									imageName = lastPart.split('?')[0];
									// replace %20 with space character
									imageName = imageName.replace(/%20/g, ' ');
								}
							}
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
								const longestSide = Math.round(Math.max(newWidth, newHeight));
								// update the size value in the image's markdown link
								editor.replaceRange(`![[${imageName}|${longestSide}]]`, { line: cursor.line, ch: 0 }, { line: cursor.line, ch: line.length });
							}
						}
					}
				}
			)
		);

		this.addSettingTab(new ImageConvertTab(this.app, this));
	}

	async onunload() {
        // Remove event listener for contextmenu event on image elements

    }

	onContextMenu(event: MouseEvent) {
		// Prevent default context menu from being displayed
		event.preventDefault();
		const target = (event.target as Element);
		if (target.tagName === 'IMG') {
			// Create new Menu object
			const menu = new Menu();

			// Add option to copy image to clipboard
			menu.addItem((item: MenuItem) =>
				item
					.setTitle('Copy Image')
					.setIcon('copy')
					.onClick(async () => {
						// Copy original image data to clipboard
						const img = target as HTMLImageElement;
						const canvas = document.createElement('canvas');
						canvas.width = img.naturalWidth;
						canvas.height = img.naturalHeight;
						const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
						ctx.drawImage(img, 0, 0);
						const dataURL = canvas.toDataURL();
						const response = await fetch(dataURL);
						const blob = await response.blob();
						const item = new ClipboardItem({ [blob.type]: blob });
						navigator.clipboard.write([item]);
						new Notice('Image copied to clipboard');
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
								let fileName: string | undefined;
								const imageName = img.getAttribute('src');
								if (imageName) {
									fileName = imageName.replace(/^app:\/\/[^/]+\//, '');
									fileName = decodeURI(fileName);
									const parts = fileName.split('/');
									fileName = parts.pop();
									if (fileName) {
										fileName = fileName.split('?')[0];
									}
								}

								// Get TFile object for image file
								if (fileName) {
									const file = this.app.vault.getAbstractFileByPath(fileName);
									if (file instanceof TFile) {
										await this.app.vault.modifyBinary(file, buffer);
									}
								}
							}
						});
						modal.open();
					})
			);

			// // Add option to copy image path or Obsidian URL
			// menu.addItem((item: MenuItem) =>
			// item
			// 	.setTitle('Copy Image Path')
			// 	.setIcon('link')
			// 	.onClick(() => {
			// 		// Copy image path or Obsidian URL to clipboard
			// 		const img = target as HTMLImageElement;
			// 		const src = img.getAttribute('src');
			// 		if (src) {
			// 			navigator.clipboard.writeText(src);
			// 			new Notice('Image path copied to clipboard');
			// 		}
			// 	})
			// );

			// Show menu at mouse event location
			menu.showAtPosition({ x: event.pageX, y: event.pageY });
		}
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
	
	async renameFile(file: TFile) {
		const activeFile = this.getActiveFile();
		if (!activeFile) {
			new Notice('Error: No active file found.');
			return;
		}
		let newName = await this.keepOrgName(file, activeFile);
		if (this.settings.autoRename) {
			newName = await this.generateNewName(file, activeFile);
		}
		const sourcePath = activeFile.path;
		// let newPath = '';
		// newPath = this.settings.dirpath;

		let newPath = '';
		if (this.settings.saveInNoteFolder) {
			// Get path of current note
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView) {
				const activeFile = activeView.file;
				if (activeFile) {
					const activeFilePath = activeFile.path;
					// Construct new path using path of current note
					newPath = activeFilePath.substring(0, activeFilePath.lastIndexOf('/'));
				}
			}
		} else {
			// Use default or custom image directory specified by user
			newPath = this.settings.dirpath;
		}

		const originName = file.name;

		// Start the conversion and show the status indicator
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText(`Converting image... ⏳`);

		const binary = await this.app.vault.readBinary(file);
		let imgBlob = new Blob([binary], { type: `image/${file.extension}` });  

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
	
			// Convert HEIC to JPG
			const outputBuffer = await heic({
				buffer: binaryBuffer,
				format: 'JPEG',
				quality: Number(this.settings.quality)
			});
	
			imgBlob = new Blob([outputBuffer], { type: 'image/jpeg' });
		}

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

		statusBarItemEl.setText('Image converted ✅');
		statusBarItemEl.setText('');

		const linkText = this.makeLinkText(file, sourcePath);
		newPath = `${newPath}/${newName}`;
		try {
			const decodedNewPath = decodeURIComponent(newPath);
			await this.app.vault.rename(file, decodedNewPath);
		} catch (err) {
			new Notice(`Failed to rename ${newName}: ${err}`);
			throw err;
		}
		const newLinkText = this.makeLinkText(file, sourcePath);
		const editor = this.getActiveEditor(sourcePath);
		if (!editor) {
			new Notice(`Failed to rename ${newName}: no active editor`);
			return;
		}
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);

		editor.transaction({
			changes: [
				{
					from: { ...cursor, ch: 0 },
					to: { ...cursor, ch: line.length },
					text: line.replace(linkText, newLinkText),
				},
			],
		});
		new Notice(`Renamed ${originName} to ${newName}`);
	}

	makeLinkText(file: TFile, sourcePath: string, subpath?: string): string {
		return this.app.fileManager.generateMarkdownLink(file, sourcePath, subpath);
	}

	async generateNewName(file: TFile, activeFile: TFile): Promise<string> {
		const newName = activeFile.basename + '-' + new Date().toISOString().replace(/[-:T.Z]/g, '');
		let extension = file.extension;
		if (this.settings.convertTo) {
			extension = this.settings.convertTo;
		}
		return `${newName}.${extension}`;
	}

	async keepOrgName(file: TFile, activeFile: TFile): Promise<string> {
		let newName = file.basename;
		let extension = file.extension;
		if (this.settings.convertTo) {
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
	const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'tif', 'tiff', 'gif'];
	return IMAGE_EXTS.includes(file.extension.toLowerCase());
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
					case 'LongestSide':
						if (image.naturalWidth > image.naturalHeight) {
							imageWidth = desiredLength;
							imageHeight = imageWidth / aspectRatio;
						} else {
							imageHeight = desiredLength;
							imageWidth = imageHeight * aspectRatio;
						}
						break;
					case 'ShortestSide':
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
				context.fillStyle = '#fff';
				context.fillRect(0, 0, canvas.width, canvas.height);
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
					case 'LongestSide':
						if (image.naturalWidth > image.naturalHeight) {
							imageWidth = desiredLength;
							imageHeight = imageWidth / aspectRatio;
						} else {
							imageHeight = desiredLength;
							imageWidth = imageHeight * aspectRatio;
						}
						break;
					case 'ShortestSide':
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
				context.fillStyle = '#fff';
				context.fillRect(0, 0, canvas.width, canvas.height);
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
					case 'LongestSide':
						if (image.naturalWidth > image.naturalHeight) {
							imageWidth = desiredLength;
							imageHeight = imageWidth / aspectRatio;
						} else {
							imageHeight = desiredLength;
							imageWidth = imageHeight * aspectRatio;
						}
						break;
					case 'ShortestSide':
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
				context.fillStyle = '#fff';
				context.fillRect(0, 0, canvas.width, canvas.height);
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
			.setDesc(`Turn this on to allow image conversion and compression on drag'n'drop or paste.`)
			.addDropdown(dropdown =>
				dropdown
					.addOptions({ webp: 'WebP', jpg: 'JPG', png: 'PNG' })
					.setValue(this.plugin.settings.convertTo)
					.onChange(async value => {
						this.plugin.settings.convertTo = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Quality')
			.setDesc('0 - low quality, 100 - high quality, 75 - Recommended')
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
		.setDesc('The mode to use when resizing the image')
		.addDropdown(dropdown =>
			dropdown
				.addOptions({ None: 'None', Fit: 'Fit', Fill: 'Fill', LongestSide: 'Longest Side', ShortestSide: 'Shortest Side', Width: 'Width', Height: 'Height' })
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
				`Automatically rename dropped image into current notes name + todays date (YYYYMMDDHHMMSS). For instance, image "testImage.jpg" dropped into note "Howtotakenotes.md" becomes "Howtotakenotes-20230927164411.webp"`
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
			.setName('Image directory')
			.setDesc('Directory to move processed images to')
			.addText(text =>
				text
					.setPlaceholder('Enter directory path')
					.setValue(this.plugin.settings.dirpath)
					.onChange(async value => {
						this.plugin.settings.dirpath = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Save images in note folder')
			.setDesc('Automatically save processed images in the same folder as the current note')
			.addToggle(toggle =>
				toggle
					.setValue(this.plugin.settings.saveInNoteFolder)
					.onChange(async value => {
						this.plugin.settings.saveInNoteFolder = value;
						await this.plugin.saveSettings();
					})
			);

		const heading2 = containerEl.createEl('h2');
		heading2.textContent = 'Non-Destructive Image Resizing:';
		const p = containerEl.createEl('p');
		p.textContent = 'Below two settings allow you to adjust image dimensions using the standard ObsidianMD method by modifying image links. For instance, to change the width of ![[Engelbart.jpg]], we add "| 100" at the end, resulting in ![[Engelbart.jpg | 100]].';
		p.style.fontSize = '12px'; // Adjust the font size as needed

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
			case 'LongestSide':
				explanation = 'Longest Side mode resizes the longest side of the image to match the desired length while maintaining the aspect ratio of the image.';
				break;
			case 'ShortestSide':
				explanation = 'Shortest Side mode resizes the shortest side of the image to match the desired length while maintaining the aspect ratio of the image.';
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
					['LongestSide', 'ShortestSide', 'Width', 'Height'].includes(this.plugin.settings.resizeMode)
						? this.plugin.settings.desiredWidth.toString()
						: this.plugin.settings.desiredHeight.toString()
				);

			// Add a button to save the settings and close the modal
			new ButtonComponent(contentEl)
				.setButtonText('Save')
				.onClick(async () => {
					const length = parseInt(lengthInput.getValue());
					if (/^\d+$/.test(lengthInput.getValue()) && length > 0) {
						if (['LongestSide'].includes(this.plugin.settings.resizeMode)) {
							this.plugin.settings.desiredLength = length;
						}

						if (['ShortestSide'].includes(this.plugin.settings.resizeMode)) {
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

		const messageE4 = createEl('p', { text: 'Please manually reload your note after clicking Submit.' });
		messageE4.style.fontSize = '12px'
		submitBUtton.controlEl.insertBefore(messageE4, submitBUtton.controlEl.firstChild);
		
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
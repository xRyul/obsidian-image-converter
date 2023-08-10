import { App, MarkdownView, Notice, Plugin, TFile, PluginSettingTab, Setting, Editor, Modal, TextComponent, ButtonComponent } from 'obsidian';
import * as path from 'path';

interface MyPluginSettings {
	autoRename: boolean;
	convertToWEBP: boolean;
	convertToJPG: boolean;
	convertToPNG: boolean;
	convertTo: string;
	quality: number;
	dirpath: string;
	resizeMode: string;
	desiredWidth: number;
	desiredHeight: number;
	desiredLength: number;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	autoRename: true,
	convertToWEBP: true,
	convertToJPG: false,
	convertToPNG: false,
	convertTo: '',
	quality: 0.75,
	dirpath: '',
	resizeMode: 'None',
	desiredWidth: 600,
	desiredHeight: 800,
	desiredLength: 800
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		await this.loadSettings();
		this.registerEvent(
			this.app.vault.on('create', (file: TFile) => {
				if (!(file instanceof TFile)) return;
				const timeGapMs = Date.now() - file.stat.ctime;
				if (timeGapMs > 1e3) return; // 1s
				if (isImage(file)) {
					console.log('pasted image created', file);
					this.renameFile(file);
				}
			})
		);

		this.addSettingTab(new SampleSettingTab(this.app, this));
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
		let newPath = '';
		newPath = this.settings.dirpath;
		console.log('newPath is set to:', newPath);
		const originName = file.name;

		const binary = await this.app.vault.readBinary(file);
		const imgBlob = new Blob([binary], { type: `image/${file.extension}` });

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

		const linkText = this.makeLinkText(file, sourcePath);
		newPath = path.join(newPath, newName);
		try {
			await this.app.vault.rename(file, newPath);
		} catch (err) {
			new Notice(`Failed to rename ${newName}: ${err}`);
			throw err;
		}
		const newLinkText = this.makeLinkText(file, sourcePath);
		console.log('replace text', linkText, newLinkText);
		const editor = this.getActiveEditor(sourcePath);
		if (!editor) {
			new Notice(`Failed to rename ${newName}: no active editor`);
			return;
		}
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		console.log('current line', line);

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
		const newName = file.basename;
		let extension = file.extension;
		if (this.settings.convertTo) {
			extension = this.settings.convertTo;
		}
		return `${newName}.${extension}`;
	}

	getActiveFile(): TFile | undefined {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file;
		console.log('active file', file?.path);
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

	onunload() { }

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

function isImage(file: TFile): boolean {
	const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp'];
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

class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

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
			.setName('Image Resize Mode')
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
			.setName('Auto Rename')
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
			.setName('Image Directory')
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

	}
}

class ResizeModal extends Modal {
	plugin: MyPlugin;

	constructor(plugin: MyPlugin) {
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





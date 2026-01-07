import {
	Menu,
	View,
	TFile,
	Notice,
	setIcon,
	Platform,
	Component,
	normalizePath,
	App,
	MenuItem,
	MarkdownView,
	Editor,
} from "obsidian";
// eslint-disable-next-line import/no-nodejs-modules -- Required for path manipulation; Obsidian runs on Electron with Node.js support
import * as path from "path";
import ImageConverterPlugin from "./main";
import { FolderAndFilenameManagement } from "./FolderAndFilenameManagement";
import { ConfirmDialog } from "./ImageConverterSettings";
import { VariableProcessor, VariableContext } from "./VariableProcessor";
import { ImageAnnotationModal } from "./ImageAnnotation";
import { Crop } from "./Crop";
import { ProcessSingleImageModal } from "./ProcessSingleImageModal";
import { getVaultConfigBoolean } from "./utils/vaultConfig";

interface ImageMatch {
	lineNumber: number;
	line: string;
	fullMatch: string;
}

/** Internal Obsidian Menu type with hide method (not in public API) */
type MenuWithHide = Menu & { hide?: () => void };

/** Internal MarkdownView type with file property (not in public API) */
type MarkdownViewWithFile = MarkdownView & { file?: TFile | null };

/** Internal MenuItem type with dom property for custom menu content (not in public API) */
type MenuItemWithDom = MenuItem & { dom?: HTMLElement };

/** Internal file explorer view type with revealInFolder method (not in public API) */
type FileExplorerView = { revealInFolder?: (file: TFile) => void };

export class ContextMenu extends Component {
	private contextMenuRegistered = false;
	private currentMenu: Menu | null = null;

	private readonly stopPropagationHandler = (e: Event) => e.stopPropagation();

	/**
	 * Safely gets the image path from an HTMLImageElement.
	 * Encapsulates the optional chaining pattern for FolderAndFilenameManagement.getImagePath.
	 */
	private getImagePathSafe(img: HTMLImageElement): string | null {
		return this.folderAndFilenameManagement?.getImagePath?.(img) ?? null;
	}

	/**
	 * Gets the file from a MarkdownView, handling the internal API.
	 */
	private getFileFromView(view: MarkdownView | null): TFile | null {
		if (!view) return null;
		return (view as MarkdownViewWithFile).file ?? null;
	}

	/**
	 * Hides a menu using the internal hide method.
	 */
	private hideMenu(menu: Menu): void {
		(menu as MenuWithHide).hide?.();
	}

	/**
	 * Gets the native menus config from the vault.
	 */
	private isNativeMenusEnabled(): boolean {
		return getVaultConfigBoolean(this.app, "nativeMenus");
	}

	/**
	 * Converts a canvas element to a Blob.
	 * @param canvas - The canvas element to convert.
	 * @param type - Optional MIME type for the blob (defaults to image/png).
	 * @returns A promise that resolves to a Blob.
	 */
	private canvasToBlob(canvas: HTMLCanvasElement, type?: string): Promise<Blob> {
		return new Promise((resolve, reject) => {
			canvas.toBlob(
				(result) => {
					if (result) resolve(result);
					else reject(new Error("Failed to create blob from canvas"));
				},
				type
			);
		});
	}

	private readonly documentClickHandler = (event: MouseEvent) => {
		if (
			!(event.target as HTMLElement).closest(
				".image-converter-contextmenu-info-container"
			) &&
			!(event.target as HTMLElement).closest(".menu-item")
		) {
			if (this.currentMenu) {
				this.hideMenu(this.currentMenu);
			}
		}
	};

	constructor(
		private app: App,
		private plugin: ImageConverterPlugin,
		private folderAndFilenameManagement: FolderAndFilenameManagement,
		private variableProcessor: VariableProcessor
	) {
		super();
		this.registerContextMenuListener();
	}

	/*-----------------------------------------------------------------*/
	/*                       CONTEXT MENU SETUP                        */
	/*-----------------------------------------------------------------*/

	/**
	 * Registers the context menu listener on the document.
	 * This listener will trigger the context menu when an image is right-clicked.
	 */
	registerContextMenuListener() {
		if (this.contextMenuRegistered) {
			return;
		}

		this.registerDomEvent(
			document,
			"contextmenu",
			this.handleContextMenuEvent,
			true
		);
		this.contextMenuRegistered = true;
	}

	/**
	 * Handles the context menu event.
	 * This function is called when the context menu is triggered on an image.
	 * @param event - The MouseEvent object.
	 */
	handleContextMenuEvent = (event: MouseEvent) => {
		const target = event.target as HTMLElement;
		const activeView = this.app.workspace.getActiveViewOfType(View);
		const isCanvasView = activeView?.getViewType() === "canvas";

		if (isCanvasView) {
			return;
		}

		const img =
			target instanceof HTMLImageElement ? target : target.closest("img");
		if (!img) {
			return;
		}

		// Skip Excalidraw images
		if (this.plugin.supportedImageFormats.isExcalidrawImage(img)) {
			return;
		}

		const isImageInSupportedContainer = !!(
			(
				img.closest(".markdown-preview-view") ||
				img.closest(".markdown-source-view")
			)
			// img.closest('.view-content > div') // uncomment this to enable it inside its individual window
		);
		if (!isImageInSupportedContainer) {
			if (target.closest(".map-view-main")) {
				return;
			}
			return;
		}

		event.preventDefault(); // prevents the default context menu from appearing (if any)
		event.stopPropagation(); // prevents the event from bubbling up to parent elements (like the callout)

	   const menu = new Menu();
	   let activeFile = this.app.workspace.getActiveFile();
	   if (!activeFile) {
		  // Fallback: try to get file from MarkdownView (file property exists but isn't in public types)
		  const mv = this.app.workspace.getActiveViewOfType(MarkdownView);
		  activeFile = this.getFileFromView(mv);
	   }

		if (activeFile) {
			this.createContextMenuItems(menu, img, activeFile, event);
		}

		menu.showAtMouseEvent(event);
	};

	/*-----------------------------------------------------------------*/
	/*                     CONTEXT MENU ITEM CREATION                  */
	/*-----------------------------------------------------------------*/

	/**
	 * Creates the items for the context menu.
	 * @param menu - The Menu object to add items to.
	 * @param img - The HTMLImageElement that was right-clicked.
	 * @param activeFile - The currently active TFile.
	 * @param event - The MouseEvent object.
	 * @returns True if the menu was created successfully.
	 */
	createContextMenuItems(
		menu: Menu,
		img: HTMLImageElement,
		activeFile: TFile,
		event: MouseEvent
	) {
		this.currentMenu = menu;

		this.addRenameAndMoveInputs(menu, img, activeFile);

		menu.addSeparator();

		if (!Platform.isMobile) {
			this.addOpenInNewWindowMenuItem(menu, img);
			menu.addSeparator();
			this.addCutImageMenuItem(menu, event);
		}

		this.addCopyImageMenuItem(menu, event);
		this.addCopyBase64ImageMenuItem(menu, event);

		menu.addSeparator();

		// Only add image alignment if enabled
		if (
			this.plugin.settings.isImageAlignmentEnabled &&
			this.plugin.ImageAlignmentManager
		) {
			this.plugin.ImageAlignmentManager.addAlignmentOptionsToContextMenu(
				menu,
				img,
				activeFile
			);
		}

		this.addProcessImageMenuItem(menu, img, event); // Pass the event here

		this.addCropRotateFlipMenuItem(menu, img);

		this.addAnnotateImageMenuItem(menu, img);

		menu.addSeparator();

		if (!Platform.isMobile) {
			this.addShowInNavigationMenuItem(menu, img);
			this.addShowInSystemExplorerMenuItem(menu, img);
		}

		menu.addSeparator();
		this.addDeleteImageAndLinkMenuItem(menu, event);

		return true;
	}

	/*-----------------------------------------------------------------*/
	/*                        CAPTION INPUT                            */
	/*-----------------------------------------------------------------*/

	private async loadCurrentCaption(
		img: HTMLImageElement,
		activeFile: TFile
	): Promise<string> {
		try {
			const imagePath = this.getImagePathSafe(img);
			if (!imagePath) return "";

			const activeView =
				this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!activeView) return "";

			const { editor } = activeView;
			const isExternal = !imagePath;
			const matches = await this.findImageMatches(
				editor,
				imagePath,
				isExternal
			);

			if (matches && matches.length > 0) {
				const [firstMatch] = matches;

				// Handle wiki-style links
				const wikiMatch = firstMatch.fullMatch.match(
					/!\[\[([^\]]+?)(?:\|([^|\]]+?))?\s*(?:\|([^|\]]+?))?\]\]/
				);
				if (wikiMatch) {
					const secondPart = wikiMatch[2] || "";
					const thirdPart = wikiMatch[3] || "";

					const isDimensions = (part: string) =>
						/^\s*\d+x\d+\s*$/.test(part);

					if (thirdPart && !isDimensions(secondPart)) {
						return secondPart.trim();
					}
					if (secondPart && !isDimensions(secondPart)) {
						return secondPart.trim();
					}
					return "";
				}

				// Handle markdown-style links
				const markdownMatch = firstMatch.fullMatch.match(
					/!\[([^|\]]*?)(?:\|(\d+x\d+))?\]\(([^)]+)\)/
				);
				if (markdownMatch) {
					const caption = markdownMatch[1] || "";
					return caption.trim();
				}
			}
			return "";
		} catch (error) {
			console.error("Error loading caption:", error);
			return "";
		}
	}

	private async loadCurrentDimensions(
		img: HTMLImageElement,
		activeFile: TFile
	): Promise<{ width: string; height: string }> {
		try {
			const imagePath = this.getImagePathSafe(img);
			if (!imagePath) return { width: "", height: "" };

			const activeView =
				this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!activeView) return { width: "", height: "" };

			const { editor } = activeView;
			const isExternal = !imagePath;
			const matches = await this.findImageMatches(
				editor,
				imagePath,
				isExternal
			);

			if (matches && matches.length > 0) {
				const [firstMatch] = matches;

				// Handle wiki-style links
				const wikiMatch = firstMatch.fullMatch.match(
					/!\[\[([^\]]+?)(?:\|([^|\]]+?))?\s*(?:\|([^|\]]+?))?\]\]/
				);
				if (wikiMatch) {
					const secondPart = wikiMatch[2] || "";
					const thirdPart = wikiMatch[3] || "";

					const isDimensions = (part: string) =>
						/^\s*\d+(?:x\d+)?\s*$/.test(part);

					// Check third part first, then second part for dimensions
					let dimensionPart = "";
					if (isDimensions(thirdPart)) {
						dimensionPart = thirdPart.trim();
					} else if (isDimensions(secondPart)) {
						dimensionPart = secondPart.trim();
					}

					if (dimensionPart) {
						const parts = dimensionPart.split("x");
						return {
							width: parts[0],
							height: parts.length > 1 ? parts[1] : "",
						};
					}
				}

				// Handle markdown-style links
				const markdownMatch = firstMatch.fullMatch.match(
					/!\[([^|\]]*?)(?:\|(\d+(?:x\d+)?))?\]\(([^)]+)\)/
				);
				if (markdownMatch && markdownMatch[2]) {
					const parts = markdownMatch[2].split("x");
					return {
						width: parts[0],
						height: parts.length > 1 ? parts[1] : "",
					};
				}
			}
			return { width: "", height: "" };
		} catch (error) {
			console.error("Error loading dimensions:", error);
			return { width: "", height: "" };
		}
	}

	private async updateImageLinkWithDimensions(
		editor: Editor,
		match: { lineNumber: number; line: string },
		newCaption: string,
		width: string,
		height: string
	): Promise<string> {
		// Format dimensions based on what's provided
		const dimensionsPart = width
			? height
				? `${width}x${height}`
				: width
			: "";

		const { line } = match;

		// Handle Wiki-style links
		if (line.includes("![[")) {
			return line.replace(
				/!\[\[([^\]]+?)(?:\|([^|\]]+?))?\s*(?:\|([^|\]]+?))?\]\]/g,
				(fullMatch, path) => {
					if (newCaption && dimensionsPart) {
						return `![[${path}|${newCaption}|${dimensionsPart}]]`;
					}
					if (newCaption) {
						return `![[${path}|${newCaption}]]`;
					}
					if (dimensionsPart) {
						return `![[${path}|${dimensionsPart}]]`;
					}
					return `![[${path}]]`;
				}
			);
		}

		// Handle Markdown-style links
		return line.replace(
			/!\[([^|\]]*?)(?:\|(\d+(?:x\d+)?))?\]\(([^)]+)\)/g,
			(fullMatch, caption, dimensions, path) => {
				if (newCaption && dimensionsPart) {
					return `![${newCaption}|${dimensionsPart}](${path})`;
				}
				if (newCaption) {
					return `![${newCaption}](${path})`;
				}
				if (dimensionsPart) {
					return `![|${dimensionsPart}](${path})`;
				}
				return `![](${path})`;
			}
		);
	}

	private async handleDimensionsAndCaptionUpdate(
		menu: Menu,
		captionInput: HTMLInputElement,
		widthInput: HTMLInputElement,
		heightInput: HTMLInputElement,
		img: HTMLImageElement,
		activeFile: TFile,
		isImageResolvable: boolean
	) {
		if (!isImageResolvable) return;

		const newCaption = captionInput.value.trim();
		const width = widthInput.value.trim();
		const height = heightInput.value.trim();

		// Validate dimensions
		if (
			(width && !/^\d+$/.test(width)) ||
			(height && !/^\d+$/.test(height))
		) {
			new Notice("Dimensions must be positive numbers");
			return;
		}

		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) return;

		const { editor } = activeView;
		const imagePath = this.getImagePathSafe(img);
		const isExternal = !imagePath;
		const matches = await this.findImageMatches(
			editor,
			imagePath,
			isExternal
		);

		if (matches.length === 0) {
			new Notice("Failed to find image link in the current note.");
			return;
		}

		const handleConfirmation = async () => {
			for (const match of matches) {
				const updatedLine = await this.updateImageLinkWithDimensions(
					editor,
					match,
					newCaption,
					width,
					height
				);
				editor.setLine(match.lineNumber, updatedLine);
			}
			new Notice("Image caption and dimensions updated successfully.");
			this.plugin.captionManager?.refresh();
		};

		if (matches.length > 1) {
			new ConfirmDialog(
				this.app,
				"Confirm Updates",
				`Found ${matches.length} matching image links. Update all?`,
				"Update",
				() => {
					handleConfirmation().catch((error: unknown) => {
						console.error("Failed to update image caption and dimensions:", error);
						new Notice("Failed to update. See console for details.");
					});
				}
			).open();
		} else {
			await handleConfirmation();
		}

		this.hideMenu(menu);
	}

	/*-----------------------------------------------------------------*/
	/*                      RENAME AND MOVE IMAGE                      */
	/*-----------------------------------------------------------------*/

	// All event listeners use this.registerDomEvent()
	// The Component class's onunload() will clean these up automatically
	// Even though we add these listeners each time the menu is created, they'll be cleaned up when:

	// The menu is closed (DOM elements are removed)
	// The component is unloaded
	// The plugin is disabled
	/**
	 * Adds input fields for renaming and moving the image to the context menu.
	 * @param menu - The Menu object to add the input fields to.
	 * @param img - The HTMLImageElement that was right-clicked.
	 * @param activeFile - The currently active TFile.
	 */
	addRenameAndMoveInputs(
		menu: Menu,
		img: HTMLImageElement,
		activeFile: TFile
	) {
		const isNativeMenus = this.isNativeMenusEnabled();

		if (!isNativeMenus && !Platform.isMobile) {
			const imagePath = this.getImagePathSafe(img);
			const isImageResolvable = imagePath !== null;

			let fileNameWithoutExt = "";
			let directoryPath = "";
			let fileExtension = "";
			let obsidianVaultPathForRename: string | undefined;
			let file: TFile | File;

			if (isImageResolvable) {
				const parsedPath = path.parse(imagePath);
				fileNameWithoutExt = parsedPath.name;
				directoryPath = parsedPath.dir;
				fileExtension = parsedPath.ext;
				obsidianVaultPathForRename = imagePath;
				if (!directoryPath) {
					directoryPath = "/";
				}

				const abstractFile =
					this.app.vault.getAbstractFileByPath(imagePath);
				file =
					abstractFile instanceof TFile
						? abstractFile
						: new File([""], imagePath);
			}

		menu.addItem((item) => {
				const menuItem = item as MenuItemWithDom;

				// Create main container
				const inputContainer = document.createElement("div");
				inputContainer.className =
					"image-converter-contextmenu-info-container";

				// Create name input group
				const nameGroup = document.createElement("div");
				nameGroup.className = "image-converter-contextmenu-input-group";

				const nameIcon = document.createElement("div");
				nameIcon.className =
					"image-converter-contextmenu-icon-container";
				setIcon(nameIcon, "file-text");
				nameGroup.appendChild(nameIcon);

				const nameLabel = document.createElement("label");
				nameLabel.textContent = "Name:";
				nameLabel.setAttribute("for", "image-converter-name-input");
				nameGroup.appendChild(nameLabel);

				const nameInput = document.createElement("input");
				nameInput.type = "text";
				nameInput.value = fileNameWithoutExt;
				nameInput.placeholder = "Enter a new image name";
				nameInput.className = "image-converter-contextmenu-name-input";
				nameInput.id = "image-converter-name-input";
				if (!isImageResolvable) {
					nameInput.classList.add(
						"image-converter-contextmenu-disabled"
					);
				}
				nameGroup.appendChild(nameInput);

				// Create path input group
				const pathGroup = document.createElement("div");
				pathGroup.className = "image-converter-contextmenu-input-group";

				const pathIcon = document.createElement("div");
				pathIcon.className =
					"image-converter-contextmenu-icon-container";
				setIcon(pathIcon, "folder");
				pathGroup.appendChild(pathIcon);

				const pathLabel = document.createElement("label");
				pathLabel.textContent = "Folder:";
				pathLabel.setAttribute("for", "image-converter-path-input");
				pathGroup.appendChild(pathLabel);

				const pathInput = document.createElement("input");
				pathInput.type = "text";
				pathInput.value = directoryPath;
				pathInput.placeholder = "Enter a new path for the image";
				pathInput.className = "image-converter-contextmenu-path-input";
				pathInput.id = "image-converter-path-input";
				if (!isImageResolvable) {
					pathInput.classList.add(
						"image-converter-contextmenu-disabled"
					);
				}
				pathGroup.appendChild(pathInput);

				// Create caption input group
				const captionGroup = document.createElement("div");
				captionGroup.className =
					"image-converter-contextmenu-input-group";

				const captionIcon = document.createElement("div");
				captionIcon.className =
					"image-converter-contextmenu-icon-container";
				setIcon(captionIcon, "subtitles");
				captionGroup.appendChild(captionIcon);

				const captionLabel = document.createElement("label");
				captionLabel.textContent = "Caption:";
				captionLabel.setAttribute(
					"for",
					"image-converter-caption-input"
				);
				captionGroup.appendChild(captionLabel);

				const captionInput = document.createElement("input");
				captionInput.type = "text";
				captionInput.placeholder = "Loading caption...";
				captionInput.className =
					"image-converter-contextmenu-caption-input";
				captionInput.id = "image-converter-caption-input";
				captionGroup.appendChild(captionInput);

				// Create dimensions input group
				const dimensionsGroup = document.createElement("div");
				dimensionsGroup.className =
					"image-converter-contextmenu-input-group";

				const dimensionsIcon = document.createElement("div");
				dimensionsIcon.className =
					"image-converter-contextmenu-icon-container";
				setIcon(dimensionsIcon, "aspect-ratio");
				dimensionsGroup.appendChild(dimensionsIcon);

				const dimensionsLabel = document.createElement("label");
				dimensionsLabel.textContent = "Size:";
				dimensionsLabel.setAttribute(
					"for",
					"image-converter-width-input"
				);
				dimensionsGroup.appendChild(dimensionsLabel);

				// Create width input
				const widthInput = document.createElement("input");
				widthInput.type = "number";
				widthInput.min = "1";
				widthInput.placeholder = "W";
				widthInput.className =
					"image-converter-contextmenu-dimension-input";
				widthInput.id = "image-converter-width-input";

				// Create height input
				const heightInput = document.createElement("input");
				heightInput.type = "number";
				heightInput.min = "1";
				heightInput.placeholder = "H";
				heightInput.className =
					"image-converter-contextmenu-dimension-input";
				heightInput.id = "image-converter-height-input";

				// Create dimension inputs container
				const dimensionInputsContainer = document.createElement("div");
				dimensionInputsContainer.className =
					"image-converter-contextmenu-dimension-inputs";
				dimensionInputsContainer.appendChild(widthInput);
				dimensionInputsContainer.appendChild(
					document.createTextNode("×")
				); // multiplication symbol
				dimensionInputsContainer.appendChild(heightInput);

				dimensionsGroup.appendChild(dimensionInputsContainer);

				// Load current dimensions
				this.loadCurrentDimensions(img, activeFile)
					.then(({ width, height }) => {
						widthInput.value = width;
						heightInput.value = height;
					})
					.catch((error: unknown) => {
						console.error("Failed to load dimensions:", error);
					});

				// Add all groups to container
				inputContainer.appendChild(nameGroup);
				inputContainer.appendChild(pathGroup);
				inputContainer.appendChild(captionGroup);
				inputContainer.appendChild(dimensionsGroup);

				// Add single confirm button
				const confirmButton = document.createElement("div");
				confirmButton.className =
					"image-converter-contextmenu-button image-converter-contextmenu-confirm";
				setIcon(confirmButton, "check");
				inputContainer.appendChild(confirmButton);

				// Register event listeners for all inputs
				[
					nameInput,
					pathInput,
					captionInput,
					widthInput,
					heightInput,
				].forEach((input) => {
					this.registerDomEvent(
						input,
						"mousedown",
						this.stopPropagationHandler
					);
					this.registerDomEvent(
						input,
						"click",
						this.stopPropagationHandler
					);
					this.registerDomEvent(
						input,
						"keydown",
						this.stopPropagationHandler
					);
				});

				this.registerDomEvent(
					document,
					"click",
					this.documentClickHandler
				);

				// Load the current caption asynchronously
				this.loadCurrentCaption(img, activeFile)
					.then((currentCaption) => {
						captionInput.value = currentCaption;
						captionInput.placeholder = "Enter a custom caption";
					})
					.catch((error: unknown) => {
						console.error("Failed to load caption:", error);
						captionInput.placeholder = "Enter a custom caption";
					});

				// Single confirm button handler
				this.registerDomEvent(confirmButton, "click", async () => {
					if (isImageResolvable) {
						// First handle rename and move
						await this.handleRenameAndMove(
							menu,
							nameInput,
							pathInput,
							img,
							isImageResolvable,
							fileNameWithoutExt,
							fileExtension,
							obsidianVaultPathForRename,
							file,
							activeFile
						);

						// Then handle caption and dimensions update together
						await this.handleDimensionsAndCaptionUpdate(
							menu,
							captionInput,
							widthInput,
							heightInput,
							img,
							activeFile,
							isImageResolvable
						);
					}
				});

				// Clear and set the menu item content (gracefully handle test mocks without a DOM property)
				const maybeDom = menuItem.dom as (HTMLElement & { empty?: () => void }) | undefined;
				if (maybeDom && typeof maybeDom.appendChild === "function") {
					// If Obsidian exposes a DOM element, populate it
					if (typeof maybeDom.empty === "function") {
						maybeDom.empty();
					} else {
						// Fallback: clear children
						while (maybeDom.firstChild) {
							maybeDom.removeChild(maybeDom.firstChild);
						}
					}
					maybeDom.appendChild(inputContainer);
				} else {
					// Minimal fallback for test environment without MenuItem DOM
					(menuItem as MenuItemWithDom & { setTitle?: (title: string) => void }).setTitle?.("Image tools");
				}
			});
		}
	}

	/**
	 * Handles the renaming and moving of the image.
	 * @param menu - The Menu object.
	 * @param nameInput - The HTMLInputElement for the new name.
	 * @param pathInput - The HTMLInputElement for the new path.
	 * @param img - The HTMLImageElement to rename/move.
	 * @param isImageResolvable - Boolean indicating if the image path can be resolved.
	 * @param fileNameWithoutExt - The current file name without extension.
	 * @param fileExtension - The file extension.
	 * @param obsidianVaultPathForRename - The original path of the image in the Obsidian vault.
	 */
	// - `\ / : * ? " < > | [ ] ( )` - INVALID characters
	// Leading and trailing dots (`.`) are removed.
	// Leading and trailing spaces are removed.
	// For more examples check sanitizeFilename inside FolderAndFilenameManagement.ts
	private readonly handleRenameAndMove = async (
		menu: Menu,
		nameInput: HTMLInputElement,
		pathInput: HTMLInputElement,
		img: HTMLImageElement,
		isImageResolvable: boolean,
		fileNameWithoutExt: string,
		fileExtension: string,
		obsidianVaultPathForRename: string | undefined,
		file: TFile | File,
		activeFile: TFile
	) => {
		if (!isImageResolvable) return;
		let newName = nameInput.value;
		let newDirectoryPath = pathInput.value;

		// --- Process variables in the input fields ---
		const variableContext: VariableContext = { file, activeFile };
		newName = await this.variableProcessor.processTemplate(
			newName,
			variableContext
		);
		newDirectoryPath = await this.variableProcessor.processTemplate(
			newDirectoryPath,
			variableContext
		);

		if (!newName.trim()) {
			new Notice("Please enter a new file name.");
			return;
		}

		newName = this.folderAndFilenameManagement.sanitizeFilename(newName);

		if (/^[.]+$/.test(newName.trim())) {
			new Notice("Please enter a valid file name");
			return;
		}
		if (!newDirectoryPath.trim()) {
			new Notice("Please enter a new path.");
			return;
		}

		if (obsidianVaultPathForRename) {
			try {
				// Handle Rename
				if (newName && newName !== fileNameWithoutExt) {
					const newPath = normalizePath(
						path.join(
							newDirectoryPath,
							`${newName}${fileExtension}`
						)
					);
					const abstractFile = this.app.vault.getAbstractFileByPath(
						obsidianVaultPathForRename
					);
					if (abstractFile instanceof TFile) {
						await this.folderAndFilenameManagement.ensureFolderExists(
							newDirectoryPath
						);
						await this.app.fileManager.renameFile(
							abstractFile,
							newPath
						);
						img.src = this.app.vault.getResourcePath(abstractFile);
						new Notice("Image name updated successfully");
					}
				}
				// Handle Movea
				const currentNameWithExtension = `${newName}${fileExtension}`;
				const oldPath = obsidianVaultPathForRename;
				const newPath = normalizePath(
					path.join(newDirectoryPath, currentNameWithExtension)
				);

				if (newPath !== oldPath) {
					const abstractFile =
						this.app.vault.getAbstractFileByPath(oldPath);
					if (abstractFile instanceof TFile) {
						await this.folderAndFilenameManagement.ensureFolderExists(
							newDirectoryPath
						);

						if (oldPath.toLowerCase() === newPath.toLowerCase()) {
							const safeRenameSuccessful =
								await this.folderAndFilenameManagement.safeRenameFile(
									abstractFile,
									newPath
								);
							if (safeRenameSuccessful) {
								new Notice(
									"Image path updated (case-sensitive change)."
								);
							} else {
								new Notice(
									"Image path update failed (case-sensitive change)."
								);
							}
						} else {
							await this.app.fileManager.renameFile(
								abstractFile,
								newPath
							);
							new Notice("Image path updated successfully");
						}
						img.src = this.app.vault.getResourcePath(abstractFile);
						const leaf = this.app.workspace.getMostRecentLeaf();
						if (leaf) {
							const currentState = leaf.getViewState();
							await leaf.setViewState({
								type: "empty",
								state: {},
							});
							await leaf.setViewState(currentState);
						}
					}
				}
			} catch (error) {
				console.error("Failed to update image path:", error);
				new Notice("Failed to update image path");
			}
		}
		this.hideMenu(menu);
	};

	/*-----------------------------------------------------------------*/
	/*                         OPEN IN NEW WINDOW                      */
	/*-----------------------------------------------------------------*/

	/**
	 * Adds the "Open in new window" menu item.
	 * @param menu - The Menu object to add the item to.
	 * @param img - The HTMLImageElement that was right-clicked.
	 */
	addOpenInNewWindowMenuItem(menu: Menu, img: HTMLImageElement) {
		menu.addItem((item) => {
			item.setTitle("Open in new window")
				.setIcon("square-arrow-out-up-right")
				.onClick(async () => {
					try {
						const imagePath =
							this.folderAndFilenameManagement.getImagePath(img);
						if (imagePath) {
							const file =
								this.app.vault.getAbstractFileByPath(imagePath);
							if (file instanceof TFile) {
								const leaf =
									this.app.workspace.getLeaf("window");
								if (leaf) {
									await leaf.openFile(file);
								}
							}
						}
					} catch (error) {
						new Notice("Failed to open in new window");
						console.error(error);
					}
				});
		});
	}

	/*-----------------------------------------------------------------*/
	/*                        HELPER METHODS                           */
	/*-----------------------------------------------------------------*/

	/**
	 * Normalizes an image path for consistent comparison.
	 * Converts backslashes to forward slashes, replaces '%20' with spaces,
	 * removes query parameters, converts to lowercase, and trims whitespace.
	 *
	 * @param path - The image path to normalize.
	 * @returns The normalized image path, always starting with a '/'.
	 */
	private normalizeImagePath(path: string): string {
		if (!path) return "";

		// Decode URL encoded characters first
		let normalizedPath = decodeURIComponent(path);

		// Remove any URL parameters
		const [pathWithoutQuery] = normalizedPath.split("?");
		normalizedPath = pathWithoutQuery;

		// Convert backslashes to forward slashes
		normalizedPath = normalizedPath.replace(/\\/g, "/");

		// Handle spaces in paths
		normalizedPath = normalizedPath.replace(/%20/g, " ");

		// Ensure consistent leading slash
		if (!normalizedPath.startsWith("/")) {
			normalizedPath = `/${normalizedPath}`;
		}

		// Normalize any '../' or './' sequences
		normalizedPath = normalizePath(normalizedPath);

		return normalizedPath.toLowerCase();
	}

	/**
	 * Finds the line number where the frontmatter section ends in the editor.
	 *
	 * @param editor - The Obsidian Editor instance.
	 * @returns The line number of the frontmatter end, or -1 if not found.
	 */
	private findFrontmatterEnd(editor: Editor): number {
		let inFrontmatter = false;
		const lineCount = editor.getDoc().lineCount();

		for (let i = 0; i < lineCount; i++) {
			const line = editor.getLine(i).trim();
			if (line === "---") {
				if (!inFrontmatter && i === 0) {
					inFrontmatter = true;
				} else if (inFrontmatter) {
					return i;
				}
			}
		}
		return -1;
	}

	/**
	 * Extracts the filename from an image link, handling both wiki and markdown formats.
	 *
	 * @param link - The full image link.
	 * @returns The extracted filename, or null if not found.
	 */
	private extractFilenameFromLink(link: string): string | null {
		const wikiMatch = link.match(/!\[\[\s*([^|\]]+?)\s*(?:\|[^\]]+)?\]\]/);
		if (wikiMatch) {
			return wikiMatch[1].trim(); // Trim spaces
		}

		const markdownMatch = link.match(/!\[.*?\]\(\s*(.*?)\s*\)/);
		if (markdownMatch) {
			return markdownMatch[1].trim(); // Trim spaces
		}

		return null;
	}

	/**
	 * Finds image links in the editor's content based on the provided criteria.
	 *
	 * @param editor - The Obsidian Editor instance.
	 * @param imagePath - The path of the image (for local images) or null (for external images).
	 * @param isExternal - A flag indicating whether the image is external.
	 * @returns An array of objects, each containing the line number, line content, and full match
	 *          for each matching image link found. Returns an empty array if no matches are found.
	 */
	private async findImageMatches(
		editor: Editor,
		imagePath: string | null,
		isExternal: boolean
	): Promise<{ lineNumber: number; line: string; fullMatch: string }[]> {
		// Helper function to resolve relative paths
		const resolveRelativePath = (
			linkPath: string,
			activeFilePath: string
		): string => {
			const activeFileDir = path.dirname(activeFilePath);
			if (linkPath.startsWith("./") || linkPath.startsWith("../")) {
				return normalizePath(path.join(activeFileDir, linkPath));
			}
			return normalizePath(linkPath);
		};

		const lineCount = editor.getDoc().lineCount();
		const frontmatterEnd = this.findFrontmatterEnd(editor);
		const matches: {
			lineNumber: number;
			line: string;
			fullMatch: string;
		}[] = [];
		const activeFile = this.app.workspace.getActiveFile();

		if (!activeFile) return matches;

		for (let i = frontmatterEnd + 1; i < lineCount; i++) {
			const line = editor.getLine(i);

			// Check wiki-style links (![[path/to/image.png]])  Added ? after last ] to be non-greedy
			const wikiMatches = [
				...line.matchAll(/!\[\[([^\]]+?)(?:\|[^\]]+?)??\]\]/g),
			];
			for (const match of wikiMatches) {
				const fullMatch = match[0].trim();

				const filename = this.extractFilenameFromLink(fullMatch);
				if (filename && !isExternal) {
					const resolvedPath = resolveRelativePath(
						filename,
						activeFile.path
					);

					if (imagePath) {
						const normalizedImagePath =
							this.normalizeImagePath(imagePath);
						const normalizedResolvedPath =
							this.normalizeImagePath(resolvedPath);

						// Check for exact match or if the normalized image path ends with the resolved path
						if (
							normalizedImagePath === normalizedResolvedPath ||
							normalizedImagePath.endsWith(normalizedResolvedPath)
						) {
							matches.push({ lineNumber: i, line, fullMatch });
							// console.log('Wiki match found:', {
							// 	normalizedImagePath,
							// 	normalizedResolvedPath,
							// 	fullMatch
							// });
						}
					}
				}
			}

			// Check markdown-style links (![alt](path/to/image.png))
			const mdMatches = [
				...line.matchAll(
					/!\[([^\]]*?)(?:\|\d+(?:\|\d+)?)?\]\(([^)]+)\)/g
				),
			];
			for (const match of mdMatches) {
				const [fullMatch, , linkPath] = match;

				if (!isExternal && linkPath) {
					const resolvedPath = resolveRelativePath(
						linkPath,
						activeFile.path
					);

					if (imagePath) {
						const normalizedImagePath =
							this.normalizeImagePath(imagePath);
						const normalizedResolvedPath =
							this.normalizeImagePath(resolvedPath);

						// Check for exact match or if the normalized image path ends with the resolved path
						if (
							normalizedImagePath === normalizedResolvedPath ||
							normalizedImagePath.endsWith(normalizedResolvedPath)
						) {
							matches.push({ lineNumber: i, line, fullMatch });
							// console.log('Markdown match found:', {
							// 	normalizedImagePath,
							// 	normalizedResolvedPath,
							// 	fullMatch
							// });
						}

						// Additional check for paths starting with ./
						if (linkPath.startsWith("./")) {
							const linkPathWithoutDotSlash =
								linkPath.substring(2);
							const normalizedLinkPathWithoutDotSlash =
								this.normalizeImagePath(
									linkPathWithoutDotSlash
								);

							if (
								normalizedImagePath.endsWith(
									normalizedLinkPathWithoutDotSlash
								)
							) {
								matches.push({
									lineNumber: i,
									line,
									fullMatch,
								});
								// console.log('Markdown dot-slash match found:', {
								// 	normalizedImagePath,
								// 	normalizedLinkPathWithoutDotSlash,
								// 	fullMatch
								// });
							}
						}
					}
				} else if (
					isExternal &&
					(linkPath.startsWith("http://") ||
						linkPath.startsWith("https://"))
				) {
					matches.push({ lineNumber: i, line, fullMatch });
					// console.log('External link match found:', {
					// 	linkPath,
					// 	fullMatch
					// });
				}
			}
		}

		// Log all matches for debugging
		// if (matches.length > 0) {
		// 	console.log('All matches found:', matches);
		// } else {
		// 	console.log('No matches found for:', {
		// 		imagePath,
		// 		isExternal
		// 	});
		// }

		return matches;
	}

	/**
	 * Processes the first Base64 image found in the editor's content.
	 *
	 * @param editor - The Obsidian Editor instance.
	 * @param src - The `src` attribute of the Base64 image to search for.
	 * @param processor - A callback function to process the matched Base64 image.
	 *                    This function takes the editor, line number, line content, and full match as arguments.
	 * @returns True if a Base64 image was found and processed, false otherwise.
	 */
	private async processBase64Image(
		editor: Editor,
		src: string,
		processor: (
			editor: Editor,
			lineNumber: number,
			line: string,
			fullMatch: string
		) => Promise<void>
	): Promise<boolean> {
		const lineCount = editor.getDoc().lineCount();
		for (let i = 0; i < lineCount; i++) {
			const line = editor.getLine(i);
			const base64Matches = [
				...line.matchAll(/<img\s+src="data:image\/[^"]+"\s*\/?>/g),
			];

			for (const match of base64Matches) {
				if (match[0].includes(src)) {
					await processor(editor, i, line, match[0]);
					return true;
				}
			}
		}
		return false;
	}

	/**
	 * Helper method to remove an image link from the editor.
	 * @param editor - The Editor instance.
	 * @param lineNumber - The line number where the match was found.
	 * @param line - The line content.
	 * @param fullMatch - The full matched text.
	 * @param copyToClipboard - Whether to copy the text to clipboard before removing.
	 */
	private async removeImageLinkFromEditor(
		editor: Editor,
		lineNumber: number,
		line: string,
		fullMatch: string,
		copyToClipboard: boolean
	) {
		if (copyToClipboard) {
			await navigator.clipboard.writeText(fullMatch);
		}

		const startPos = {
			line: lineNumber,
			ch: line.indexOf(fullMatch),
		};
		const endPos = {
			line: lineNumber,
			ch: startPos.ch + fullMatch.length,
		};

		// Calculate trailing whitespace
		let trailingWhitespace = 0;
		while (
			line[endPos.ch + trailingWhitespace] === " " ||
			line[endPos.ch + trailingWhitespace] === "\t"
		) {
			trailingWhitespace++;
		}

		// If this is the only content on the line, delete the entire line
		if (line.trim() === fullMatch.trim()) {
			editor.replaceRange(
				"",
				{ line: lineNumber, ch: 0 },
				{ line: lineNumber + 1, ch: 0 }
			);
		} else {
			// Otherwise, just delete the match and its trailing whitespace
			editor.replaceRange("", startPos, {
				line: lineNumber,
				ch: endPos.ch + trailingWhitespace,
			});
		}
	}

	/*-----------------------------------------------------------------*/
	/*                           CUT IMAGE                             */
	/*-----------------------------------------------------------------*/

	/**
	 * Adds the "Cut" menu item.
	 * @param menu - The Menu object to add the item to.
	 * @param event - The MouseEvent object.
	 */
	addCutImageMenuItem(menu: Menu, event: MouseEvent) {
		menu.addItem((item) => {
			item.setTitle("Cut")
				.setIcon("scissors")
				.onClick(async () => {
					await this.cutImageAndLinkFromNote(event);
				});
		});
	}

	/**
	 * Cuts the image and its link from the note, copying the link to clipboard.
	 * @param event - The MouseEvent object.
	 */
	async cutImageAndLinkFromNote(event: MouseEvent) {
		const img = event.target as HTMLImageElement;
		const src = img.getAttribute("src");
		if (!src) return;

		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) {
			new Notice("No active Markdown view found");
			return;
		}

		try {
			const { editor } = activeView;

			if (src.startsWith("data:image/")) {
				const found = await this.processBase64Image(
					editor,
					src,
					async (editor, lineNumber, line, fullMatch) => {
						await this.removeImageLinkFromEditor(
							editor,
							lineNumber,
							line,
							fullMatch,
							true
						);
					}
				);
				if (!found) {
					// eslint-disable-next-line obsidianmd/ui/sentence-case -- Base64 is a proper technical term
					new Notice("Failed to find Base64 image link");
				}
				return;
			}

			const imagePath =
				src.startsWith("http://") || src.startsWith("https://")
					? null
					: this.folderAndFilenameManagement.getImagePath(img);

			const isExternal = !imagePath;

			// Use the modified findImageMatches
			const matches = await this.findImageMatches(
				editor,
				imagePath,
				isExternal
			);

			if (matches.length === 0) {
				new Notice("Failed to find image link in the current note.");
				return;
			}

			const handleConfirmation = async () => {
				for (const match of matches) {
					await this.removeImageLinkFromEditor(
						editor,
						match.lineNumber,
						match.line,
						match.fullMatch,
						true
					);
				}
				new Notice(
					"Image link(s) cut from note and copied to clipboard"
				);
			};

		if (matches.length > 1) {
				// Show confirmation modal
				new ConfirmDialog(
					this.app,
					"Confirm Cut",
					`Found ${matches.length} matching image links inside current note. Do you want to cut all of them?`,
					"Cut",
					() => {
						handleConfirmation().catch((error: unknown) => {
							console.error("Failed to cut image links:", error);
							new Notice("Failed to cut. See console for details.");
						});
					}
				).open();
			} else {
				// Proceed directly if only one match
				await handleConfirmation();
			}
		} catch (error) {
			console.error("Error cutting image:", error);
			new Notice("Failed to cut image. Check console for details.");
		}
	}

	/*-----------------------------------------------------------------*/
	/*                          COPY IMAGE                             */
	/*-----------------------------------------------------------------*/

	/**
	 * Adds the "Copy image" menu item.
	 * @param menu - The Menu object to add the item to.
	 * @param event - The MouseEvent object.
	 */
	addCopyImageMenuItem(menu: Menu, event: MouseEvent) {
		menu.addItem((item: MenuItem) =>
			item
				.setTitle("Copy image")
				.setIcon("copy")
				.onClick(async () => {
					await this.copyImageToClipboard(event);
				})
		);
	}

	/**
	 * Copies the image to the clipboard.
	 * @param event - The MouseEvent object.
	 */
	async copyImageToClipboard(event: MouseEvent) {
		const img = new Image();
		img.crossOrigin = "anonymous";
		const targetImg = event.target as HTMLImageElement;

		// Use this.registerDomEvent() for proper cleanup
		this.registerDomEvent(img, "load", async () => {
			try {
				const canvas = document.createElement("canvas");
				canvas.width = img.naturalWidth;
				canvas.height = img.naturalHeight;
				const ctx = canvas.getContext("2d");
				if (!ctx) {
					new Notice("Failed to get canvas context");
					return;
				}
				ctx.drawImage(img, 0, 0);
				const blob = await this.canvasToBlob(canvas);
				const item = new ClipboardItem({ [blob.type]: blob });
				await navigator.clipboard.write([item]);
				new Notice("Image copied to clipboard");
			} catch (error) {
				console.error("Failed to copy image:", error);
				new Notice("Failed to copy image to clipboard");
			}
		});

		img.src = targetImg.src;
	}

	/*-----------------------------------------------------------------*/
	/*                      COPY BASE64 IMAGE                          */
	/*-----------------------------------------------------------------*/

	/**
	 * Adds the "Copy as Base64 encoded image" menu item.
	 * @param menu - The Menu object to add the item to.
	 * @param event - The MouseEvent object.
	 */
	addCopyBase64ImageMenuItem(menu: Menu, event: MouseEvent) {
		menu.addItem((item: MenuItem) =>
			item
				// eslint-disable-next-line obsidianmd/ui/sentence-case -- Base64 is a proper technical term
				.setTitle("Copy as Base64 encoded image")
				.setIcon("copy")
				.onClick(() => {
					void this.copyImageAsBase64(event);
				})
		);
	}

	/**
	 * Copies the image as a Base64 encoded string to the clipboard.
	 * @param event - The MouseEvent object.
	 */
	async copyImageAsBase64(event: MouseEvent) {
		const targetImg = event.target as HTMLImageElement;
		const img = new Image();
		img.crossOrigin = "anonymous";

		this.registerDomEvent(img, "load", async () => {
			try {
				const canvas = document.createElement("canvas");
				canvas.width = img.naturalWidth;
				canvas.height = img.naturalHeight;
				const ctx = canvas.getContext("2d");
				if (!ctx) {
					new Notice("Failed to get canvas context");
					return;
				}
				ctx.drawImage(img, 0, 0);
				const dataURL = canvas.toDataURL();
				await navigator.clipboard.writeText(`<img src="${dataURL}"/>`);
				// eslint-disable-next-line obsidianmd/ui/sentence-case -- Base64 is a proper technical term
				new Notice("Image copied to clipboard as Base64");
			} catch (error) {
				console.error("Failed to copy image as Base64:", error);
				// eslint-disable-next-line obsidianmd/ui/sentence-case -- Base64 is a proper technical term
				new Notice("Failed to copy image as Base64");
			}
		});

		img.src = targetImg.src;
	}

	/*-----------------------------------------------------------------*/
	/*                            Convert/Compress                     */
	/*-----------------------------------------------------------------*/

	/**
	 * Adds the "Convert/Compress" menu item.
	 *
	 * @param menu - The Menu object to add the item to.
	 * @param img - The HTMLImageElement representing the image.
	 * @param event - The MouseEvent representing the context menu event.
	 */
	addProcessImageMenuItem(
		menu: Menu,
		img: HTMLImageElement,
		event: MouseEvent
	) {
		menu.addItem((item) => {
			item.setTitle("Convert/compress...")
				.setIcon("cog")
				.onClick(async () => {
					try {
						// Ensure there is an active markdown view
						const activeView =
							this.app.workspace.getActiveViewOfType(
								MarkdownView
							);
					if (!activeView) {
						new Notice("No active Markdown view");
						return;
					}

					// Get the current note being viewed
					const currentFile = activeView.file;
					if (!currentFile) {
						new Notice("No current file found");
							return;
						}

						// Extract the filename from the img's src attribute
						const srcAttribute = img.getAttribute("src");
						if (!srcAttribute) {
							new Notice(
								"No source attribute found on the image"
							);
							return;
						}

						// Decode the filename from the src attribute
						const filename = decodeURIComponent(
							srcAttribute.split("?")[0].split("/").pop() || ""
						);
						if (!filename) {
							new Notice(
								"Unable to extract filename from the image source"
							);
							return;
						}

						// Search for matching files in the vault
						const matchingFiles = this.app.vault
							.getFiles()
							.filter((file) => file.name === filename);
						if (matchingFiles.length === 0) {
							console.error(
								"No matching files found for:",
								filename
							);
							new Notice(`Unable to find image: ${filename}`);
							return;
						}

						// If multiple matches, prefer files in the same folder as the current note
						const file =
							matchingFiles.length === 1
								? matchingFiles[0]
								: matchingFiles.find((fileItem) => {
										const parentPath =
											currentFile.parent?.path;
										return parentPath
											? fileItem.path.startsWith(
													parentPath
											  )
											: false;
								  }) || matchingFiles[0];

						// Process the found file
						if (file instanceof TFile) {
							new ProcessSingleImageModal(
								this.app,
								this.plugin,
								file
							).open();
					} else {
						new Notice("Not a valid image file");
					}
					} catch (error) {
						console.error("Error processing image:", error);
						new Notice("Error processing image");
					}
				});
		});
	}

	/*-----------------------------------------------------------------*/
	/*                            CROP                                 */
	/*-----------------------------------------------------------------*/

	/**
	 * Adds the "Crop/Rotate/Flip" menu item.
	 * @param menu - The Menu object to add the item to.
	 * @param img - The HTMLImageElement that was right-clicked.
	 */
	addCropRotateFlipMenuItem(menu: Menu, img: HTMLImageElement) {
		menu.addItem((item) => {
			item.setTitle("Crop/rotate/flip")
				.setIcon("scissors")
				.onClick(async () => {
					// Get the active markdown view
					const activeView =
						this.app.workspace.getActiveViewOfType(MarkdownView);
					if (!activeView) {
						new Notice("No active Markdown view");
						return;
					}

					// Get the current file (note) being viewed
					const currentFile = activeView.file;
					if (!currentFile) {
						new Notice("No current file found");
						return;
					}

					// Get the filename from the src attribute
					const srcAttribute = img.getAttribute("src");
					if (!srcAttribute) {
						new Notice("No source attribute found");
						return;
					}

					// Extract just the filename
					const filename = decodeURIComponent(
						srcAttribute.split("?")[0].split("/").pop() || ""
					);

					// Search for the file in the vault
					const matchingFiles = this.app.vault
						.getFiles()
						.filter((file) => file.name === filename);

					if (matchingFiles.length === 0) {
						console.error("No matching files found for:", filename);
						new Notice(`Unable to find image: ${filename}`);
						return;
					}

					// If multiple matches, try to find the one in the same folder as the current note
					const file =
						matchingFiles.length === 1
							? matchingFiles[0]
							: matchingFiles.find((fileItem) => {
									// Get the parent folder of the current file
									const parentPath = currentFile.parent?.path;
									return parentPath
										? fileItem.path.startsWith(parentPath)
										: false;
							  }) || matchingFiles[0];

					if (file instanceof TFile) {
						new Crop(this.app, file).open();
					} else {
						new Notice("Unable to locate image file");
					}
				});
		});
	}

	/*-----------------------------------------------------------------*/
	/*                      Image Annotation                           */
	/*-----------------------------------------------------------------*/

	addAnnotateImageMenuItem(menu: Menu, img: HTMLImageElement) {
		menu.addItem((item) => {
			item.setTitle("Annotate image")
				.setIcon("pencil")
				.onClick(async () => {
					try {
						// Get the active markdown view
						const activeView =
						this.app.workspace.getActiveViewOfType(
							MarkdownView
						);
					if (!activeView) {
						new Notice("No active Markdown view");
						return;
					}

					// Get the current file (note) being viewed
					const currentFile = activeView.file;
					if (!currentFile) {
						new Notice("No current file found");
						return;
					}

					// Get the filename from the src attribute
					const srcAttribute = img.getAttribute("src");
					if (!srcAttribute) {
						new Notice("No source attribute found");
							return;
						}

						// Extract just the filename
						const filename = decodeURIComponent(
							srcAttribute.split("?")[0].split("/").pop() || ""
						);
						// console.log('Extracted filename:', filename);

						// Search for the file in the vault
						const matchingFiles = this.app.vault
							.getFiles()
							.filter((file) => file.name === filename);

						if (matchingFiles.length === 0) {
							console.error(
								"No matching files found for:",
								filename
							);
							new Notice(`Unable to find image: ${filename}`);
							return;
						}

						// If multiple matches, try to find the one in the same folder as the current note
						const file =
							matchingFiles.length === 1
								? matchingFiles[0]
								: matchingFiles.find((fileItem) => {
										// Get the parent folder of the current file
										const parentPath =
											currentFile.parent?.path;
										return parentPath
											? fileItem.path.startsWith(
													parentPath
											  )
											: false;
								  }) || matchingFiles[0];

						if (file instanceof TFile) {
							// console.log('Found file:', file.path);
							new ImageAnnotationModal(
								this.app,
								this.plugin,
								file
							).open();
						} else {
							new Notice("Unable to locate image file");
						}
					} catch (error) {
						console.error("Image location error:", error);
						new Notice("Error processing image path");
					}
				});
		});
	}

	/*-----------------------------------------------------------------*/
	/*                      SHOW IN NAVIGATION                         */
	/*-----------------------------------------------------------------*/

	/**
	 * Adds the "Show in navigation" menu item.
	 * @param menu - The Menu object to add the item to.
	 * @param img - The HTMLImageElement whose file needs to be shown.
	 */
	addShowInNavigationMenuItem(menu: Menu, img: HTMLImageElement) {
		menu.addItem((item) => {
			item.setTitle("Show in navigation")
				.setIcon("folder-open")
				.onClick(async () => {
					await this.showImageInNavigation(img);
				});
		});
	}

	/**
	 * Shows the image file in the navigation pane.
	 * @param img - The HTMLImageElement whose file needs to be shown.
	 */
	async showImageInNavigation(img: HTMLImageElement) {
		try {
			const imagePath =
				this.folderAndFilenameManagement.getImagePath(img);
			if (imagePath) {
				const file = this.app.vault.getAbstractFileByPath(imagePath);
				if (file instanceof TFile) {
					// First, try to get existing file explorer
					let [fileExplorerLeaf] =
						this.app.workspace.getLeavesOfType("file-explorer");

					// If file explorer isn't open, create it
					if (!fileExplorerLeaf) {
						const newLeaf = this.app.workspace.getLeftLeaf(false);
						if (newLeaf) {
							await newLeaf.setViewState({
								type: "file-explorer",
							});
							fileExplorerLeaf = newLeaf;
						}
					}

					// Proceed only if we have a valid leaf
					if (fileExplorerLeaf) {
						// Ensure the left sidebar is expanded
						if (this.app.workspace.leftSplit) {
							this.app.workspace.leftSplit.expand();
						}

						// Now reveal the file using internal file explorer API
						const fileExplorerView = fileExplorerLeaf.view as FileExplorerView;
						fileExplorerView.revealInFolder?.(file);
					}
				}
			}
		} catch (error) {
			new Notice("Failed to show in navigation");
			console.error(error);
		}
	}

	/*-----------------------------------------------------------------*/
	/*                  SHOW IN SYSTEM EXPLORER                        */
	/*-----------------------------------------------------------------*/
	/**
	 * Adds the "Show in system explorer" menu item.
	 * @param menu - The Menu object to add the item to.
	 * @param img - The HTMLImageElement whose file needs to be shown in the system explorer.
	 */
	addShowInSystemExplorerMenuItem(menu: Menu, img: HTMLImageElement) {
		menu.addItem((item) => {
			item.setTitle("Show in system explorer")
				.setIcon("arrow-up-right")
				.onClick(async () => {
					await this.showImageInSystemExplorer(img);
				});
		});
	}

	/**
	 * Shows the image file in the system explorer.
	 * @param img - The HTMLImageElement whose file needs to be shown in the system explorer.
	 */
	async showImageInSystemExplorer(img: HTMLImageElement) {
		try {
			const imagePath =
				this.folderAndFilenameManagement.getImagePath(img);
			if (imagePath) {
				// Use the Obsidian API to reveal the file in the system explorer
				await this.app.showInFolder(imagePath);
			}
		} catch (error) {
			new Notice("Failed to show in system explorer");
			console.error(error);
		}
	}

	/*-----------------------------------------------------------------*/
	/*                  DELETE IMAGE AND LINK                          */
	/*-----------------------------------------------------------------*/

	/**
	 * Adds the "Delete Image and Link" menu item.
	 * @param menu - The Menu object to add the item to.
	 * @param event - The MouseEvent object.
	 */
	addDeleteImageAndLinkMenuItem(menu: Menu, event: MouseEvent) {
		menu.addItem((item) => {
			item.setTitle("Delete image and link")
				.setIcon("trash")
				.onClick(async () => {
					await this.deleteImageAndLinkFromNote(event);
				});
		});
	}

	/**
	 * Deletes both the image file and its link from the note.
	 * @param event - The MouseEvent object.
	 */
	async deleteImageAndLinkFromNote(event: MouseEvent) {
		const img = event.target as HTMLImageElement;
		const src = img.getAttribute("src");
		if (!src) return;

		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) {
			new Notice("No active Markdown view found");
			return;
		}

		try {
			const { editor } = activeView;

			if (src.startsWith("data:image/")) {
				const found = await this.processBase64Image(
					editor,
					src,
					async (editor, lineNumber, line, fullMatch) => {
						await this.removeImageLinkFromEditor(
							editor,
							lineNumber,
							line,
							fullMatch,
							false
						);
					}
				);
			if (!found) {
				// eslint-disable-next-line obsidianmd/ui/sentence-case -- Base64 is a proper technical term
				new Notice("Failed to find Base64 image link");
			}
				return;
			}

			const imagePath =
				src.startsWith("http://") || src.startsWith("https://")
					? null
					: this.folderAndFilenameManagement.getImagePath(img);

			const isExternal = !imagePath;
			const matches = await this.findImageMatches(
				editor,
				imagePath,
				isExternal
			);

			if (matches.length === 0) {
				new Notice("Failed to find image link in the current note.");
				return;
			}

			// Identify unique matches based on line number, line content, and full match
			const uniqueMatchesMap: Map<string, ImageMatch> = new Map();
			for (const match of matches) {
				const key = `${match.lineNumber}-${match.line}-${match.fullMatch}`; // Create a unique key
				if (!uniqueMatchesMap.has(key)) {
					uniqueMatchesMap.set(key, match); // Add to map if not already present
				}
			}
			const uniqueMatches: ImageMatch[] = Array.from(
				uniqueMatchesMap.values()
			);

			if (uniqueMatches.length === 0) {
				new Notice(
					"Failed to find unique image links in the current note."
				); // Should not happen ideally as 'matches.length > 0' check is before, but good to have.
				return;
			}

			const handleConfirmation = async () => {
				// Sort matches by line number in descending order to handle deletions from bottom to top
				// This prevents line number shifting from affecting subsequent deletions
				const sortedMatches = uniqueMatches.sort(
					(matchA, matchB) => matchB.lineNumber - matchA.lineNumber
				);

				for (const match of sortedMatches) {
					await this.removeImageLinkFromEditor(
						editor,
						match.lineNumber,
						match.line,
						match.fullMatch,
						false
					);
				}

				new Notice("Image link(s) removed from note");

				// Delete the actual image file if it exists in the vault
				if (imagePath) {
					const imageFile =
						this.app.vault.getAbstractFileByPath(imagePath);
					if (imageFile instanceof TFile) {
						// Use FileManager.trashFile instead of direct deletion so that Obsidian's
						// file deletion settings are honored (e.g., "Move to system trash" vs
						// "Permanently delete").
						await this.app.fileManager.trashFile(imageFile);
						new Notice("Image file moved to trash");
					}
				}
			};

			// Show info in confirmation MODAL if more than 1 UNIQUE image were found
			if (uniqueMatches.length > 1) {
				// Create a DocumentFragment for the details
				const detailsFragment = document.createDocumentFragment();

				// Create a container div for the message within the fragment
				const messageContainer = document.createElement("div");
				detailsFragment.appendChild(messageContainer);

				// Add introductory text
				const introText = document.createElement("p");
				introText.textContent = `Found ${uniqueMatches.length} unique matching image links inside current note. Do you want to delete all of them?`; // Updated message
				messageContainer.appendChild(introText);

				// Add details to the message container
				uniqueMatches.forEach((match, index) => {
					// Iterate over uniqueMatches
					const lineNumber = match.lineNumber + 1;
					const lineContent = match.line.trim();
					const detailDiv = document.createElement("div");
					detailDiv.addClass("image-converter-confirm-detail");
					detailDiv.createSpan({ text: `  ${index + 1}. Line ${lineNumber}: ${lineContent}` });
					messageContainer.appendChild(detailDiv); // Append to messageContainer
				});

				new ConfirmDialog(
					this.app,
					"Confirm Delete",
					detailsFragment,
					"Delete",
					() => {
						handleConfirmation().catch((error: unknown) => {
							console.error("Failed to delete image:", error);
							new Notice("Failed to delete. See console for details.");
						});
					}
				).open();
			} else if (uniqueMatches.length === 1) {
				// if only 1 unique match, proceed directly without confirmation for multiple
				await handleConfirmation();
			} else {
				// This case should not happen because of the initial check `if (uniqueMatches.length === 0)` but for completeness.
				new Notice("No unique image links found to delete.");
			}
		} catch (error) {
			console.error("Error deleting image:", error);
			new Notice("Failed to delete image. Check console for details.");
		}
	}

	onunload() {
		super.onunload(); // Important! Calls Component's cleanup
		if (this.currentMenu) {
			this.hideMenu(this.currentMenu);
			this.currentMenu = null;
		}
		this.contextMenuRegistered = false;
	}
}

import {
    App,
    Modal,
    Notice,
    TFile,
    ButtonComponent,
    DropdownComponent,
    Component,
    MarkdownView,
    Scope,
} from 'obsidian';
import {
    Canvas,
    FabricImage,
    IText,
    FabricObject,
    PencilBrush,
    ActiveSelection,
    Point,
    Pattern,
    util,
    Path,
    TEvent,
    TBrushEventData,
    ImageFormat,
} from 'fabric';
import ImageConverterPlugin from './main'; // Assuming this is your main plugin file

import mime from "./mime.min.js"

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

export interface ToolPreset {
    size: number;
    color: string;
    opacity: number;
    blendMode: BlendMode;
    backgroundColor?: string;
    backgroundOpacity?: number;
}


enum ToolMode {
    None,
    Draw,
    Text,
    Arrow
}

export class ImageAnnotationModal extends Modal {
    private componentContainer = new Component();
    private currentTool: ToolMode = ToolMode.None;
    private canvas: Canvas;
    
    // UI Components
    private drawButton: ButtonComponent | undefined = undefined;
    private textButton: ButtonComponent | undefined;
    private arrowButton: ButtonComponent | undefined;
    private resizeHandle: HTMLDivElement | null = null;
    private backgroundDropdown: HTMLElement | null = null;
    private textBackgroundControls: HTMLElement | null = null;
    
    // State Management
    private isDrawingMode = false;
    private isTextMode = false;
    private isArrowMode = false;
    private isTextEditingBlocked = false;
    private _previousStates: { drawingMode: boolean; } | null = null;
    private isResizing = false;
    private isPanning = false;
    private isSpacebarDown = false;
    private isUndoRedoAction = false;
    private preserveObjectStacking = true;
	
    // Drawing Settings
    private readonly brushSizes = [2, 4, 8, 12, 16, 24];
    private readonly brushOpacities = [0.2, 0.4, 0.6, 0.8, 0.9, 1.0];
    private currentBrushSizeIndex = 2;
    private currentOpacityIndex = 5;
    private currentBlendMode: BlendMode = 'source-over';
    private currentBackground: BackgroundType = 'transparent';
    
    // Constants and Limits
    private readonly minWidth = 400;
    private readonly minHeight = 300;
    private readonly minZoom = 0.1;
    private readonly maxZoom = 10;
    private currentZoom = 1;
    
    // Event Handlers
    private boundKeyDownHandler: (e: KeyboardEvent) => void;
    private boundKeyUpHandler: (e: KeyboardEvent) => void;
    private lastPanPoint: { x: number; y: number } | null = null;
    
    // History Management
    private undoStack: string[] = [];
    private redoStack: string[] = [];
    
    // Arrays and Options
	private readonly blendModes: BlendMode[] = [
		'source-over',
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
    private readonly backgroundOptions: BackgroundOptions = ['transparent', '#ffffff', '#000000', 'grid', 'dots'] as const;
    private dominantColors: string[] = [];
    private complementaryColors: string[][] = [];
    
    constructor(
        app: App,
        private plugin: ImageConverterPlugin,
        private file: TFile
    ) {
        super(app);
        this.setupModal();
        this.setupEventHandlers();
    }

    private setupModal() {
        this.componentContainer.load();
        this.modalEl.addClass('image-converter-annotation-tool-image-annotation-modal');
        this.setupCloseButton();
    }

    private setupEventHandlers() {
        this.boundKeyDownHandler = this.handleKeyDown.bind(this);
        this.boundKeyUpHandler = this.handleKeyUp.bind(this);
        this.scope = new Scope();
        this.registerShortcuts();
        this.preventDefaultHandlers();
    }

    private setupCloseButton() {
        const closeButton = this.modalEl.querySelector('.modal-close-button') as HTMLElement | null;
        if (closeButton) {
            this.componentContainer.registerDomEvent(closeButton, 'click', (e: MouseEvent) => {
                e.stopPropagation();
                this.close();
            });
        }
    }

    private registerShortcuts() {
        this.scope.register([], 'Escape', (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopPropagation();
            
            const activeObject = this.canvas?.getActiveObject();
            if (activeObject instanceof IText && activeObject.isEditing) {
                activeObject.exitEditing();
            }
            return false;
        });
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.style.padding = '0';
        contentEl.style.overflow = 'hidden';

        const modalContainer = contentEl.createDiv('image-converter-annotation-tool-modal-container');
		this.setupResizable();
		this.setupToolbar(modalContainer);
		
        const canvasContainer = modalContainer.createDiv('image-converter-annotation-tool-canvas-container');
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
				this.componentContainer.registerDomEvent(this.modalEl, 'mousedown', (e) => {
					if (e.target === this.modalEl) {
						e.preventDefault();
						e.stopPropagation();
					}
				});
				// Prevent keyboard events from bubbling up to Obsidian
				this.componentContainer.registerDomEvent(this.modalEl, 'keydown', (e: KeyboardEvent) => {
					e.preventDefault();
					e.stopPropagation();
				}, true);

				this.componentContainer.registerDomEvent(this.modalEl, 'keyup', (e: KeyboardEvent) => {
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
		const colorPickerWrapper = this.modalEl.querySelector('.image-converter-annotation-tool-color-picker-wrapper');
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
		const existingSwatches = colorPickerWrapper.querySelector('.image-converter-annotation-tool-color-swatches');
		if (existingSwatches) {
			existingSwatches.remove();
		}
		
		const swatchesContainer = colorPickerWrapper.createDiv('image-converter-annotation-tool-color-swatches');
	
		// Predefined color rows
		const grayScaleColors = ['#000000', '#ffffff', '#d1d3d4', '#a7a9acCC', '#808285', '#58595b'];
		const paletteColors = ['#ff80ff', '#ffc680', '#ffff80', '#80ff9e', '#80d6ff', '#bcb3ff'];
	
		// Create grayscale row
		const grayScaleRow = swatchesContainer.createDiv('image-converter-annotation-tool-color-row');
		grayScaleRow.createSpan('image-converter-annotation-tool-row-label').setText('Grayscale:');
		const grayScaleSwatches = grayScaleRow.createDiv('image-converter-annotation-tool-swatches-container');
		grayScaleColors.forEach(color => {
			const swatch = grayScaleSwatches.createDiv('color-swatch preset');
			swatch.style.backgroundColor = color;
			swatch.setAttribute('title', color);
			this.componentContainer.registerDomEvent(swatch, 'click', () => updateObjectColor(color));
		});
	
		// Create palette row
		const paletteRow = swatchesContainer.createDiv('image-converter-annotation-tool-color-row');
		paletteRow.createSpan('image-converter-annotation-tool-row-label').setText('Palette:');
		const paletteSwatches = paletteRow.createDiv('image-converter-annotation-tool-swatches-container');
		paletteColors.forEach(color => {
			const swatch = paletteSwatches.createDiv('color-swatch preset');
			swatch.style.backgroundColor = color;
			swatch.setAttribute('title', color);
			this.componentContainer.registerDomEvent(swatch, 'click', () => updateObjectColor(color));
		});
	
		// Sort dominant colors by luminosity
		const colorPairs = this.dominantColors.map((dominantColor, index) => ({
			dominant: dominantColor,
			complementary: this.complementaryColors[index][0],
			luminosity: this.getLuminosity(dominantColor)
		})).sort((a, b) => a.luminosity - b.luminosity);
	
		// Create dominant colors row
		const dominantRow = swatchesContainer.createDiv('image-converter-annotation-tool-color-row');
		dominantRow.createSpan('image-converter-annotation-tool-row-label').setText('Dominant:');
		const dominantSwatches = dominantRow.createDiv('image-converter-annotation-tool-swatches-container');
		colorPairs.forEach(pair => {
			const dominantSwatch = dominantSwatches.createDiv('color-swatch dominant');
			dominantSwatch.style.backgroundColor = pair.dominant;
			dominantSwatch.setAttribute('title', pair.dominant);
			this.componentContainer.registerDomEvent(dominantSwatch, 'click', () => updateObjectColor(pair.dominant));
		});

		// Create complementary colors row
		const complementaryRow = swatchesContainer.createDiv('image-converter-annotation-tool-color-row');
		complementaryRow.createSpan('image-converter-annotation-tool-row-label').setText('180:');
		const complementarySwatches = complementaryRow.createDiv('image-converter-annotation-tool-swatches-container');
		colorPairs.forEach(pair => {
			const complementarySwatch = complementarySwatches.createDiv('color-swatch complementary');
			complementarySwatch.style.backgroundColor = pair.complementary;
			complementarySwatch.setAttribute('title', pair.complementary);
			this.componentContainer.registerDomEvent(complementarySwatch, 'click', () => {
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

	private createTextBackgroundControls(container: HTMLElement) {
		const textBgContainer = container.createDiv('image-converter-annotation-tool-control-group');
		textBgContainer.createDiv('control-label').setText('Text Background:');
		const controlsContainer = textBgContainer.createDiv('image-converter-annotation-tool-button-group');
		
		// Create color picker wrapper with alpha support
		const bgColorWrapper = controlsContainer.createDiv('image-converter-annotation-tool-background-color-wrapper');
		const bgColorPicker = bgColorWrapper.createEl('input', {
			type: 'color',
			cls: 'background-color-picker',
			value: '#ffffff'
		});
		
		// Add alpha slider next to color picker
		const alphaSlider = bgColorWrapper.createEl('input', {
			type: 'range',
			cls: 'background-alpha-slider',
			attr: {
				min: '0',
				max: '100',
				value: '70' // default to 0 - transparent
			}
		});
	
		// Transparent background
		new ButtonComponent(controlsContainer)
			.setTooltip('Transparent')
			.setIcon('eraser')
			.onClick(() => {
				this.setTextBackground('transparent');
			});
	
		// Semi-transparent white
		new ButtonComponent(controlsContainer)
			.setTooltip('Semi-transparent white')
			.setIcon('square')
			.onClick(() => {
				this.setTextBackground('rgba(255, 255, 255, 0.7)');
			})
			.buttonEl.addClass('bg-white-semi');
	
		// Semi-transparent black
		new ButtonComponent(controlsContainer)
			.setTooltip('Semi-transparent black')
			.setIcon('square')
			.onClick(() => {
				this.setTextBackground('rgba(0, 0, 0, 0.7)');
			})
			.buttonEl.addClass('bg-black-semi');
	
		// Update background with both color and alpha
		const updateBackground = () => {
			const color = bgColorPicker.value;
			const alpha = parseInt(alphaSlider.value) / 100;
			const rgba = this.hexToRgba(color, alpha);
			this.setTextBackground(rgba);
		};
	
		this.componentContainer.registerDomEvent(bgColorPicker, 'input', updateBackground);
		this.componentContainer.registerDomEvent(alphaSlider, 'input', updateBackground);
	}


	private setTextBackground(color: string) {
		if (!this.canvas) return;
		
		const activeObject = this.canvas.getActiveObject();
		if (!activeObject) return;
		
		if (activeObject instanceof IText) {
			activeObject.set('backgroundColor', color);
		} else if (activeObject instanceof ActiveSelection) {
			activeObject.getObjects().forEach(obj => {
				if (obj instanceof IText) {
					obj.set('backgroundColor', color);
				}
			});
		}
		
		this.canvas.requestRenderAll();
		this.saveState();
	}
	
	
	private createAndAddText(color: string, x: number, y: number) {
		if (this.isTextEditingBlocked) {
			console.debug('Text creation blocked');
			return;
		}
	
		try {
			// Get background color from current settings
			const bgColorPicker = this.modalEl.querySelector('.background-color-picker') as HTMLInputElement;
			const alphaSlider = this.modalEl.querySelector('.background-alpha-slider') as HTMLInputElement;
			let backgroundColor = 'transparent';
			
			if (bgColorPicker && alphaSlider) {
				const alpha = parseInt(alphaSlider.value) / 100;
				backgroundColor = this.hexToRgba(bgColorPicker.value, alpha);
			}
	
			const text = new IText('Type here', {
				left: x,
				top: y,
				fontSize: 20,
				fill: color,
				backgroundColor: backgroundColor, // Apply background color
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
	
				this.redo();
			} else {

				this.undo();
			}
			return false;
		});
		
		this.scope.register(['Mod', 'Shift'], 'Z', (evt: KeyboardEvent) => {
			evt.preventDefault();
		
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

		// Handle text background controls visibility
		const textBgControls = this.modalEl.querySelector('.text-background-controls');
		if (textBgControls instanceof HTMLElement) {
			textBgControls.style.display = 
				newTool === ToolMode.Text ? 'flex' : 'none';
		}

		// Show/hide preset buttons based on tool
		const presetContainer = this.modalEl.querySelector('.image-converter-annotation-tool-preset-buttons');
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
		const presetContainer = containerEl.createDiv('image-converter-annotation-tool-preset-buttons');
		presetContainer.style.display = 'none';
		
		// Create 3 preset buttons
		for (let i = 0; i < 3; i++) {
			const presetButton = presetContainer.createDiv(`preset-button preset-${i + 1}`);
			presetButton.createDiv('image-converter-annotation-tool-preset-color');
			presetButton.createSpan('preset-number').setText(`${i + 1}`);
			
			this.componentContainer.registerDomEvent(presetButton, 'click', (e) => {
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
		const bgColorPicker = this.modalEl.querySelector('.background-color-picker') as HTMLInputElement;
		const bgAlphaSlider = this.modalEl.querySelector('.background-alpha-slider') as HTMLInputElement;
		
		if (!colorPicker) return;
	
		const preset: ToolPreset = {
			size: this.brushSizes[this.currentBrushSizeIndex],
			color: colorPicker.value,
			opacity: this.brushOpacities[this.currentOpacityIndex],
			blendMode: this.currentBlendMode,
			backgroundColor: bgColorPicker?.value,
			backgroundOpacity: bgAlphaSlider ? parseInt(bgAlphaSlider.value) / 100 : undefined
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
	
		// Check if preset exists
		if (!preset) return;
	
		// Apply color to color picker
		const colorPicker = this.modalEl.querySelector('.color-picker') as HTMLInputElement;
		if (colorPicker) {
			colorPicker.value = preset.color;
		}
	
		// If in text mode, handle text-specific settings
		if (this.isTextMode) {
			// Update background controls
			const bgColorPicker = this.modalEl.querySelector('.background-color-picker') as HTMLInputElement;
			const bgAlphaSlider = this.modalEl.querySelector('.background-alpha-slider') as HTMLInputElement;
			
			if (bgColorPicker && preset.backgroundColor) {
				bgColorPicker.value = preset.backgroundColor;
			}
			
			if (bgAlphaSlider && preset.backgroundOpacity !== undefined) {
				bgAlphaSlider.value = (preset.backgroundOpacity * 100).toString();
			}
	
			// Apply to selected text object if one exists
			const activeObject = this.canvas?.getActiveObject();
			if (activeObject) {
				if (activeObject instanceof IText) {
					// Apply text color
					activeObject.set('fill', preset.color);
					
					// Apply background color if defined
					if (preset.backgroundColor) {
						const bgColor = this.hexToRgba(
							preset.backgroundColor, 
							preset.backgroundOpacity ?? 1
						);
						activeObject.set('backgroundColor', bgColor);
					}
					
					this.canvas?.requestRenderAll();
				} else if (activeObject instanceof ActiveSelection) {
					// Handle multiple selected text objects
					activeObject.getObjects().forEach(obj => {
						if (obj instanceof IText) {
							obj.set('fill', preset.color);
							if (preset.backgroundColor) {
								const bgColor = this.hexToRgba(
									preset.backgroundColor, 
									preset.backgroundOpacity ?? 1
								);
								obj.set('backgroundColor', bgColor);
							}
						}
					});
					this.canvas?.requestRenderAll();
				}
			}
		} else {
			// Handle non-text presets (drawing, arrow)
			const activeObject = this.canvas?.getActiveObject();
			if (activeObject) {
				if (activeObject instanceof ActiveSelection) {
					activeObject.getObjects().forEach(obj => {
						if (!(obj instanceof IText)) {
							obj.set('stroke', this.hexToRgba(preset.color, preset.opacity ?? 1));
						}
					});
				} else if (!(activeObject instanceof IText)) {
					activeObject.set('stroke', this.hexToRgba(preset.color, preset.opacity ?? 1));
				}
				this.canvas?.requestRenderAll();
			}
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
			const colorDiv = button.querySelector('.image-converter-annotation-tool-preset-color') as HTMLDivElement;
			if (colorDiv) {
				if (this.isTextMode && currentPresets[index].backgroundColor) {
					// For text mode, show both text color and background
					colorDiv.style.backgroundColor = currentPresets[index].backgroundColor ?? 'transparent';
					colorDiv.style.opacity = (currentPresets[index].backgroundOpacity ?? 1).toString();
					// Add a small indicator for text color
					colorDiv.style.border = `2px solid ${currentPresets[index].color}`;
				} else {
					// For other modes, show just the main color
					colorDiv.style.backgroundColor = currentPresets[index].color;
					colorDiv.style.opacity = currentPresets[index].opacity.toString();
					colorDiv.style.border = 'none';
				}
			}
		});
	}









	private setupToolbar(container: HTMLElement) {
		const toolbar = container.createDiv('image-converter-annotation-tool-annotation-toolbar');
	
		// Create tool groups
		const drawingGroup = toolbar.createDiv('annotation-toolbar-group drawing-group');
		const brushControls = toolbar.createDiv('annotation-toolbar-group brush-controls');
		const utilityGroup = toolbar.createDiv('annotation-toolbar-group');
	
		// Left section container for drawing tools and colors
		const leftSection = drawingGroup.createDiv('image-converter-annotation-tool-left-section');
	
		// Create a column container for drawing tools
		const drawingToolsColumn = leftSection.createDiv('image-converter-annotation-tool-drawing-tools-column');
	
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
		const colorPickerWrapper = leftSection.createDiv('image-converter-annotation-tool-color-picker-wrapper');
		const colorPicker = colorPickerWrapper.createEl('input', {
			type: 'color',
			value: '#ff0000'
		});
		colorPicker.addClass('color-picker');
	
		
		// Update color picker event listener
		this.componentContainer.registerDomEvent(colorPicker, 'input', (e) => {
			const color = (e.target as HTMLInputElement).value;
			this.updateColorForSelectedObjects(color);
			this.updateBrushColor();
		});

		// Brush controls
		const brushControlsColumn = brushControls.createDiv('brush-controls-column');
		this.createSizeButtons(brushControlsColumn);
		this.createOpacityButtons(brushControlsColumn);
		this.createBlendModeButtons(brushControlsColumn);

		// Add layer control buttons
		const layerControls = brushControlsColumn.createDiv('layer-controls');
		layerControls.createDiv('control-label').setText('Layer:');
		const layerButtonContainer = layerControls.createDiv('image-converter-annotation-tool-button-group');

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
		

		// Create a separate container for text background controls
		this.textBackgroundControls = brushControlsColumn.createDiv('text-background-controls');
		this.textBackgroundControls.style.display = 'none'; // Hide by default
		this.createTextBackgroundControls(this.textBackgroundControls);

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
		
		const sizeButtonContainer = sizeButtonsContainer.createDiv('image-converter-annotation-tool-button-group');
		
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
		
		const opacityButtonContainer = opacityButtonsContainer.createDiv('image-converter-annotation-tool-button-group');
		
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
	
		this.canvas.on('selection:created', (e) => {
			const event = e as unknown as { selected: FabricObject[] };
			this.syncColorPickerWithSelection(event);
		});
	
		this.canvas.on('selection:updated', (e) => {
			const event = e as unknown as { selected: FabricObject[] };
			this.syncColorPickerWithSelection(event);
		});
	
		// Add color picker event listener
		const colorPicker = this.modalEl.querySelector('.color-picker') as HTMLInputElement;
		if (colorPicker) {
			this.componentContainer.registerDomEvent(colorPicker, 'input', (e) => {
				const color = (e.target as HTMLInputElement).value;
				this.updateColorForSelectedObjects(color);
				this.updateBrushColor();
			});
		}
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
				target.closest('.image-converter-annotation-tool-annotation-toolbar') !== null ||
				target.closest('.image-converter-annotation-tool-color-picker-wrapper') !== null ||
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
		this.componentContainer.registerDomEvent(this.modalEl, 'mousedown', handleEvent, true);
		this.componentContainer.registerDomEvent(this.modalEl, 'mousemove', handleEvent, true);
		this.componentContainer.registerDomEvent(this.modalEl, 'mouseup', handleEvent, true);
		this.componentContainer.registerDomEvent(this.modalEl, 'click', handleEvent, true);
		this.componentContainer.registerDomEvent(this.modalEl, 'dblclick', handleEvent, true);
		
		// Keyboard events
		this.componentContainer.registerDomEvent(this.modalEl, 'keydown', handleKeyboard, true);
		this.componentContainer.registerDomEvent(this.modalEl, 'keyup', handleKeyboard, true);
	
		// Store the handlers for cleanup
		// this._boundHandleEvent = handleEvent;
		// this._boundHandleKeyboard = handleKeyboard;
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
	

	// private _boundHandleEvent: ((e: Event) => void) | null = null;
	// private _boundHandleKeyboard: ((e: KeyboardEvent) => void) | null = null;


	private syncColorPickerWithSelection(e: { selected: FabricObject[] }) {
		const colorPicker = this.modalEl.querySelector('.color-picker') as HTMLInputElement;
		const bgColorPicker = this.modalEl.querySelector('.background-color-picker') as HTMLInputElement;
		const alphaSlider = this.modalEl.querySelector('.background-alpha-slider') as HTMLInputElement;
		if (!colorPicker || !bgColorPicker || !alphaSlider) return;
	
		if (e.selected.length === 0) return;
	
		const firstObject = e.selected[0];
		if (firstObject instanceof IText) {
			// Only update if the color is actually defined
			const color = firstObject.fill as string;
			if (color && color !== colorPicker.value) {
				colorPicker.value = this.rgbaToHex(color);
			}
	
			// Update background color and alpha only if they're different
			const bgColor = firstObject.backgroundColor as string;
			if (bgColor && bgColor !== 'transparent') {
				const { hex, alpha } = this.rgbaToHexWithAlpha(bgColor);
				if (hex !== bgColorPicker.value) {
					bgColorPicker.value = hex;
				}
				const newAlpha = Math.round(alpha * 100).toString();
				if (newAlpha !== alphaSlider.value) {
					alphaSlider.value = newAlpha;
				}
			}
		}
	}
	
	
	private updateColorForSelectedObjects(color: string) {
		if (!this.canvas) return;
	
		const activeObject = this.canvas.getActiveObject();
		if (!activeObject) return;
	
		const opacity = this.brushOpacities[this.currentOpacityIndex];
	
		if (activeObject instanceof ActiveSelection) {
			// Handle multiple selection
			const selection = activeObject as ActiveSelection;
			selection.forEachObject((obj) => {
				if (obj instanceof IText) {
					obj.set('fill', color);
				} else {
					obj.set('stroke', this.hexToRgba(color, opacity));
				}
			});
			// Mark the selection as dirty to ensure it updates
			selection.dirty = true;
		} else {
			// Handle single object
			if (activeObject instanceof IText) {
				activeObject.set('fill', color);
			} else {
				activeObject.set('stroke', this.hexToRgba(color, opacity));
			}
		}
	
		this.canvas.requestRenderAll();
	}

	private rgbaToHex(rgba: string): string {
		const rgbaMatch = rgba.match(/rgba?\((\d+), (\d+), (\d+)/);
		if (!rgbaMatch) return '#ff0000'; // Default to white if parsing fails -> RED COLOR TEXT
	
		const [, r, g, b] = rgbaMatch.map(Number); // Skip the first element (full match)
		return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
	}
	
	private rgbaToHexWithAlpha(rgba: string): { hex: string; alpha: number } {
		const rgbaMatch = rgba.match(/rgba\((\d+), (\d+), (\d+), ([0-9.]+)\)/);
		if (!rgbaMatch) return { hex: '#ffffff', alpha: 1 }; // Default to white and opaque
	
		const [, r, g, b, a] = rgbaMatch.map((v, i) => (i === 4 ? parseFloat(v) : Number(v))); // Skip first element
		const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
		return { hex, alpha: a };
	}
	
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
        this.componentContainer.registerDomEvent(this.resizeHandle, 'mousedown', this.startResize.bind(this));
        this.componentContainer.registerDomEvent(document, 'mousemove', this.resize.bind(this));
        this.componentContainer.registerDomEvent(document, 'mouseup', this.stopResize.bind(this));

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
	
		const toolbar = this.modalEl.querySelector('.image-converter-annotation-tool-annotation-toolbar') as HTMLElement;
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
		this.componentContainer.registerDomEvent(document, 'keydown', this.boundKeyDownHandler);
		this.componentContainer.registerDomEvent(document, 'keyup', this.boundKeyUpHandler);
	
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
	
			this.componentContainer.registerDomEvent(item, 'click', (e: MouseEvent) => { 
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
		this.componentContainer.registerDomEvent(document, 'click', () => {
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
		const buttons = this.modalEl.querySelectorAll('.background-controls .image-converter-annotation-tool-button-group button');
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
			// console.log('Skipping state save - isUndoRedoAction:', this.isUndoRedoAction);
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
			// console.log('Skipping duplicate state');
			return;
		}
	
		this.undoStack.push(newState);
		this.redoStack = []; // Clear redo stack when new action is performed
		
	}
	
	private async undo() {
		if (!this.canvas || this.undoStack.length <= 1) { // Changed from 0 to 1 because of initial empty state
			// console.log('Cannot undo: no more states');
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
			// console.log('Cannot redo: no more states');
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
	

			// Try multiple export methods
			let arrayBuffer: ArrayBuffer | null = null;

			// Method 1: Try toBlob first
			try {

				// First create the canvas element at original scale
				const canvasElement = this.canvas.toCanvasElement(scaleToOriginal);
				
				// Create a temporary canvas for cropping
				const tempCanvas = document.createElement('canvas');
				tempCanvas.width = finalWidth * scaleToOriginal;
				tempCanvas.height = finalHeight * scaleToOriginal;
				const tempCtx = tempCanvas.getContext('2d');
	
				if (tempCtx) {
				
					// Draw the portion we want to keep
					tempCtx.drawImage(
						canvasElement,
						minX * scaleToOriginal, 
						minY * scaleToOriginal, 
						finalWidth * scaleToOriginal, 
						finalHeight * scaleToOriginal,
						0, 0, 
						tempCanvas.width, 
						tempCanvas.height
					);
	
					// Convert to blob
					arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
						tempCanvas.toBlob((blob: Blob | null) => {
					
							if (blob) {
								blob.arrayBuffer().then(resolve).catch(reject);
							} else {
						
								reject(new Error('Blob creation failed'));
							}
						}, mimeType, 1);
					});
				}
			} catch (e) {
				console.log('toCanvasElement method failed, trying alternative...', e);
			}

	
			// Method 2: Try toDataURL if toBlob failed
			if (!arrayBuffer) {
		
				try {
				
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
					
					if (!dataUrl || dataUrl === 'data:,') {
						throw new Error('Invalid data URL');
					}

					arrayBuffer = base64ToArrayBuffer(dataUrl);
				} catch (e) {
					console.log('toDataURL method failed, trying alternative...', e);
				}
			}

			// Method 3: Try canvas drawing fallback
			if (!arrayBuffer) {
				new Notice("6")
				try {
					const nativeCanvas = this.canvas.getElement();
					const tempCanvas = document.createElement('canvas');
					tempCanvas.width = finalWidth * scaleToOriginal;
					tempCanvas.height = finalHeight * scaleToOriginal;
					const tempCtx = tempCanvas.getContext('2d');
					new Notice("7")
					if (tempCtx) {
						new Notice("8")
						tempCtx.drawImage(
							nativeCanvas,
							minX, minY, finalWidth, finalHeight,
							0, 0, tempCanvas.width, tempCanvas.height
						);
						
						const blob = await new Promise<Blob>((resolve, reject) => {
							tempCanvas.toBlob((b: Blob | null) => {
								if (b) resolve(b);
								else reject(new Error('Blob creation failed'));
							}, mimeType, 1);
						});
						arrayBuffer = await blob.arrayBuffer();
					}
				} catch (e) {
					console.log('Native canvas fallback failed', e);
				}
			}

			// If all methods failed, throw error
			if (!arrayBuffer) {
				throw new Error('All export methods failed');
			}

			
			// Restore viewport transform
			this.canvas.setViewportTransform(currentVPT);
			this.canvas.renderAll();

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
		
		// Unload child components to remove event listeners
		this.componentContainer.unload();
	
		// Clear references
		// this._boundHandleEvent = null;
		// this._boundHandleKeyboard = null;

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
		this.componentContainer.registerDomEvent(document, 'mousemove', this.resize.bind(this));
		this.componentContainer.registerDomEvent(document, 'mouseup', this.stopResize.bind(this));

		// Unload child components to remove event listeners
		this.componentContainer.unload();
		super.onClose();

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
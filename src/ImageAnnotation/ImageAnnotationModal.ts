import {
    App,
    Modal,
    Notice,
    TFile,
    Component,
    Scope,
} from 'obsidian';
import {
    Canvas,
    FabricImage,
    IText,
    FabricObject,
    PencilBrush,
    ActiveSelection,
} from 'fabric';
import { ConfirmDialog } from '../ImageConverterSettings';
import ImageConverterPlugin from '../main';
import { ToolMode, ToolPreset, BlendMode, BRUSH_SIZES, BRUSH_OPACITIES } from './types';
import { hexToRgba, rgbaToHex, rgbaToHexWithAlpha, analyzeImageColors, updateRgbaOpacity } from './utils/colorUtils';
import { HistoryManager, ViewportManager, LayerManager, ToolManager, BackgroundManager } from './managers';
import { ToolbarBuilder, ToolbarCallbacks } from './ui';
import { ImageExporter } from './export/ImageExporter';

export class ImageAnnotationModal extends Modal {
    private componentContainer = new Component();
    private canvas!: Canvas;

    // Managers
    private historyManager!: HistoryManager;
    private viewportManager!: ViewportManager;
    private layerManager!: LayerManager;
    private toolManager!: ToolManager;
    private backgroundManager!: BackgroundManager;
    private imageExporter!: ImageExporter;
    private toolbarBuilder!: ToolbarBuilder;

    // UI Elements
    private textBackgroundControls: HTMLElement | null = null;

    // State
    private isTextEditingBlocked = false;
    private dominantColors: string[] = [];
    private complementaryColors: string[][] = [];

    // Event handlers
    private boundKeyDownHandler!: (e: KeyboardEvent) => void;
    private boundKeyUpHandler!: (e: KeyboardEvent) => void;

    constructor(
        app: App,
        private plugin: ImageConverterPlugin,
        private file: TFile
    ) {
        super(app);
        this.setupModal();
        this.setupEventHandlers();
    }

    private setupModal(): void {
        this.componentContainer.load();
        this.modalEl.addClass('image-converter-annotation-tool-image-annotation-modal');
        this.setupCloseButton();
    }

    private setupEventHandlers(): void {
        this.boundKeyDownHandler = this.handleKeyDown.bind(this);
        this.boundKeyUpHandler = this.handleKeyUp.bind(this);
        this.scope = new Scope();
        this.registerShortcuts();
        this.preventDefaultHandlers();
    }

    private setupCloseButton(): void {
        const closeButton = this.modalEl.querySelector('.modal-close-button') as HTMLElement | null;
        if (closeButton) {
            this.componentContainer.registerDomEvent(closeButton, 'click', (e: MouseEvent) => {
                e.stopPropagation();
                this.close();
            });
        }
    }

    private registerShortcuts(): void {
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

    async onOpen(): Promise<void> {
        const { contentEl } = this;
        contentEl.style.padding = '0';
        contentEl.style.overflow = 'hidden';

        const modalContainer = contentEl.createDiv('image-converter-annotation-tool-modal-container');

        // Initialize managers
        this.initializeManagers();

        // Setup viewport resize
        this.viewportManager.setupResizable();

        // Setup toolbar
        this.setupToolbar(modalContainer);

        const canvasContainer = modalContainer.createDiv('image-converter-annotation-tool-canvas-container');
        const canvasEl = canvasContainer.createEl('canvas');

        try {
            const arrayBuffer = await this.app.vault.readBinary(this.file);
            const blob = new Blob([arrayBuffer]);
            const blobUrl = URL.createObjectURL(blob);

            const img = new Image();
            img.onload = async () => {
                this.historyManager.initialize();

                const padding = 80;
                const toolbarHeight = 60;
                const maxWidth = window.innerWidth * 0.9 - padding;
                const maxHeight = window.innerHeight * 0.9 - padding - toolbarHeight;
                const canvasWidth = maxWidth;
                const canvasHeight = maxHeight;

                this.canvas = new Canvas(canvasEl, {
                    width: canvasWidth,
                    height: canvasHeight,
                    backgroundColor: 'transparent',
                    isDrawingMode: false,
                    preserveObjectStacking: true
                });

                const scale = Math.min(
                    canvasWidth / img.width,
                    canvasHeight / img.height
                ) * 0.8;

                const fabricImg = new FabricImage(img, {
                    selectable: false,
                    evented: false,
                    scaleX: scale,
                    scaleY: scale,
                    objectCaching: true,
                    opacity: 1,
                    erasable: false,
                    crossOrigin: 'anonymous',
                    strokeWidth: 0
                });

                this.canvas.add(fabricImg);
                this.centerFabricImage(fabricImg);

                this.modalEl.style.width = `${canvasWidth + padding}px`;
                this.modalEl.style.height = `${canvasHeight + padding + toolbarHeight}px`;

                // Analyze colors and create swatches
                const colors = await analyzeImageColors(img);
                this.dominantColors = colors.dominantColors;
                this.complementaryColors = colors.complementaryColors;
                this.toolbarBuilder.setColors(this.dominantColors, this.complementaryColors);
                this.toolbarBuilder.createColorSwatches();

                // Setup viewport
                this.viewportManager.setupZoom();
                this.viewportManager.setupPan();

                // Initialize canvas event handlers
                this.initializeCanvasEventHandlers();

                // Prevent default behaviors
                this.componentContainer.registerDomEvent(this.modalEl, 'mousedown', (e) => {
                    if (e.target === this.modalEl) {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                });

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
        }
    }

    private initializeManagers(): void {
        const getCanvas = () => this.canvas;

        this.historyManager = new HistoryManager(getCanvas);
        this.layerManager = new LayerManager(getCanvas, () => this.historyManager.saveState());

        this.viewportManager = new ViewportManager(
            getCanvas,
            this.modalEl,
            this.componentContainer,
            () => this.toolManager?.isInDrawingMode() ?? false,
            (mode) => {
                if (this.toolManager) {
                    this.toolManager.updateDrawingModeUI(mode);
                }
            }
        );

        this.toolManager = new ToolManager(getCanvas, {
            onToolChanged: (tool) => this.onToolChanged(tool),
            getBrushColor: () => this.getBrushColor()
        });

        this.backgroundManager = new BackgroundManager(getCanvas, this.componentContainer);
        this.imageExporter = new ImageExporter(this.app);
    }

    private setupToolbar(container: HTMLElement): void {
        const callbacks: ToolbarCallbacks = {
            onDrawingToggle: () => this.toolManager.toggleDrawingMode(),
            onTextToggle: () => this.toolManager.toggleTextMode(),
            onArrowToggle: () => this.toolManager.toggleArrowMode(),
            onResetZoom: () => this.viewportManager.resetZoom(),
            onClearAll: () => this.clearAll(),
            onSave: () => this.saveAnnotation(),
            onBringToFront: () => this.layerManager.bringToFront(),
            onBringForward: () => this.layerManager.bringForward(),
            onSendBackward: () => this.layerManager.sendBackward(),
            onSendToBack: () => this.layerManager.sendToBack(),
            onBackgroundToggle: (buttonEl) => this.backgroundManager.toggleBackgroundDropdown(buttonEl),
            onColorChange: (color) => this.handleColorChange(color),
            onSizeChange: (index) => this.toolManager.setBrushSizeIndex(index),
            onOpacityChange: (index, opacity) => this.handleOpacityChange(index, opacity),
            onBlendModeChange: (mode) => this.handleBlendModeChange(mode),
            onPresetSave: (index) => this.savePreset(index),
            onPresetLoad: (index) => this.loadPreset(index),
            onTextBackgroundChange: (color) => this.setTextBackground(color),
            getCanvas: () => this.canvas,
            getCurrentOpacity: () => this.toolManager.getCurrentOpacity(),
            getBrushSizeIndex: () => this.toolManager.getBrushSizeIndex(),
            getOpacityIndex: () => this.toolManager.getOpacityIndex(),
            getBlendMode: () => this.toolManager.getBlendMode(),
            isDrawingMode: () => this.toolManager.isInDrawingMode(),
            isTextMode: () => this.toolManager.isInTextMode(),
            isArrowMode: () => this.toolManager.isInArrowMode()
        };

        this.toolbarBuilder = new ToolbarBuilder(this.componentContainer, this.modalEl, callbacks);
        const elements = this.toolbarBuilder.build(container);

        this.toolManager.setButtons(elements.drawButton, elements.textButton, elements.arrowButton);
        this.textBackgroundControls = elements.textBackgroundControls;

        // Setup background controls
        const utilityGroup = this.modalEl.querySelector('.annotation-toolbar-group:last-child');
        if (utilityGroup) {
            this.backgroundManager.createBackgroundControls(utilityGroup as HTMLElement, null);
        }

        this.registerHotkeys();
    }

    private onToolChanged(tool: ToolMode): void {
        // Handle text background controls visibility
        if (this.textBackgroundControls) {
            this.textBackgroundControls.style.display = tool === ToolMode.TEXT ? 'flex' : 'none';
        }

        // Show/hide preset buttons
        const presetContainer = this.modalEl.querySelector('.image-converter-annotation-tool-preset-buttons');
        if (presetContainer instanceof HTMLElement) {
            presetContainer.style.display = tool === ToolMode.NONE ? 'none' : 'flex';
            this.updatePresetButtons();
        }
    }

    private getBrushColor(): string {
        const colorPicker = this.modalEl.querySelector('.color-picker') as HTMLInputElement;
        return colorPicker?.value ?? '#ff0000';
    }

    private handleColorChange(color: string): void {
        this.toolManager.updateBrushColor();
        this.updateColorForSelectedObjects(color);
    }

    private handleOpacityChange(index: number, opacity: number): void {
        this.toolManager.setOpacityIndex(index);

        if (this.canvas) {
            const activeObject = this.canvas.getActiveObject();
            if (activeObject) {
                if (activeObject.type === 'activeselection') {
                    const selection = activeObject as ActiveSelection;
                    selection.getObjects().forEach(obj => {
                        this.updateObjectOpacity(obj, opacity);
                    });
                    selection.dirty = true;
                } else {
                    this.updateObjectOpacity(activeObject, opacity);
                }
                this.canvas.requestRenderAll();
            }
        }
    }

    private handleBlendModeChange(mode: BlendMode): void {
        this.toolManager.setBlendMode(mode);

        if (this.canvas) {
            const activeObject = this.canvas.getActiveObject();
            if (activeObject) {
                if (activeObject.type === 'activeselection') {
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
    }

    private updateObjectOpacity(obj: FabricObject, opacity: number): void {
        if (obj instanceof IText) {
            const currentColor = obj.get('fill') as string;
            if (currentColor.startsWith('rgba')) {
                obj.set('fill', updateRgbaOpacity(currentColor, opacity));
            } else {
                obj.set('fill', hexToRgba(currentColor, opacity));
            }
        } else {
            const currentStroke = obj.get('stroke') as string;
            if (currentStroke.startsWith('rgba')) {
                obj.set('stroke', updateRgbaOpacity(currentStroke, opacity));
            } else {
                obj.set('stroke', hexToRgba(currentStroke, opacity));
            }
        }
        obj.dirty = true;
    }

    private updateColorForSelectedObjects(color: string): void {
        if (!this.canvas) return;

        const activeObject = this.canvas.getActiveObject();
        if (!activeObject) return;

        const opacity = this.toolManager.getCurrentOpacity();

        if (activeObject instanceof ActiveSelection) {
            activeObject.forEachObject((obj) => {
                if (obj instanceof IText) {
                    obj.set('fill', color);
                } else {
                    obj.set('stroke', hexToRgba(color, opacity));
                }
            });
            activeObject.dirty = true;
        } else {
            if (activeObject instanceof IText) {
                activeObject.set('fill', color);
            } else {
                activeObject.set('stroke', hexToRgba(color, opacity));
            }
        }

        this.canvas.requestRenderAll();
    }

    private centerFabricImage(fabricImg: FabricImage): void {
        if (!this.canvas) return;

        const canvasWidth = this.canvas.width ?? 0;
        const canvasHeight = this.canvas.height ?? 0;
        const imageWidth = fabricImg.width ?? 0;
        const imageHeight = fabricImg.height ?? 0;
        const scaleX = fabricImg.scaleX ?? 1;
        const scaleY = fabricImg.scaleY ?? 1;

        const left = (canvasWidth - imageWidth * scaleX) / 2;
        const top = (canvasHeight - imageHeight * scaleY) / 2;

        fabricImg.set({ left, top });
    }

    private registerHotkeys(): void {
        this.scope.register(['Mod'], 'S', (evt: KeyboardEvent) => {
            evt.preventDefault();
            this.saveAnnotation();
        });

        this.scope.register(['Mod'], 'A', (evt: KeyboardEvent) => {
            if (this.isTextEditing()) return true;
            evt.preventDefault();
            this.selectAll();
            return false;
        });

        this.scope.register(['Mod'], 'Z', (evt: KeyboardEvent) => {
            evt.preventDefault();
            if (evt.shiftKey) {
                this.historyManager.redo();
            } else {
                this.historyManager.undo();
            }
            return false;
        });

        this.scope.register(['Mod', 'Shift'], 'Z', (evt: KeyboardEvent) => {
            evt.preventDefault();
            this.historyManager.redo();
            return false;
        });

        this.scope.register([], 'A', (evt: KeyboardEvent) => {
            if (this.isTextEditing()) return true;
            evt.preventDefault();
            this.toolManager.toggleArrowMode();
            return false;
        });

        this.scope.register([], 'B', (evt: KeyboardEvent) => {
            if (this.isTextEditing()) return true;
            evt.preventDefault();
            this.toolManager.toggleDrawingMode();
            return false;
        });

        this.scope.register([], 'T', (evt: KeyboardEvent) => {
            if (this.isTextEditing()) return true;
            evt.preventDefault();
            this.toolManager.toggleTextMode();
            return false;
        });

        this.scope.register([], 'Delete', (evt: KeyboardEvent) => {
            evt.preventDefault();
            this.deleteSelectedObjects();
            return false;
        });

        this.scope.register([], 'Backspace', (evt: KeyboardEvent) => {
            const activeObject = this.canvas?.getActiveObject();
            if (activeObject instanceof IText && activeObject.isEditing) {
                return true;
            }
            evt.preventDefault();
            this.deleteSelectedObjects();
            return false;
        });
    }

    private handleKeyDown(e: KeyboardEvent): void {
        const activeObject = this.canvas?.getActiveObject();
        if (activeObject instanceof IText && activeObject.isEditing) {
            if (e.code === 'Space') return;
        }

        if (this.viewportManager.handleKeyDown(e)) return;

        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            e.stopPropagation();
            if (e.shiftKey) {
                this.historyManager.redo();
            } else {
                this.historyManager.undo();
            }
        }
    }

    private handleKeyUp(e: KeyboardEvent): void {
        const activeObject = this.canvas?.getActiveObject();
        if (activeObject instanceof IText && activeObject.isEditing) {
            if (e.code === 'Space') return;
        }

        this.viewportManager.handleKeyUp(e);
    }

    private initializeCanvasEventHandlers(): void {
        if (!this.canvas) return;

        this.canvas.freeDrawingBrush = new PencilBrush(this.canvas);
        this.canvas.freeDrawingBrush.width = BRUSH_SIZES[this.toolManager.getBrushSizeIndex()];
        (this.canvas.freeDrawingBrush as any).globalCompositeOperation = this.toolManager.getBlendMode();

        this.toolManager.updateBrushColor();

        this.canvas.on('path:created', (e: any) => {
            if (!this.historyManager.isPerformingUndoRedo()) {
                if (e.path) {
                    e.path.globalCompositeOperation = this.toolManager.getBlendMode();
                    this.canvas?.requestRenderAll();
                }
                this.historyManager.saveState();
            }
        });

        this.canvas.on('object:added', (e) => {
            this.toolManager.updateObjectInteractivity();
            if (e.target instanceof FabricImage || this.historyManager.isPerformingUndoRedo()) return;
            if (!(e.target.type === 'path')) {
                this.historyManager.saveState();
            }
        });

        this.canvas.on('object:modified', (e) => {
            if (e.target instanceof FabricImage || this.historyManager.isPerformingUndoRedo()) return;
            this.historyManager.saveState();
        });

        this.canvas.on('object:removed', (e) => {
            if (e.target instanceof FabricImage || this.historyManager.isPerformingUndoRedo()) return;
            this.historyManager.saveState();
        });

        this.canvas.on('mouse:down', (opt) => {
            const { target } = opt;
            if (target instanceof IText) {
                this.toolManager.updateDrawingModeUI(false);
                this.isTextEditingBlocked = false;
                target.selectable = true;
                target.evented = true;
            }
        });

        this.canvas.on('text:editing:entered', (opt) => {
            const textObject = opt.target;
            if (textObject) {
                this.isTextEditingBlocked = false;
                this.toolManager.updateDrawingModeUI(false);
                textObject.selectable = true;
                textObject.evented = true;
            }
        });

        this.canvas.on('text:editing:exited', (opt) => {
            const textObject = opt.target;
            if (textObject) {
                this.isTextEditingBlocked = false;
                textObject.selectable = true;
                textObject.evented = true;
            }
        });

        this.canvas.on('mouse:dblclick', (opt) => {
            if (!this.toolManager.isInTextMode() || this.toolManager.isInDrawingMode() || this.isTextEditingBlocked) {
                return;
            }

            const { target } = opt;
            if (target instanceof IText) {
                this.isTextEditingBlocked = false;
                target.enterEditing();
                target.selectAll();
                this.canvas?.requestRenderAll();
                return;
            }

            try {
                const pointer = this.canvas.getScenePoint(opt.e);
                const currentColor = this.getBrushColor();
                this.createAndAddText(currentColor, pointer.x, pointer.y);
            } catch (error) {
                console.error('Error creating text:', error);
                this.isTextEditingBlocked = false;
            }
        });

        // Keyboard handlers
        this.componentContainer.registerDomEvent(document, 'keydown', this.boundKeyDownHandler);
        this.componentContainer.registerDomEvent(document, 'keyup', this.boundKeyUpHandler);

        // Periodic state check
        setInterval(() => {
            const activeObject = this.canvas?.getActiveObject();
            if (activeObject instanceof IText && !activeObject.isEditing && this.isTextEditingBlocked) {
                this.isTextEditingBlocked = false;
            }
        }, 5000);
    }

    private preventDefaultHandlers(): void {
        const shouldAllowEvent = (e: Event): boolean => {
            const target = e.target as HTMLElement;
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

        const handleEvent = (e: Event) => {
            if (!shouldAllowEvent(e)) {
                e.stopPropagation();
            }
        };

        const handleKeyboard = (e: KeyboardEvent) => {
            const activeObject = this.canvas?.getActiveObject();

            if (activeObject instanceof IText && activeObject.isEditing) {
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                    e.preventDefault();
                    e.stopPropagation();
                }
                return;
            }

            if (this.isHandledKey(e)) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            if (shouldAllowEvent(e)) {
                return;
            }

            e.stopPropagation();
        };

        this.componentContainer.registerDomEvent(this.modalEl, 'mousedown', handleEvent, true);
        this.componentContainer.registerDomEvent(this.modalEl, 'mousemove', handleEvent, true);
        this.componentContainer.registerDomEvent(this.modalEl, 'mouseup', handleEvent, true);
        this.componentContainer.registerDomEvent(this.modalEl, 'click', handleEvent, true);
        this.componentContainer.registerDomEvent(this.modalEl, 'dblclick', handleEvent, true);
        this.componentContainer.registerDomEvent(this.modalEl, 'keydown', handleKeyboard, true);
        this.componentContainer.registerDomEvent(this.modalEl, 'keyup', handleKeyboard, true);
    }

    private isHandledKey(e: KeyboardEvent): boolean {
        const activeObject = this.canvas?.getActiveObject();
        if (activeObject instanceof IText && activeObject.isEditing) {
            return false;
        }

        return (
            (e.ctrlKey || e.metaKey) && (
                e.key.toLowerCase() === 's' ||
                e.key.toLowerCase() === 'a'
            ) ||
            e.key === 'Escape' ||
            (!this.isTextEditing() && (
                e.key === 'Delete' ||
                e.key === 'Backspace' ||
                e.key.toLowerCase() === 'b' ||
                e.key.toLowerCase() === 't' ||
                e.key.toLowerCase() === 'a'
            ))
        );
    }

    private isTextEditing(): boolean {
        const activeObject = this.canvas?.getActiveObject();
        return !!(activeObject instanceof IText && activeObject.isEditing);
    }

    private setupSelectionEvents(): void {
        if (!this.canvas) return;

        this.canvas.on('selection:created', (e) => {
            const event = e as unknown as { selected: FabricObject[] };
            this.syncColorPickerWithSelection(event);
        });

        this.canvas.on('selection:updated', (e) => {
            const event = e as unknown as { selected: FabricObject[] };
            this.syncColorPickerWithSelection(event);
        });
    }

    private syncColorPickerWithSelection(e: { selected: FabricObject[] }): void {
        const colorPicker = this.modalEl.querySelector('.color-picker') as HTMLInputElement;
        const bgColorPicker = this.modalEl.querySelector('.background-color-picker') as HTMLInputElement;
        const alphaSlider = this.modalEl.querySelector('.background-alpha-slider') as HTMLInputElement;
        if (!colorPicker || !bgColorPicker || !alphaSlider) return;

        if (e.selected.length === 0) return;

        const [firstObject] = e.selected;
        if (firstObject instanceof IText) {
            const color = firstObject.fill as string;
            if (color && color !== colorPicker.value) {
                colorPicker.value = rgbaToHex(color);
            }

            const bgColor = firstObject.backgroundColor as string;
            if (bgColor && bgColor !== 'transparent') {
                const { hex, alpha } = rgbaToHexWithAlpha(bgColor);
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

    private createAndAddText(color: string, x: number, y: number): void {
        if (this.isTextEditingBlocked) {
            return;
        }

        try {
            const bgColorPicker = this.modalEl.querySelector('.background-color-picker') as HTMLInputElement;
            const alphaSlider = this.modalEl.querySelector('.background-alpha-slider') as HTMLInputElement;
            let backgroundColor = 'transparent';

            if (bgColorPicker && alphaSlider) {
                const alpha = parseInt(alphaSlider.value) / 100;
                backgroundColor = hexToRgba(bgColorPicker.value, alpha);
            }

            const text = new IText('Type here', {
                left: x,
                top: y,
                fontSize: 20,
                fill: color,
                backgroundColor,
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

    private setTextBackground(color: string): void {
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
        this.historyManager.saveState();
    }

    private async savePreset(index: number): Promise<void> {
        const colorPicker = this.modalEl.querySelector('.color-picker') as HTMLInputElement;
        const bgColorPicker = this.modalEl.querySelector('.background-color-picker') as HTMLInputElement;
        const bgAlphaSlider = this.modalEl.querySelector('.background-alpha-slider') as HTMLInputElement;

        if (!colorPicker) return;

        const preset: ToolPreset = {
            size: BRUSH_SIZES[this.toolManager.getBrushSizeIndex()],
            color: colorPicker.value,
            opacity: BRUSH_OPACITIES[this.toolManager.getOpacityIndex()],
            blendMode: this.toolManager.getBlendMode(),
            backgroundColor: bgColorPicker?.value,
            backgroundOpacity: bgAlphaSlider ? parseInt(bgAlphaSlider.value) / 100 : undefined
        };

        if (this.toolManager.isInDrawingMode()) {
            this.plugin.settings.annotationPresets.drawing[index] = preset;
        } else if (this.toolManager.isInArrowMode()) {
            this.plugin.settings.annotationPresets.arrow[index] = preset;
        } else if (this.toolManager.isInTextMode()) {
            this.plugin.settings.annotationPresets.text[index] = preset;
        }

        await this.plugin.saveSettings();
        this.updatePresetButtons();
        new Notice(`Preset ${index + 1} saved`);
    }

    private loadPreset(index: number): void {
        let preset: ToolPreset;

        if (this.toolManager.isInDrawingMode()) {
            preset = this.plugin.settings.annotationPresets.drawing[index];
        } else if (this.toolManager.isInArrowMode()) {
            preset = this.plugin.settings.annotationPresets.arrow[index];
        } else if (this.toolManager.isInTextMode()) {
            preset = this.plugin.settings.annotationPresets.text[index];
        } else {
            return;
        }

        if (!preset) return;

        const colorPicker = this.modalEl.querySelector('.color-picker') as HTMLInputElement;
        if (colorPicker) {
            colorPicker.value = preset.color;
        }

        if (this.toolManager.isInTextMode()) {
            const bgColorPicker = this.modalEl.querySelector('.background-color-picker') as HTMLInputElement;
            const bgAlphaSlider = this.modalEl.querySelector('.background-alpha-slider') as HTMLInputElement;

            if (bgColorPicker && preset.backgroundColor) {
                bgColorPicker.value = preset.backgroundColor;
            }

            if (bgAlphaSlider && preset.backgroundOpacity !== undefined) {
                bgAlphaSlider.value = (preset.backgroundOpacity * 100).toString();
            }

            const activeObject = this.canvas?.getActiveObject();
            if (activeObject) {
                if (activeObject instanceof IText) {
                    activeObject.set('fill', preset.color);
                    if (preset.backgroundColor) {
                        const bgColor = hexToRgba(preset.backgroundColor, preset.backgroundOpacity ?? 1);
                        activeObject.set('backgroundColor', bgColor);
                    }
                    this.canvas?.requestRenderAll();
                } else if (activeObject instanceof ActiveSelection) {
                    activeObject.getObjects().forEach(obj => {
                        if (obj instanceof IText) {
                            obj.set('fill', preset.color);
                            if (preset.backgroundColor) {
                                const bgColor = hexToRgba(preset.backgroundColor, preset.backgroundOpacity ?? 1);
                                obj.set('backgroundColor', bgColor);
                            }
                        }
                    });
                    this.canvas?.requestRenderAll();
                }
            }
        } else {
            const activeObject = this.canvas?.getActiveObject();
            if (activeObject) {
                if (activeObject instanceof ActiveSelection) {
                    activeObject.getObjects().forEach(obj => {
                        if (!(obj instanceof IText)) {
                            obj.set('stroke', hexToRgba(preset.color, preset.opacity ?? 1));
                        }
                    });
                } else if (!(activeObject instanceof IText)) {
                    activeObject.set('stroke', hexToRgba(preset.color, preset.opacity ?? 1));
                }
                this.canvas?.requestRenderAll();
            }
        }

        const opacityIndex = (BRUSH_OPACITIES as readonly number[]).indexOf(preset.opacity);
        if (opacityIndex !== -1) {
            this.toolManager.setOpacityIndex(opacityIndex);
        }

        const sizeIndex = (BRUSH_SIZES as readonly number[]).indexOf(preset.size);
        if (sizeIndex !== -1) {
            this.toolManager.setBrushSizeIndex(sizeIndex);
        }

        this.toolManager.setBlendMode(preset.blendMode);
        this.toolManager.updateBrushColor();
    }

    private updatePresetButtons(): void {
        const currentPresets = this.toolManager.isInDrawingMode()
            ? this.plugin.settings.annotationPresets.drawing
            : this.toolManager.isInArrowMode()
                ? this.plugin.settings.annotationPresets.arrow
                : this.toolManager.isInTextMode()
                    ? this.plugin.settings.annotationPresets.text
                    : null;

        if (currentPresets) {
            this.toolbarBuilder.updatePresetButtons(currentPresets, this.toolManager.isInTextMode());
        }
    }

    private deleteSelectedObjects(): void {
        if (!this.canvas) return;

        const activeObject = this.canvas.getActiveObject();
        if (!activeObject) return;

        if (activeObject instanceof IText && activeObject.isEditing) {
            return;
        }

        if (activeObject.type === 'activeselection') {
            const activeSelection = activeObject as ActiveSelection;
            const objectsToRemove = activeSelection.getObjects();

            objectsToRemove.forEach(obj => {
                if (!(obj instanceof FabricImage)) {
                    this.canvas?.remove(obj);
                }
            });

            this.canvas.discardActiveObject();
        } else {
            if (!(activeObject instanceof FabricImage)) {
                this.canvas.remove(activeObject);
            }
        }

        this.canvas.requestRenderAll();
    }

    private selectAll(): void {
        if (!this.canvas) return;

        const objects = this.canvas.getObjects().slice(1);
        if (objects.length === 0) return;

        const wasDrawingMode = this.toolManager.isInDrawingMode();
        const wasTextMode = this.toolManager.isInTextMode();

        if (wasDrawingMode) {
            this.toolManager.updateDrawingModeUI(false);
        }
        if (wasTextMode) {
            this.toolManager.toggleTextMode();
        }

        if (objects.length === 1) {
            this.canvas.setActiveObject(objects[0]);
        } else {
            const activeSelection = new ActiveSelection(objects, {
                canvas: this.canvas
            });
            this.canvas.setActiveObject(activeSelection);
        }

        this.canvas.requestRenderAll();

        if (wasDrawingMode) {
            this.toolManager.updateDrawingModeUI(true);
        }
        if (wasTextMode) {
            this.toolManager.toggleTextMode();
        }
    }

    private clearAll(): void {
        if (!this.canvas) return;

        new ConfirmDialog(this.app, 'Clear Annotations', 'Are you sure you want to clear all annotations?', 'Clear', () => {
            const objects = this.canvas.getObjects();
            objects.slice(1).forEach(obj => this.canvas.remove(obj));
            this.canvas.requestRenderAll();
            this.historyManager.saveState();
        }).open();
    }

    private async saveAnnotation(): Promise<void> {
        if (!this.canvas) return;

        const success = await this.imageExporter.save(this.canvas, this.file);
        if (success) {
            this.close();
        }
    }

    private cleanup(): void {
        if (this.canvas) {
            this.canvas.off();
            this.canvas.dispose();
        }

        this.componentContainer.unload();

        this.isTextEditingBlocked = false;
        this.toolManager?.cleanup();
        this.viewportManager?.cleanup();
        this.historyManager?.clear();
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
        this.cleanup();
        this.componentContainer.unload();
        super.onClose();
    }
}

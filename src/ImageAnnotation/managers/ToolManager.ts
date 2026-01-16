import { Canvas, PencilBrush, FabricImage, IText } from 'fabric';
import { ButtonComponent } from 'obsidian';
import { ToolMode, BlendMode, BRUSH_SIZES, BRUSH_OPACITIES, DrawingBrushWithComposite } from '../types';
import { ArrowBrush } from '../brushes/ArrowBrush';
import { hexToRgba } from '../utils/colorUtils';

export interface ToolManagerCallbacks {
    onToolChanged?: (tool: ToolMode) => void;
    getBrushColor: () => string;
}

export class ToolManager {
    private currentTool: ToolMode = ToolMode.NONE;
    private isDrawingMode = false;
    private isTextMode = false;
    private isArrowMode = false;

    private drawButton: ButtonComponent | undefined;
    private textButton: ButtonComponent | undefined;
    private arrowButton: ButtonComponent | undefined;

    private currentBrushSizeIndex = 2;
    private currentOpacityIndex = 5;
    private currentBlendMode: BlendMode = 'source-over';

    constructor(
        private getCanvas: () => Canvas | null,
        private callbacks: ToolManagerCallbacks
    ) {}

    setButtons(draw?: ButtonComponent, text?: ButtonComponent, arrow?: ButtonComponent): void {
        this.drawButton = draw;
        this.textButton = text;
        this.arrowButton = arrow;
    }

    switchTool(newTool: ToolMode): void {
        this.isDrawingMode = false;
        this.isTextMode = false;
        this.isArrowMode = false;

        if (this.drawButton) this.drawButton.buttonEl.removeClass('is-active');
        if (this.textButton) this.textButton.buttonEl.removeClass('is-active');
        if (this.arrowButton) this.arrowButton.buttonEl.removeClass('is-active');

        const canvas = this.getCanvas();

        switch (newTool) {
            case ToolMode.DRAW:
                this.isDrawingMode = true;
                if (this.drawButton) this.drawButton.buttonEl.addClass('is-active');
                if (canvas) {
                    canvas.isDrawingMode = true;
                    canvas.freeDrawingBrush = new PencilBrush(canvas);
                    this.updateBrushColor();
                    canvas.freeDrawingBrush.width = BRUSH_SIZES[this.currentBrushSizeIndex];
                }
                break;

            case ToolMode.TEXT:
                this.isTextMode = true;
                if (this.textButton) this.textButton.buttonEl.addClass('is-active');
                if (canvas) {
                    canvas.isDrawingMode = false;
                }
                break;

            case ToolMode.ARROW:
                this.isArrowMode = true;
                if (this.arrowButton) this.arrowButton.buttonEl.addClass('is-active');
                if (canvas) {
                    canvas.isDrawingMode = true;
                    const arrowBrush = new ArrowBrush(canvas);
                    canvas.freeDrawingBrush = arrowBrush;
                    this.updateBrushColor();
                    arrowBrush.width = BRUSH_SIZES[this.currentBrushSizeIndex];
                }
                break;

            case ToolMode.NONE:
                if (canvas) {
                    canvas.isDrawingMode = false;
                }
                break;
        }

        this.currentTool = newTool;
        this.updateObjectInteractivity();

        if (this.callbacks.onToolChanged) {
            this.callbacks.onToolChanged(newTool);
        }
    }

    toggleDrawingMode(): void {
        const newTool = this.currentTool === ToolMode.DRAW ? ToolMode.NONE : ToolMode.DRAW;
        this.switchTool(newTool);
    }

    toggleTextMode(): void {
        const newTool = this.currentTool === ToolMode.TEXT ? ToolMode.NONE : ToolMode.TEXT;
        this.switchTool(newTool);
    }

    toggleArrowMode(): void {
        const newTool = this.currentTool === ToolMode.ARROW ? ToolMode.NONE : ToolMode.ARROW;
        this.switchTool(newTool);
    }

    updateObjectInteractivity(): void {
        const canvas = this.getCanvas();
        if (!canvas) return;

        canvas.forEachObject(obj => {
            if (obj instanceof FabricImage) {
                obj.selectable = false;
                obj.evented = false;
            } else if (obj instanceof IText) {
                if (this.isDrawingMode) {
                    obj.selectable = false;
                    obj.evented = false;
                    obj.editable = false;
                } else {
                    obj.selectable = true;
                    obj.evented = true;
                    obj.editable = true;
                }
            } else {
                if (this.isTextMode) {
                    obj.selectable = false;
                    obj.evented = false;
                } else {
                    obj.selectable = !this.isDrawingMode;
                    obj.evented = !this.isDrawingMode;
                }
            }
        });

        canvas.selection = !this.isDrawingMode && !this.isTextMode;
        canvas.requestRenderAll();
    }

    updateBrushColor(): void {
        const canvas = this.getCanvas();
        if (!canvas?.freeDrawingBrush) return;

        const currentColor = this.callbacks.getBrushColor();
        const currentOpacity = BRUSH_OPACITIES[this.currentOpacityIndex];

        canvas.freeDrawingBrush.color = hexToRgba(currentColor, currentOpacity);
        canvas.freeDrawingBrush.width = BRUSH_SIZES[this.currentBrushSizeIndex];
    }

    updateDrawingModeUI(isDrawing: boolean): void {
        this.isDrawingMode = isDrawing;
        const canvas = this.getCanvas();
        if (canvas) {
            canvas.isDrawingMode = isDrawing;
        }

        this.updateObjectInteractivity();

        if (this.drawButton) {
            if (isDrawing) {
                this.drawButton.buttonEl.addClass('is-active');
            } else {
                this.drawButton.buttonEl.removeClass('is-active');
            }
        }

        canvas?.requestRenderAll();
    }

    // Getters and setters
    getCurrentTool(): ToolMode {
        return this.currentTool;
    }

    isInDrawingMode(): boolean {
        return this.isDrawingMode;
    }

    isInTextMode(): boolean {
        return this.isTextMode;
    }

    isInArrowMode(): boolean {
        return this.isArrowMode;
    }

    getBrushSizeIndex(): number {
        return this.currentBrushSizeIndex;
    }

    setBrushSizeIndex(index: number): void {
        this.currentBrushSizeIndex = index;
        const canvas = this.getCanvas();
        if (canvas?.freeDrawingBrush) {
            canvas.freeDrawingBrush.width = BRUSH_SIZES[this.currentBrushSizeIndex];
        }
    }

    getOpacityIndex(): number {
        return this.currentOpacityIndex;
    }

    setOpacityIndex(index: number): void {
        this.currentOpacityIndex = index;
        this.updateBrushColor();
    }

    getCurrentOpacity(): number {
        return BRUSH_OPACITIES[this.currentOpacityIndex];
    }

    getBlendMode(): BlendMode {
        return this.currentBlendMode;
    }

    setBlendMode(mode: BlendMode): void {
        this.currentBlendMode = mode;
        const canvas = this.getCanvas();
        if (canvas?.freeDrawingBrush) {
            (canvas.freeDrawingBrush as DrawingBrushWithComposite).globalCompositeOperation = mode;
        }
    }

    cleanup(): void {
        this.isDrawingMode = false;
        this.isTextMode = false;
        this.isArrowMode = false;
        this.currentTool = ToolMode.NONE;

        if (this.drawButton) {
            this.drawButton.buttonEl.removeClass('is-active');
        }
        if (this.textButton) {
            this.textButton.buttonEl.removeClass('is-active');
        }
        if (this.arrowButton) {
            this.arrowButton.buttonEl.removeClass('is-active');
        }
    }
}

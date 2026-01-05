import { Canvas, FabricImage, Point } from 'fabric';
import { Component } from 'obsidian';

export interface ViewportConfig {
    minWidth: number;
    minHeight: number;
    minZoom: number;
    maxZoom: number;
}

export class ViewportManager {
    private currentZoom = 1;
    private isPanning = false;
    private isSpacebarDown = false;
    private isResizing = false;
    private lastPanPoint: { x: number; y: number } | null = null;
    private resizeHandle: HTMLDivElement | null = null;
    private previousDrawingMode = false;

    private readonly config: ViewportConfig = {
        minWidth: 400,
        minHeight: 300,
        minZoom: 0.1,
        maxZoom: 10
    };

    constructor(
        private getCanvas: () => Canvas | null,
        private modalEl: HTMLElement,
        private componentContainer: Component,
        private getDrawingMode: () => boolean,
        private setDrawingMode: (mode: boolean) => void
    ) {}

    setupZoom(): void {
        const canvas = this.getCanvas();
        if (!canvas) return;

        canvas.on('mouse:wheel', (opt) => {
            const event = opt.e as WheelEvent;
            event.preventDefault();
            event.stopPropagation();

            const point = canvas.getScenePoint(event);
            const delta = event.deltaY;
            let newZoom = this.currentZoom * (delta > 0 ? 0.95 : 1.05);

            newZoom = Math.min(Math.max(newZoom, this.config.minZoom), this.config.maxZoom);

            if (newZoom !== this.currentZoom) {
                const backgroundImage = canvas.getObjects()[0] as FabricImage;

                if (backgroundImage) {
                    backgroundImage.objectCaching = false;
                }

                this.zoomToPoint(point, newZoom);

                setTimeout(() => {
                    if (backgroundImage) {
                        backgroundImage.objectCaching = true;
                        canvas.requestRenderAll();
                    }
                }, 100);
            }
        });
    }

    setupPan(): void {
        const canvas = this.getCanvas();
        if (!canvas) return;

        canvas.on('mouse:down', (opt) => {
            if (this.isSpacebarDown && opt.e) {
                this.isPanning = true;
                canvas.defaultCursor = 'grabbing';
                const event = opt.e as MouseEvent;
                this.lastPanPoint = { x: event.clientX, y: event.clientY };
            }
        });

        canvas.on('mouse:move', (opt) => {
            if (!this.isPanning || !this.lastPanPoint || !opt.e) return;

            const event = opt.e as MouseEvent;
            const currentPoint = { x: event.clientX, y: event.clientY };

            const deltaX = currentPoint.x - this.lastPanPoint.x;
            const deltaY = currentPoint.y - this.lastPanPoint.y;

            canvas.relativePan(new Point(deltaX, deltaY));
            this.lastPanPoint = currentPoint;
        });

        canvas.on('mouse:up', () => {
            if (this.isPanning) {
                this.isPanning = false;
                this.lastPanPoint = null;
                canvas.defaultCursor = this.isSpacebarDown ? 'grab' : 'default';
            }
        });
    }

    handleKeyDown(e: KeyboardEvent): boolean {
        if (e.code === 'Space') {
            if (!this.isSpacebarDown) {
                e.preventDefault();
                this.isSpacebarDown = true;
                const canvas = this.getCanvas();
                if (canvas) {
                    canvas.defaultCursor = 'grab';
                }

                this.previousDrawingMode = this.getDrawingMode();

                if (this.previousDrawingMode && canvas) {
                    canvas.isDrawingMode = false;
                }

                return true;
            }
        }
        return false;
    }

    handleKeyUp(e: KeyboardEvent): boolean {
        if (e.code === 'Space') {
            e.preventDefault();
            this.isSpacebarDown = false;
            this.isPanning = false;
            this.lastPanPoint = null;

            const canvas = this.getCanvas();
            if (canvas) {
                canvas.defaultCursor = 'default';

                if (this.previousDrawingMode) {
                    canvas.isDrawingMode = true;
                    this.setDrawingMode(true);
                }
            }

            this.previousDrawingMode = false;
            return true;
        }
        return false;
    }

    private zoomToPoint(point: Point, newZoom: number): void {
        const canvas = this.getCanvas();
        if (!canvas) return;

        const scaleFactor = newZoom / this.currentZoom;
        this.currentZoom = newZoom;

        const vpt = [...canvas.viewportTransform];
        if (!vpt) return;

        const canvasPoint = {
            x: point.x - vpt[4],
            y: point.y - vpt[5]
        };

        const newVpt: [number, number, number, number, number, number] = [
            newZoom,
            0,
            0,
            newZoom,
            point.x - canvasPoint.x * scaleFactor,
            point.y - canvasPoint.y * scaleFactor
        ];

        canvas.setViewportTransform(newVpt);
        this.enforceViewportBounds();

        const backgroundImage = canvas.getObjects()[0] as FabricImage;
        if (backgroundImage) {
            backgroundImage.setCoords();
        }

        canvas.requestRenderAll();

        setTimeout(() => {
            canvas.requestRenderAll();
        }, 50);
    }

    private enforceViewportBounds(): void {
        const canvas = this.getCanvas();
        if (!canvas) return;

        const vpt = canvas.viewportTransform;
        if (!vpt) return;

        const canvasWidth = canvas.width ?? 0;
        const canvasHeight = canvas.height ?? 0;

        const zoom = this.currentZoom;
        const maxX = canvasWidth * (1 - zoom);
        const maxY = canvasHeight * (1 - zoom);

        vpt[4] = Math.min(Math.max(vpt[4], maxX), 0);
        vpt[5] = Math.min(Math.max(vpt[5], maxY), 0);

        canvas.setViewportTransform(vpt);
    }

    resetZoom(): void {
        const canvas = this.getCanvas();
        if (!canvas) return;

        this.currentZoom = 1;
        canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        canvas.requestRenderAll();
    }

    setupResizable(): void {
        this.resizeHandle = this.modalEl.createDiv('modal-resize-handle');
        this.resizeHandle.innerHTML = '⋮⋮';

        this.componentContainer.registerDomEvent(this.resizeHandle, 'mousedown', this.startResize.bind(this));
        this.componentContainer.registerDomEvent(document, 'mousemove', this.resize.bind(this));
        this.componentContainer.registerDomEvent(document, 'mouseup', this.stopResize.bind(this));

        this.modalEl.addClass('resizable-modal');
    }

    private startResize(e: MouseEvent): void {
        this.isResizing = true;
        this.modalEl.addClass('is-resizing');
        e.preventDefault();
    }

    private resize(e: MouseEvent): void {
        const canvas = this.getCanvas();
        if (!this.isResizing || !canvas) return;

        const modalRect = this.modalEl.getBoundingClientRect();
        const newWidth = Math.max(this.config.minWidth, e.clientX - modalRect.left);
        const newHeight = Math.max(this.config.minHeight, e.clientY - modalRect.top);

        this.modalEl.style.width = `${newWidth}px`;
        this.modalEl.style.height = `${newHeight}px`;

        const toolbar = this.modalEl.querySelector('.image-converter-annotation-tool-annotation-toolbar') as HTMLElement;
        const toolbarHeight = toolbar?.offsetHeight ?? 0;
        const padding = 40;

        canvas.setDimensions({
            width: newWidth - padding,
            height: newHeight - toolbarHeight - padding
        });

        const backgroundImage = canvas.getObjects()[0] as FabricImage;
        if (backgroundImage) {
            const imageWidth = backgroundImage.width ?? 1;
            const imageHeight = backgroundImage.height ?? 1;

            const scale = Math.min(
                (newWidth - padding) / imageWidth,
                (newHeight - toolbarHeight - padding) / imageHeight
            ) * 0.8;

            backgroundImage.set({
                scaleX: scale,
                scaleY: scale
            });
        }

        const canvasWidth = canvas.width ?? 0;
        const canvasHeight = canvas.height ?? 0;

        canvas.getObjects().slice(1).forEach(obj => {
            const objBounds = obj.getBoundingRect();

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

        canvas.requestRenderAll();
    }

    private stopResize(): void {
        this.isResizing = false;
        this.modalEl.removeClass('is-resizing');
    }

    getCurrentZoom(): number {
        return this.currentZoom;
    }

    isCurrentlyPanning(): boolean {
        return this.isPanning;
    }

    isSpacebarPressed(): boolean {
        return this.isSpacebarDown;
    }

    cleanup(): void {
        this.isPanning = false;
        this.isSpacebarDown = false;
        this.lastPanPoint = null;
        this.resetZoom();

        const canvas = this.getCanvas();
        if (canvas) {
            canvas.defaultCursor = 'default';
        }
    }
}

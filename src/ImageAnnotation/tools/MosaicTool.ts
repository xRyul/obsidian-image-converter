import { Canvas, FabricImage, FabricObject, Rect } from 'fabric';
import { MOSAIC_BLOCK_SIZES } from '../types';

export const MOSAIC_MARKER = '__isMosaicRegion';

export function isMosaicImage(obj: FabricObject): boolean {
    return obj instanceof FabricImage && (obj as unknown as Record<string, unknown>)[MOSAIC_MARKER] === true;
}

export class MosaicTool {
    private isMouseDown = false;
    private previewRect: Rect | null = null;
    private startPoint: { x: number; y: number } | null = null;
    private currentBlockSizeIndex = 1; // default 10px

    constructor(
        private getCanvas: () => Canvas | null,
        private getBackgroundImage: () => FabricImage | null,
        private onMosaicCreated: () => void
    ) {}

    getBlockSizeIndex(): number {
        return this.currentBlockSizeIndex;
    }

    setBlockSizeIndex(index: number): void {
        if (index >= 0 && index < MOSAIC_BLOCK_SIZES.length) {
            this.currentBlockSizeIndex = index;
        }
    }

    getBlockSize(): number {
        return MOSAIC_BLOCK_SIZES[this.currentBlockSizeIndex];
    }

    onMouseDown(sceneX: number, sceneY: number): void {
        const canvas = this.getCanvas();
        const bgImage = this.getBackgroundImage();
        if (!canvas || !bgImage) return;

        // Check if point is within background image bounds
        if (!this.isPointInBackground(sceneX, sceneY, bgImage)) return;

        this.isMouseDown = true;
        this.startPoint = { x: sceneX, y: sceneY };

        // Create preview rectangle
        this.previewRect = new Rect({
            left: sceneX,
            top: sceneY,
            width: 0,
            height: 0,
            fill: 'rgba(0, 120, 255, 0.15)',
            stroke: 'rgba(0, 120, 255, 0.6)',
            strokeWidth: 1,
            selectable: false,
            evented: false,
            strokeDashArray: [4, 4],
        });

        canvas.add(this.previewRect);
        canvas.requestRenderAll();
    }

    onMouseMove(sceneX: number, sceneY: number): void {
        if (!this.isMouseDown || !this.startPoint || !this.previewRect) return;

        const canvas = this.getCanvas();
        if (!canvas) return;

        const left = Math.min(this.startPoint.x, sceneX);
        const top = Math.min(this.startPoint.y, sceneY);
        const width = Math.abs(sceneX - this.startPoint.x);
        const height = Math.abs(sceneY - this.startPoint.y);

        this.previewRect.set({ left, top, width, height });
        canvas.requestRenderAll();
    }

    onMouseUp(sceneX: number, sceneY: number): void {
        if (!this.isMouseDown || !this.startPoint) return;

        const canvas = this.getCanvas();
        if (!canvas) return;

        // Remove preview rect
        if (this.previewRect) {
            canvas.remove(this.previewRect);
            this.previewRect = null;
        }

        const left = Math.min(this.startPoint.x, sceneX);
        const top = Math.min(this.startPoint.y, sceneY);
        const width = Math.abs(sceneX - this.startPoint.x);
        const height = Math.abs(sceneY - this.startPoint.y);

        this.isMouseDown = false;
        this.startPoint = null;

        // Ignore tiny drags (click mistakes)
        if (width < 3 || height < 3) return;

        void this.createMosaicRegion(left, top, width, height);
    }

    private isPointInBackground(x: number, y: number, bgImage: FabricImage): boolean {
        const bgLeft = bgImage.left ?? 0;
        const bgTop = bgImage.top ?? 0;
        const bgWidth = (bgImage.width ?? 0) * (bgImage.scaleX ?? 1);
        const bgHeight = (bgImage.height ?? 0) * (bgImage.scaleY ?? 1);

        return x >= bgLeft && x <= bgLeft + bgWidth && y >= bgTop && y <= bgTop + bgHeight;
    }

    private async createMosaicRegion(left: number, top: number, width: number, height: number): Promise<void> {
        const canvas = this.getCanvas();
        const bgImage = this.getBackgroundImage();
        if (!canvas || !bgImage) return;

        // Clamp region to background image bounds
        const bgLeft = bgImage.left ?? 0;
        const bgTop = bgImage.top ?? 0;
        const bgWidth = (bgImage.width ?? 0) * (bgImage.scaleX ?? 1);
        const bgHeight = (bgImage.height ?? 0) * (bgImage.scaleY ?? 1);

        const clampedLeft = Math.max(left, bgLeft);
        const clampedTop = Math.max(top, bgTop);
        const clampedRight = Math.min(left + width, bgLeft + bgWidth);
        const clampedBottom = Math.min(top + height, bgTop + bgHeight);

        const clampedWidth = clampedRight - clampedLeft;
        const clampedHeight = clampedBottom - clampedTop;

        if (clampedWidth <= 0 || clampedHeight <= 0) return;

        // Extract region from background image
        const bgElement = bgImage.getElement() as HTMLImageElement;
        const scaleX = bgImage.scaleX ?? 1;
        const scaleY = bgImage.scaleY ?? 1;

        // Convert canvas coordinates to source image coordinates
        const srcX = (clampedLeft - bgLeft) / scaleX;
        const srcY = (clampedTop - bgTop) / scaleY;
        const srcWidth = clampedWidth / scaleX;
        const srcHeight = clampedHeight / scaleY;

        // Create pixelated region
        const pixelatedCanvas = this.pixelateRegion(bgElement, srcX, srcY, srcWidth, srcHeight);
        if (!pixelatedCanvas) return;

        try {
            const dataUrl = pixelatedCanvas.toDataURL('image/png');
            const img = new Image();

            await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject(new Error('Failed to load mosaic image'));
                img.src = dataUrl;
            });

            const mosaicImage = new FabricImage(img, {
                left: clampedLeft,
                top: clampedTop,
                scaleX: clampedWidth / img.width,
                scaleY: clampedHeight / img.height,
                selectable: true,
                evented: true,
                hasControls: true,
                hasBorders: true,
                objectCaching: true,
                crossOrigin: 'anonymous',
                strokeWidth: 0,
            });

            // Mark as mosaic region
            (mosaicImage as unknown as Record<string, unknown>)[MOSAIC_MARKER] = true;

            canvas.add(mosaicImage);
            canvas.requestRenderAll();
            this.onMosaicCreated();
        } catch (error) {
            console.error('Error creating mosaic region:', error);
        }
    }

    private pixelateRegion(
        source: HTMLImageElement,
        srcX: number,
        srcY: number,
        srcWidth: number,
        srcHeight: number
    ): HTMLCanvasElement | null {
        const blockSize = this.getBlockSize();

        // Create canvas for the extracted region
        const extractCanvas = document.createElement('canvas');
        extractCanvas.width = Math.ceil(srcWidth);
        extractCanvas.height = Math.ceil(srcHeight);
        const extractCtx = extractCanvas.getContext('2d');
        if (!extractCtx) return null;

        extractCtx.drawImage(
            source,
            srcX, srcY, srcWidth, srcHeight,
            0, 0, extractCanvas.width, extractCanvas.height
        );

        // Downscale
        const smallWidth = Math.max(1, Math.ceil(extractCanvas.width / blockSize));
        const smallHeight = Math.max(1, Math.ceil(extractCanvas.height / blockSize));

        const smallCanvas = document.createElement('canvas');
        smallCanvas.width = smallWidth;
        smallCanvas.height = smallHeight;
        const smallCtx = smallCanvas.getContext('2d');
        if (!smallCtx) return null;

        smallCtx.drawImage(extractCanvas, 0, 0, smallWidth, smallHeight);

        // Upscale with nearest-neighbor (pixelated effect)
        const resultCanvas = document.createElement('canvas');
        resultCanvas.width = extractCanvas.width;
        resultCanvas.height = extractCanvas.height;
        const resultCtx = resultCanvas.getContext('2d');
        if (!resultCtx) return null;

        resultCtx.imageSmoothingEnabled = false;
        resultCtx.drawImage(smallCanvas, 0, 0, resultCanvas.width, resultCanvas.height);

        return resultCanvas;
    }

    cancel(): void {
        const canvas = this.getCanvas();
        if (canvas && this.previewRect) {
            canvas.remove(this.previewRect);
            this.previewRect = null;
        }
        this.isMouseDown = false;
        this.startPoint = null;
    }

    cleanup(): void {
        this.cancel();
    }
}

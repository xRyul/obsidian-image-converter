import { Canvas, FabricImage, FabricObject, ImageProps, ImageSource, Rect, classRegistry } from 'fabric';
import { MOSAIC_BLOCK_SIZES } from '../types';

/** Drags smaller than this many scene pixels in either direction are treated as clicks. */
const MIN_DRAG_SIZE = 3;

type HistoryIgnoredRect = Rect & {
    excludeFromHistory?: boolean;
};

export interface MosaicRegion {
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface SourceRegion {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * A pixelated patch baked from the background image.
 *
 * The bitmap is stored at one pixel per block and scaled up without smoothing, so history
 * snapshots stay small. A mosaic can be selected and deleted, but not moved, scaled or
 * rotated: moving it would uncover the pixels it hides.
 */
export class MosaicImage extends FabricImage {
    static type = 'MosaicImage';

    constructor(element: ImageSource, options?: Partial<ImageProps>) {
        super(element, options);
        this.set({
            imageSmoothing: false,
            objectCaching: false,
            lockMovementX: true,
            lockMovementY: true,
            lockRotation: true,
            lockScalingX: true,
            lockScalingY: true,
            lockSkewingX: true,
            lockSkewingY: true,
            hasControls: false,
            hoverCursor: 'pointer',
        });
    }
}

classRegistry.setClass(MosaicImage);

export function isMosaicImage(obj: FabricObject | undefined): obj is MosaicImage {
    return obj instanceof MosaicImage;
}

/**
 * Clamps a scene-space rectangle to the background bounds and snaps it to whole source pixels,
 * so that every block covers the same source pixels as it will in the saved image.
 */
export function mapRegionToSource(
    region: MosaicRegion,
    background: { left: number; top: number; scaleX: number; scaleY: number; width: number; height: number }
): SourceRegion | null {
    const { left: bgLeft, top: bgTop, scaleX, scaleY, width: bgWidth, height: bgHeight } = background;
    if (scaleX <= 0 || scaleY <= 0 || bgWidth <= 0 || bgHeight <= 0) return null;

    const x0 = Math.max(0, Math.floor((region.left - bgLeft) / scaleX));
    const y0 = Math.max(0, Math.floor((region.top - bgTop) / scaleY));
    const x1 = Math.min(bgWidth, Math.ceil((region.left + region.width - bgLeft) / scaleX));
    const y1 = Math.min(bgHeight, Math.ceil((region.top + region.height - bgTop) / scaleY));

    if (x1 <= x0 || y1 <= y0) return null;

    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export class MosaicTool {
    private previewRect: HistoryIgnoredRect | null = null;
    private startPoint: { x: number; y: number } | null = null;
    private currentBlockSizeIndex = 2; // default 15px

    constructor(
        private getCanvas: () => Canvas | null,
        private getBackgroundImage: () => FabricImage | null
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

    isDragging(): boolean {
        return this.startPoint !== null;
    }

    onMouseDown(sceneX: number, sceneY: number): void {
        const canvas = this.getCanvas();
        const bgImage = this.getBackgroundImage();
        if (!canvas || !bgImage) return;
        if (!this.isPointInBackground(sceneX, sceneY, bgImage)) return;

        this.cancel();
        this.startPoint = { x: sceneX, y: sceneY };

        const previewRect: HistoryIgnoredRect = new Rect({
            left: sceneX,
            top: sceneY,
            width: 0,
            height: 0,
            fill: 'rgba(0, 120, 255, 0.15)',
            stroke: 'rgba(0, 120, 255, 0.6)',
            strokeWidth: 1,
            strokeUniform: true,
            strokeDashArray: [4, 4],
            selectable: false,
            evented: false,
            excludeFromExport: true,
        });
        previewRect.excludeFromHistory = true;
        this.previewRect = previewRect;

        canvas.add(previewRect);
        canvas.requestRenderAll();
    }

    onMouseMove(sceneX: number, sceneY: number): void {
        if (!this.startPoint || !this.previewRect) return;

        const canvas = this.getCanvas();
        if (!canvas) return;

        this.previewRect.set(this.regionFrom(sceneX, sceneY));
        this.previewRect.setCoords();
        canvas.requestRenderAll();
    }

    /** Returns true when a mosaic region was added to the canvas. */
    onMouseUp(sceneX: number, sceneY: number): boolean {
        if (!this.startPoint) return false;

        const region = this.regionFrom(sceneX, sceneY);
        this.cancel();

        if (region.width < MIN_DRAG_SIZE || region.height < MIN_DRAG_SIZE) return false;

        return this.createMosaicRegion(region);
    }

    cancel(): void {
        const canvas = this.getCanvas();
        if (canvas && this.previewRect) {
            canvas.remove(this.previewRect);
            canvas.requestRenderAll();
        }
        this.previewRect = null;
        this.startPoint = null;
    }

    cleanup(): void {
        this.cancel();
    }

    private regionFrom(sceneX: number, sceneY: number): MosaicRegion {
        const start = this.startPoint ?? { x: sceneX, y: sceneY };
        return {
            left: Math.min(start.x, sceneX),
            top: Math.min(start.y, sceneY),
            width: Math.abs(sceneX - start.x),
            height: Math.abs(sceneY - start.y),
        };
    }

    private isPointInBackground(x: number, y: number, bgImage: FabricImage): boolean {
        const { left, top, width, height } = this.getBackgroundGeometry(bgImage);
        return x >= left && x <= left + width && y >= top && y <= top + height;
    }

    private getBackgroundGeometry(bgImage: FabricImage) {
        const scaleX = bgImage.scaleX ?? 1;
        const scaleY = bgImage.scaleY ?? 1;
        return {
            left: bgImage.left ?? 0,
            top: bgImage.top ?? 0,
            scaleX,
            scaleY,
            width: (bgImage.width ?? 0) * scaleX,
            height: (bgImage.height ?? 0) * scaleY,
        };
    }

    private createMosaicRegion(region: MosaicRegion): boolean {
        const canvas = this.getCanvas();
        const bgImage = this.getBackgroundImage();
        if (!canvas || !bgImage) return false;

        const { left, top, scaleX, scaleY } = this.getBackgroundGeometry(bgImage);
        const source = mapRegionToSource(region, {
            left,
            top,
            scaleX,
            scaleY,
            width: bgImage.width ?? 0,
            height: bgImage.height ?? 0,
        });
        if (!source) return false;

        const blocks = this.pixelateRegion(bgImage.getElement(), source);
        if (!blocks) return false;

        const mosaic = new MosaicImage(blocks, {
            left: left + source.x * scaleX,
            top: top + source.y * scaleY,
            scaleX: (source.width / blocks.width) * scaleX,
            scaleY: (source.height / blocks.height) * scaleY,
            strokeWidth: 0,
        });

        canvas.add(mosaic);
        canvas.requestRenderAll();
        return true;
    }

    /**
     * Averages the source region into one pixel per block. Edge blocks are slightly larger
     * when the region size is not a multiple of the block size.
     */
    private pixelateRegion(source: ImageSource, region: SourceRegion): HTMLCanvasElement | null {
        const blockSize = this.getBlockSize();
        const columns = Math.max(1, Math.round(region.width / blockSize));
        const rows = Math.max(1, Math.round(region.height / blockSize));

        const doc = source.ownerDocument ?? activeDocument;
        const blocks = doc.createElement('canvas');
        blocks.width = columns;
        blocks.height = rows;

        const ctx = blocks.getContext('2d');
        if (!ctx) return null;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(source, region.x, region.y, region.width, region.height, 0, 0, columns, rows);

        return blocks;
    }
}

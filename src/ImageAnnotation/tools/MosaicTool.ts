import { Canvas, FabricImage, FabricObject, ImageProps, ImageSource, Rect, classRegistry } from 'fabric';
import { MOSAIC_BLOCK_SIZES } from '../types';

/** Drags smaller than this many scene pixels in either direction are treated as clicks. */
const MIN_DRAG_SIZE = 3;

const DEFAULT_BLOCK_SIZE = 15;

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

export type MosaicImageOptions = Partial<ImageProps> & { blockSize?: number };

/**
 * A pixelated patch of the background image.
 *
 * The bitmap holds one pixel per block and is scaled up without smoothing, so history
 * snapshots stay small. MosaicTool.refresh() rebuilds it from the background after every
 * move, resize or block size change, so a mosaic always hides what is under it and never
 * carries pixels from somewhere else. Rotation and skew are off: the patch stays aligned
 * with the image's pixel grid.
 */
export class MosaicImage extends FabricImage {
    static type = 'MosaicImage';
    static customProperties = ['blockSize'];

    /** Edge of one block, in pixels of the source image. */
    declare blockSize: number;

    constructor(element: ImageSource, options: MosaicImageOptions = {}) {
        super(element, options);
        this.blockSize = options.blockSize ?? DEFAULT_BLOCK_SIZE;
        this.set({
            imageSmoothing: false,
            objectCaching: false,
            lockRotation: true,
            lockSkewingX: true,
            lockSkewingY: true,
            lockScalingFlip: true,
        });
        this.setControlVisible('mtr', false);
    }
}

classRegistry.setClass(MosaicImage);

export function isMosaicImage(obj: FabricObject | undefined): obj is MosaicImage {
    return obj instanceof MosaicImage;
}

interface BackgroundGeometry {
    left: number;
    top: number;
    scaleX: number;
    scaleY: number;
    /** Size of the source image in its own pixels. */
    width: number;
    height: number;
}

/**
 * Clamps a scene-space rectangle to the background bounds and snaps it to whole source pixels,
 * so that every block covers the same source pixels as it will in the saved image.
 */
export function mapRegionToSource(region: MosaicRegion, background: BackgroundGeometry): SourceRegion | null {
    const { left: bgLeft, top: bgTop, scaleX, scaleY, width: bgWidth, height: bgHeight } = background;
    if (scaleX <= 0 || scaleY <= 0 || bgWidth <= 0 || bgHeight <= 0) return null;

    const x0 = Math.max(0, Math.floor((region.left - bgLeft) / scaleX));
    const y0 = Math.max(0, Math.floor((region.top - bgTop) / scaleY));
    const x1 = Math.min(bgWidth, Math.ceil((region.left + region.width - bgLeft) / scaleX));
    const y1 = Math.min(bgHeight, Math.ceil((region.top + region.height - bgTop) / scaleY));

    if (x1 <= x0 || y1 <= y0) return null;

    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** How far a span has to shift to fit inside [min, min + range]. Oversized spans align to min. */
function shiftIntoRange(start: number, size: number, min: number, range: number): number {
    if (size >= range) return min - start;
    return Math.min(Math.max(start, min), min + range - size) - start;
}

export class MosaicTool {
    private previewRect: HistoryIgnoredRect | null = null;
    private startPoint: { x: number; y: number } | null = null;
    private currentBlockSizeIndex = MOSAIC_BLOCK_SIZES.indexOf(DEFAULT_BLOCK_SIZE);

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

    /** Returns the mosaic added to the canvas, or null for a click or a failed drag. */
    onMouseUp(sceneX: number, sceneY: number): MosaicImage | null {
        if (!this.startPoint) return null;

        const region = this.regionFrom(sceneX, sceneY);
        this.cancel();

        if (region.width < MIN_DRAG_SIZE || region.height < MIN_DRAG_SIZE) return null;

        return this.createMosaicRegion(region);
    }

    /**
     * Rebuilds the mosaic from the background under its current box, at its own block size.
     * Call after the mosaic is moved or resized, or its block size changes.
     */
    refresh(mosaic: MosaicImage): boolean {
        const bgImage = this.getBackgroundImage();
        if (!bgImage) return false;

        const background = this.getBackgroundGeometry(bgImage);
        mosaic.setCoords();
        const source = mapRegionToSource(mosaic.getBoundingRect(), background);
        if (!source) return false;

        const blocks = this.pixelateRegion(bgImage.getElement(), source, mosaic.blockSize);
        if (!blocks) return false;

        if (mosaic.group) {
            // Inside a multi-selection the position is relative to the group, so keep the box as it is
            const width = mosaic.width * mosaic.scaleX;
            const height = mosaic.height * mosaic.scaleY;
            mosaic.setElement(blocks);
            mosaic.set({ scaleX: width / blocks.width, scaleY: height / blocks.height });
        } else {
            mosaic.setElement(blocks);
            mosaic.set({ originX: 'left', originY: 'top', ...this.placeOver(source, blocks, background) });
        }

        mosaic.setCoords();
        return true;
    }

    /** Moves a mosaic back inside the background image if a drag took it past an edge. */
    keepInsideBackground(mosaic: MosaicImage): void {
        const bgImage = this.getBackgroundImage();
        if (!bgImage || mosaic.group) return;

        const { left, top, scaleX, scaleY, width, height } = this.getBackgroundGeometry(bgImage);
        mosaic.setCoords();
        const box = mosaic.getBoundingRect();
        const dx = shiftIntoRange(box.left, box.width, left, width * scaleX);
        const dy = shiftIntoRange(box.top, box.height, top, height * scaleY);

        if (dx !== 0 || dy !== 0) {
            mosaic.set({ left: mosaic.left + dx, top: mosaic.top + dy });
            mosaic.setCoords();
        }
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
        const { left, top, scaleX, scaleY, width, height } = this.getBackgroundGeometry(bgImage);
        return x >= left && x <= left + width * scaleX && y >= top && y <= top + height * scaleY;
    }

    private getBackgroundGeometry(bgImage: FabricImage): BackgroundGeometry {
        return {
            left: bgImage.left ?? 0,
            top: bgImage.top ?? 0,
            scaleX: bgImage.scaleX ?? 1,
            scaleY: bgImage.scaleY ?? 1,
            width: bgImage.width ?? 0,
            height: bgImage.height ?? 0,
        };
    }

    /** Scene position and scale that lay the blocks exactly over the source region. */
    private placeOver(source: SourceRegion, blocks: HTMLCanvasElement, background: BackgroundGeometry) {
        return {
            left: background.left + source.x * background.scaleX,
            top: background.top + source.y * background.scaleY,
            scaleX: (source.width / blocks.width) * background.scaleX,
            scaleY: (source.height / blocks.height) * background.scaleY,
        };
    }

    private createMosaicRegion(region: MosaicRegion): MosaicImage | null {
        const canvas = this.getCanvas();
        const bgImage = this.getBackgroundImage();
        if (!canvas || !bgImage) return null;

        const background = this.getBackgroundGeometry(bgImage);
        const source = mapRegionToSource(region, background);
        if (!source) return null;

        const blockSize = this.getBlockSize();
        const blocks = this.pixelateRegion(bgImage.getElement(), source, blockSize);
        if (!blocks) return null;

        const mosaic = new MosaicImage(blocks, {
            ...this.placeOver(source, blocks, background),
            blockSize,
            strokeWidth: 0,
        });

        canvas.add(mosaic);
        canvas.requestRenderAll();
        return mosaic;
    }

    /**
     * Averages the source region into one pixel per block. Edge blocks are slightly larger
     * when the region size is not a multiple of the block size.
     */
    private pixelateRegion(source: ImageSource, region: SourceRegion, blockSize: number): HTMLCanvasElement | null {
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

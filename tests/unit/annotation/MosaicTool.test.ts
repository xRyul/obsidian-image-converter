import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { type Canvas, FabricImage, Rect, StaticCanvas, classRegistry, util } from 'fabric';
import { HistoryManager } from '../../../src/ImageAnnotation/managers/HistoryManager';
import { MOSAIC_BLOCK_SIZES } from '../../../src/ImageAnnotation/types';
import {
  MosaicImage,
  MosaicTool,
  isMosaicImage,
  mapRegionToSource,
} from '../../../src/ImageAnnotation/tools/MosaicTool';

/**
 * happy-dom's canvas has no 2D context. The tests give the mosaic canvas a small recording
 * context so they can check which source pixels were averaged into how many blocks.
 */
interface DrawCall {
  source: CanvasImageSource;
  sx: number; sy: number; sw: number; sh: number;
  dx: number; dy: number; dw: number; dh: number;
}

let drawCalls: DrawCall[] = [];

beforeEach(() => {
  drawCalls = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low',
    drawImage: (source: CanvasImageSource, ...args: number[]) => {
      const [sx, sy, sw, sh, dx, dy, dw, dh] = args;
      drawCalls.push({ source, sx, sy, sw, sh, dx, dy, dw, dh });
    },
  }) as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Background like the modal creates: 400×300 source pixels shown at half size, offset 50/20. */
function setup(blockSizeIndex = MOSAIC_BLOCK_SIZES.indexOf(10)) {
  const source = document.createElement('canvas');
  source.width = 400;
  source.height = 300;

  const canvas = new StaticCanvas(document.createElement('canvas'), { width: 800, height: 600 });
  const background = new FabricImage(source, { left: 50, top: 20, scaleX: 0.5, scaleY: 0.5 });
  canvas.add(background);

  const tool = new MosaicTool(() => canvas as unknown as Canvas, () => background);
  tool.setBlockSizeIndex(blockSizeIndex);

  return { canvas, background, source, tool };
}

function drag(tool: MosaicTool, from: [number, number], to: [number, number]): boolean {
  tool.onMouseDown(from[0], from[1]);
  tool.onMouseMove((from[0] + to[0]) / 2, (from[1] + to[1]) / 2);
  return tool.onMouseUp(to[0], to[1]);
}

describe('mapRegionToSource', () => {
  const background = { left: 50, top: 20, scaleX: 0.5, scaleY: 0.5, width: 400, height: 300 };

  it('maps a scene rectangle to the source pixels under it', () => {
    expect(mapRegionToSource({ left: 60, top: 30, width: 50, height: 25 }, background))
      .toEqual({ x: 20, y: 20, width: 100, height: 50 });
  });

  it('clamps a rectangle that extends past the image edges', () => {
    expect(mapRegionToSource({ left: 0, top: 0, width: 1000, height: 1000 }, background))
      .toEqual({ x: 0, y: 0, width: 400, height: 300 });
  });

  it('rounds outwards to whole source pixels so no partly covered pixel is left uncovered', () => {
    // Scene 60.3–70.6 covers source 20.6–41.2, so pixels 20 to 41 inclusive
    expect(mapRegionToSource({ left: 60.3, top: 30.3, width: 10.3, height: 10.3 }, background))
      .toEqual({ x: 20, y: 20, width: 22, height: 22 });
  });

  it('returns null for a rectangle entirely outside the image', () => {
    expect(mapRegionToSource({ left: 300, top: 300, width: 20, height: 20 }, background)).toBeNull();
  });

  it('returns null for a degenerate background', () => {
    expect(mapRegionToSource({ left: 60, top: 30, width: 5, height: 5 }, { ...background, scaleX: 0 })).toBeNull();
  });
});

describe('MosaicTool', () => {
  it('averages the dragged area into one pixel per block and places it over that area', () => {
    const { canvas, source, tool } = setup();

    expect(drag(tool, [60, 30], [110, 55])).toBe(true);

    const mosaics = canvas.getObjects().filter(isMosaicImage);
    expect(mosaics).toHaveLength(1);
    const [mosaic] = mosaics;

    // 100×50 source pixels at 10px blocks → 10×5 blocks
    expect(drawCalls).toHaveLength(1);
    expect(drawCalls[0]).toMatchObject({ source, sx: 20, sy: 20, sw: 100, sh: 50, dx: 0, dy: 0, dw: 10, dh: 5 });
    expect(mosaic.width).toBe(10);
    expect(mosaic.height).toBe(5);

    const bounds = mosaic.getBoundingRect();
    expect(bounds.left).toBeCloseTo(60);
    expect(bounds.top).toBeCloseTo(30);
    expect(bounds.width).toBeCloseTo(50);
    expect(bounds.height).toBeCloseTo(25);
  });

  it('uses the selected block size', () => {
    const { tool } = setup(MOSAIC_BLOCK_SIZES.indexOf(20));
    drag(tool, [60, 30], [110, 55]);
    expect(drawCalls[0]).toMatchObject({ dw: 5, dh: 3 });
  });

  it('keeps at least one block for an area smaller than a block', () => {
    const { tool } = setup(MOSAIC_BLOCK_SIZES.indexOf(30));
    drag(tool, [60, 30], [64, 34]);
    expect(drawCalls[0]).toMatchObject({ dw: 1, dh: 1 });
  });

  it('works for a drag in any direction', () => {
    const { canvas, tool } = setup();
    drag(tool, [110, 55], [60, 30]);
    expect(drawCalls[0]).toMatchObject({ sx: 20, sy: 20, sw: 100, sh: 50 });
    expect(canvas.getObjects().filter(isMosaicImage)).toHaveLength(1);
  });

  it('ignores a click or a tiny drag', () => {
    const { canvas, tool } = setup();
    expect(drag(tool, [60, 30], [62, 80])).toBe(false);
    expect(canvas.getObjects()).toHaveLength(1);
  });

  it('ignores a drag that starts outside the image', () => {
    const { canvas, tool } = setup();
    tool.onMouseDown(10, 10);
    expect(tool.isDragging()).toBe(false);
    expect(tool.onMouseUp(100, 100)).toBe(false);
    expect(canvas.getObjects()).toHaveLength(1);
  });

  it('shows a preview while dragging that is left out of history and export, and removes it afterwards', () => {
    const { canvas, tool } = setup();
    tool.onMouseDown(60, 30);
    tool.onMouseMove(110, 55);

    const preview = canvas.getObjects().find(obj => obj instanceof Rect) as Rect & { excludeFromHistory?: boolean };
    expect(preview).toBeDefined();
    expect(preview.excludeFromHistory).toBe(true);
    expect(preview.excludeFromExport).toBe(true);
    expect(preview.selectable).toBe(false);
    expect(preview.evented).toBe(false);
    expect(preview.width).toBe(50);
    expect(preview.height).toBe(25);

    tool.onMouseUp(110, 55);
    expect(canvas.getObjects().some(obj => obj instanceof Rect)).toBe(false);
  });

  it('cancel() removes the preview and stops the drag', () => {
    const { canvas, tool } = setup();
    tool.onMouseDown(60, 30);
    tool.cancel();

    expect(tool.isDragging()).toBe(false);
    expect(canvas.getObjects()).toHaveLength(1);
    expect(tool.onMouseUp(110, 55)).toBe(false);
  });

  it('ignores block size indexes outside the list', () => {
    const { tool } = setup();
    tool.setBlockSizeIndex(-1);
    tool.setBlockSizeIndex(MOSAIC_BLOCK_SIZES.length);
    expect(tool.getBlockSize()).toBe(10);
  });
});

describe('MosaicImage', () => {
  const blocks = (): HTMLCanvasElement => {
    const element = document.createElement('canvas');
    element.width = 4;
    element.height = 3;
    return element;
  };

  it('can be selected but not moved, scaled, rotated or styled with smoothing', () => {
    const mosaic = new MosaicImage(blocks());
    expect(mosaic).toMatchObject({
      lockMovementX: true,
      lockMovementY: true,
      lockRotation: true,
      lockScalingX: true,
      lockScalingY: true,
      hasControls: false,
      imageSmoothing: false,
    });
  });

  it('is told apart from the background image', () => {
    expect(isMosaicImage(new MosaicImage(blocks()))).toBe(true);
    expect(isMosaicImage(new FabricImage(blocks()))).toBe(false);
    expect(isMosaicImage(undefined)).toBe(false);
  });

  it('is registered with Fabric so history snapshots restore it as a mosaic', async () => {
    expect(classRegistry.getClass('MosaicImage')).toBe(MosaicImage);

    const original = new MosaicImage(blocks(), { left: 12, top: 34, scaleX: 5, scaleY: 6 });
    const [restored] = await util.enlivenObjects([original.toObject()]);

    expect(restored).toBeInstanceOf(MosaicImage);
    expect(restored).toMatchObject({ left: 12, top: 34, scaleX: 5, scaleY: 6, lockMovementX: true, hasControls: false });
  });

  it('survives an undo and redo round trip through HistoryManager', async () => {
    const { canvas, tool } = setup();
    const history = new HistoryManager(() => canvas as unknown as Canvas);
    history.initialize();

    drag(tool, [60, 30], [110, 55]);
    history.saveState();
    expect(history.canUndo()).toBe(true);

    await history.undo();
    expect(canvas.getObjects().filter(isMosaicImage)).toHaveLength(0);

    await history.redo();
    const restored = canvas.getObjects().filter(isMosaicImage);
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ lockMovementX: true, imageSmoothing: false });
  });
});

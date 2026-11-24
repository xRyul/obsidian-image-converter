/**
 * Unit tests for the canvas rotate and flip helpers.
 *
 * jsdom has no real canvas, so these tests use a fake 2D context that keeps
 * the current transform matrix. The tests then calculate where the pixels of
 * the source go on the new canvas.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { transformCanvas, transformForOrientation } from '../../../src/utils/canvasTransform';

type Point = { x: number; y: number };

/** A fake canvas whose context records where `drawImage` puts the source. */
function fakeMatrixCanvas() {
  // Affine matrix [a c e; b d f]: x' = a*x + c*y + e, y' = b*x + d*y + f.
  let matrix = [1, 0, 0, 1, 0, 0];
  let drawOrigin: Point | null = null;
  let drawMatrix = matrix;

  const multiply = (next: number[]) => {
    const [a, b, c, d, e, f] = matrix;
    const [na, nb, nc, nd, ne, nf] = next;
    matrix = [
      a * na + c * nb,
      b * na + d * nb,
      a * nc + c * nd,
      b * nc + d * nd,
      a * ne + c * nf + e,
      b * ne + d * nf + f,
    ];
  };

  const ctx = {
    translate: (x: number, y: number) => multiply([1, 0, 0, 1, x, y]),
    rotate: (angle: number) => multiply([Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0]),
    scale: (x: number, y: number) => multiply([x, 0, 0, y, 0, 0]),
    drawImage: (_source: unknown, x: number, y: number) => {
      drawOrigin = { x, y };
      drawMatrix = matrix;
    },
  };

  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    /** Maps a point of the source to its position on this canvas. */
    locate(point: Point): Point {
      const [a, b, c, d, e, f] = drawMatrix;
      const x = drawOrigin!.x + point.x;
      const y = drawOrigin!.y + point.y;
      return { x: a * x + c * y + e, y: b * x + d * y + f };
    },
  };

  return canvas;
}

function mockCanvasCreation() {
  const canvas = fakeMatrixCanvas();
  vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLElement);
  return canvas;
}

const SOURCE = { width: 4, height: 2 } as HTMLCanvasElement;

describe('canvasTransform', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('transformForOrientation', () => {
    it.each([1, 0, 9, NaN])('Given Orientation %s, When looked up, Then no transform is needed', (orientation) => {
      expect(transformForOrientation(orientation)).toBeNull();
    });

    // The EXIF specification gives, for each value, the visual position of
    // the first stored row and the first stored column. From these come the
    // visual corner of the first stored pixel, and the visual direction in
    // which a stored row runs.
    it.each([
      [2, 'top-right', 'left'],
      [3, 'bottom-right', 'left'],
      [4, 'bottom-left', 'right'],
      [5, 'top-left', 'down'],
      [6, 'top-right', 'down'],
      [7, 'bottom-right', 'up'],
      [8, 'bottom-left', 'up'],
    ] as const)('Given Orientation %s, When its transform is applied, Then the first stored pixel goes to the %s and a row runs %s', (orientation, corner, direction) => {
      const canvas = mockCanvasCreation();

      transformCanvas(SOURCE, transformForOrientation(orientation)!);

      // Centres of the first pixel and of the next pixel in the same row.
      const first = canvas.locate({ x: 0.5, y: 0.5 });
      const next = canvas.locate({ x: 1.5, y: 0.5 });

      const expectedCorner = {
        'top-left': { x: 0.5, y: 0.5 },
        'top-right': { x: canvas.width - 0.5, y: 0.5 },
        'bottom-right': { x: canvas.width - 0.5, y: canvas.height - 0.5 },
        'bottom-left': { x: 0.5, y: canvas.height - 0.5 },
      }[corner];
      const expectedStep = {
        right: { x: 1, y: 0 },
        left: { x: -1, y: 0 },
        down: { x: 0, y: 1 },
        up: { x: 0, y: -1 },
      }[direction];

      expect(first.x).toBeCloseTo(expectedCorner.x);
      expect(first.y).toBeCloseTo(expectedCorner.y);
      expect(next.x - first.x).toBeCloseTo(expectedStep.x);
      expect(next.y - first.y).toBeCloseTo(expectedStep.y);
    });
  });

  describe('transformCanvas', () => {
    it.each([90, 270, -90])('Given a rotation of %s degrees, When transformed, Then the width and the height are exchanged', (degrees) => {
      mockCanvasCreation();

      const result = transformCanvas(SOURCE, { degrees, flipX: false, flipY: false });

      expect(result.width).toBe(2);
      expect(result.height).toBe(4);
    });

    it.each([0, 180, 45])('Given a rotation of %s degrees, When transformed, Then the canvas keeps the size of the source', (degrees) => {
      mockCanvasCreation();

      const result = transformCanvas(SOURCE, { degrees, flipX: false, flipY: false });

      expect(result.width).toBe(4);
      expect(result.height).toBe(2);
    });

    it('Given a vertical flip, When transformed, Then the first stored pixel goes to the bottom-left', () => {
      const canvas = mockCanvasCreation();

      transformCanvas(SOURCE, { degrees: 0, flipX: false, flipY: true });

      const first = canvas.locate({ x: 0.5, y: 0.5 });
      expect(first.x).toBeCloseTo(0.5);
      expect(first.y).toBeCloseTo(1.5);
    });

    it('Given no 2D context, When transformed, Then it throws', () => {
      vi.spyOn(document, 'createElement').mockReturnValue(
        { getContext: () => null } as unknown as HTMLElement
      );

      expect(() => transformCanvas(SOURCE, { degrees: 90, flipX: false, flipY: false })).toThrow();
    });
  });
});

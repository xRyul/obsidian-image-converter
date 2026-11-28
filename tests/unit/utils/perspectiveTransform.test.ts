/**
 * Unit tests for the perspective correction helpers.
 *
 * The homography maths is pure and tested directly. For `warpPerspective`
 * a fake 2D context records the `setTransform` and `drawImage` calls, the
 * same way the canvasTransform tests do.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import {
	PerspectivePoint,
	PerspectiveQuad,
	applyH,
	homographyFromPoints,
	homographyToCssMatrix3d,
	isConvexQuad,
	mat3Invert,
	mat3Multiply,
	mat3Rotate,
	mat3Scale,
	mat3Translate,
	outputSizeFor,
	previewHomography,
	quadArea,
	quadCentroid,
	warpPerspective,
} from '../../../src/utils/perspectiveTransform';

function expectPoint(actual: PerspectivePoint, x: number, y: number) {
	expect(actual.x).toBeCloseTo(x, 6);
	expect(actual.y).toBeCloseTo(y, 6);
}

/** A fake canvas whose context records clip rects, transforms and draws. */
function fakeWarpCanvas() {
	let matrix = [1, 0, 0, 1, 0, 0];
	const draws: { args: number[]; matrix: number[] }[] = [];

	const ctx = {
		imageSmoothingEnabled: false,
		imageSmoothingQuality: 'low',
		save: () => undefined,
		restore: () => undefined,
		beginPath: () => undefined,
		rect: () => undefined,
		clip: () => undefined,
		setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => {
			matrix = [a, b, c, d, e, f];
		},
		drawImage: (_source: unknown, ...args: number[]) => {
			draws.push({ args, matrix: [...matrix] });
		},
	};

	return {
		width: 0,
		height: 0,
		getContext: () => ctx,
		draws,
	};
}

function mockCanvasCreation() {
	const canvas = fakeWarpCanvas();
	vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLElement);
	return canvas;
}

const RECT: PerspectiveQuad = [
	{ x: 0, y: 0 },
	{ x: 10, y: 0 },
	{ x: 10, y: 8 },
	{ x: 0, y: 8 },
];

// A trapezoid as produced by photographing a rectangle from below-right.
const TRAPEZOID: PerspectiveQuad = [
	{ x: 1, y: 2 },
	{ x: 9, y: 0 },
	{ x: 8, y: 8 },
	{ x: 2, y: 8 },
];

describe('perspectiveTransform', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('homographyFromPoints', () => {
		it('Given identical source and target, When computed, Then points map to themselves', () => {
			const h = homographyFromPoints(RECT, RECT)!;

			for (const p of RECT) {
				const mapped = applyH(h, p);
				expectPoint(mapped, p.x, p.y);
			}
			expectPoint(applyH(h, { x: 5, y: 4 }), 5, 4);
		});

		it('Given a trapezoid, When computed, Then the corners land on the rectangle corners', () => {
			const target: PerspectiveQuad = [
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },
				{ x: 100, y: 60 },
				{ x: 0, y: 60 },
			];
			const h = homographyFromPoints(TRAPEZOID, target)!;

			TRAPEZOID.forEach((corner, i) => {
				expectPoint(applyH(h, corner), target[i].x, target[i].y);
			});
		});

		it('Given collinear points, When computed, Then it returns null', () => {
			const degenerate: PerspectiveQuad = [
				{ x: 0, y: 0 },
				{ x: 1, y: 1 },
				{ x: 2, y: 2 },
				{ x: 3, y: 3 },
			];
			expect(homographyFromPoints(degenerate, RECT)).toBeNull();
		});
	});

	describe('mat3 helpers', () => {
		it('Given a homography and its inverse, When composed, Then points round-trip', () => {
			const h = homographyFromPoints(TRAPEZOID, RECT)!;
			const inv = mat3Invert(h)!;
			const p = { x: 4.2, y: 3.7 };

			expectPoint(applyH(inv, applyH(h, p)), p.x, p.y);
		});

		it('Given a singular matrix, When inverted, Then it returns null', () => {
			expect(mat3Invert([1, 2, 3, 2, 4, 6, 0, 0, 0])).toBeNull();
		});

		it('Given a translate and a scale, When composed, Then the affine maps correctly', () => {
			const m = mat3Multiply(mat3Translate(5, 7), mat3Scale(2, 3));
			expectPoint(applyH(m, { x: 1, y: 1 }), 7, 10);
		});

		it('Given a 90 degree rotation, When applied, Then the point rotates clockwise', () => {
			expectPoint(applyH(mat3Rotate(90), { x: 1, y: 0 }), 0, 1);
		});
	});

	describe('quad predicates and measures', () => {
		it.each([
			['clockwise', RECT],
			['counter-clockwise', [...RECT].reverse() as PerspectiveQuad],
		])('Given a %s rectangle, When tested, Then it is convex', (_label, quad) => {
			expect(isConvexQuad(quad)).toBe(true);
		});

		it('Given a bow-tie quad, When tested, Then it is not convex', () => {
			const bowtie: PerspectiveQuad = [
				{ x: 0, y: 0 },
				{ x: 10, y: 10 },
				{ x: 10, y: 0 },
				{ x: 0, y: 10 },
			];
			expect(isConvexQuad(bowtie)).toBe(false);
		});

		it('Given a quad with three collinear corners, When tested, Then it is not convex', () => {
			const degenerate: PerspectiveQuad = [
				{ x: 0, y: 0 },
				{ x: 5, y: 0 },
				{ x: 10, y: 0 },
				{ x: 5, y: 8 },
			];
			expect(isConvexQuad(degenerate)).toBe(false);
		});

		it('Given a 10x8 rectangle, When measured, Then the area is 80', () => {
			expect(Math.abs(quadArea(RECT))).toBeCloseTo(80);
		});

		it('Given a quad, When the centroid is taken, Then it is the mean of the corners', () => {
			expectPoint(quadCentroid(RECT), 5, 4);
		});
	});

	describe('outputSizeFor', () => {
		it('Given a trapezoid, When sized, Then the longer of each opposite edge wins', () => {
			const quad: PerspectiveQuad = [
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },   // top edge 100
				{ x: 60, y: 40 },   // bottom edge 40, right edge ~56.6
				{ x: 0, y: 50 },    // left edge 50
			];
			const size = outputSizeFor(quad);
			expect(size.width).toBe(100);
			expect(size.height).toBe(57);
		});

		it('Given a huge quad, When sized, Then it is clamped keeping the aspect ratio', () => {
			const quad: PerspectiveQuad = [
				{ x: 0, y: 0 },
				{ x: 20000, y: 0 },
				{ x: 20000, y: 10000 },
				{ x: 0, y: 10000 },
			];
			const size = outputSizeFor(quad);
			expect(size.width).toBe(8192);
			expect(size.height).toBe(4096);
		});
	});

	describe('homographyToCssMatrix3d', () => {
		it('Given a homography, When converted, Then a 16-number matrix3d string comes out', () => {
			const h = homographyFromPoints(TRAPEZOID, RECT)!;
			const css = homographyToCssMatrix3d(h);

			expect(css.startsWith('matrix3d(')).toBe(true);
			expect(css.endsWith(')')).toBe(true);
			const numbers = css.slice(9, -1).split(',').map(Number);
			expect(numbers).toHaveLength(16);
			expect(numbers.every(Number.isFinite)).toBe(true);
		});
	});

	describe('previewHomography', () => {
		const IDENTITY = { panX: 0, panY: 0, zoom: 1, degrees: 0, flipX: false, flipY: false };

		it('Given an offset image and identity transform, When composed, Then element corners render at their container positions', () => {
			// Element 200x150 shown at container offset (50,30); the quad is
			// the displayed box, so the warp is the identity and the preview
			// must reproduce the base display exactly. Regression test for
			// the missing offset conjugation, which shifted the preview by
			// the image offset.
			const quad: PerspectiveQuad = [
				{ x: 50, y: 30 },
				{ x: 250, y: 30 },
				{ x: 250, y: 180 },
				{ x: 50, y: 180 },
			];
			const m = previewHomography(quad, IDENTITY, { x: 50, y: 30 }, { x: 100, y: 75 })!;

			const localCorners: PerspectivePoint[] = [
				{ x: 0, y: 0 },
				{ x: 200, y: 0 },
				{ x: 200, y: 150 },
				{ x: 0, y: 150 },
			];
			localCorners.forEach((local, i) => {
				const rendered = applyH(m, local);
				// On-screen position = img offset + CSS matrix output.
				expect(rendered.x + 50).toBeCloseTo(quad[i].x, 4);
				expect(rendered.y + 30).toBeCloseTo(quad[i].y, 4);
			});
		});

		it('Given a 90 degree rotation, When composed, Then local corners land on the displayed quad', () => {
			// Element 200x100 about centre (100,50), offset (10,10), 90 CW:
			// the displayed box is x in [60,160], y in [-40,160].
			const quad: PerspectiveQuad = [
				{ x: 60, y: -40 },
				{ x: 160, y: -40 },
				{ x: 160, y: 160 },
				{ x: 60, y: 160 },
			];
			const base = { ...IDENTITY, degrees: 90 };
			const m = previewHomography(quad, base, { x: 10, y: 10 }, { x: 100, y: 50 })!;

			const pairs: [PerspectivePoint, PerspectivePoint][] = [
				[{ x: 0, y: 100 }, quad[0]],   // local BL displays top-left after CW rotation
				[{ x: 0, y: 0 }, quad[1]],
				[{ x: 200, y: 0 }, quad[2]],
				[{ x: 200, y: 100 }, quad[3]],
			];
			for (const [local, visual] of pairs) {
				const rendered = applyH(m, local);
				expect(rendered.x + 10).toBeCloseTo(visual.x, 4);
				expect(rendered.y + 10).toBeCloseTo(visual.y, 4);
			}
		});

		it('Given a trapezoid, When composed, Then each quad corner maps to its rect corner', () => {
			const quad: PerspectiveQuad = [
				{ x: 60, y: 40 },
				{ x: 260, y: 20 },
				{ x: 240, y: 200 },
				{ x: 50, y: 190 },
			];
			const m = previewHomography(quad, IDENTITY, { x: 10, y: 10 }, { x: 100, y: 75 })!;

			const { width, height } = outputSizeFor(quad);
			const centre = quadCentroid(quad);
			const rect: PerspectiveQuad = [
				{ x: centre.x - width / 2, y: centre.y - height / 2 },
				{ x: centre.x + width / 2, y: centre.y - height / 2 },
				{ x: centre.x + width / 2, y: centre.y + height / 2 },
				{ x: centre.x - width / 2, y: centre.y + height / 2 },
			];

			quad.forEach((corner, i) => {
				// With an identity base transform the element-local pre-image
				// of a quad corner is the corner minus the image offset.
				const local = { x: corner.x - 10, y: corner.y - 10 };
				const rendered = applyH(m, local);
				expect(rendered.x + 10).toBeCloseTo(rect[i].x, 4);
				expect(rendered.y + 10).toBeCloseTo(rect[i].y, 4);
			});
		});

		it('Given a non-convex quad, When composed, Then it returns null', () => {
			const bowtie: PerspectiveQuad = [
				{ x: 0, y: 0 },
				{ x: 10, y: 10 },
				{ x: 10, y: 0 },
				{ x: 0, y: 10 },
			];
			expect(previewHomography(bowtie, IDENTITY, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeNull();
		});
	});

	describe('warpPerspective', () => {
		const SOURCE = { width: 64, height: 48 } as HTMLCanvasElement;

		it('Given a convex quad, When warped, Then the output canvas has the requested size', () => {
			mockCanvasCreation();

			const result = warpPerspective(SOURCE, RECT, 32, 24);

			expect(result.width).toBe(32);
			expect(result.height).toBe(24);
		});

		it('Given a scaling quad, When warped, Then every cell draws its slice', () => {
			const canvas = mockCanvasCreation();

			warpPerspective(SOURCE, RECT, 32, 16);

			// 32x16 output in 16px cells: 2 columns x 1 row.
			expect(canvas.draws).toHaveLength(2);

			// The quad 10x8 maps onto 32x16: the first cell covers source
			// (0,0)-(5,8) and scales x by 3.2 and y by 2.
			const first = canvas.draws[0];
			expect(first.matrix[0]).toBeCloseTo(3.2);
			expect(first.matrix[1]).toBeCloseTo(0);
			expect(first.matrix[2]).toBeCloseTo(0);
			expect(first.matrix[3]).toBeCloseTo(2);
			expect(first.matrix[4]).toBeCloseTo(0);
			expect(first.matrix[5]).toBeCloseTo(0);
			expect(first.args).toEqual([0, 0, 7, 10, 0, 0, 7, 10]);
		});

		it('Given a non-convex quad, When warped, Then it throws', () => {
			const bowtie: PerspectiveQuad = [
				{ x: 0, y: 0 },
				{ x: 10, y: 10 },
				{ x: 10, y: 0 },
				{ x: 0, y: 10 },
			];
			expect(() => warpPerspective(SOURCE, bowtie, 32, 32)).toThrow();
		});

		it('Given no 2D context, When warped, Then it throws', () => {
			vi.spyOn(document, 'createElement').mockReturnValue(
				{ getContext: () => null } as unknown as HTMLElement,
			);

			expect(() => warpPerspective(SOURCE, RECT, 32, 32)).toThrow();
		});
	});
});

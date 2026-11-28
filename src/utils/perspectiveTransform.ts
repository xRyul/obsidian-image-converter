// Perspective (keystone) correction helpers. The crop modal uses these to
// rectify a photographed rectangle (a slide, a document, a whiteboard) that
// was shot at an angle: the user marks the four corners and the quadrilateral
// is warped into a rectangle through a plane homography.

export interface PerspectivePoint {
	x: number;
	y: number;
}

/** Corners of a quadrilateral in order: top-left, top-right, bottom-right, bottom-left. */
export type PerspectiveQuad = [PerspectivePoint, PerspectivePoint, PerspectivePoint, PerspectivePoint];

/** A 3x3 matrix in row-major order. Used both for homographies and affines. */
export type Mat3 = [
	number, number, number,
	number, number, number,
	number, number, number,
];

/** Largest side of a warped output image, to bound memory use. */
const MAX_OUTPUT_SIDE = 8192;

/**
 * Multiplies two 3x3 matrices: returns matA * matB, so `applyH(mul(A, B), p)`
 * applies matB first, then matA.
 */
export function mat3Multiply(matA: Mat3, matB: Mat3): Mat3 {
	const result = new Array(9) as Mat3;
	for (let row = 0; row < 3; row++) {
		for (let col = 0; col < 3; col++) {
			result[row * 3 + col] =
				matA[row * 3] * matB[col] +
				matA[row * 3 + 1] * matB[3 + col] +
				matA[row * 3 + 2] * matB[6 + col];
		}
	}
	return result;
}

export function mat3Translate(x: number, y: number): Mat3 {
	return [1, 0, x, 0, 1, y, 0, 0, 1];
}

export function mat3Scale(x: number, y: number): Mat3 {
	return [x, 0, 0, 0, y, 0, 0, 0, 1];
}

export function mat3Rotate(degrees: number): Mat3 {
	const radians = (degrees * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	return [cos, -sin, 0, sin, cos, 0, 0, 0, 1];
}

/**
 * Inverts a 3x3 matrix through the adjugate formula.
 * @returns null when the matrix is (near) singular.
 */
export function mat3Invert(matrix: Mat3): Mat3 | null {
	const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = matrix;
	const det =
		m0 * (m4 * m8 - m5 * m7) -
		m1 * (m3 * m8 - m5 * m6) +
		m2 * (m3 * m7 - m4 * m6);
	if (!isFinite(det) || Math.abs(det) < 1e-12) {
		return null;
	}
	const scale = 1 / det;
	return [
		(m4 * m8 - m5 * m7) * scale, (m2 * m7 - m1 * m8) * scale, (m1 * m5 - m2 * m4) * scale,
		(m5 * m6 - m3 * m8) * scale, (m0 * m8 - m2 * m6) * scale, (m2 * m3 - m0 * m5) * scale,
		(m3 * m7 - m4 * m6) * scale, (m1 * m6 - m0 * m7) * scale, (m0 * m4 - m1 * m3) * scale,
	];
}

/**
 * Maps a point through a homogeneous 3x3 matrix, dividing by the
 * projective coordinate. Returns non-finite coordinates when the point
 * lands on the line at infinity.
 */
export function applyH(matrix: Mat3, point: PerspectivePoint): PerspectivePoint {
	const weight = matrix[6] * point.x + matrix[7] * point.y + matrix[8];
	return {
		x: (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / weight,
		y: (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / weight,
	};
}

/**
 * Solves an n-by-n linear system Ax = b by Gaussian elimination with
 * partial pivoting. `matrix` is row-major and is mutated. Returns null
 * when the system is singular.
 */
function solveLinear(matrix: number[][], rhs: number[]): number[] | null {
	const size = rhs.length;
	for (let col = 0; col < size; col++) {
		let pivot = col;
		for (let row = col + 1; row < size; row++) {
			if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) {
				pivot = row;
			}
		}
		if (Math.abs(matrix[pivot][col]) < 1e-12) {
			return null;
		}
		if (pivot !== col) {
			[matrix[pivot], matrix[col]] = [matrix[col], matrix[pivot]];
			[rhs[pivot], rhs[col]] = [rhs[col], rhs[pivot]];
		}
		for (let row = col + 1; row < size; row++) {
			const factor = matrix[row][col] / matrix[col][col];
			for (let iter = col; iter < size; iter++) {
				matrix[row][iter] -= factor * matrix[col][iter];
			}
			rhs[row] -= factor * rhs[col];
		}
	}
	const solution = new Array<number>(size);
	for (let row = size - 1; row >= 0; row--) {
		let sum = rhs[row];
		for (let iter = row + 1; iter < size; iter++) {
			sum -= matrix[row][iter] * solution[iter];
		}
		solution[row] = sum / matrix[row][row];
	}
	return solution;
}

/**
 * Computes the homography mapping four source points onto four target
 * points (Direct Linear Transform with the ninth element fixed at 1).
 * @returns null when the points are degenerate (three collinear, etc.).
 */
export function homographyFromPoints(src: PerspectiveQuad, dst: PerspectiveQuad): Mat3 | null {
	const matrix: number[][] = [];
	const rhs: number[] = [];
	for (let index = 0; index < 4; index++) {
		const { x: sx, y: sy } = src[index];
		const { x: tx, y: ty } = dst[index];
		matrix.push([sx, sy, 1, 0, 0, 0, -tx * sx, -tx * sy]);
		rhs.push(tx);
		matrix.push([0, 0, 0, sx, sy, 1, -ty * sx, -ty * sy]);
		rhs.push(ty);
	}
	const coeffs = solveLinear(matrix, rhs);
	if (coeffs === null) {
		return null;
	}
	return [
		coeffs[0], coeffs[1], coeffs[2],
		coeffs[3], coeffs[4], coeffs[5],
		coeffs[6], coeffs[7], 1,
	];
}

function edgeLength(pointA: PerspectivePoint, pointB: PerspectivePoint): number {
	return Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y);
}

/** Centre of the four corners. */
export function quadCentroid(quad: PerspectiveQuad): PerspectivePoint {
	return {
		x: (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4,
		y: (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4,
	};
}

/**
 * Signed area of the quad (positive when the corners wind clockwise in
 * screen coordinates).
 */
export function quadArea(quad: PerspectiveQuad): number {
	let area = 0;
	for (let index = 0; index < 4; index++) {
		const point = quad[index];
		const next = quad[(index + 1) % 4];
		area += point.x * next.y - next.x * point.y;
	}
	return area / 2;
}

/**
 * Whether the four corners form a convex quadrilateral: every turn at a
 * corner goes the same way. Self-intersecting (bow-tie) or degenerate
 * quads return false.
 */
export function isConvexQuad(quad: PerspectiveQuad): boolean {
	let sign = 0;
	for (let index = 0; index < 4; index++) {
		const vertex = quad[index];
		const next = quad[(index + 1) % 4];
		const after = quad[(index + 2) % 4];
		const cross =
			(next.x - vertex.x) * (after.y - next.y) -
			(next.y - vertex.y) * (after.x - next.x);
		if (Math.abs(cross) < 1e-9) {
			return false;
		}
		const turn = Math.sign(cross);
		if (sign === 0) {
			sign = turn;
		} else if (turn !== sign) {
			return false;
		}
	}
	return true;
}

/**
 * Output size for a warped quad: the longer of each pair of opposite
 * edges, so no information is lost to downscaling. Clamped to
 * MAX_OUTPUT_SIDE while keeping the aspect ratio.
 */
export function outputSizeFor(quad: PerspectiveQuad): { width: number; height: number } {
	const width = Math.max(edgeLength(quad[0], quad[1]), edgeLength(quad[3], quad[2]));
	const height = Math.max(edgeLength(quad[0], quad[3]), edgeLength(quad[1], quad[2]));
	const scale = Math.min(1, MAX_OUTPUT_SIDE / Math.max(width, height));
	return {
		width: Math.max(2, Math.round(width * scale)),
		height: Math.max(2, Math.round(height * scale)),
	};
}

/**
 * The affine mapping three source points onto three target points, as
 * canvas `setTransform` arguments [a, b, c, d, e, f]. Returns null for
 * collinear source points.
 */
function affineFromTriangles(
	s0: PerspectivePoint, s1: PerspectivePoint, s2: PerspectivePoint,
	d0: PerspectivePoint, d1: PerspectivePoint, d2: PerspectivePoint,
): [number, number, number, number, number, number] | null {
	const det = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
	if (Math.abs(det) < 1e-12) {
		return null;
	}
	const mA = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / det;
	const mB = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / det;
	const mC = (s0.x * (d1.x - d2.x) + s1.x * (d2.x - d0.x) + s2.x * (d0.x - d1.x)) / det;
	const mD = (s0.x * (d1.y - d2.y) + s1.x * (d2.y - d0.y) + s2.x * (d0.y - d1.y)) / det;
	return [mA, mB, mC, mD, d0.x - mA * s0.x - mC * s0.y, d0.y - mB * s0.x - mD * s0.y];
}

/** Roughly one output cell per CELL_PX pixels on each axis. */
const CELL_PX = 16;

/** Clip overlap between neighbouring cells, to hide hairline seams. */
const CELL_OVERLAP_PX = 0.75;

/**
 * Warps the region inside `quad` of the source canvas into a rectangle.
 *
 * Canvas 2D has no projective transform, so the output is drawn cell by
 * cell: each small output cell's corners are mapped back to the source
 * through the inverse homography and drawn with an affine
 * `setTransform`. At CELL_PX cells the approximation error is
 * sub-pixel for typical document photos.
 *
 * @throws When the quad is not convex, or when no 2D context is given.
 */
export function warpPerspective(
	source: HTMLCanvasElement,
	quad: PerspectiveQuad,
	outputWidth: number,
	outputHeight: number,
): HTMLCanvasElement {
	if (!isConvexQuad(quad)) {
		throw new Error('Perspective quad must be convex');
	}
	const rect: PerspectiveQuad = [
		{ x: 0, y: 0 },
		{ x: outputWidth, y: 0 },
		{ x: outputWidth, y: outputHeight },
		{ x: 0, y: outputHeight },
	];
	const forward = homographyFromPoints(quad, rect);
	const inverse = forward ? mat3Invert(forward) : null;
	if (!inverse) {
		throw new Error('Perspective quad is degenerate');
	}

	const canvas = document.createElement('canvas');
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		throw new Error('Could not get canvas context for perspective warp');
	}
	canvas.width = outputWidth;
	canvas.height = outputHeight;
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';

	const cols = Math.max(1, Math.ceil(outputWidth / CELL_PX));
	const rows = Math.max(1, Math.ceil(outputHeight / CELL_PX));
	const cellW = outputWidth / cols;
	const cellH = outputHeight / rows;

	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			const x0 = col * cellW;
			const y0 = row * cellH;
			const x1 = Math.min(outputWidth, x0 + cellW);
			const y1 = Math.min(outputHeight, y0 + cellH);

			// Source positions of the cell's top-left, top-right and
			// bottom-left corners (the fourth corner is the projective
			// residual the affine approximation drops).
			const s0 = applyH(inverse, { x: x0, y: y0 });
			const s1 = applyH(inverse, { x: x1, y: y0 });
			const s2 = applyH(inverse, { x: x0, y: y1 });
			if (!isFinite(s0.x) || !isFinite(s0.y) ||
				!isFinite(s1.x) || !isFinite(s1.y) ||
				!isFinite(s2.x) || !isFinite(s2.y)) {
				continue;
			}

			const affine = affineFromTriangles(
				s0, s1, s2,
				{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x0, y: y1 },
			);
			if (!affine) {
				continue;
			}

			// Only the covered part of the source needs drawing.
			const minX = Math.max(0, Math.floor(Math.min(s0.x, s1.x, s2.x)) - 2);
			const minY = Math.max(0, Math.floor(Math.min(s0.y, s1.y, s2.y)) - 2);
			const maxX = Math.min(source.width, Math.ceil(Math.max(s0.x, s1.x, s2.x)) + 2);
			const maxY = Math.min(source.height, Math.ceil(Math.max(s0.y, s1.y, s2.y)) + 2);
			if (maxX - minX <= 0 || maxY - minY <= 0) {
				continue;
			}

			ctx.save();
			ctx.beginPath();
			ctx.rect(
				x0 - CELL_OVERLAP_PX,
				y0 - CELL_OVERLAP_PX,
				(x1 - x0) + CELL_OVERLAP_PX * 2,
				(y1 - y0) + CELL_OVERLAP_PX * 2,
			);
			ctx.clip();
			ctx.setTransform(affine[0], affine[1], affine[2], affine[3], affine[4], affine[5]);
			ctx.drawImage(
				source,
				minX, minY, maxX - minX, maxY - minY,
				minX, minY, maxX - minX, maxY - minY,
			);
			ctx.restore();
		}
	}

	return canvas;
}

/** The crop modal's affine display state (pan, zoom, rotation, flips). */
export interface DisplayTransform {
	panX: number;
	panY: number;
	zoom: number;
	degrees: number;
	flipX: boolean;
	flipY: boolean;
}

/**
 * Composes the live-preview matrix for the crop modal: element-local
 * coordinates → the base display transform (applied about the element
 * centre) → container coordinates → the warped rect → back to element
 * space, so it can be set as a CSS transform with `transform-origin:
 * 0 0` and the quad appears rectified in place.
 *
 * @param quad      The quad in container coordinates.
 * @param base      The modal's current display transform.
 * @param imgOffset The element's untransformed top-left in container coords.
 * @param imgCenter The element's centre in element-local coords.
 * @returns null when the quad is non-convex or degenerate.
 */
export function previewHomography(
	quad: PerspectiveQuad,
	base: DisplayTransform,
	imgOffset: PerspectivePoint,
	imgCenter: PerspectivePoint,
): Mat3 | null {
	if (!isConvexQuad(quad)) {
		return null;
	}
	const linear = mat3Multiply(
		mat3Translate(base.panX, base.panY),
		mat3Multiply(
			mat3Scale(base.zoom, base.zoom),
			mat3Multiply(
				mat3Rotate(base.degrees),
				mat3Scale(base.flipX ? -1 : 1, base.flipY ? -1 : 1),
			),
		),
	);
	// The CSS transforms act about the element's centre O, so conjugate.
	const aboutOrigin = mat3Multiply(
		mat3Translate(imgCenter.x, imgCenter.y),
		mat3Multiply(linear, mat3Translate(-imgCenter.x, -imgCenter.y)),
	);

	const { width, height } = outputSizeFor(quad);
	const centre = quadCentroid(quad);
	const rect: PerspectiveQuad = [
		{ x: centre.x - width / 2, y: centre.y - height / 2 },
		{ x: centre.x + width / 2, y: centre.y - height / 2 },
		{ x: centre.x + width / 2, y: centre.y + height / 2 },
		{ x: centre.x - width / 2, y: centre.y + height / 2 },
	];
	const warp = homographyFromPoints(quad, rect);
	if (!warp) {
		return null;
	}

	// The CSS transform outputs in container space: the warp works on
	// container coordinates, so conjugate it by the image's offset.
	const toContainer = mat3Translate(imgOffset.x, imgOffset.y);
	const fromContainer = mat3Translate(-imgOffset.x, -imgOffset.y);
	return mat3Multiply(
		fromContainer,
		mat3Multiply(warp, mat3Multiply(toContainer, aboutOrigin)),
	);
}

/**
 * Converts a 3x3 homography into a CSS `matrix3d()` string, for live
 * preview of a warp on a flat element. Use with `transform-origin: 0 0`
 * and coordinates in the element's local space.
 */
export function homographyToCssMatrix3d(matrix: Mat3): string {
	return `matrix3d(${[
		matrix[0], matrix[3], 0, matrix[6],
		matrix[1], matrix[4], 0, matrix[7],
		0, 0, 1, 0,
		matrix[2], matrix[5], 0, matrix[8],
	].join(',')})`;
}

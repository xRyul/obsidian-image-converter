// Canvas helpers that rotate and flip a full image. The TIFF decoder uses
// them to apply the EXIF orientation.

/** A rotation and flip that `transformCanvas` can apply. */
export interface CanvasTransform {
    /** Clockwise rotation in degrees. */
    degrees: number;
    flipX: boolean;
    flipY: boolean;
}

/**
 * The transform that makes the pixels upright for each EXIF Orientation
 * value. `transformCanvas` flips first and rotates second, so each entry is
 * "mirror horizontally, then rotate clockwise".
 */
const ORIENTATION_TRANSFORMS: ReadonlyMap<number, CanvasTransform> = new Map([
    [2, { degrees: 0, flipX: true, flipY: false }],
    [3, { degrees: 180, flipX: false, flipY: false }],
    [4, { degrees: 180, flipX: true, flipY: false }],
    [5, { degrees: 270, flipX: true, flipY: false }],
    [6, { degrees: 90, flipX: false, flipY: false }],
    [7, { degrees: 90, flipX: true, flipY: false }],
    [8, { degrees: 270, flipX: false, flipY: false }],
]);

/**
 * Gives the transform that makes an image with this EXIF Orientation upright.
 * @returns The transform, or null if the pixels are already upright or the
 *          value is not valid.
 */
export function transformForOrientation(orientation: number): CanvasTransform | null {
    return ORIENTATION_TRANSFORMS.get(orientation) ?? null;
}

/**
 * Draws a source onto a new canvas, flipped and then rotated about its centre.
 *
 * For a rotation of 90 or 270 degrees, the new canvas has the width and the
 * height exchanged. For all other angles, it keeps the size of the source, so
 * the corners of the image can be cut off.
 *
 * @throws If the browser gives no 2D context.
 */
export function transformCanvas(
    source: HTMLCanvasElement,
    transform: CanvasTransform
): HTMLCanvasElement {
    const { degrees, flipX, flipY } = transform;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('Could not get canvas context for rotation');
    }

    const quarterTurn = Math.abs(degrees) === 90 || Math.abs(degrees) === 270;
    canvas.width = quarterTurn ? source.height : source.width;
    canvas.height = quarterTurn ? source.width : source.height;

    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((degrees * Math.PI) / 180);
    ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    ctx.drawImage(source, -source.width / 2, -source.height / 2);

    return canvas;
}

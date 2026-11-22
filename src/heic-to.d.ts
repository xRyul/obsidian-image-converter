/**
 * Checks if a file is in HEIC format.
 * @param file - The file to check.
 * @returns A promise that resolves to true if the file is HEIC, false otherwise.
 */
export declare function isHeic(file: File): Promise<boolean>;

type ImageMime = `${"image"}/${string}`; // e.g. "image/jpeg", "image/png", "image/webp"
type HeicTarget = "bitmap" | ImageMime;

/**
 * Converts a HEIC image to another format.
 * @param args - The conversion options.
 * @returns A promise that resolves to the converted image bitmap.
 */
export function heicTo(args: {
  /**
   * The HEIC image blob to convert.
   */
  blob: Blob;
  type: "bitmap";
  /**
   * Options for creating the ImageBitmap.
   */
  options?: ImageBitmapOptions;
  quality?: never;
}): Promise<ImageBitmap>;

/**
 * Converts a HEIC image to another format.
 * @param args - The conversion options.
 * @returns A promise that resolves to the converted image blob.
 */
export function heicTo<M extends Exclude<HeicTarget, "bitmap">>(args: {
  /**
   * The HEIC image blob to convert.
   */
  blob: Blob;
  /**
   * The desired output image MIME type (e.g., 'image/jpeg', 'image/png').
   */
  type: M;
  /**
   * The quality of the output image, between 0 and 1.
   */
  quality?: number;        // 0..1 for JPEG/WEBP, ignored by PNG
  options?: never;
}): Promise<Blob>;
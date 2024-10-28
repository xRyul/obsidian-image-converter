/**
 * Checks if a file is in HEIC format.
 * @param file - The file to check.
 * @returns A promise that resolves to true if the file is HEIC, false otherwise.
 */
export declare function isHeic(file: File): Promise<boolean>;

/**
 * Options for converting HEIC images.
 */
export interface HeicToOptions {
    /**
     * The HEIC image blob to convert.
     */
    blob: Blob;

    /**
     * The desired output image MIME type (e.g., 'image/jpeg', 'image/png').
     */
    type: string;

    /**
     * The quality of the output image, between 0 and 1.
     */
    quality?: number;
}

/**
 * Converts a HEIC image to another format.
 * @param options - The conversion options.
 * @returns A promise that resolves to the converted image blob.
 */
export declare function heicTo(options: HeicToOptions): Promise<Blob>;
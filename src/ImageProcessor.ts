// ImageProcessor.ts
import { App, Notice } from "obsidian";
import { SupportedImageFormats } from "./SupportedImageFormats";

// Import types
export type ResizeMode = 'None' | 'Fit' | 'Fill' | 'LongestEdge' | 'ShortestEdge' | 'Width' | 'Height';
export type EnlargeReduce = 'Auto' | 'Reduce' | 'Enlarge';

interface Dimensions {
    imageWidth: number;
    imageHeight: number;
    aspectRatio: number;
}

export class ImageProcessor {
    private app: App;
    supportedImageFormats: SupportedImageFormats

    constructor(app: App, supportedImageFormats: SupportedImageFormats) {
        this.app = app;
        this.supportedImageFormats = supportedImageFormats;
    }

    /**
     * Main method to process an image file. This method is intended to be used directly
     * for single image processing or by other classes like BatchImageProcessor.
     * 
     * @param file - The image file as a Blob.
     * @param format - The desired output format ('WEBP', 'JPEG', 'PNG').
     * @param quality - The quality setting for lossy formats (0.0 - 1.0).
     * @param colorDepth - The color depth for PNG (0.0 - 1.0, where 1 is full color).
     * @param resizeMode - The resizing mode.
     * @param desiredWidth - The desired width for resizing.
     * @param desiredHeight - The desired height for resizing.
     * @param desiredLongestEdge - The desired longest edge for resizing.
     * @param enlargeOrReduce - Whether to enlarge or reduce the image during resizing.
     * @param allowLargerFiles - Whether to allow output files larger than the original.
     * @returns A Promise that resolves to the processed image as an ArrayBuffer.
     */
    async processImage(
        file: Blob,
        format: 'WEBP' | 'JPEG' | 'PNG' | 'ORIGINAL' | 'NONE',
        quality: number,
        colorDepth: number,
        resizeMode: ResizeMode,
        desiredWidth: number,
        desiredHeight: number,
        desiredLongestEdge: number,
        enlargeOrReduce: EnlargeReduce,
        allowLargerFiles: boolean
    ): Promise<ArrayBuffer> {
        try {
            // --- Handle NONE format ---
            if (format === 'NONE' && resizeMode !== 'None') {
                // No conversion, but resizing is needed
                return this.resizeImage(
                    file,
                    resizeMode,
                    desiredWidth,
                    desiredHeight,
                    desiredLongestEdge,
                    enlargeOrReduce
                );
            } else if (format === 'NONE') {
                // No conversion or compression or resizing
                return file.arrayBuffer();
            }

            // --- Handle ORIGINAL format ---
            if (format === 'ORIGINAL') {
                // Compress using original format
                return this.compressOriginalImage(
                    file,
                    quality,
                    resizeMode,
                    desiredWidth,
                    desiredHeight,
                    desiredLongestEdge,
                    enlargeOrReduce
                );
            }

            let mimeType = file.type;
            // Use file.name if it exists (if file is a File object), otherwise default to 'image'
            const filename = (file instanceof File) ? file.name : 'image';

            if (!mimeType || mimeType === 'unknown' || !this.supportedImageFormats.isSupported(mimeType, filename)) {
                mimeType = await this.supportedImageFormats.getMimeTypeFromFile(file);
                // Mime type from header
                // console.log(`Detected mime type from header: ${mimeType} for file: ${filename}`);
            } else {
                // Log original mime type
                // console.log(`Mime type from file.type: ${mimeType} for file: ${filename}`); 
            }

            switch (mimeType) {
                case 'image/tiff':
                case 'image/tif': {
                    // TIFF requires special handling
                    const tiffBlob = await this.handleTiff(await file.arrayBuffer());
                    return this.convertAndCompress(
                        tiffBlob,
                        format,
                        quality,
                        colorDepth,
                        resizeMode,
                        desiredWidth,
                        desiredHeight,
                        desiredLongestEdge,
                        enlargeOrReduce,
                        allowLargerFiles
                    );
                }
                case 'image/heic':
                case 'image/heif': {
                    // console.log("convertToWebP - Image loaded successfully");
                    // HEIC requires special handling
                    const heicBlob = await this.handleHeic(
                        await file.arrayBuffer(),
                        format === 'JPEG' ? 'JPEG' : 'PNG', // HEIC can only convert to JPEG or PNG
                        format === 'JPEG' ? quality : 1 // Quality only applies to JPEG
                    );
                    return this.convertAndCompress(
                        heicBlob,
                        format,
                        quality,
                        colorDepth,
                        resizeMode,
                        desiredWidth,
                        desiredHeight,
                        desiredLongestEdge,
                        enlargeOrReduce,
                        allowLargerFiles
                    );
                }
                default:
                    // Other formats can be handled directly
                    return this.convertAndCompress(
                        file,
                        format,
                        quality,
                        colorDepth,
                        resizeMode,
                        desiredWidth,
                        desiredHeight,
                        desiredLongestEdge,
                        enlargeOrReduce,
                        allowLargerFiles
                    );
            }
        } catch (error) {
            console.error('Error processing image:', error);
            new Notice(`Failed to process image: ${error.message}`);
            return file.arrayBuffer(); // Fallback to original
        }
    }

    /**
     * Handles TIFF image conversion using UTIF.js.
     * @param binary - The TIFF image data as an ArrayBuffer.
     * @returns A Promise that resolves to a Blob representing the decoded image.
     */
    private async handleTiff(binary: ArrayBuffer): Promise<Blob> {
        try {
            // Dynamically import UTIF only when needed
            const UTIF = await import('./UTIF.js').then(module => module.default);

            // Convert ArrayBuffer to Uint8Array
            const binaryUint8Array = new Uint8Array(binary);

            // Decode TIFF image
            const ifds = UTIF.decode(binaryUint8Array);
            UTIF.decodeImage(binaryUint8Array, ifds[0]);
            const rgba = UTIF.toRGBA8(ifds[0]);

            // Create canvas and draw image
            const canvas = document.createElement('canvas');
            canvas.width = ifds[0].width;
            canvas.height = ifds[0].height;
            const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
            const imageData = ctx.createImageData(canvas.width, canvas.height);
            imageData.data.set(rgba);
            ctx.putImageData(imageData, 0, 0);

            // Convert canvas to Blob
            return new Promise<Blob>((resolve, reject) => {
                canvas.toBlob((blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('Failed to convert canvas to Blob'));
                    }
                }, 'image/png'); // Default to PNG after TIFF decoding for broader compatibility and lossless format
            });
        } catch (error) {
            console.error('Error processing TIFF image:', error);
            throw new Error('Failed to process TIFF image');
        }
    }

    /**
     * Handles HEIC/HEIF image conversion using heic-to.js.
     * @param binary - The HEIC image data as an ArrayBuffer.
     * @param format - The desired output format ('JPEG' or 'PNG').
     * @param quality - The quality setting for JPEG (0.0 - 1.0).
     * @returns A Promise that resolves to a Blob representing the converted image.
     */
    private async handleHeic(
        binary: ArrayBuffer,
        format: 'JPEG' | 'PNG',
        quality: number
    ): Promise<Blob> {
        try {
            // Import heic-to for both platforms
            const { heicTo } = await import('./heic-to.min.js');

            // Convert ArrayBuffer to Blob
            const blob = new Blob([binary], { type: 'image/heic' });

            // Determine MIME type for the conversion format
            const outputMimeType = format === 'JPEG' ? 'image/jpeg' : 'image/png';

            // Convert using heic-to
            return await heicTo({
                blob: blob,
                type: outputMimeType,
                quality: quality
            });
        } catch (error) {
            console.error('Error converting HEIC:', error);
            throw new Error(`Failed to convert HEIC image: ${error.message}`);
        }
    }

    /**
     * Converts and compresses an image.
     * @param file - The image file as a Blob.
     * @param format - The desired output format ('WEBP', 'JPEG', 'PNG').
     * @param quality - The quality setting for lossy formats (0.0 - 1.0).
     * @param colorDepth - The color depth for PNG (0.0 - 1.0).
     * @param resizeMode - The resizing mode.
     * @param desiredWidth - The desired width for resizing.
     * @param desiredHeight - The desired height for resizing.
     * @param desiredLongestEdge - The desired longest edge for resizing.
     * @param enlargeOrReduce - Whether to enlarge or reduce the image during resizing.
     * @param allowLargerFiles - Whether to allow output files larger than the original.
     * @returns A Promise that resolves to the processed image as an ArrayBuffer.
     */
    private async convertAndCompress(
        file: Blob,
        format: 'WEBP' | 'JPEG' | 'PNG',
        quality: number,
        colorDepth: number,
        resizeMode: ResizeMode,
        desiredWidth: number,
        desiredHeight: number,
        desiredLongestEdge: number,
        enlargeOrReduce: EnlargeReduce,
        allowLargerFiles: boolean
    ): Promise<ArrayBuffer> {
        switch (format) {
            case 'WEBP':
                return this.convertToWebP(
                    file,
                    quality,
                    resizeMode,
                    desiredWidth,
                    desiredHeight,
                    desiredLongestEdge,
                    enlargeOrReduce,
                    allowLargerFiles
                );
            case 'JPEG':
                return this.convertToJPG(
                    file,
                    quality,
                    resizeMode,
                    desiredWidth,
                    desiredHeight,
                    desiredLongestEdge,
                    enlargeOrReduce,
                    allowLargerFiles
                );
            case 'PNG':
                return this.convertToPNG(
                    file,
                    colorDepth,
                    resizeMode,
                    desiredWidth,
                    desiredHeight,
                    desiredLongestEdge,
                    enlargeOrReduce,
                    allowLargerFiles
                );
            default:
                return file.arrayBuffer(); // No conversion needed
        }
    }

    /**
     * Converts an image to WebP format.
     * @param file - The image file as a Blob.
     * @param quality - The quality setting (0.0 - 1.0).
     * @param resizeMode - The resizing mode.
     * @param desiredWidth - The desired width.
     * @param desiredHeight - The desired height.
     * @param desiredLongestEdge - The desired longest edge.
     * @param enlargeOrReduce - Whether to enlarge or reduce the image.
     * @param allowLargerFiles - Whether to allow output files larger than the original.
     * @returns A Promise that resolves to the WebP image as an ArrayBuffer.
     */
    private async convertToWebP(
        file: Blob,
        quality: number,
        resizeMode: ResizeMode,
        desiredWidth: number,
        desiredHeight: number,
        desiredLongestEdge: number,
        enlargeOrReduce: EnlargeReduce,
        allowLargerFiles: boolean
    ): Promise<ArrayBuffer> {
        // Early return if no processing needed
        if (quality === 1 && resizeMode === 'None') {
            return file.arrayBuffer();
        }

        // Helper function to setup canvas with image
        const setupCanvas = async (imageData: string): Promise<{
            canvas: HTMLCanvasElement;
            context: CanvasRenderingContext2D;
        }> => {
            return new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => {
                    const { imageWidth, imageHeight } = this.calculateDesiredDimensions(
                        image,
                        resizeMode,
                        desiredWidth,
                        desiredHeight,
                        desiredLongestEdge,
                        enlargeOrReduce
                    );

                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d', {
                        willReadFrequently: false
                    });

                    if (!context) {
                        reject(new Error('Failed to get canvas context'));
                        return;
                    }

                    canvas.width = imageWidth;
                    canvas.height = imageHeight;

                    // Calculate the source rectangle for cropping
                    let sx = 0;
                    let sy = 0;
                    let sWidth = image.naturalWidth;
                    let sHeight = image.naturalHeight;

                    if (resizeMode === 'Fill') {
                        const scale = Math.max(imageWidth / image.naturalWidth, imageHeight / image.naturalHeight);
                        sWidth = imageWidth / scale;
                        sHeight = imageHeight / scale;
                        sx = (image.naturalWidth - sWidth) / 2;
                        sy = (image.naturalHeight - sHeight) / 2;
                    }

                    // Draw the image, optionally with cropping
                    context.drawImage(
                        image,
                        sx, sy, sWidth, sHeight,
                        0, 0, imageWidth, imageHeight
                    );

                    resolve({ canvas, context });
                };
                image.onerror = (event) => {
                    console.error("WebP conversion error:", event);
                    reject(new Error('Failed to load image'));
                };
                image.src = imageData;
            });
        };

        try {
            // Read file as data URL once
            const imageData = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = (e) => resolve(e.target?.result as string);
                reader.onerror = () => reject(new Error('Failed to read file'));
                reader.readAsDataURL(file);
            });

            // Setup canvas
            const { canvas } = await setupCanvas(imageData);

            // Try both conversion methods in parallel
            const [blobResult, dataUrlResult] = await Promise.all([
                // Method 1: toBlob approach
                new Promise<ArrayBuffer>((resolve) => {
                    canvas.toBlob(
                        async (blob) => {
                            if (!blob) {
                                resolve(new ArrayBuffer(0));
                                return;
                            }
                            resolve(await blob.arrayBuffer());
                        },
                        'image/webp',
                        quality
                    );
                }),

                // Method 2: toDataURL approach
                new Promise<ArrayBuffer>((resolve) => {
                    const webpData = canvas.toDataURL('image/webp', quality);
                    resolve(this.base64ToArrayBuffer(webpData));
                })
            ]);

            // Get original format compression as well
            // We're working with the original blob at the beginning,but the crucial 
            // part is HOW we're creating the new compressed version. The path we take
            // to create the compressed version (toDataURL vs toBlob) can result in 
            // different compression algorithms being used internally by the browser.
            const originalCompressed = await this.compressOriginalImage(
                file,
                quality,
                resizeMode,
                desiredWidth,
                desiredHeight,
                desiredLongestEdge,
                enlargeOrReduce
            );

            // Compare all results and choose the smallest one
            const results = [
                { type: 'blob', data: blobResult, size: blobResult.byteLength },
                { type: 'dataUrl', data: dataUrlResult, size: dataUrlResult.byteLength },
                { type: 'original', data: originalCompressed, size: originalCompressed.byteLength }
            ].filter(result => result.size > 0);

            // Sort by size
            results.sort((a, b) => a.size - b.size);

            // If we don't allow larger files, filter out results larger than original
            if (!allowLargerFiles) {
                const validResults = results.filter(result => result.size <= file.size);
                if (validResults.length > 0) {
                    return validResults[0].data;
                }
                // If no valid results, return original file
                return file.arrayBuffer();
            }

            // Return the smallest result
            return results[0].data;

        } catch (error) {
            console.error('WebP conversion error:', error);
            // Fallback to original file
            return file.arrayBuffer();
        }
    }

    /**
     * Converts an image to JPEG format.
     * @param file - The image file as a Blob.
     * @param quality - The quality setting (0.0 - 1.0).
     * @param resizeMode - The resizing mode.
     * @param desiredWidth - The desired width.
     * @param desiredHeight - The desired height.
     * @param desiredLongestEdge - The desired longest edge.
     * @param enlargeOrReduce - Whether to enlarge or reduce the image.
     * @param allowLargerFiles - Whether to allow output files larger than the original.
     * @returns A Promise that resolves to the JPEG image as an ArrayBuffer.
     */
    private async convertToJPG(
        file: Blob,
        quality: number,
        resizeMode: ResizeMode,
        desiredWidth: number,
        desiredHeight: number,
        desiredLongestEdge: number,
        enlargeOrReduce: EnlargeReduce,
        allowLargerFiles: boolean
    ): Promise<ArrayBuffer> {
        // Early return if no processing needed
        if (quality === 1 && resizeMode === 'None') {
            return file.arrayBuffer();
        }

        // Helper function to setup canvas with image
        const setupCanvas = async (imageData: string): Promise<{
            canvas: HTMLCanvasElement;
            context: CanvasRenderingContext2D;
        }> => {
            return new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => {
                    const { imageWidth, imageHeight } = this.calculateDesiredDimensions(
                        image,
                        resizeMode,
                        desiredWidth,
                        desiredHeight,
                        desiredLongestEdge,
                        enlargeOrReduce
                    );

                    const canvas = document.createElement('canvas');
                    // For JPG, we definitely want to disable alpha
                    const context = canvas.getContext('2d', {
                        willReadFrequently: false,
                        alpha: false // JPG doesn't support alpha, so we can disable it
                    });

                    if (!context) {
                        reject(new Error('Failed to get canvas context'));
                        return;
                    }

                    canvas.width = imageWidth;
                    canvas.height = imageHeight;

                    // Calculate the source rectangle for cropping
                    let sx = 0;
                    let sy = 0;
                    let sWidth = image.naturalWidth;
                    let sHeight = image.naturalHeight;

                    if (resizeMode === 'Fill') {
                        const scale = Math.max(imageWidth / image.naturalWidth, imageHeight / image.naturalHeight);
                        sWidth = imageWidth / scale;
                        sHeight = imageHeight / scale;
                        sx = (image.naturalWidth - sWidth) / 2;
                        sy = (image.naturalHeight - sHeight) / 2;
                    }

                    // Draw the image, optionally with cropping
                    context.drawImage(
                        image,
                        sx, sy, sWidth, sHeight,
                        0, 0, imageWidth, imageHeight
                    );

                    resolve({ canvas, context });
                };
                image.onerror = (event) => {
                    console.error("JPEG conversion error:", event);
                    reject(new Error('Failed to load image'));
                };
                image.src = imageData;
            });
        };

        try {
            // Read file as data URL once
            const imageData = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = (e) => resolve(e.target?.result as string);
                reader.onerror = () => reject(new Error('Failed to read file'));
                reader.readAsDataURL(file);
            });

            // Setup canvas
            const { canvas } = await setupCanvas(imageData);

            // Try both conversion methods in parallel
            const [blobResult, dataUrlResult] = await Promise.all([
                // Method 1: toBlob approach
                new Promise<ArrayBuffer>((resolve) => {
                    canvas.toBlob(
                        async (blob) => {
                            if (!blob) {
                                resolve(new ArrayBuffer(0));
                                return;
                            }
                            resolve(await blob.arrayBuffer());
                        },
                        'image/jpeg',
                        quality
                    );
                }),

                // Method 2: toDataURL approach
                new Promise<ArrayBuffer>((resolve) => {
                    const jpegData = canvas.toDataURL('image/jpeg', quality);
                    resolve(this.base64ToArrayBuffer(jpegData));
                })
            ]);

            // Get original format compression as well
            const originalCompressed = await this.compressOriginalImage(
                file,
                quality,
                resizeMode,
                desiredWidth,
                desiredHeight,
                desiredLongestEdge,
                enlargeOrReduce
            );

            // Compare all results and choose the smallest one
            const results = [
                { type: 'blob', data: blobResult, size: blobResult.byteLength },
                { type: 'dataUrl', data: dataUrlResult, size: dataUrlResult.byteLength },
                // Only include original compression if the input wasn't already JPEG
                ...(file.type !== 'image/jpeg' ? [{
                    type: 'original',
                    data: originalCompressed,
                    size: originalCompressed.byteLength
                }] : [])
            ].filter(result => result.size > 0);

            // Sort by size
            results.sort((a, b) => a.size - b.size);

            // If we don't allow larger files, filter out results larger than original
            if (!allowLargerFiles) {
                const validResults = results.filter(result => result.size <= file.size);
                if (validResults.length > 0) {
                    return validResults[0].data;
                }
                // If no valid results, return original file
                return file.arrayBuffer();
            }

            // Return the smallest result
            return results[0].data;

        } catch (error) {
            console.error('JPEG conversion error:', error);
            // Fallback to original file
            return file.arrayBuffer();
        }
    }

    /**
     * Converts an image to PNG format.
     * @param file - The image file as a Blob.
     * @param colorDepth - The color depth (0.0 - 1.0).
     * @param resizeMode - The resizing mode.
     * @param desiredWidth - The desired width.
     * @param desiredHeight - The desired height.
     * @param desiredLongestEdge - The desired longest edge.
     * @param enlargeOrReduce - Whether to enlarge or reduce the image.
     * @param allowLargerFiles - Whether to allow output files larger than the original.
     * @returns A Promise that resolves to the PNG image as an ArrayBuffer.
     */
    private async convertToPNG(
        file: Blob,
        colorDepth: number,
        resizeMode: ResizeMode,
        desiredWidth: number,
        desiredHeight: number,
        desiredLongestEdge: number,
        enlargeOrReduce: EnlargeReduce,
        allowLargerFiles: boolean
    ): Promise<ArrayBuffer> {
        // Early return if no processing needed
        if (colorDepth === 1 && resizeMode === 'None') {
            return file.arrayBuffer();
        }

        // Helper function to setup canvas with image
        const setupCanvas = async (imageData: string): Promise<{
            canvas: HTMLCanvasElement;
            context: CanvasRenderingContext2D;
        }> => {
            return new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => {
                    const { imageWidth, imageHeight } = this.calculateDesiredDimensions(
                        image,
                        resizeMode,
                        desiredWidth,
                        desiredHeight,
                        desiredLongestEdge,
                        enlargeOrReduce
                    );

                    const canvas = document.createElement('canvas');
                    // For PNG, we want to keep alpha channel
                    const context = canvas.getContext('2d', {
                        willReadFrequently: colorDepth < 1, // Only if we need color reduction
                        alpha: true
                    });

                    if (!context) {
                        reject(new Error('Failed to get canvas context'));
                        return;
                    }

                    canvas.width = imageWidth;
                    canvas.height = imageHeight;

                    // Calculate the source rectangle for cropping
                    let sx = 0;
                    let sy = 0;
                    let sWidth = image.naturalWidth;
                    let sHeight = image.naturalHeight;

                    if (resizeMode === 'Fill') {
                        const scale = Math.max(imageWidth / image.naturalWidth, imageHeight / image.naturalHeight);
                        sWidth = imageWidth / scale;
                        sHeight = imageHeight / scale;
                        sx = (image.naturalWidth - sWidth) / 2;
                        sy = (image.naturalHeight - sHeight) / 2;
                    }

                    // Draw the image, optionally with cropping
                    context.drawImage(
                        image,
                        sx, sy, sWidth, sHeight,
                        0, 0, imageWidth, imageHeight
                    );

                    // Apply color depth reduction if needed
                    if (colorDepth < 1) {
                        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
                        const reducedImageData = this.reduceColorDepth(imageData, colorDepth);
                        context.putImageData(reducedImageData, 0, 0);
                    }

                    resolve({ canvas, context });
                };
                image.onerror = (event) => {
                    console.error("PNG conversion error:", event);
                    reject(new Error('Failed to load image'));
                };
                image.src = imageData;
            });
        };

        try {
            // Read file as data URL once
            const imageData = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = (e) => resolve(e.target?.result as string);
                reader.onerror = () => reject(new Error('Failed to read file'));
                reader.readAsDataURL(file);
            });

            // Setup canvas
            const { canvas } = await setupCanvas(imageData);

            // Try both conversion methods in parallel
            const [blobResult, dataUrlResult] = await Promise.all([
                // Method 1: toBlob approach
                new Promise<ArrayBuffer>((resolve) => {
                    canvas.toBlob(
                        async (blob) => {
                            if (!blob) {
                                resolve(new ArrayBuffer(0));
                                return;
                            }
                            resolve(await blob.arrayBuffer());
                        },
                        'image/png'
                    );
                }),

                // Method 2: toDataURL approach
                new Promise<ArrayBuffer>((resolve) => {
                    const pngData = canvas.toDataURL('image/png');
                    resolve(this.base64ToArrayBuffer(pngData));
                })
            ]);

            // For PNG, we might want to try additional optimization methods
            const results = [
                { type: 'blob', data: blobResult, size: blobResult.byteLength },
                { type: 'dataUrl', data: dataUrlResult, size: dataUrlResult.byteLength }
            ];

            // If input wasn't PNG, add original format as comparison
            if (file.type !== 'image/png') {
                const originalCompressed = await this.compressOriginalImage(
                    file,
                    1, // PNG doesn't use quality parameter
                    resizeMode,
                    desiredWidth,
                    desiredHeight,
                    desiredLongestEdge,
                    enlargeOrReduce
                );
                results.push({
                    type: 'original',
                    data: originalCompressed,
                    size: originalCompressed.byteLength
                });
            }

            // Filter out empty results and sort by size
            const validResults = results
                .filter(result => result.size > 0)
                .sort((a, b) => a.size - b.size);

            // If we don't allow larger files, filter out results larger than original
            if (!allowLargerFiles) {
                const smallerResults = validResults.filter(result => result.size <= file.size);
                if (smallerResults.length > 0) {
                    return smallerResults[0].data;
                }
                // If no valid results, return original file
                return file.arrayBuffer();
            }

            // Return the smallest result
            return validResults[0].data;

        } catch (error) {
            console.error('PNG conversion error:', error);
            // Fallback to original file
            return file.arrayBuffer();
        }
    }

    /**
     * Compresses an image using its original format.
     * @param file - The image file as a Blob.
     * @param quality - The quality setting for lossy formats (0.0 - 1.0).
     * @param resizeMode - The resizing mode.
     * @param desiredWidth - The desired width.
     * @param desiredHeight - The desired height.
     * @param desiredLongestEdge - The desired longest edge.
     * @param enlargeOrReduce - Whether to enlarge or reduce the image.
     * @returns A Promise that resolves to the compressed image as an ArrayBuffer.
     */
    private async compressOriginalImage(
        file: Blob,
        quality: number,
        resizeMode: ResizeMode,
        desiredWidth: number,
        desiredHeight: number,
        desiredLongestEdge: number,
        enlargeOrReduce: EnlargeReduce
    ): Promise<ArrayBuffer> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const reader = new FileReader();

            reader.onload = (e) => {
                img.onload = () => {
                    const { imageWidth, imageHeight } = this.calculateDesiredDimensions(
                        img,
                        resizeMode,
                        desiredWidth,
                        desiredHeight,
                        desiredLongestEdge,
                        enlargeOrReduce
                    );

                    const canvas = document.createElement('canvas');
                    canvas.width = imageWidth;
                    canvas.height = imageHeight;

                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        reject(new Error('Failed to get canvas context'));
                        return;
                    }

                    // Calculate source x, y, width, and height for cropping (if needed)
                    let sx = 0;
                    let sy = 0;
                    let sWidth = img.naturalWidth;
                    let sHeight = img.naturalHeight;

                    if (resizeMode === 'Fill') {
                        // Scale factor to fill the canvas
                        const scale = Math.max(imageWidth / img.naturalWidth, imageHeight / img.naturalHeight);
                        sWidth = imageWidth / scale;
                        sHeight = imageHeight / scale;
                        sx = (img.naturalWidth - sWidth) / 2;
                        sy = (img.naturalHeight - sHeight) / 2;
                    }

                    // Draw the (potentially cropped) image onto the canvas
                    ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, imageWidth, imageHeight);

                    const blobType = file.type || 'image/jpeg';

                    // Use original format instead of hardcoding JPEG
                    canvas.toBlob(
                        (blob) => {
                            if (!blob) {
                                reject(new Error('Failed to create blob'));
                                return;
                            }
                            blob.arrayBuffer().then(resolve).catch(reject);
                        },
                        blobType,
                        quality
                    );
                };

                img.onerror = (event) => {
                    console.error("Original Compression error:", event);
                    reject(new Error('Failed to load image'));
                };
                img.src = e.target?.result as string;
            };

            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
        });
    }

    /**
     * Resizes an image without changing its format or applying compression.
     * @param file - The image file as a Blob.
     * @param resizeMode - The resizing mode.
     * @param desiredWidth - The desired width.
     * @param desiredHeight - The desired height.
     * @param desiredLongestEdge - The desired longest edge.
     * @param enlargeOrReduce - Whether to enlarge or reduce the image.
     * @returns A Promise that resolves to the resized image as an ArrayBuffer.
     */
    private async resizeImage(
        file: Blob,
        resizeMode: ResizeMode,
        desiredWidth: number,
        desiredHeight: number,
        desiredLongestEdge: number,
        enlargeOrReduce: EnlargeReduce
    ): Promise<ArrayBuffer> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const reader = new FileReader();

            reader.onload = (e) => {
                img.onload = () => {
                    const { imageWidth, imageHeight } = this.calculateDesiredDimensions(
                        img,
                        resizeMode,
                        desiredWidth,
                        desiredHeight,
                        desiredLongestEdge,
                        enlargeOrReduce
                    );

                    const canvas = document.createElement('canvas');
                    canvas.width = imageWidth;
                    canvas.height = imageHeight;

                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        reject(new Error('Failed to get canvas context'));
                        return;
                    }

                    // Draw the image onto the canvas with the new dimensions
                    ctx.drawImage(img, 0, 0, imageWidth, imageHeight);

                    canvas.toBlob(
                        (blob) => {
                            if (!blob) {
                                reject(new Error('Failed to create blob'));
                                return;
                            }
                            blob.arrayBuffer().then(resolve).catch(reject);
                        },
                        file.type // Use the original file's MIME type
                    );
                };

                img.onerror = (event) => {
                    console.error("Image resizing error:", event);
                    reject(new Error('Failed to load image for resizing'));
                };
                img.src = e.target?.result as string;
            };

            reader.onerror = () => reject(new Error('Failed to read file for resizing'));
            reader.readAsDataURL(file);
        });
    }

    /**
     * Calculates the desired dimensions for resizing an image.
     * @param image - The image element.
     * @param resizeMode - The resizing mode.
     * @param desiredWidth - The desired width.
     * @param desiredHeight - The desired height.
     * @param desiredLongestEdge - The desired longest edge.
     * @param enlargeOrReduce - Whether to enlarge or reduce the image.
     * @returns An object containing the calculated dimensions and aspect ratio.
     */
    private calculateDesiredDimensions(
        image: HTMLImageElement,
        resizeMode: ResizeMode,
        desiredWidth: number,
        desiredHeight: number,
        desiredLongestEdge: number,
        enlargeOrReduce: EnlargeReduce
    ): Dimensions {
        let imageWidth = image.naturalWidth;
        let imageHeight = image.naturalHeight;
        const aspectRatio = imageWidth / imageHeight;

        switch (resizeMode) {
            case 'None':
                // No resizing needed
                break;
            case 'Fit':
                if (aspectRatio > desiredWidth / desiredHeight) {
                    imageWidth = desiredWidth;
                    imageHeight = imageWidth / aspectRatio;
                } else {
                    imageHeight = desiredHeight;
                    imageWidth = imageHeight * aspectRatio;
                }
                break;
            case 'Fill':
                if (aspectRatio > desiredWidth / desiredHeight) {
                    imageHeight = desiredHeight;
                    imageWidth = imageHeight * aspectRatio;
                } else {
                    imageWidth = desiredWidth;
                    imageHeight = imageWidth / aspectRatio;
                }
                break;
            case 'LongestEdge':
                if (imageWidth > imageHeight) {
                    imageWidth = desiredLongestEdge;
                    imageHeight = imageWidth / aspectRatio;
                } else {
                    imageHeight = desiredLongestEdge;
                    imageWidth = imageHeight * aspectRatio;
                }
                break;
            case 'ShortestEdge':
                if (imageWidth < imageHeight) {
                    imageWidth = desiredLongestEdge;
                    imageHeight = imageWidth / aspectRatio;
                } else {
                    imageHeight = desiredLongestEdge;
                    imageWidth = imageHeight * aspectRatio;
                }
                break;
            case 'Width':
                imageWidth = desiredWidth;
                imageHeight = imageWidth / aspectRatio;
                break;
            case 'Height':
                imageHeight = desiredHeight;
                imageWidth = imageHeight * aspectRatio;
                break;
        }

        // Enlarge or reduce based on the enlargeOrReduce setting
        switch (enlargeOrReduce) {
            case 'Auto':
                // No specific action needed here. 
                // 'Auto' means resize to the exact dimensions specified by resizeMode
                break;
            case 'Reduce':
                // Only reduce if the image is larger than the desired dimensions
                if (image.naturalWidth > imageWidth || image.naturalHeight > imageHeight) {
                    // Do nothing, the desired dimensions are already calculated
                } else {
                    // Image is smaller, so use original dimensions
                    imageWidth = image.naturalWidth;
                    imageHeight = image.naturalHeight;
                }
                break;
            case 'Enlarge':
                // Only enlarge if the image is smaller than the desired dimensions
                if (image.naturalWidth < imageWidth && image.naturalHeight < imageHeight) {
                    // Do nothing, the desired dimensions are already calculated
                } else {
                    // Image is larger, so use original dimensions
                    imageWidth = image.naturalWidth;
                    imageHeight = image.naturalHeight;
                }
                break;
        }

        return { imageWidth, imageHeight, aspectRatio };
    }

    /**
     * Reduces the color depth of an image.
     * @param imageData - The image data.
     * @param colorDepth - The color depth (0.0 - 1.0).
     * @returns The image data with reduced color depth.
     */
    private reduceColorDepth(imageData: ImageData, colorDepth: number): ImageData {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('Failed to get canvas context');
        }
        canvas.width = imageData.width;
        canvas.height = imageData.height;
        ctx.putImageData(imageData, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const numColors = Math.pow(256, colorDepth);
        const reducedData = new Uint8ClampedArray(data.length);
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const reducedR = Math.round(r / (256 / numColors)) * (256 / numColors);
            const reducedG = Math.round(g / (256 / numColors)) * (256 / numColors);
            const reducedB = Math.round(b / (256 / numColors)) * (256 / numColors);
            reducedData[i] = reducedR;
            reducedData[i + 1] = reducedG;
            reducedData[i + 2] = reducedB;
            reducedData[i + 3] = data[i + 3];
        }
        const reducedImageData = new ImageData(reducedData, imageData.width, imageData.height);
        return reducedImageData;
    }

    /**
     * Converts a base64 string to an ArrayBuffer.
     * @param base64 - The base64 string.
     * @returns The ArrayBuffer.
     */
    private base64ToArrayBuffer(base64: string): ArrayBuffer {
        const binary = atob(base64.split(',')[1]);
        const length = binary.length;
        const buffer = new ArrayBuffer(length);
        const view = new Uint8Array(buffer);

        for (let i = 0; i < length; i++) {
            view[i] = binary.charCodeAt(i);
        }

        return buffer;
    }
}
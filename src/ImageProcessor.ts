// ImageProcessor.ts
import { Notice, Platform } from "obsidian";
import { SupportedImageFormats } from "./SupportedImageFormats";
// eslint-disable-next-line import/no-nodejs-modules -- Required for spawning external processes (FFmpeg, pngquant); Obsidian runs on Electron with Node.js support
import { ChildProcess, spawn } from 'child_process';
import { ConversionPreset, ImageConverterSettings, DEFAULT_SETTINGS } from "./ImageConverterSettings";
import * as piexif from "piexifjs"; // Import piexif library

// eslint-disable-next-line import/no-nodejs-modules -- Required for temporary file handling in FFmpeg processing; Obsidian runs on Electron with Node.js support
import * as fs from 'fs/promises';
// eslint-disable-next-line import/no-nodejs-modules -- Required for temporary directory access; Obsidian runs on Electron with Node.js support
import * as os from 'os';
// eslint-disable-next-line import/no-nodejs-modules -- Required for path manipulation; Obsidian runs on Electron with Node.js support
import * as path from 'path';

// Import types
export type ResizeMode = 'None' | 'Fit' | 'Fill' | 'LongestEdge' | 'ShortestEdge' | 'Width' | 'Height';
export type EnlargeReduce = 'Auto' | 'Reduce' | 'Enlarge';

interface Dimensions {
    imageWidth: number;
    imageHeight: number;
    aspectRatio: number;
}

export class ImageProcessor {

    supportedImageFormats: SupportedImageFormats
    private preset: ConversionPreset | undefined;
    private settings: ImageConverterSettings;

    constructor(supportedImageFormats: SupportedImageFormats) {
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
        format: 'WEBP' | 'JPEG' | 'PNG' | 'ORIGINAL' | 'NONE' | 'PNGQUANT' | 'AVIF',
        quality: number,
        colorDepth: number,
        resizeMode: ResizeMode,
        desiredWidth: number,
        desiredHeight: number,
        desiredLongestEdge: number,
        enlargeOrReduce: EnlargeReduce,
        allowLargerFiles: boolean,
        preset?: ConversionPreset, // Add preset parameter
        settings?: ImageConverterSettings
    ): Promise<ArrayBuffer> {
        // Process the image using the helper function
        const processedImage = await this.processImageHelper(
            file,
            format,
            quality,
            colorDepth,
            resizeMode,
            desiredWidth,
            desiredHeight,
            desiredLongestEdge,
            enlargeOrReduce,
            allowLargerFiles,
            preset,
            settings
        );

        if (format === "JPEG") {
            try {
                // Extract metadata from the original file
                const metadata: piexif.ExifDict | undefined = await this.extractMetadata(file);

                // Remove rotation property (Orientation tag in 0th IFD, tag 274)
                if (metadata && metadata["0th"] && metadata["0th"][piexif.ImageIFD.Orientation]) {
                    delete metadata["0th"][piexif.ImageIFD.Orientation];
                }

                const stringifiedMetadata = metadata && Object.keys(metadata).length > 0 ? piexif.dump(metadata) : "";

                // Re-apply the metadata to the processed image
                return await this.applyMetadata(processedImage, stringifiedMetadata);
            } catch (exifError) {
                console.error("JPEG EXIF handling error:", exifError);
                // Per contract 1.8: on EXIF failure, return JPEG without EXIF; no throw
                return processedImage;
            }
        }

        return processedImage
    }    

    /**
     * Helper method to process an image file.
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
    private async processImageHelper(
        file: Blob,
        format: 'WEBP' | 'JPEG' | 'PNG' | 'ORIGINAL' | 'NONE' | 'PNGQUANT' | 'AVIF',
        quality: number,
        colorDepth: number,
        resizeMode: ResizeMode,
        desiredWidth: number,
        desiredHeight: number,
        desiredLongestEdge: number,
        enlargeOrReduce: EnlargeReduce,
        allowLargerFiles: boolean,
        preset?: ConversionPreset, // Add preset parameter
        settings?: ImageConverterSettings
    ): Promise<ArrayBuffer> {
        this.preset = preset; // Store the preset
        this.settings = settings ?? DEFAULT_SETTINGS;

        try {
            // --- Handle NONE format ---
if (format === 'NONE' && resizeMode !== 'None') {
                // No conversion, but resizing is needed
                return await this.resizeImage(
                    file,
                    resizeMode,
                    desiredWidth,
                    desiredHeight,
                    desiredLongestEdge,
                    enlargeOrReduce,
                    quality
                );
            }
            if (format === 'NONE') {
                // No conversion or compression or resizing
                return file.arrayBuffer();
            }

            // --- Handle ORIGINAL format ---
if (format === 'ORIGINAL') {
                // Compress using original format
                return await this.compressOriginalImage(
                    file,
                    quality,
                    resizeMode,
                    desiredWidth,
                    desiredHeight,
                    desiredLongestEdge,
                    enlargeOrReduce
                );
            }

// Prefer magic bytes (header) over file.type per contract
            const filename = (file instanceof File) ? file.name : 'image';
            const detected = await this.supportedImageFormats.getMimeTypeFromFile(file);
            if (!detected || detected === 'unknown') {
                // Per contract (1.18): if detection fails, return original bytes; no throw
                return file.arrayBuffer();
            }
            const mimeType = detected;
            // If detected MIME isn't supported by our engine, treat as unknown and return original
            if (!this.supportedImageFormats.isSupported(mimeType, filename)) {
                return file.arrayBuffer();
            }

            switch (mimeType) {
                case 'image/tiff':
                case 'image/tif': {
                    // TIFF requires special handling
                    try {
                        const tiffBlob = await this.handleTiff(await file.arrayBuffer());
                        return await this.convertAndCompress(
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
                    } catch {
                        // Fallback to original on failure
                        return file.arrayBuffer();
                    }
                }
                case 'image/heic':
                case 'image/heif': {
                    try {
                        const heicBlob = await this.handleHeic(
                            await file.arrayBuffer(),
                            format === 'JPEG' ? 'JPEG' : 'PNG', // HEIC can only convert to JPEG or PNG
                            format === 'JPEG' ? quality : 1 // Quality only applies to JPEG
                        );
                        return await this.convertAndCompress(
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
                    } catch {
                        // Fallback to original on failure
                        return file.arrayBuffer();
                    }
                }
                default:
                    try {
                        // Other formats can be handled directly
                        return await this.convertAndCompress(
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
                    } catch {
                        // Any unexpected error in pipeline -> return original, do not throw (1.31)
                        return file.arrayBuffer();
                    }
            }
        } catch (error) {
            const filename = (file instanceof File) ? file.name : 'image';
            const message = error instanceof Error ? (error.message || 'Unknown error') : String(error);
            console.error(`Error processing image "${filename}" (target: ${format}):`, error);
            new Notice(`Failed to process image "${filename}" (target: ${format}): ${message}`);
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

            // UTIF expects ArrayBuffer or Buffer, not Uint8Array
            // Pass the ArrayBuffer directly
            const ifds = UTIF.decode(binary);
            UTIF.decodeImage(binary, ifds[0]);
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
                blob,
                type: outputMimeType,
                quality
            }) as Blob;
        } catch (error) {
            console.error('Error converting HEIC:', error);
            const errorMessage = error instanceof Error ? (error.message || 'Unknown error') : String(error);
            throw new Error(`Failed to convert HEIC image to ${format}: ${errorMessage}`);
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
        format: 'WEBP' | 'JPEG' | 'PNG' | 'PNGQUANT' | 'AVIF', // Include AVIF
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
            case 'PNGQUANT': {// Add case for PNGQUANT
                // Retrieve PNGQUANT settings from preset if available, otherwise from global settings.
                const pngquantExecutablePath = this.preset?.pngquantExecutablePath || this.settings.singleImageModalSettings?.pngquantExecutablePath;
                const pngquantQuality = this.preset?.pngquantQuality || this.settings.pngquantQuality;
                // Check if executable path is set
                if (!pngquantExecutablePath) {
                    new Notice("The pngquant executable path is not set. Please configure it in the plugin settings.");
                    return file.arrayBuffer(); // Return original
                }

                return this.processWithPngquant(
                    file,
                    pngquantExecutablePath,
                    pngquantQuality,
                    resizeMode,
                    desiredWidth,
                    desiredHeight,
                    desiredLongestEdge,
                    enlargeOrReduce
                );
            }
            case 'AVIF': {
                // Retrieve AVIF settings from preset if available, or from SingleImageModal
                const ffmpegExecutablePath = this.preset?.ffmpegExecutablePath || this.settings.singleImageModalSettings?.ffmpegExecutablePath;
                const ffmpegCrf = this.preset?.ffmpegCrf || this.settings.ffmpegCrf;
                const ffmpegPreset = this.preset?.ffmpegPreset || this.settings.ffmpegPreset;

                // Check if executable path is set
                if (!ffmpegExecutablePath) {
                    // eslint-disable-next-line obsidianmd/ui/sentence-case -- FFmpeg is the official brand name
                    new Notice("FFmpeg executable path is not set. Please configure it in the plugin settings.");
                    return file.arrayBuffer();  // Return original
                }

                return this.processWithFFmpeg(
                    file,
                    ffmpegExecutablePath,
                    ffmpegCrf,
                    ffmpegPreset,
                    resizeMode,
                    desiredWidth,
                    desiredHeight,
                    desiredLongestEdge,
                    enlargeOrReduce
                );
            }
            default:
                return file.arrayBuffer(); // No conversion needed
        }
    }

    /**
     * Processes an image using FFmpeg for AVIF conversion.
     * @param file The image file as a Blob.
     * @param executablePath The path to the FFmpeg executable.
     * @param crf The Constant Rate Factor for AVIF encoding (lower is better quality, 0-63).
     * @param preset  The encoding preset (e.g., 'veryslow', 'slow', 'medium', 'fast').
     * @param resizeMode The resizing mode (same as your existing enum).
     * @param desiredWidth Desired width for resizing.
     * @param desiredHeight Desired height for resizing.
     * @param desiredLongestEdge Desired longest edge for resizing.
     * @param enlargeOrReduce Whether to enlarge or reduce the image during resizing.
     * @returns A Promise that resolves to the processed image as an ArrayBuffer.
     */
    private async processWithFFmpeg(
        file: Blob,
        executablePath: string,
        crf: number,
        preset: string,
        resizeMode: ResizeMode,
        desiredWidth: number,
        desiredHeight: number,
        desiredLongestEdge: number,
        enlargeOrReduce: EnlargeReduce
    ): Promise<ArrayBuffer> {

        let resizedBlob: Blob = file;
        if (resizeMode !== 'None') {
            const resizedBuffer = await this.resizeImage(file, resizeMode, desiredWidth, desiredHeight, desiredLongestEdge, enlargeOrReduce);
            resizedBlob = new Blob([resizedBuffer], { type: file.type });
        }

        const dimensions = await this.getImageDimensions(resizedBlob);
        const imageData = await resizedBlob.arrayBuffer();

        // Check if the image has transparency
        const hasTransparency = await this.checkForTransparency(resizedBlob);

        // Create a temporary file path
        const tempDir = os.tmpdir(); // Get the system's temporary directory
        const tempFileName = `obsidian_image_converter_${Date.now()}.avif`; // Unique filename
        const tempFilePath = path.join(tempDir, tempFileName);


        return new Promise((resolve, reject) => {
            const scaleFilter = this.buildScaleFilter(resizeMode, dimensions, desiredWidth, desiredHeight, desiredLongestEdge);

            let args: string[];

            if (hasTransparency) {
                // For images with transparency
                let filterChain = 'format=rgba';
                if (scaleFilter) {
                    filterChain += `,${scaleFilter}`;
                }

                args = [
                    '-i', 'pipe:0',
                    '-map', '0',
                    '-map', '0',
                    '-filter:v:0', filterChain,
                    '-filter:v:1', 'alphaextract',
                    '-c:v', 'libaom-av1',
                    '-crf', crf.toString(),
                    '-preset', preset,
                    '-still-picture', '1',
                    '-y',
                    '-f', 'avif',
                    tempFilePath
                ];
            } else {
                // For images without transparency
                let filterChain = 'format=yuv420p';
                if (scaleFilter) {
                    filterChain += `,${scaleFilter}`;
                }

                args = [
                    '-i', 'pipe:0',
                    '-filter:v', filterChain,
                    '-c:v', 'libaom-av1',
                    '-crf', crf.toString(),
                    '-preset', preset,
                    '-still-picture', '1',
                    '-y',
                    '-f', 'avif',
                    tempFilePath
                ];
            }

            let ffmpeg: ChildProcess | null = null;

            try {
                if (Platform.isWin) {
                    ffmpeg = spawn(executablePath, args, { windowsHide: true });
                } else {
                    ffmpeg = spawn(executablePath, args);
                }
            } catch (spawnError) {
                const errorMessage = spawnError instanceof Error ? (spawnError.message || 'Unknown error') : String(spawnError);
                console.error(`Failed to spawn FFmpeg: ${errorMessage}`);
                reject(new Error(`Failed to spawn FFmpeg: ${errorMessage}`));
                return;
            }

            if (!ffmpeg) {
                reject(new Error("Failed to spawn FFmpeg process."));
                return;
            }

            // Declare errorData before onExit handler to avoid temporal dead zone
            let errorData = "";

            // Fallback: ensure process terminates to unblock tests when mocks emit 'exit' instead of 'close'
            const onExit = (code: number | null, _signal: string | null) => {
                // Mirror close handler logic to reject on non-zero
                ffmpeg?.removeAllListeners('close');
                if (code !== null && code !== 0) {
                    const exitErrorMessage = `FFmpeg failed with code ${code}: ${errorData}`;
                    console.error(exitErrorMessage);
                    // Clean up temp file on error (wrapped for test mock compatibility)
                    void Promise.resolve(fs.unlink(tempFilePath)).catch(() => { /* ignore cleanup errors */ });
                    reject(new Error(exitErrorMessage));
                }
            };
            ffmpeg.on('exit', onExit);

            // We don't need stdout listener when writing to a file.
            // ffmpeg.stdout?.on('data', (data: Buffer) => {
            //     outputData.push(data);
            // });

            ffmpeg.stderr?.on('data', (data: Buffer) => {
                errorData += data.toString();
            });

            ffmpeg.on('close', (code: number) => {
                void (async () => {
                    if (code !== 0) {
                        const closeErrorMessage = `FFmpeg failed with code ${code}: ${errorData}`;
                        console.error(closeErrorMessage);
                        // Clean up temp file on error
                        try { await fs.unlink(tempFilePath); } catch { /* ignore errors during cleanup */ }
                        reject(new Error(closeErrorMessage));
                        return;
                    }

                    try {
                        // Read the temporary file and convert Buffer to ArrayBuffer
                        const fileBuffer = await fs.readFile(tempFilePath);
                        resolve(this.nodeBufferToArrayBuffer(fileBuffer));
                    } catch (readError) {
                        console.error("Error reading temporary file:", readError);
                        reject(new Error(`Failed to read the processed image from the temporary file: ${String(readError)}`));
                    } finally {
                        //  Clean up the temporary file.  VERY IMPORTANT.
                        try {
                            await fs.unlink(tempFilePath);
                        } catch (unlinkError) {
                            console.error("Error deleting temporary file:", unlinkError);
                            //  Don't reject here; we already resolved/rejected.
                        }
                    }
                })();
            });

ffmpeg.on('error', (err: Error) => {
                const errorMessage = `Error with FFmpeg process: ${err.message}`;
                console.error(errorMessage);
                // Clean up temp file on error (if it exists, wrapped for test mock compatibility)
                void Promise.resolve(fs.unlink(tempFilePath)).catch(() => { /* ignore errors during cleanup */ });
                reject(new Error(errorMessage));
            });

            // Safety timeout to avoid hanging tests in case mocks fail to emit expected events
            const safetyTimeout = setTimeout(() => {
                try { ffmpeg?.kill?.('SIGKILL'); } catch { /* ignore kill errors */ }
                reject(new Error('FFmpeg process timed out'));
            }, 5000);

            ffmpeg.on('close', () => clearTimeout(safetyTimeout));
            ffmpeg.on('exit', () => clearTimeout(safetyTimeout));

            ffmpeg.stdin?.write(Buffer.from(imageData));
            ffmpeg.stdin?.end();
        });
    }

    // Add this helper method to check for transparency
    private async checkForTransparency(blob: Blob): Promise<boolean> {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    resolve(false);
                    return;
                }

                ctx.drawImage(img, 0, 0);

                // Get image data and check for non-255 alpha values
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const { data } = imageData;

                for (let i = 3; i < data.length; i += 4) {
                    if (data[i] < 255) {
                        resolve(true);
                        return;
                    }
                }

                resolve(false);
            };

            img.onerror = () => resolve(false);

            const reader = new FileReader();
            reader.onload = (e) => {
                img.src = e.target?.result as string;
            };
            reader.onerror = () => resolve(false);
            reader.readAsDataURL(blob);
        });
    }

    /**
     * Helper function to get the dimensions of an image Blob.
     */
    private async getImageDimensions(blob: Blob): Promise<{ width: number, height: number }> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                resolve({ width: img.naturalWidth, height: img.naturalHeight });
            };
            img.onerror = () => {
                reject(new Error("Failed to load image to get dimensions."));
            }
            img.src = URL.createObjectURL(blob);
        });
    }


    /**
     * Builds the FFmpeg scale filter string based on resize mode and desired dimensions.
     * Returns null if no scaling is needed.
     */
    private buildScaleFilter(
        resizeMode: ResizeMode,
        dimensions: { width: number, height: number },
        desiredWidth: number,
        desiredHeight: number,
        desiredLongestEdge: number
    ): string | null {

        const { width, height } = dimensions;
        const aspectRatio = width / height;

        let targetWidth: number;
        let targetHeight: number;

        switch (resizeMode) {
            case 'None':
                return null;  // No scaling

            case 'Fit':
                if (aspectRatio > desiredWidth / desiredHeight) {
                    targetWidth = desiredWidth;
                    targetHeight = Math.round(desiredWidth / aspectRatio);
                } else {
                    targetHeight = desiredHeight;
                    targetWidth = Math.round(desiredHeight * aspectRatio);
                }
                break;

            case 'Fill':
                if (aspectRatio > desiredWidth / desiredHeight) {
                    targetHeight = desiredHeight;
                    targetWidth = Math.round(desiredHeight * aspectRatio);
                } else {
                    targetWidth = desiredWidth;
                    targetHeight = Math.round(desiredWidth / aspectRatio);
                }
                break;

            case 'LongestEdge':
                if (width > height) {
                    targetWidth = desiredLongestEdge;
                    targetHeight = Math.round(desiredLongestEdge / aspectRatio);
                } else {
                    targetHeight = desiredLongestEdge;
                    targetWidth = Math.round(desiredLongestEdge * aspectRatio);
                }
                break;

            case 'ShortestEdge':  // Corrected case
                if (width < height) {  // Corrected condition
                    targetWidth = desiredLongestEdge;
                    targetHeight = Math.round(desiredLongestEdge / aspectRatio);
                } else {
                    targetHeight = desiredLongestEdge;
                    targetWidth = Math.round(desiredLongestEdge * aspectRatio);
                }
                break;

            case 'Width':
                targetWidth = desiredWidth;
                targetHeight = Math.round(desiredWidth / aspectRatio);
                break;

            case 'Height':
                targetHeight = desiredHeight;
                targetWidth = Math.round(desiredHeight * aspectRatio);
                break;

            default:
                return null; // Should not happen, but good for completeness
        }
        return `scale=${targetWidth}:${targetHeight}`;
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
image.onload = () => { try {
                    const { imageWidth, imageHeight } = this.calculateDesiredDimensions(
                        image,
                        resizeMode,
                        desiredWidth,
                        desiredHeight,
                        desiredLongestEdge,
                        enlargeOrReduce
                    );

                    // Enforce Reduce semantics: do not upscale beyond original dimensions
                    let outWidth = imageWidth;
                    let outHeight = imageHeight;
                    if (enlargeOrReduce === 'Reduce' && (image.naturalWidth < imageWidth || image.naturalHeight < imageHeight)) {
                        outWidth = image.naturalWidth;
                        outHeight = image.naturalHeight;
                    }

                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d', {
                        willReadFrequently: false
                    });

                    if (!context) {
                        reject(new Error('Failed to get canvas context'));
                        return;
                    }

                    canvas.width = outWidth;
                    canvas.height = outHeight;

                    // Calculate the source rectangle for cropping
                    let sx = 0;
                    let sy = 0;
                    let sWidth = image.naturalWidth;
                    let sHeight = image.naturalHeight;

                    if (resizeMode === 'Fill') {
                        const scale = Math.max(outWidth / image.naturalWidth, outHeight / image.naturalHeight);
                        sWidth = outWidth / scale;
                        sHeight = outHeight / scale;
                        sx = Math.floor((image.naturalWidth - sWidth) / 2);
                        sy = Math.floor((image.naturalHeight - sHeight) / 2);
                    }

                    // Draw the image, optionally with cropping
                    context.drawImage(
                        image,
                        sx, sy, sWidth, sHeight,
                        0, 0, outWidth, outHeight
                    );

                    resolve({ canvas, context });
                } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
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
                        (blob) => {
                            if (!blob) {
                                resolve(new ArrayBuffer(0));
                                return;
                            }
                            blob.arrayBuffer()
                                .then(resolve)
                                .catch(() => resolve(new ArrayBuffer(0)));
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
            results.sort((left, right) => left.size - right.size);

            // If we don't allow larger files, filter out results larger than original
            // if (!allowLargerFiles) {
            //     const validResults = results.filter(result => result.size <= file.size);
            //     if (validResults.length > 0) {
            //         return validResults[0].data;
            //     }
            //     // If no valid results, return original file
            //     return file.arrayBuffer();
            // }

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
image.onload = () => { try {
                    const { imageWidth, imageHeight } = this.calculateDesiredDimensions(
                        image,
                        resizeMode,
                        desiredWidth,
                        desiredHeight,
                        desiredLongestEdge,
                        enlargeOrReduce
                    );

                    // Enforce Reduce semantics: do not upscale beyond original dimensions
                    let outWidth = imageWidth;
                    let outHeight = imageHeight;
                    if (enlargeOrReduce === 'Reduce' && (image.naturalWidth < imageWidth || image.naturalHeight < imageHeight)) {
                        outWidth = image.naturalWidth;
                        outHeight = image.naturalHeight;
                    }

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

                    canvas.width = outWidth;
                    canvas.height = outHeight;

                    // Calculate the source rectangle for cropping
                    let sx = 0;
                    let sy = 0;
                    let sWidth = image.naturalWidth;
                    let sHeight = image.naturalHeight;

                    if (resizeMode === 'Fill') {
                        const scale = Math.max(outWidth / image.naturalWidth, outHeight / image.naturalHeight);
                        sWidth = outWidth / scale;
                        sHeight = outHeight / scale;
                        sx = Math.floor((image.naturalWidth - sWidth) / 2);
                        sy = Math.floor((image.naturalHeight - sHeight) / 2);
                    }

                    // Draw the image, optionally with cropping
                    context.drawImage(
                        image,
                        sx, sy, sWidth, sHeight,
                        0, 0, outWidth, outHeight
                    );

                    resolve({ canvas, context });
                } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
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
                        (blob) => {
                            if (!blob) {
                                resolve(new ArrayBuffer(0));
                                return;
                            }
                            blob.arrayBuffer()
                                .then(resolve)
                                .catch(() => resolve(new ArrayBuffer(0)));
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

// Compare all results and choose the smallest one
            const results: { type: string; data: ArrayBuffer; size: number }[] = [
                { type: 'blob', data: blobResult, size: blobResult.byteLength },
                { type: 'dataUrl', data: dataUrlResult, size: dataUrlResult.byteLength }
            ];
            // Include original format compression only when input is not already JPEG
            if (file.type !== 'image/jpeg') {
                const originalCompressed = await this.compressOriginalImage(
                    file,
                    quality,
                    resizeMode,
                    desiredWidth,
                    desiredHeight,
                    desiredLongestEdge,
                    enlargeOrReduce
                );
                results.push({ type: 'original', data: originalCompressed, size: originalCompressed.byteLength });
            }

            const filtered = results.filter(result => result.size > 0);

// Sort by size
            filtered.sort((left, right) => left.size - right.size);

            // If we don't allow larger files, filter out results larger than original
            // if (!allowLargerFiles) {
            //     const validResults = filtered.filter(result => result.size <= file.size);
            //     if (validResults.length > 0) {
            //         return validResults[0].data;
            //     }
            //     // If no valid results, return original file
            //     return file.arrayBuffer();
            // }

            // Return the smallest result
            return filtered[0].data;

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
image.onload = () => { try {
                    const { imageWidth, imageHeight } = this.calculateDesiredDimensions(
                        image,
                        resizeMode,
                        desiredWidth,
                        desiredHeight,
                        desiredLongestEdge,
                        enlargeOrReduce
                    );

                    // Enforce Reduce semantics: do not upscale beyond original dimensions
                    let outWidth = imageWidth;
                    let outHeight = imageHeight;
                    if (enlargeOrReduce === 'Reduce' && (image.naturalWidth < imageWidth || image.naturalHeight < imageHeight)) {
                        outWidth = image.naturalWidth;
                        outHeight = image.naturalHeight;
                    }

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

                    canvas.width = outWidth;
                    canvas.height = outHeight;

                    // Calculate the source rectangle for cropping
                    let sx = 0;
                    let sy = 0;
                    let sWidth = image.naturalWidth;
                    let sHeight = image.naturalHeight;

                    if (resizeMode === 'Fill') {
                        const scale = Math.max(outWidth / image.naturalWidth, outHeight / image.naturalHeight);
                        sWidth = outWidth / scale;
                        sHeight = outHeight / scale;
                        sx = (image.naturalWidth - sWidth) / 2;
                        sy = (image.naturalHeight - sHeight) / 2;
                    }

                    // Draw the image, optionally with cropping
                    context.drawImage(
                        image,
                        sx, sy, sWidth, sHeight,
                        0, 0, outWidth, outHeight
                    );

                    // Apply color depth reduction if needed
                    if (colorDepth < 1) {
                        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
                        const reducedImageData = this.reduceColorDepth(imageData, colorDepth);
                        context.putImageData(reducedImageData, 0, 0);
                    }

                    resolve({ canvas, context });
                } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
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
                        (blob) => {
                            if (!blob) {
                                resolve(new ArrayBuffer(0));
                                return;
                            }
                            blob.arrayBuffer()
                                .then(resolve)
                                .catch(() => resolve(new ArrayBuffer(0)));
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
                .sort((left, right) => left.size - right.size);

            // If we don't allow larger files, filter out results larger than original
            // if (!allowLargerFiles) {
            //     const smallerResults = validResults.filter(result => result.size <= file.size);
            //     if (smallerResults.length > 0) {
            //         return smallerResults[0].data;
            //     }
            //     // If no valid results, return original file
            //     return file.arrayBuffer();
            // }

            // Return the smallest result
            return validResults[0].data;

        } catch (error) {
            console.error('PNG conversion error:', error);
            // Fallback to original file
            return file.arrayBuffer();
        }
    }

    /**
     * Processes an image using PNGQUANT.
     * @param file The image file as a Blob.
     * @param executablePath The path to the PNGQUANT executable.
     * @param quality The quality setting for PNGQUANT (e.g., "65-80").
     * @param resizeMode The resizing mode (same as your existing enum).
     * @param desiredWidth Desired width for resizing.
     * @param desiredHeight Desired height for resizing.
     * @param desiredLongestEdge Desired longest edge for resizing.
     * @param enlargeOrReduce Whether to enlarge or reduce the image during resizing.
     * @returns A Promise that resolves to the processed image as an ArrayBuffer.
     */
    // Inside ImageProcessor.ts

    private async processWithPngquant(
        file: Blob,
        executablePath: string,
        quality: string,
        resizeMode: ResizeMode,
        desiredWidth: number,
        desiredHeight: number,
        desiredLongestEdge: number,
        enlargeOrReduce: EnlargeReduce
    ): Promise<ArrayBuffer> {

        // 1. Resize if necessary *before* passing to pngquant.
        let resizedBlob: Blob = file;
        if (resizeMode !== 'None') {
            const resizedBuffer = await this.resizeImage(file, resizeMode, desiredWidth, desiredHeight, desiredLongestEdge, enlargeOrReduce);
            resizedBlob = new Blob([resizedBuffer], { type: file.type });
        }

        // 2. Get image data as ArrayBuffer
        const imageData = await resizedBlob.arrayBuffer();

        return new Promise((resolve, reject) => {
            // 3. Construct the command.  Crucially, we use `-` for both input
            //    and output to work with stdin and stdout.
            const args = ['--quality', quality, '-'];
            let pngquant: ChildProcess | null = null; // Initialize to null

            try {
                if (Platform.isWin) { // Corrected: Use isWin
                    pngquant = spawn(executablePath, args, { windowsHide: true });
                } else {
                    pngquant = spawn(executablePath, args);
                }
            } catch (spawnError) {
                // Handle spawn errors *immediately*.  This is crucial.
                const errorMessage = spawnError instanceof Error ? (spawnError.message || 'Unknown error') : String(spawnError);
                console.error(`Failed to spawn pngquant: ${errorMessage}`);
                reject(new Error(`Failed to spawn pngquant: ${errorMessage}`));
                return; // Exit early.
            }


            // --- Null Check and Early Return ---
            if (!pngquant) {
                reject(new Error("Failed to spawn pngquant process."));
                return; // *Crucially* return to prevent further execution
            }

            // 4. Data Handling: We use let for outputData because we might
            //    reassign it in case of an error.
            const outputData: Buffer[] = [];
            let errorData = "";

            // 5. Handle stdout.  pngquant writes the *processed image data* to stdout.
            // Use nullish coalescing operator to handle potential null
            pngquant.stdout?.on('data', (data: Buffer) => {
                outputData.push(data);
            });

            // 6. Handle stderr.  pngquant writes *errors* to stderr.
            // Use nullish coalescing operator to handle potential null
            pngquant.stderr?.on('data', (data: Buffer) => {
                errorData += data.toString();
            });

            // 7. Handle Process Exit
            pngquant.on('close', (code: number) => {
                if (code !== 0) {
                    // 8. Error:  If pngquant exits with a non-zero code, it's an error.
                    const errorMessage = `pngquant failed with code ${code}: ${errorData}`;
                    console.error(errorMessage);
                    reject(new Error(errorMessage));
                    return;
                }

                // 9. Success: If we get here, pngquant succeeded.  Concatenate the
                //    Buffer chunks and convert to ArrayBuffer.
                const resultBuffer = Buffer.concat(outputData);
                resolve(this.nodeBufferToArrayBuffer(resultBuffer));
            });

            // 10. Handle Errors on the process itself (e.g., couldn't start).
            // Use nullish coalescing operator to handle potential null
            pngquant.on('error', (err: Error) => {
                const errorMessage = `Error with pngquant process: ${err.message}`;
                console.error(errorMessage);
                reject(new Error(errorMessage));
            });


            // 11. Write the image data to pngquant's stdin.  This is how we
            //     pass the image to be processed.
            // Use nullish coalescing operator to handle potential null
            pngquant.stdin?.write(Buffer.from(imageData));
            pngquant.stdin?.end(); // Close stdin - *important*!

        });
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
    async compressOriginalImage(
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
                        sx = Math.floor((img.naturalWidth - sWidth) / 2);
                        sy = Math.floor((img.naturalHeight - sHeight) / 2);
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
async resizeImage(
        file: Blob,
        resizeMode: ResizeMode,
        desiredWidth: number,
        desiredHeight: number,
        desiredLongestEdge: number,
        enlargeOrReduce: EnlargeReduce,
        quality: number = 1
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
                        file.type, // Use the original file's MIME type
                        quality
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
                // Destination should exactly match target bounds; source rect will be center-cropped
                imageWidth = desiredWidth;
                imageHeight = desiredHeight;
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
     * Converts a Node.js Buffer to an ArrayBuffer representing only the buffer's bytes.
     */
    private nodeBufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
        // Buffer.buffer may be backed by ArrayBuffer or SharedArrayBuffer depending on runtime.
        // We always return a real ArrayBuffer for maximum Web API compatibility.
        const out = new ArrayBuffer(buffer.byteLength);
        new Uint8Array(out).set(buffer);
        return out;
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
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const numColors = Math.pow(256, colorDepth);
        const reducedData = new Uint8ClampedArray(data.length);
        for (let i = 0; i < data.length; i += 4) {
            const red = data[i];
            const green = data[i + 1];
            const blue = data[i + 2];
            const reducedR = Math.round(red / (256 / numColors)) * (256 / numColors);
            const reducedG = Math.round(green / (256 / numColors)) * (256 / numColors);
            const reducedB = Math.round(blue / (256 / numColors)) * (256 / numColors);
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
        const { length } = binary;
        const buffer = new ArrayBuffer(length);
        const view = new Uint8Array(buffer);

        for (let i = 0; i < length; i++) {
            view[i] = binary.charCodeAt(i);
        }

        return buffer;
    }

    /**
     * Extracts metadata from an image file.
     * @param file - The image file as a Blob.
     * @returns A Promise that resolves to the extracted metadata.
     */
    private async extractMetadata(file: Blob): Promise<piexif.ExifDict | undefined> {
        const reader = new FileReader();
        const fileDataUrl = await new Promise<string>((resolve, reject) => {
            reader.onload = (e) => resolve(e.target?.result as string);
            reader.onerror = () => reject(new Error("Failed to read file for metadata"));
            reader.readAsDataURL(file);
        });

        try {
            return piexif.load(fileDataUrl);
        } catch {
            return;
        }
    }

    private async applyMetadata(
        buffer: ArrayBuffer,
        metadata: string
    ): Promise<ArrayBuffer> {
        try {
            // Convert ArrayBuffer to Base64 string in chunks
            const uint8Array = new Uint8Array(buffer);
            let binaryString = '';
            const chunkSize = 8192; // Process in chunks to avoid stack overflow
            for (let i = 0; i < uint8Array.length; i += chunkSize) {
                binaryString += String.fromCharCode.apply(
                    null,
                    uint8Array.subarray(i, i + chunkSize)
                );
            }
            const base64Data = `data:image/jpeg;base64,${btoa(binaryString)}`;
    
            // Insert EXIF metadata using piexif
            const updatedBase64 = piexif.insert(metadata, base64Data);
    
            // Convert the updated Base64 string back to an ArrayBuffer
            const updatedBinaryString = atob(updatedBase64.split(',')[1]);
            const updatedBuffer = new ArrayBuffer(updatedBinaryString.length);
            const updatedUint8Array = new Uint8Array(updatedBuffer);
            for (let i = 0; i < updatedBinaryString.length; i++) {
                updatedUint8Array[i] = updatedBinaryString.charCodeAt(i);
            }
    
            return updatedBuffer;
        } catch (error) {
            console.error("Error applying metadata:", error);
            return buffer; // Return original if metadata application fails
        }
    }
}
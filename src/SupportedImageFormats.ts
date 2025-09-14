import { TFile, CachedMetadata, App } from "obsidian";

export class SupportedImageFormats {
    // Use a Map for faster mime type lookups
    supportedMimeTypes: Map<string, boolean> = new Map([
        ["image/jpeg", true],
        ["image/png", true],
        ["image/webp", true],
        ["image/heic", true],
        ["image/heif", true],
        ["image/avif", true],
        ["image/tiff", true],
        ["image/bmp", true],
        ["image/svg+xml", true],
        ["image/gif", true],
        // ["video/quicktime", true] // .mov files
    ]);

    // Keep extensions for fallback, use a Set for faster lookups
    supportedExtensions: Set<string> = new Set([
        "jpg",
        "jpeg",
        "png",
        "webp",
        "heic",
        "heif",
        "avif",
        "tif",
        "tiff",
        "bmp",
        "svg",
        "gif",
        // "mov"
    ]);

    // Reverse mapping from extensions to mime types
    extensionToMime: Map<string, string[]> = new Map([
        ["jpg", ["image/jpeg"]],
        ["jpeg", ["image/jpeg"]],
        ["png", ["image/png"]],
        ["webp", ["image/webp"]],
        ["heic", ["image/heic", "image/heif"]],
        ["heif", ["image/heic", "image/heif"]],
        ["avif", ["image/avif"]],
        ["tif", ["image/tiff"]],
        ["tiff", ["image/tiff"]],
        ["bmp", ["image/bmp"]],
        ["svg", ["image/svg+xml"]],
        ["gif", ["image/gif"]],
        // ["mov", ["video/quicktime"]]
    ]);

    constructor(private app: App) { }

    /**
     * Checks if an HTMLImageElement is an Excalidraw image.
     * Excalidraw images should be excluded from all plugin functionality.
     *
     * @param imgElement The HTMLImageElement to check.
     * @returns True if it's an Excalidraw image, false otherwise.
     */
    isExcalidrawImage(imgElement: HTMLImageElement): boolean {
        // Check if the image element has Excalidraw-specific classes
        if (imgElement.classList.contains('excalidraw-svg') ||
            imgElement.classList.contains('excalidraw-embedded-img') ||
            imgElement.classList.contains('excalidraw-canvas-immersive')) {
            return true;
        }

        // Check if the image is contained within an Excalidraw container
        const excalidrawContainer = imgElement.closest('.excalidraw-svg');
        if (excalidrawContainer) {
            return true;
        }

        // Check if the image is within an internal-embed with Excalidraw source
        const internalEmbed = imgElement.closest('.internal-embed');
        if (internalEmbed) {
            const srcAttr = internalEmbed.getAttribute('src');
            if (srcAttr && srcAttr.includes('Excalidraw/')) {
                return true;
            }
        }

        // Check if the image has a filesource attribute pointing to an Excalidraw file
        const filesource = imgElement.getAttribute('filesource');
        if (filesource && (filesource.includes('Excalidraw/') || filesource.endsWith('.excalidraw.md'))) {
            return true;
        }

        // Check if the image src is a blob URL and has Excalidraw context
        const src = imgElement.getAttribute('src');
        if (src && src.startsWith('blob:') && 
            (imgElement.hasAttribute('filesource') || imgElement.closest('.excalidraw-svg'))) {
            return true;
        }

        return false;
    }

    /**
     * Checks if a file is a supported image format based on its mime type or extension.
     * This method does not perform any I/O and relies on the provided mime type or filename.
     *
     * @param mimeType The mime type of the file (preferred).
     * @param filename The name of the file (used for extension-based fallback).
     * @returns True if the file is a supported image, false otherwise.
     */
    isSupported(mimeType?: string, filename?: string): boolean {
        // 1. Mime Type Check (Preferred)
        if (mimeType && this.supportedMimeTypes.has(mimeType)) {
            return true;
        }

        // 2. Extension Check (Fallback)
        if (filename) {
            const extension = filename.split(".").pop()?.toLowerCase();
            if (extension && this.supportedExtensions.has(extension)) {
                // For heic/heif, double check with header if mimeType is unreliable
                if ((extension === 'heic' || extension === 'heif') && (!mimeType || !this.supportedMimeTypes.has(mimeType))) {
                    return true; // Let header check in processImage decide for HEIC/HEIF
                }
                return true;
            }
        }

        return false;
    }

    /**
     * Determines the mime type of a TFile from Obsidian's metadata cache.
     *
     * @param file The TFile to get the mime type for.
     * @returns The mime type string or undefined if not found in the cache.
     */
    getMimeTypeFromCache(file: TFile): string | undefined {
        const metadata: CachedMetadata | null =
            this.app.metadataCache.getFileCache(file);
        return metadata?.frontmatter?.mime || metadata?.frontmatter?.type;
    }

    /**
     * Gets the possible extensions associated with a given mime type.
     *
     * @param mimeType The mime type to look up.
     * @returns An array of extensions or undefined if the mime type is not found.
     */
    getExtensionsFromMimeType(mimeType: string): string[] | undefined {
        const extensions: string[] = [];
        this.extensionToMime.forEach((mimeTypes, ext) => {
            if (mimeTypes.includes(mimeType)) {
                extensions.push(ext);
            }
        });
        return extensions.length > 0 ? extensions : undefined;
    }
    
    /**
     * Reads the first few bytes of a File object to determine its mime type.
     * This is an asynchronous operation as it involves reading from a file.
     *
     * @param file The File object.
     * @returns A Promise that resolves to the mime type string.
     */
    async getMimeTypeFromFile(file: Blob): Promise<string> {
        try {
            // Read a small slice of the blob directly to avoid relying on FileReader mocks
            const slice = file.slice(0, 24);
            const arrayBuffer = await slice.arrayBuffer();

            const arr = new Uint8Array(arrayBuffer).subarray(0, 12); // Read up to 12 bytes
            let headerHex = "";
            for (let i = 0; i < arr.length; i++) {
                const hex = arr[i].toString(16).padStart(2, '0'); // Ensure two digits
                headerHex += hex;
            }
            headerHex = headerHex.toLowerCase(); // Use lowercase for comparison

            // Basic mime type checking based on file header
            if (headerHex.startsWith("89504e47")) { // PNG
                return "image/png";
            }
            if (headerHex.startsWith("47494638")) { // GIF
                return "image/gif";
            }
            if (headerHex.startsWith("ffd8ffe")) { // JPEG (starts with ffd8ffe and then can have 0, 1, 2, 3, or 8)
                return "image/jpeg";
            }
            if (headerHex.startsWith('424d')) { // BMP
                return 'image/bmp';
            }
            if (headerHex.startsWith('000000') && headerHex.substring(8, 16) === '66747970') {// HEIC/HEIF & AVIF - ftyp check
                const ftyp = this.getFtyp(arrayBuffer);

                if (ftyp !== null) {
                    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(ftyp)) {
                        return 'image/heic'; // It's HEIC/HEIF
                    }
                    if (['avif', 'avis'].includes(ftyp)) {
                        return 'image/avif'; // It's AVIF
                    }
                }
            }
            if (headerHex.startsWith('4949') || headerHex.startsWith('4d4d')) { // TIFF (II or MM)
                return 'image/tiff';
            }
            if (headerHex.startsWith('52494646')) { // 'RIFF'
                // Check bytes 8..11 for 'WEBP' signature (each byte = 2 hex chars => positions 16..24)
                const webpSig = headerHex.substring(16, 24);
                if (webpSig === '57454250') { // 'WEBP'
                    return 'image/webp';
                }
            }

            // Unrecognized header -> fall back to Blob.type if available
            if (file.type && file.type.length > 0) {
                return file.type;
            }
            return "unknown";
        } catch (error) {
            console.error("Error reading file:", error);
            // On error, fall back to Blob.type if available
            if (file.type && file.type.length > 0) {
                return file.type;
            }
            return "unknown";
        }
    }

    // Helper function to extract ftyp from HEIF/AVIF header (ISO Base Media File Format)
    private getFtyp(buffer: ArrayBuffer): string | null {
        const view = new DataView(buffer);
        // ftyp box is typically at offset 4, after size (4 bytes) and type (4 bytes 'ftyp')
        const majorBrandOffset = 8;
    
        // console.log("getFtyp - buffer.byteLength:", buffer.byteLength, ", majorBrandOffset:", majorBrandOffset); 
    
        if (buffer.byteLength < majorBrandOffset + 4) {
            // console.log("getFtyp - Buffer too short");
            return null; // Check buffer length
        }
    
        const majorBrandCode = view.getUint32(majorBrandOffset, false);
        const brandChars = String.fromCharCode(
            (majorBrandCode >> 24) & 0xFF,
            (majorBrandCode >> 16) & 0xFF,
            (majorBrandCode >> 8) & 0xFF,
            majorBrandCode & 0xFF
        );
    
        // console.log("getFtyp - majorBrandCode (hex):", majorBrandCode.toString(16)); 
        // console.log("getFtyp - brandChars:", brandChars);
    
        return brandChars.trim(); // Return ftyp brand
    }

}
